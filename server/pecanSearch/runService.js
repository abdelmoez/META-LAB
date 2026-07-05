/**
 * pecanSearch/runService.js — the Pecan Search Engine orchestration brain.
 *
 * Owns the lifecycle of a search RUN: create (snapshot the query + per-source
 * translations + durable job), process (seed the dedup index, fan out sources with
 * bounded concurrency, aggregate honest partial-success counts), cancel, retry, and
 * the read models (list/get/detail/duplicates) the controller serves.
 *
 * The worker (pecanSearchWorker.js) only claims a job and calls processRun; ALL
 * business logic lives here so it is unit/integration-testable without the worker.
 */
import { prisma } from '../db/client.js';
import { v4 as uuid } from 'uuid';
import { emitToMetaLabProject } from '../realtime/bus.js';
import { featureAccess } from '../services/featureAccess.js';
import { createLinkedScreenProject } from '../screening/createScreenProject.js';
import { getMetaSiftSettings } from '../screening/settings.js';
import { DEFAULT_MAX_RECORDS_PER_PROJECT } from '../services/screeningImportService.js';
import { createEngineContext, isProviderImplemented } from './connectors/registry.js';
import { runSource } from './pipeline.js';
import { normalizeCanonical, renderPlain, validateCanonical } from './query/ast.js';
import { PROVIDER_IDS } from './config.js';

export const ENGINE_VERSION = 'pecan-search-1.0.0';

/** Read the admin `searchProviderSettings` policy block (non-secret). */
export async function loadProviderSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'searchProviderSettings' } });
    return row ? JSON.parse(row.value || '{}') : {};
  } catch { return {}; }
}

/**
 * The `pecanSearch` global feature flag (default OFF → endpoints 404).
 *
 * Prompt 60 — co-dependency: Pecan Search runs the strategy built by the Search
 * Builder, so it is INERT unless `searchEngine` is also ON. Enforcing it here (the
 * single server gate every /api/pecan-search endpoint calls) means a stored
 * `pecanSearch:true, searchEngine:false` state can never launch a run — the engine
 * is silent without its dependency, regardless of how the flags were toggled.
 */
export async function pecanSearchEnabled(user = null) {
  // 75.md Phase 7 — routed through the central seam. The pecan→searchEngine hard
  // dependency now lives in featureAccess's FEATURE_DEPS table (single source of
  // truth). With no `user` (living's runtime co-dependency check, the overview
  // status report) this is plain flag state; a gate passes `req.user` so admins
  // keep the feature usable while it is globally OFF.
  return (await featureAccess('pecanSearch', user)).allowed;
}

/** Build the engine context (config + http + connectors) from env + admin policy. */
export async function buildEngine(overrides = {}) {
  const settings = await loadProviderSettings();
  return createEngineContext(process.env, settings, overrides);
}

/**
 * resolveLandingProject — the ScreenProject that search results land into for a
 * META·LAB project. Finds the existing linked project, else creates one (so a
 * search always has a screening destination), mirroring the normal link flow.
 */
async function resolveLandingProject(metaLabProjectId, ownerId) {
  const existing = await prisma.screenProject.findFirst({
    where: { linkedMetaLabProjectId: metaLabProjectId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, ownerId: true },
  });
  if (existing) return existing;
  const ml = await prisma.project.findUnique({ where: { id: metaLabProjectId }, select: { name: true, data: true, userId: true } });
  if (!ml) return null;
  let mlData = {};
  try { mlData = JSON.parse(ml.data || '{}'); } catch { mlData = {}; }
  const sp = await createLinkedScreenProject({
    ownerId: ownerId || ml.userId,
    title: ml.name || 'Imported search',
    linkedMetaLabProjectId: metaLabProjectId,
    mlData,
  });
  return { id: sp.id, ownerId: sp.ownerId };
}

/**
 * startRun(params) — create a durable run + its per-source rows + a queued job.
 * Idempotent on idempotencyKey (a refresh/retry of the start call returns the
 * same run rather than launching a duplicate).
 *
 * @returns {{ run, created:boolean }}
 */
export async function startRun(params, deps = {}) {
  const {
    metaLabProjectId, user, name = '', canonicalQuery, sources = [],
    caps = {}, idempotencyKey = '', engineOverrides = {},
  } = params;

  const key = idempotencyKey ? String(idempotencyKey).slice(0, 200) : null;

  // Idempotency (fast path): an existing run with this key for this project wins.
  if (key) {
    const existing = await prisma.pecanSearchRun.findFirst({
      where: { metaLabProjectId, idempotencyKey: key }, orderBy: { createdAt: 'desc' },
    });
    if (existing) return { run: existing, created: false };
  }

  const engine = await buildEngine(engineOverrides);

  // Concurrency guard + quota (§12.3, §20.4): at most maxActiveRunsPerProject
  // non-terminal runs per project. If one already exists and no idempotency key
  // was supplied, return the most recent active run (so a refresh/double-submit
  // re-attaches instead of launching a parallel run that would double-count).
  const active = await prisma.pecanSearchRun.findMany({
    where: { metaLabProjectId, state: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (active.length) {
    if (!key) return { run: active[0], created: false };
    if (active.length >= engine.config.engine.maxActiveRunsPerProject) {
      const e = new Error('Too many searches are already running for this project.');
      e.code = 'QUOTA_EXCEEDED'; e.userMessage = 'Too many searches are already running for this project. Wait for one to finish.';
      throw e;
    }
  }
  const canonical = normalizeCanonical(canonicalQuery);
  const v = validateCanonical(canonical);
  if (!v.ok) { const e = new Error(v.errors.join(' ')); e.code = 'INVALID_QUERY'; e.userMessage = v.errors.join(' '); throw e; }

  // Resolve + validate the selected providers (drop unavailable, warn).
  const warnings = [];
  const selected = [];
  const requested = Array.isArray(sources) ? sources : [];
  for (const s of requested) {
    const id = typeof s === 'string' ? s : (s && s.provider);
    if (!PROVIDER_IDS.includes(id)) { warnings.push(`Unknown source "${id}" was ignored.`); continue; }
    const p = engine.config.providers[id];
    if (!isProviderImplemented(id)) { warnings.push(`${p.label} is not yet available and was skipped.`); continue; }
    if (!p.available) { warnings.push(`${p.label} is disabled or unconfigured and was skipped.`); continue; }
    selected.push({ id, override: (s && typeof s.override === 'string') ? s.override.slice(0, 12000) : '' });
  }
  if (!selected.length) { const e = new Error('No usable sources were selected.'); e.code = 'INVALID_QUERY'; e.userMessage = 'No usable sources were selected.'; throw e; }

  const landing = await resolveLandingProject(metaLabProjectId, user.id);
  if (!landing) { const e = new Error('Project not found'); e.code = 'AUTHORIZATION_FAILED'; e.userMessage = 'Project not found.'; throw e; }

  const config = {
    sources: selected.map((s) => s.id),
    caps,
    filters: canonical.filters,
    defaultResultCap: engine.config.engine.defaultResultCap,
    maxResultCap: engine.config.engine.maxResultCap,
    concurrency: engine.config.engine.concurrency,
  };

  const runId = uuid();
  let run;
  try {
    run = await prisma.pecanSearchRun.create({
      data: {
        id: runId, metaLabProjectId, screenProjectId: landing.id,
        initiatedById: user.id, initiatedByName: user.name || user.email || '',
        name: String(name || '').slice(0, 200) || 'Search ' + new Date().toISOString().slice(0, 10),
        state: 'queued',
        canonicalQuery: JSON.stringify(canonical).slice(0, 60000),
        canonicalText: renderPlain(canonical).slice(0, 12000),
        config: JSON.stringify(config).slice(0, 20000),
        counts: '{}',
        warningSummary: JSON.stringify(warnings).slice(0, 8000),
        idempotencyKey: key, // null when no key → never collides; a duplicate key → P2002 below
        softwareVersion: ENGINE_VERSION, engineVersion: ENGINE_VERSION,
      },
    });
  } catch (err) {
    // Atomic idempotency: a concurrent start with the same key won the unique
    // [metaLabProjectId, idempotencyKey] race — return THE winner, create nothing.
    if (err && err.code === 'P2002' && key) {
      const winner = await prisma.pecanSearchRun.findFirst({ where: { metaLabProjectId, idempotencyKey: key }, orderBy: { createdAt: 'desc' } });
      if (winner) return { run: winner, created: false };
    }
    throw err;
  }

  // Per-source rows with translated queries (exact executed query stored).
  for (const s of selected) {
    const connector = engine.connectors[s.id];
    let tr;
    try { tr = connector.translateQuery(canonical, { override: s.override }); }
    catch (err) { tr = { query: '', queryHash: '', warnings: [String(err && err.message || 'translation failed')], version: '' }; }
    const cap = clampCap(caps[s.id], engine.config.providers[s.id]);
    await prisma.pecanSearchSource.create({
      data: {
        runId, provider: s.id, providerVersion: tr.version || '',
        generatedQuery: (tr.query || '').slice(0, 12000),
        finalQuery: (tr.query || '').slice(0, 12000),
        queryHash: tr.queryHash || '',
        translationWarnings: JSON.stringify(tr.warnings || []).slice(0, 8000),
        overrideById: s.override ? user.id : '',
        filters: JSON.stringify(canonical.filters).slice(0, 4000),
        cap, state: 'pending', stage: 'queued',
      },
    });
  }

  const job = await prisma.pecanSearchJob.create({
    data: { id: uuid(), runId, metaLabProjectId, status: 'queued', stage: 'queued', payload: JSON.stringify({ runId }).slice(0, 4000) },
  });
  await prisma.pecanSearchRun.update({ where: { id: runId }, data: { jobId: job.id } });

  // Kick the worker (lazy import to avoid a cycle at module load). Tests pass
  // deps.autoKick=false and drive processRun directly with a mock fetch.
  if (deps.autoKick !== false) {
    try { const m = await import('./pecanSearchWorker.js'); m.kickPecanSearchWorker(); } catch { /* boot hook will drain */ }
  }

  emitRunEvent(run.metaLabProjectId, landing.ownerId, runId, { state: 'queued', stage: 'queued' });
  return { run, created: true };
}

function clampCap(requested, providerCfg) {
  const n = Number(requested);
  const max = providerCfg ? providerCfg.maxCap : 10000;
  const dflt = providerCfg ? providerCfg.defaultCap : 2000;
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.max(1, Math.min(Math.floor(n), max));
}

/**
 * processRun(job) — execute a queued/processing job's run to completion.
 * Called ONLY by the worker. Idempotent: a re-run (crash recovery) resumes from
 * each source's persisted cursor and never double-imports.
 */
export async function processRun(job, deps = {}) {
  const runId = job.runId;
  const run = await prisma.pecanSearchRun.findUnique({ where: { id: runId } });
  if (!run) return;
  if (['completed', 'cancelled', 'failed'].includes(run.state) && !deps.force) {
    await finishJob(job.id, 'completed');
    return;
  }
  if (run.cancelRequested) { await finalizeRun(run, 'cancelled'); await finishJob(job.id, 'cancelled'); return; }

  const sources = await prisma.pecanSearchSource.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
  const screen = await prisma.screenProject.findUnique({ where: { id: run.screenProjectId }, select: { id: true, ownerId: true } });
  if (!screen) { await finalizeRun(run, 'failed', 'Landing project was removed.'); await finishJob(job.id, 'failed'); return; }

  await prisma.pecanSearchRun.update({ where: { id: runId }, data: { state: 'running', startedAt: run.startedAt || new Date() } });
  emitRunEvent(run.metaLabProjectId, screen.ownerId, runId, { state: 'running', stage: 'running' });

  const engine = await buildEngine(deps.engineOverrides || {});
  const settings = await getMetaSiftSettings().catch(() => ({}));
  const maxRecordsPerProject = Number(settings.maxRecordsPerProject) > 0 ? Number(settings.maxRecordsPerProject) : DEFAULT_MAX_RECORDS_PER_PROJECT;
  const secrets = Object.values(engine.config.providers).map((p) => p.apiKey).filter(Boolean);

  // Seed the dedup index from the project's CURRENT records (incl. anything a
  // prior attempt landed → idempotent re-import).
  const { createDedupIndex } = await import('./dedup.js');
  const existing = await prisma.screenRecord.findMany({
    where: { projectId: screen.id }, select: { id: true, doi: true, pmid: true, title: true, year: true, authors: true, journal: true },
  });
  const index = createDedupIndex(existing, { fuzzyCeiling: deps.fuzzyCeiling });

  const isCancelled = async () => {
    try { const r = await prisma.pecanSearchRun.findUnique({ where: { id: runId }, select: { cancelRequested: true } }); return !!(r && r.cancelRequested); }
    catch { return false; }
  };
  const onPageProgress = async (patch) => {
    try {
      await prisma.pecanSearchJob.update({ where: { id: job.id }, data: { heartbeatAt: new Date(), stage: patch.provider ? `fetching:${patch.provider}` : 'running' } });
    } catch { /* ignore */ }
    emitRunEvent(run.metaLabProjectId, screen.ownerId, runId, { state: 'running', stage: 'fetching', provider: patch.provider });
  };

  // Fan out sources with bounded concurrency.
  const concurrency = Math.max(1, engine.config.engine.concurrency);
  const queue = sources.filter((s) => s.state !== 'completed'); // resume: skip done sources
  await runWithConcurrency(queue, concurrency, async (sourceRow) => {
    const connector = engine.connectors[sourceRow.provider];
    if (!connector || !engine.config.providers[sourceRow.provider]?.available) {
      await prisma.pecanSearchSource.update({ where: { id: sourceRow.id }, data: { state: 'skipped', stage: 'skipped', errorClass: 'PROVIDER_DISABLED', errorDetail: 'Provider unavailable at run time.', completedAt: new Date() } });
      return;
    }
    const translated = { provider: sourceRow.provider, query: sourceRow.finalQuery, queryHash: sourceRow.queryHash };
    await runSource({
      sourceRow, connector, translated, index,
      screenProjectId: screen.id, metaLabProjectId: run.metaLabProjectId,
      config: engine.config, secrets, signal: null, isCancelled, onPageProgress,
      maxRecordsPerProject, initiatedById: run.initiatedById, initiatedByName: run.initiatedByName,
    });
  });

  // Aggregate + finalize.
  const finalSources = await prisma.pecanSearchSource.findMany({ where: { runId } });
  const cancelled = await isCancelled();
  const runState = deriveRunState(finalSources, cancelled);
  await finalizeRun(run, runState);
  await finishJob(job.id, runState === 'failed' ? 'failed' : 'completed');
  emitRunEvent(run.metaLabProjectId, screen.ownerId, runId, { state: runState, stage: runState });
}

/** Derive the honest run state from per-source outcomes. */
export function deriveRunState(sources, cancelled) {
  if (cancelled) return 'cancelled';
  const states = sources.map((s) => s.state);
  const done = states.filter((s) => s === 'completed').length;
  const failed = states.filter((s) => s === 'failed').length;
  const partial = states.filter((s) => s === 'partial').length;
  const cancel = states.filter((s) => s === 'cancelled').length;
  const total = states.length;
  if (cancel > 0 && done === 0) return 'cancelled';
  if (done === total) return 'completed';
  if (done === 0 && (failed + partial + cancel) === total && partial === 0) return 'failed';
  return 'partial'; // some succeeded, some did not → honest partial success
}

/** Aggregate per-source counts into the run-level counts object. */
export function aggregateCounts(sources) {
  const c = { rawRetrieved: 0, normalized: 0, imported: 0, existingMatched: 0, exactDup: 0, fuzzyDup: 0, ambiguousDup: 0, failedRecords: 0, sourcesCompleted: 0, sourcesFailed: 0, sourcesPartial: 0, perSource: {} };
  for (const s of sources) {
    c.rawRetrieved += s.rawCount || 0;
    c.normalized += s.normalizedCount || 0;
    c.imported += s.importedCount || 0;
    c.existingMatched += s.existingMatchCount || 0;
    c.exactDup += s.exactDupCount || 0;
    c.fuzzyDup += s.fuzzyDupCount || 0;
    c.ambiguousDup += s.ambiguousDupCount || 0;
    c.failedRecords += s.failedRecordCount || 0;
    if (s.state === 'completed') c.sourcesCompleted += 1;
    else if (s.state === 'failed') c.sourcesFailed += 1;
    else if (s.state === 'partial') c.sourcesPartial += 1;
    c.perSource[s.provider] = {
      raw: s.rawCount || 0, imported: s.importedCount || 0, existingMatched: s.existingMatchCount || 0,
      exactDup: s.exactDupCount || 0, fuzzyDup: s.fuzzyDupCount || 0, ambiguousDup: s.ambiguousDupCount || 0,
      failed: s.failedRecordCount || 0, capReached: !!s.capReached, state: s.state,
    };
  }
  return c;
}

async function finalizeRun(run, state, errorSummary = '') {
  const sources = await prisma.pecanSearchSource.findMany({ where: { runId: run.id } });
  const counts = aggregateCounts(sources);
  const errs = sources.filter((s) => s.errorDetail).map((s) => `${s.provider}: ${s.errorDetail}`);
  await prisma.pecanSearchRun.update({
    where: { id: run.id },
    data: {
      state, counts: JSON.stringify(counts).slice(0, 40000),
      errorSummary: (errorSummary || errs.join(' | ')).slice(0, 4000),
      completedAt: new Date(),
      ...(state === 'cancelled' ? { cancelledAt: new Date() } : {}),
    },
  });
}

async function finishJob(jobId, status) {
  try { await prisma.pecanSearchJob.update({ where: { id: jobId }, data: { status, stage: status, finishedAt: new Date(), progress: status === 'completed' ? 100 : -1 } }); }
  catch { /* ignore */ }
}

/** Cancel a run: durable intent the running pipeline observes between pages. */
export async function cancelRun(runId) {
  const run = await prisma.pecanSearchRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  if (['completed', 'failed', 'cancelled'].includes(run.state)) return run;
  await prisma.pecanSearchRun.update({ where: { id: runId }, data: { cancelRequested: true } });
  // If a job is still QUEUED (no worker has claimed it), atomically flip it to
  // cancelled and finalize the run synchronously — otherwise a queued run would
  // sit "cancelRequested" forever until a worker happens to pick it up.
  const flipped = await prisma.pecanSearchJob.updateMany({ where: { runId, status: 'queued' }, data: { status: 'cancelled', stage: 'cancelled', finishedAt: new Date() } });
  await prisma.pecanSearchJob.updateMany({ where: { runId, status: 'processing' }, data: { stage: 'cancelling' } });
  if (flipped.count > 0) {
    // Was unclaimed → safe to finalize now (the worker can no longer pick it up).
    const stillUnclaimed = await prisma.pecanSearchJob.count({ where: { runId, status: 'processing' } });
    if (stillUnclaimed === 0) await finalizeRun(run, 'cancelled');
  }
  return prisma.pecanSearchRun.findUnique({ where: { id: runId } });
}

/** Retry the failed/partial sources of a run (resume from each source's cursor). */
export async function retryRun(runId) {
  const run = await prisma.pecanSearchRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  // Only retry runs that represent UNINTENDED incomplete work (failed/partial).
  // Excludes queued/running (would reset sources under a live worker + enqueue a
  // second job) AND completed/cancelled (an explicit cancel stays sticky — a new
  // search must be started rather than silently un-cancelling §12.4).
  if (!['failed', 'partial'].includes(run.state)) return run;
  const liveJob = await prisma.pecanSearchJob.count({ where: { runId, status: { in: ['queued', 'processing'] } } });
  if (liveJob > 0) return run;
  const retryable = await prisma.pecanSearchSource.findMany({ where: { runId, state: { in: ['failed', 'partial'] } } });
  if (!retryable.length) return run;
  for (const s of retryable) {
    await prisma.pecanSearchSource.update({ where: { id: s.id }, data: { state: 'pending', stage: 'queued', errorClass: '', errorDetail: '', retryCount: (s.retryCount || 0) + 1, completedAt: null } });
  }
  await prisma.pecanSearchRun.update({ where: { id: runId }, data: { state: 'queued', cancelRequested: false, completedAt: null } });
  const job = await prisma.pecanSearchJob.create({ data: { id: uuid(), runId, metaLabProjectId: run.metaLabProjectId, status: 'queued', stage: 'queued', payload: JSON.stringify({ runId, retry: true }) } });
  await prisma.pecanSearchRun.update({ where: { id: runId }, data: { jobId: job.id } });
  try { const m = await import('./pecanSearchWorker.js'); m.kickPecanSearchWorker(); } catch { /* boot drains */ }
  return prisma.pecanSearchRun.findUnique({ where: { id: runId } });
}

/** Run an async fn over items with a max in-flight concurrency. */
async function runWithConcurrency(items, concurrency, fn) {
  const queue = [...items];
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push((async () => { for (;;) { const item = queue.shift(); if (item === undefined) break; await fn(item); } })());
  }
  await Promise.all(workers);
}

function emitRunEvent(metaLabProjectId, ownerId, runId, extra = {}) {
  try { emitToMetaLabProject(metaLabProjectId, ownerId, { type: 'search.run.progress', runId, ...extra }); } catch { /* best-effort */ }
}

// ── Read models ──────────────────────────────────────────────────────────────

export async function getRunSummary(runId) {
  const run = await prisma.pecanSearchRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const sources = await prisma.pecanSearchSource.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
  return shapeRun(run, sources);
}

export async function listRuns(metaLabProjectId, { skip = 0, take = 20 } = {}) {
  const [rows, total] = await Promise.all([
    prisma.pecanSearchRun.findMany({ where: { metaLabProjectId }, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.pecanSearchRun.count({ where: { metaLabProjectId } }),
  ]);
  const out = [];
  for (const run of rows) {
    const sources = await prisma.pecanSearchSource.findMany({ where: { runId: run.id }, select: { provider: true, state: true, importedCount: true, rawCount: true } });
    out.push(shapeRunListItem(run, sources));
  }
  return { runs: out, total, skip, take };
}

export function shapeRun(run, sources) {
  return {
    id: run.id, name: run.name, state: run.state,
    metaLabProjectId: run.metaLabProjectId, screenProjectId: run.screenProjectId,
    initiatedByName: run.initiatedByName,
    canonicalText: run.canonicalText,
    canonicalQuery: safeJson(run.canonicalQuery, {}),
    config: safeJson(run.config, {}),
    counts: safeJson(run.counts, {}),
    warnings: safeJson(run.warningSummary, []),
    errorSummary: run.errorSummary || '',
    cancelRequested: !!run.cancelRequested,
    startedAt: run.startedAt, completedAt: run.completedAt, cancelledAt: run.cancelledAt, createdAt: run.createdAt,
    engineVersion: run.engineVersion,
    sources: sources.map(shapeSource),
  };
}

function shapeRunListItem(run, sources) {
  return {
    id: run.id, name: run.name, state: run.state,
    initiatedByName: run.initiatedByName, canonicalText: run.canonicalText,
    counts: safeJson(run.counts, {}),
    sources: sources.map((s) => ({ provider: s.provider, state: s.state, imported: s.importedCount, raw: s.rawCount })),
    createdAt: run.createdAt, startedAt: run.startedAt, completedAt: run.completedAt,
  };
}

export function shapeSource(s) {
  return {
    id: s.id, provider: s.provider, state: s.state, stage: s.stage,
    generatedQuery: s.generatedQuery, finalQuery: s.finalQuery, queryHash: s.queryHash,
    translationWarnings: safeJson(s.translationWarnings, []),
    previewCount: s.previewCount, previewKind: s.previewKind,
    rawCount: s.rawCount, normalizedCount: s.normalizedCount, importedCount: s.importedCount,
    existingMatchCount: s.existingMatchCount, exactDupCount: s.exactDupCount,
    fuzzyDupCount: s.fuzzyDupCount, ambiguousDupCount: s.ambiguousDupCount, failedRecordCount: s.failedRecordCount,
    cap: s.cap, capReached: s.capReached, retryCount: s.retryCount,
    errorClass: s.errorClass, errorDetail: s.errorDetail,
    startedAt: s.startedAt, completedAt: s.completedAt,
  };
}

function safeJson(s, dflt) { try { return JSON.parse(s || ''); } catch { return dflt; } }
