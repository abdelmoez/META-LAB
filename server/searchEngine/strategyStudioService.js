/**
 * strategyStudioService.js — P11 Guided Boolean search-strategy Studio (DB + business
 * layer; no Express). A bounded generator↔critic loop refines a per-database Boolean
 * strategy using the REAL per-DB hit counts already produced by the Pecan Search
 * connectors (server/pecanSearch/connectors/*), critiques each candidate, and persists
 * every iteration's provenance (executed string, live hit count, critic assessment,
 * what changed, timestamp) so the refinement trail is fully reproducible.
 *
 * The PURE engine (strategy generator / critic / recall estimator) is built by a
 * parallel agent under src/research-engine/searchBuilder/. It is imported lazily +
 * GUARDED here: if it has not yet landed, loadStudioEngine() returns null and the
 * controller answers 503 STUDIO_ENGINE_UNAVAILABLE rather than crashing.
 *
 * The real per-DB count path (buildEngine → connector.previewCount; PubMed esearch
 * rettype=count, OpenAlex meta.count) is reused verbatim via makeDefaultCountFetcher,
 * but the count fetcher is INJECTABLE (optimize/estimateRecallFor accept it) so tests
 * drive the loop deterministically without hitting live providers.
 */
import { prisma } from '../db/client.js';
import { getModuleState } from '../services/workflowState.js';
import { buildEngine } from '../pecanSearch/runService.js';
import { renderPlain } from '../pecanSearch/query/ast.js';
import { buildSearchDocumentation } from '../pecanSearch/report.js';

const SEARCH_MODULE = 'search';
export const DEFAULT_MAX_ITERATIONS = 4;   // bounded loop — no runaway external calls
const MAX_ITERATIONS_CEILING = 6;
const OPTIMIZE_DEADLINE_MS = 25000;        // synchronous but time-guarded (well under a proxy 504)
const DEFAULT_DATABASES = ['pubmed', 'openalex'];
const MAX_DATABASES = 7;

/* ── small utils ─────────────────────────────────────────────────────────── */
const str = (v) => String(v == null ? '' : v);
function safeJson(s, dflt) { try { return JSON.parse(s || ''); } catch { return dflt; } }
function normDoi(v) {
  const d = str(v).trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  return d ? d.slice(0, 300) : null;
}
function normPmid(v) {
  const m = str(v).trim().replace(/[^0-9]/g, '');
  return m ? m.slice(0, 20) : null;
}
function clampIterations(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_ITERATIONS;
  return Math.max(1, Math.min(n, MAX_ITERATIONS_CEILING));
}

/* ── Flag gate: studio depends on searchEngine + pecanSearch (all three ON) ── */
export async function studioEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    const flags = JSON.parse(row && row.value ? row.value : '{}');
    return flags.searchStrategyStudio === true
      && flags.searchEngine === true
      && flags.pecanSearch === true;
  } catch { return false; }
}

/* ── Guarded engine import (parallel agent owns the pure modules) ──────────── */
let _engine = null;
let _engineTried = false;
/** Lazily import the pure engine trio; null when not (yet) landed → route 503s. */
export async function loadStudioEngine() {
  if (_engineTried) return _engine;
  _engineTried = true;
  try {
    const [gen, crit, rec] = await Promise.all([
      import('../../src/research-engine/searchBuilder/strategyGenerator.js'),
      import('../../src/research-engine/searchBuilder/strategyCritic.js'),
      import('../../src/research-engine/searchBuilder/recallEstimate.js'),
    ]);
    if (gen && typeof gen.generateStrategies === 'function'
      && crit && typeof crit.critiqueStrategy === 'function'
      && rec && typeof rec.estimateRecall === 'function') {
      _engine = {
        generateStrategies: gen.generateStrategies,
        critiqueStrategy: crit.critiqueStrategy,
        estimateRecall: rec.estimateRecall,
        suggestQueryImprovements: typeof rec.suggestQueryImprovements === 'function' ? rec.suggestQueryImprovements : null,
      };
    }
  } catch { _engine = null; }
  return _engine;
}
/** Test hook — forget the memoized engine (so a test can inject/reset). */
export function _resetStudioEngineCache() { _engine = null; _engineTried = false; }

/* ── Stored strategy (the live 'search' workflow module) ──────────────────── */
async function loadStoredStrategy(pid) {
  const mod = await getModuleState(pid, SEARCH_MODULE);
  const st = (mod && mod.state) || {};
  return {
    concepts: Array.isArray(st.concepts) ? st.concepts : [],
    filters: st.filters && typeof st.filters === 'object' ? st.filters : {},
    databases: Array.isArray(st.databases) ? st.databases.filter((d) => typeof d === 'string') : [],
  };
}

function normalizeDatabases(optDbs, storedDbs) {
  const pick = Array.isArray(optDbs) && optDbs.length ? optDbs
    : (Array.isArray(storedDbs) && storedDbs.length ? storedDbs : DEFAULT_DATABASES);
  const seen = new Set();
  const out = [];
  for (const d of pick) {
    const id = str(d).trim();
    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
    if (out.length >= MAX_DATABASES) break;
  }
  return out.length ? out : DEFAULT_DATABASES.slice();
}

/* ── Real per-DB count fetcher (reuses the Pecan connectors' previewCount) ─── */
/**
 * makeDefaultCountFetcher — the production count path. Builds the engine context
 * (buildEngine → createEngineContext → connectors) once, then returns
 * countFetcher(database, searchString) → { count, kind, at }. Only providers with a
 * connector that supportsCountPreview return a real number; everything else reports
 * 'unsupported'. Each call is time-guarded (previewTimeoutMs fast-fail + abort) and
 * inherits the connector's own throttle + the http client's retry/backoff, so the
 * loop can never flood a provider.
 */
export async function makeDefaultCountFetcher(engineOverrides = {}) {
  const engine = await buildEngine(engineOverrides);
  const eng = engine.config.engine;
  return async function countFetcher(database, searchString) {
    const at = new Date().toISOString();
    const connector = engine.connectors[database];
    const p = engine.config.providers[database];
    if (!connector || !p || !p.available || !p.supportsCountPreview || typeof connector.previewCount !== 'function') {
      return { count: null, kind: 'unsupported', at };
    }
    const q = typeof searchString === 'string' ? searchString.trim() : '';
    if (!q) return { count: null, kind: 'unavailable', at };
    const ac = new AbortController();
    let timer = null;
    try {
      const onDeadline = new Promise((resolve) => {
        timer = setTimeout(() => { try { ac.abort(); } catch { /* ignore */ } resolve({ count: null, kind: 'timeout' }); }, (eng.previewTimeoutMs || 7000) + 750);
      });
      const pc = await Promise.race([
        connector.previewCount({ query: q }, { signal: ac.signal, timeoutMs: eng.previewTimeoutMs, retryLimit: eng.previewRetryLimit }),
        onDeadline,
      ]);
      if (!pc) return { count: null, kind: 'unavailable', at };
      return { count: pc.count == null ? null : Number(pc.count), kind: pc.kind || 'unavailable', at: pc.at || at };
    } catch {
      try { ac.abort(); } catch { /* ignore */ }
      return { count: null, kind: 'unavailable', at };
    } finally { if (timer) clearTimeout(timer); }
  };
}

/* ── PURE generator↔critic loop (fully injected — testable, no DB/HTTP) ────── */
/**
 * computeOptimization({concepts,databases,filters,options}, deps) — the bounded loop.
 * deps: { generateStrategies, critiqueStrategy, countFetcher, maxIterations, seedRecall,
 *         config, deadlineAt, now }.  Returns { iterationRecords, finalStrategies, notes }
 * where iterationRecords are plain objects the caller persists as SearchStrategyIteration.
 *
 * Each pass: fetch the REAL count for every DB → critique each candidate (given its own
 * count + sibling counts + optional seed recall) → record one iteration row per DB. If
 * no critic proposes a revision (converged / acceptable), stop early; otherwise apply the
 * revisions and loop, up to maxIterations, or until the wall-clock deadline is hit.
 */
export async function computeOptimization({ concepts, databases, filters, options } = {}, deps = {}) {
  const {
    generateStrategies, critiqueStrategy, countFetcher,
    maxIterations = DEFAULT_MAX_ITERATIONS, seedRecall = null, config = {},
    deadlineAt = Infinity, now = () => Date.now(),
  } = deps;

  const genOut = (await generateStrategies({ concepts, databases, filters, options })) || {};
  let strategies = Array.isArray(genOut.strategies) ? genOut.strategies.slice() : [];
  const notes = genOut.notes || '';
  const iterationRecords = [];
  // Per-DB record of how the CURRENT string was derived (for changesJson).
  const derivedFrom = new Map(); // db -> changes object; absent = initial

  let iter = 0;
  while (iter < maxIterations && strategies.length) {
    iter += 1;

    // 1) Real per-DB counts (bounded by the deadline).
    const counts = {};
    for (const s of strategies) {
      if (now() >= deadlineAt) { counts[s.database] = { count: null, kind: 'timeout' }; continue; }
      try { counts[s.database] = await countFetcher(s.database, s.searchString); }
      catch { counts[s.database] = { count: null, kind: 'unavailable' }; }
    }
    const siblingCounts = {};
    for (const [db, c] of Object.entries(counts)) siblingCounts[db] = c && c.count != null ? Number(c.count) : null;

    // 2) Critique + record each candidate; collect revisions for the next pass.
    let changedAny = false;
    const nextStrategies = [];
    for (const s of strategies) {
      const c = counts[s.database] || { count: null, kind: 'unavailable' };
      let critique = {};
      try {
        critique = (await critiqueStrategy({
          strategy: s, hitCount: c.count == null ? null : Number(c.count), hitKind: c.kind || 'unavailable',
          seedRecall, siblingCounts, config,
        })) || {};
      } catch { critique = { issues: [], score: null, suggestedEdits: [], revised: null }; }

      iterationRecords.push({
        iteration: iter,
        database: s.database,
        searchString: s.searchString,
        hitCount: c.count == null ? null : Number(c.count),
        hitKind: c.kind || 'unavailable',
        critic: critique,
        changes: derivedFrom.get(s.database) || { reason: 'initial' },
        profile: s.profile || '',
      });

      const revised = critique.revised && typeof critique.revised === 'object' ? critique.revised : null;
      const nextString = revised && typeof revised.searchString === 'string' ? revised.searchString : s.searchString;
      if (revised && nextString !== s.searchString) {
        changedAny = true;
        nextStrategies.push({ ...s, ...revised });
        derivedFrom.set(s.database, {
          from: s.searchString, to: nextString,
          edits: Array.isArray(critique.suggestedEdits) ? critique.suggestedEdits : [],
          issues: Array.isArray(critique.issues) ? critique.issues.map((i) => i && i.type).filter(Boolean) : [],
        });
      } else {
        nextStrategies.push(s);
      }
    }

    if (!changedAny) break; // converged — critic satisfied or proposed no change
    strategies = nextStrategies;
    if (now() >= deadlineAt) break;
  }

  return { iterationRecords, finalStrategies: strategies, notes };
}

/* ── generate: stored concepts → per-DB candidate strategies ──────────────── */
export async function generate(pid, opts = {}) {
  const engine = await loadStudioEngine();
  if (!engine) return { error: 'engine_unavailable' };
  const { concepts, filters, databases: storedDbs } = await loadStoredStrategy(pid);
  if (!concepts.length) return { error: 'no_concepts' };
  const databases = normalizeDatabases(opts.databases, storedDbs);
  const out = (await engine.generateStrategies({ concepts, databases, filters, options: opts.options || {} })) || {};
  return { candidates: { strategies: Array.isArray(out.strategies) ? out.strategies : [], notes: out.notes || '' }, databases };
}

/* ── optimize: bounded generate→count→critic loop + persist provenance ─────── */
export async function optimize(pid, opts = {}, injected = {}) {
  const engine = await loadStudioEngine();
  if (!engine) return { error: 'engine_unavailable' };
  const { concepts, filters, databases: storedDbs } = await loadStoredStrategy(pid);
  if (!concepts.length) return { error: 'no_concepts' };

  const databases = normalizeDatabases(opts.databases, storedDbs);
  const countFetcher = injected.countFetcher || await makeDefaultCountFetcher();
  const maxIterations = clampIterations(opts.maxIterations);
  const user = injected.user || null;
  const deadlineAt = Date.now() + OPTIMIZE_DEADLINE_MS;

  const { iterationRecords, finalStrategies, notes } = await computeOptimization(
    { concepts, databases, filters, options: opts.options || {} },
    {
      generateStrategies: engine.generateStrategies,
      critiqueStrategy: engine.critiqueStrategy,
      countFetcher, maxIterations, seedRecall: opts.seedRecall ?? null,
      config: opts.config || {}, deadlineAt,
    },
  );

  // Persist every iteration (provenance: string, count, critic, changes, timestamp).
  const persisted = [];
  for (const r of iterationRecords) {
    const row = await prisma.searchStrategyIteration.create({
      data: {
        metaLabProjectId: pid,
        strategyVersionId: opts.strategyVersionId || null,
        iteration: r.iteration,
        database: str(r.database).slice(0, 100),
        searchString: str(r.searchString).slice(0, 20000),
        hitCount: Number.isFinite(Number(r.hitCount)) ? Number(r.hitCount) : null,
        hitKind: str(r.hitKind).slice(0, 40),
        criticJson: JSON.stringify(r.critic || {}).slice(0, 40000),
        changesJson: JSON.stringify(r.changes || {}).slice(0, 20000),
        profile: str(r.profile).slice(0, 200),
        createdById: (user && user.id) || null,
      },
    });
    persisted.push(shapeIteration(row));
  }

  return { iterations: persisted, finalStrategy: { strategies: finalStrategies, notes }, maxIterations };
}

/* ── iteration read model ─────────────────────────────────────────────────── */
export async function listIterations(pid, { limit = 300 } = {}) {
  const rows = await prisma.searchStrategyIteration.findMany({
    where: { metaLabProjectId: pid },
    orderBy: [{ createdAt: 'asc' }],
    take: Math.min(Math.max(1, Number(limit) || 300), 1000),
  });
  return rows.map(shapeIteration);
}

function shapeIteration(row) {
  return {
    id: row.id,
    iteration: row.iteration,
    database: row.database,
    searchString: row.searchString,
    hitCount: row.hitCount,
    hitKind: row.hitKind,
    critic: safeJson(row.criticJson, {}),
    changes: safeJson(row.changesJson, {}),
    profile: row.profile || '',
    strategyVersionId: row.strategyVersionId || null,
    createdAt: row.createdAt,
  };
}

/* ── Seed studies (known-included set for recall) — CRUD ──────────────────── */
export async function listSeeds(pid) {
  const rows = await prisma.searchSeedStudy.findMany({
    where: { metaLabProjectId: pid }, orderBy: { createdAt: 'asc' },
  });
  return rows.map(shapeSeed);
}

export async function addSeeds(pid, seeds, user) {
  const list = Array.isArray(seeds) ? seeds : (seeds ? [seeds] : []);
  const created = [];
  for (const s of list.slice(0, 500)) {
    if (!s || typeof s !== 'object') continue;
    const title = str(s.title).slice(0, 1000).trim();
    const doi = normDoi(s.doi);
    const pmid = normPmid(s.pmid);
    const openAlexId = (str(s.openAlexId).trim().slice(0, 100)) || null;
    if (!title && !doi && !pmid && !openAlexId) continue; // need at least one useful field
    const row = await prisma.searchSeedStudy.create({
      data: {
        metaLabProjectId: pid, title, doi, pmid, openAlexId,
        source: ['manual', 'import', 'run'].includes(s.source) ? s.source : 'manual',
        addedById: (user && user.id) || null,
        addedByName: (user && (user.name || user.email)) || null,
      },
    });
    created.push(shapeSeed(row));
  }
  return created;
}

export async function removeSeed(pid, sid) {
  const row = await prisma.searchSeedStudy.findUnique({ where: { id: sid } });
  if (!row || row.metaLabProjectId !== pid) return { error: 'not_found' };
  await prisma.searchSeedStudy.delete({ where: { id: sid } });
  return { ok: true };
}

function shapeSeed(row) {
  return {
    id: row.id, title: row.title || '',
    doi: row.doi || '', pmid: row.pmid || '', openAlexId: row.openAlexId || '',
    source: row.source || 'manual', addedByName: row.addedByName || '',
    createdAt: row.createdAt,
  };
}

/* ── Recall estimation (source 'run' intersection | 'probe' per-seed) ─────── */
/** Best-available PubMed strategy string for probing: the latest persisted pubmed
 *  iteration, else a rendered fallback from the stored concepts, else ''. */
async function resolvePubmedString(pid) {
  const last = await prisma.searchStrategyIteration.findFirst({
    where: { metaLabProjectId: pid, database: 'pubmed' },
    orderBy: [{ createdAt: 'desc' }],
    select: { searchString: true },
  });
  if (last && last.searchString) return last.searchString;
  try {
    const { concepts, filters } = await loadStoredStrategy(pid);
    if (concepts.length) return renderPlain({ concepts, filters });
  } catch { /* ignore */ }
  return '';
}

export async function estimateRecallFor(pid, { source = 'run', runId = null, strategyVersionId = null } = {}, injected = {}) {
  const engine = await loadStudioEngine();
  if (!engine) return { error: 'engine_unavailable' };
  const seeds = await listSeeds(pid);
  if (!seeds.length) return { error: 'no_seeds' };

  let retrieved = [];
  if (source === 'run') {
    if (!runId) return { error: 'run_required' };
    const run = await prisma.pecanSearchRun.findUnique({
      where: { id: runId }, select: { id: true, metaLabProjectId: true, screenProjectId: true },
    });
    if (!run || run.metaLabProjectId !== pid) return { error: 'run_not_found' };
    const recs = await prisma.screenRecord.findMany({
      where: { projectId: run.screenProjectId }, select: { doi: true, pmid: true },
    });
    retrieved = recs.map((r) => ({ doi: str(r.doi), pmid: str(r.pmid) }));
  } else if (source === 'probe') {
    const finalStr = await resolvePubmedString(pid);
    if (!finalStr) return { error: 'no_strategy' };
    const countFetcher = injected.countFetcher || await makeDefaultCountFetcher();
    // Per-seed membership: does the strategy (restricted to that PMID) return a hit?
    for (const seed of seeds) {
      if (!seed.pmid) continue; // probe requires a PMID
      const probeQuery = `(${finalStr}) AND ${seed.pmid}[uid]`;
      let c;
      try { c = await countFetcher('pubmed', probeQuery); } catch { c = null; }
      if (c && Number(c.count) >= 1) retrieved.push({ pmid: seed.pmid, doi: str(seed.doi) });
    }
  } else {
    return { error: 'bad_source' };
  }

  // The intersection (seed ↔ retrieved by DOI/PMID) is the engine's job. It returns
  // `found`/`notFound` as ARRAYS of seed objects (found carries a `matchedBy`).
  const est = engine.estimateRecall({ seeds, retrieved }) || {};
  const foundCount = Array.isArray(est.found) ? est.found.length
    : (Number.isFinite(Number(est.found)) ? Number(est.found) : 0);
  const notFound = est.notFound || est.missingAnalysis || [];
  let suggestions = [];
  if (engine.suggestQueryImprovements) {
    try {
      const { concepts } = await loadStoredStrategy(pid);
      const s = engine.suggestQueryImprovements({ notFound, concepts });
      suggestions = Array.isArray(s) ? s : (s && Array.isArray(s.suggestions) ? s.suggestions : []);
    } catch { suggestions = []; }
  }

  await prisma.searchRecallReport.create({
    data: {
      metaLabProjectId: pid,
      strategyVersionId: strategyVersionId || null,
      runId: runId || null,
      seedTotal: Number.isFinite(Number(est.seedTotal)) ? Number(est.seedTotal) : seeds.length,
      foundCount,
      estimatedRecall: est.estimatedRecall == null ? null : Number(est.estimatedRecall),
      missingJson: JSON.stringify({ notFound, suggestions }).slice(0, 40000),
    },
  });

  return { ...est, foundCount, source, suggestions };
}

/* ── PRISMA-S search documentation (extended report incl. the strategy trail) ─ */
export async function prismaS(pid, runId = null) {
  return buildSearchDocumentation({ projectId: pid, runId });
}
