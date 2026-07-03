/**
 * citationMining/citationMiningService.js — P15 Bibliomine service brain.
 *
 * Owns the lifecycle of citation mining for a META·LAB project:
 *   ingestSeed        — parse an uploaded review's reference list → SeedReview +
 *                       ExtractedReference rows (pure engine; no network).
 *   resolveSeed       — resolve each reference to a canonical record (bounded,
 *                       throttled, reuses the real bibliographic connectors).
 *   dedupePreview     — classify candidates/references against the project's
 *                       existing screening records (pure engine).
 *   importCandidates  — land selected candidates into screening via the SHARED
 *                       import path with a source:'citation-mining' batch +
 *                       per-record provenance; flip CitationCandidate.imported.
 *   startChase        — enqueue a bounded, cancellable, crash-resumable durable
 *                       CitationChaseJob (backward/forward citation chasing).
 *   processChase      — execute the bounded BFS (worker calls this ONLY; all logic
 *                       lives here so it is unit-testable without the worker).
 *   cancelChase       — durable cancel intent the running BFS observes each step.
 *
 * The pure engine (src/research-engine/citationMining) is built by a PARALLEL
 * workstream and may be ABSENT at runtime; engine-dependent operations throw a
 * typed CITATION_ENGINE_UNAVAILABLE (controller → 503) so the routes stay honest.
 * External fan-out is bounded everywhere: depth ≤ 3, maxCandidates cap, throttled
 * http client, cancel checks between nodes — no runaway jobs, no server lag.
 */
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { prisma } from '../db/client.js';
import { createLinkedScreenProject } from '../screening/createScreenProject.js';
import { dedupeAndInsertRecords } from '../services/screeningImportService.js';
import { keyForRecord } from '../services/citationEnrichmentService.js';
import { normalizeDoi, normalizePmid } from '../pecanSearch/normalize.js';
import { createResolver, bareOaId } from './resolver.js';
// P15 recs — import must share the SAME gating as file/Pecan imports: the admin
// import kill-switch (settings.allowImport), the layered per-project capacity cap
// (resolveScreeningUploadLimit → dedupeAndInsertRecords maxRecords), and the
// product-tier entitlement + record-limit (67.md).
import { getMetaSiftSettings } from '../screening/settings.js';
import { resolveScreeningUploadLimit } from '../screening/uploadLimit.js';
import { requireEntitlement, requireLimit, loadUserForTier } from '../services/entitlementService.js';

// ── Bounds (hard caps — a user request can never exceed these) ─────────────────
export const MAX_DEPTH = 3;                 // BFS depth ceiling (external fan-out guard)
export const MAX_CANDIDATES_CAP = 2000;     // per-job candidate ceiling
export const DEFAULT_MAX_CANDIDATES = 500;
export const MAX_REFS_PER_RESOLVE = 1000;   // references resolved per resolveSeed call
export const PER_NODE_LIMIT = 200;          // max candidates pulled from a single node

const clampInt = (v, dflt, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(Math.floor(n), max));
};
const asArray = (v) => (Array.isArray(v) ? v : []);
const safeJson = (s, dflt) => { try { const v = JSON.parse(s || ''); return v == null ? dflt : v; } catch { return dflt; } };
const authorsToStr = (a) => (Array.isArray(a) ? a.join('; ') : String(a || '')).slice(0, 500);

function engineUnavailable() {
  const e = new Error('The citation-mining engine is not available.');
  e.code = 'CITATION_ENGINE_UNAVAILABLE';
  return e;
}

// ── Pure engine (parallel workstream; may be absent) ───────────────────────────
let _engine; let _engineTried = false;
async function loadEngine() {
  if (_engineTried) return _engine;
  _engineTried = true;
  try { _engine = await import('../../src/research-engine/citationMining/index.js'); }
  catch { _engine = null; }
  return _engine;
}
/** Test hook: inject/override the pure engine (and reset the memoized load). */
export function __setEngineForTests(mod) { _engine = mod; _engineTried = true; }

// ── Feature flag gate ──────────────────────────────────────────────────────────
export async function citationMiningEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    const flags = JSON.parse(row && row.value ? row.value : '{}');
    return flags.citationMining === true;
  } catch { return false; }
}

// ── Default resolver (offline unless CITATION_MINING_LIVE_RESOLVE=1) ───────────
async function loadProviderSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'searchProviderSettings' } });
    return row ? JSON.parse(row.value || '{}') : {};
  } catch { return {}; }
}
async function getDefaultResolver() {
  const settings = await loadProviderSettings();
  return createResolver({ env: process.env, settings });
}

// ── Landing-project helpers ────────────────────────────────────────────────────
/** The linked ScreenProject for a META·LAB project (read-only; null if none). */
async function findLinkedScreenProject(metaLabProjectId) {
  return prisma.screenProject.findFirst({
    where: { linkedMetaLabProjectId: metaLabProjectId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, ownerId: true },
  });
}
/** The ScreenProject results land into — create one if the link doesn't exist yet. */
async function resolveLandingProject(metaLabProjectId, ownerId) {
  const existing = await findLinkedScreenProject(metaLabProjectId);
  if (existing) return existing;
  const ml = await prisma.project.findUnique({ where: { id: metaLabProjectId }, select: { name: true, data: true, userId: true } });
  if (!ml) return null;
  const sp = await createLinkedScreenProject({
    ownerId: ownerId || ml.userId,
    title: ml.name || 'Citation mining',
    linkedMetaLabProjectId: metaLabProjectId,
    mlData: safeJson(ml.data, {}),
  });
  return { id: sp.id, ownerId: sp.ownerId };
}

// ── Read models ────────────────────────────────────────────────────────────────
export function shapeSeedReview(s) {
  return {
    id: s.id, metaLabProjectId: s.metaLabProjectId, title: s.title, filename: s.filename,
    fileHash: s.fileHash, referenceCount: s.referenceCount, textChars: s.textChars,
    uploadedByName: s.uploadedByName, createdAt: s.createdAt,
  };
}
export function shapeReference(r) {
  return {
    id: r.id, seedReviewId: r.seedReviewId, orderIndex: r.orderIndex, raw: r.raw,
    authors: r.authors, title: r.title, journal: r.journal, year: r.year, doi: r.doi, pmid: r.pmid,
    url: r.url, parseConfidence: r.parseConfidence, resolutionStatus: r.resolutionStatus,
    resolvedSource: r.resolvedSource, resolvedDoi: r.resolvedDoi, resolvedPmid: r.resolvedPmid,
    resolvedOpenAlexId: r.resolvedOpenAlexId,
  };
}
export function shapeCandidate(c) {
  return {
    id: c.id, doi: c.doi, pmid: c.pmid, openAlexId: c.openAlexId, title: c.title, abstract: c.abstract,
    year: c.year, journal: c.journal, authors: safeJson(c.authorsJson, []), publicationType: c.publicationType,
    source: c.source, provenance: safeJson(c.provenanceJson, {}), dedupStatus: c.dedupStatus,
    matchedRecordId: c.matchedRecordId, imported: c.imported, seedReviewId: c.seedReviewId,
    chaseJobId: c.chaseJobId, createdAt: c.createdAt,
  };
}
export function shapeChaseJob(j) {
  return {
    id: j.id, metaLabProjectId: j.metaLabProjectId, direction: j.direction, depth: j.depth,
    maxCandidates: j.maxCandidates, status: j.status, progress: j.progress, total: j.total,
    nFound: j.nFound, cancelRequested: j.cancelRequested, error: j.errorText,
    seedIds: safeJson(j.seedIdsJson, []), createdAt: j.createdAt, updatedAt: j.updatedAt,
  };
}

// ── 1. Ingest a seed review's reference list ───────────────────────────────────
/**
 * ingestSeed(metaLabProjectId, { title, filename, text, user })
 * Parse client-extracted PDF text into references and persist them.
 */
export async function ingestSeed(metaLabProjectId, { title = '', filename = '', text = '', user } = {}) {
  const eng = await loadEngine();
  if (!eng || typeof eng.parseReferences !== 'function') throw engineUnavailable();
  const body = String(text || '');
  const parsed = eng.parseReferences(body, {}) || {};
  const references = asArray(parsed.references);
  const fileHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');

  const seed = await prisma.seedReview.create({
    data: {
      metaLabProjectId,
      title: String(title || filename || 'Seed review').slice(0, 300),
      filename: String(filename || '').slice(0, 300),
      fileHash,
      uploadedById: user?.id || null,
      uploadedByName: (user?.name || user?.email || '').slice(0, 200),
      referenceCount: references.length,
      textChars: body.length,
    },
  });

  if (references.length) {
    const rows = references.map((ref, i) => ({
      seedReviewId: seed.id,
      metaLabProjectId,
      orderIndex: Number.isFinite(ref.index) ? ref.index : i,
      raw: String(ref.raw || '').slice(0, 4000),
      authors: authorsToStr(ref.authors),
      title: String(ref.title || '').slice(0, 1000),
      journal: String(ref.journal || '').slice(0, 300),
      year: String(ref.year || '').slice(0, 20),
      doi: normalizeDoi(ref.doi || '').slice(0, 200),
      pmid: normalizePmid(ref.pmid || '').slice(0, 50),
      url: String(ref.url || '').slice(0, 500),
      parseConfidence: Number.isFinite(ref.confidence) ? ref.confidence : null,
      resolutionStatus: 'pending',
    }));
    // Chunked createMany keeps us under the SQLite variable ceiling.
    for (let i = 0; i < rows.length; i += 200) {
      await prisma.extractedReference.createMany({ data: rows.slice(i, i + 200) });
    }
  }

  return { seed: shapeSeedReview(seed), referenceCount: references.length, meta: parsed.meta || {} };
}

export async function listSeedReviews(metaLabProjectId) {
  const rows = await prisma.seedReview.findMany({ where: { metaLabProjectId }, orderBy: { createdAt: 'desc' } });
  return rows.map(shapeSeedReview);
}
export async function getSeedReview(id) {
  const s = await prisma.seedReview.findUnique({ where: { id } });
  return s ? shapeSeedReview(s) : null;
}
/** The raw SeedReview row (any project), or null. */
export async function loadSeed(id) {
  return prisma.seedReview.findUnique({ where: { id } });
}
/** Owned-lookup: the raw SeedReview row IF it belongs to the given project, else null. */
export async function loadOwnedSeed(id, metaLabProjectId) {
  const s = await prisma.seedReview.findUnique({ where: { id } });
  return s && s.metaLabProjectId === metaLabProjectId ? s : null;
}
export async function listReferences(seedReviewId) {
  const rows = await prisma.extractedReference.findMany({ where: { seedReviewId }, orderBy: { orderIndex: 'asc' } });
  return rows.map(shapeReference);
}

// ── 2. Resolve a seed's references to canonical records ────────────────────────
/**
 * resolveSeed(seedReviewId, { resolver, onlyPending, limit })
 * Bounded, throttled resolution of each reference. Never throws per-reference —
 * a provider hiccup degrades a single row to not_found/error, never the batch.
 */
export async function resolveSeed(seedReviewId, opts = {}) {
  const resolver = opts.resolver || await getDefaultResolver();
  const cap = clampInt(opts.limit, MAX_REFS_PER_RESOLVE, 1, MAX_REFS_PER_RESOLVE);
  const where = { seedReviewId };
  if (opts.onlyPending !== false) where.resolutionStatus = 'pending';
  const refs = await prisma.extractedReference.findMany({ where, orderBy: { orderIndex: 'asc' }, take: cap });

  const summary = { total: refs.length, resolved: 0, notFound: 0, error: 0 };
  for (const r of refs) {
    let res;
    try { res = await resolver.resolveReference({ raw: r.raw, doi: r.doi, pmid: r.pmid, title: r.title, authors: r.authors, journal: r.journal, year: r.year, confidence: r.parseConfidence }); }
    catch { res = { status: 'error' }; }
    const status = res && res.status ? res.status : 'error';
    if (status === 'resolved') summary.resolved += 1;
    else if (status === 'not_found') summary.notFound += 1;
    else summary.error += 1;
    await prisma.extractedReference.update({
      where: { id: r.id },
      data: {
        resolutionStatus: status,
        resolvedSource: String((res && res.source) || '').slice(0, 40),
        resolvedDoi: normalizeDoi((res && res.doi) || '').slice(0, 200),
        resolvedPmid: normalizePmid((res && res.pmid) || '').slice(0, 50),
        resolvedOpenAlexId: bareOaId((res && res.openAlexId) || '').slice(0, 80),
        resolvedJson: JSON.stringify(res || {}).slice(0, 8000),
      },
    }).catch(() => { /* row vanished mid-run — ignore */ });

    // P15 recs — a RESOLVED seed reference becomes an importable CitationCandidate
    // (source 'reference'), so a seed review's own references can be deduped +
    // imported through the SAME path as chase candidates (no separate import route).
    if (status === 'resolved') {
      const doi = normalizeDoi((res && res.doi) || '').slice(0, 200);
      const pmid = normalizePmid((res && res.pmid) || '').slice(0, 50);
      const oaId = bareOaId((res && res.openAlexId) || '').slice(0, 80);
      const title = String((res && res.title) || r.title || '').slice(0, 1000);
      const identity = doi || pmid || oaId || title.trim();
      if (identity) {
        const dup = await prisma.citationCandidate.findFirst({
          where: {
            metaLabProjectId: r.metaLabProjectId, seedReviewId, source: 'reference',
            OR: [doi ? { doi } : null, pmid ? { pmid } : null, oaId ? { openAlexId: oaId } : null].filter(Boolean),
          },
          select: { id: true },
        }).catch(() => null);
        if (!dup) {
          await prisma.citationCandidate.create({
            data: {
              id: uuid(),
              metaLabProjectId: r.metaLabProjectId,
              chaseJobId: null,
              seedReviewId,
              doi, pmid, openAlexId: oaId, title,
              abstract: String((res && res.abstract) || '').slice(0, 6000),
              year: String((res && res.year) || r.year || '').slice(0, 20),
              journal: String((res && res.journal) || r.journal || '').slice(0, 300),
              authorsJson: JSON.stringify(asArray((res && res.authors) || safeJson(r.authors, []))).slice(0, 4000),
              publicationType: String((res && res.publicationType) || '').slice(0, 80),
              source: 'reference',
              provenanceJson: JSON.stringify({ fromReference: r.id, seedReviewId, origin: 'seed-reference' }).slice(0, 2000),
            },
          }).catch(() => {});
        }
      }
    }
  }
  return summary;
}

// ── 3. Dedupe preview: classify candidates/refs vs existing screening records ──
/** Load the project's existing screening records (identity + display fields). */
async function loadExistingRecords(metaLabProjectId) {
  const sp = await findLinkedScreenProject(metaLabProjectId);
  if (!sp) return [];
  return prisma.screenRecord.findMany({
    where: { projectId: sp.id },
    select: { id: true, title: true, doi: true, pmid: true, year: true, authors: true, journal: true },
  });
}
/**
 * dedupePreview(metaLabProjectId, { candidateIds, refs, persist })
 * Classify each item against the project's existing records via the pure engine.
 * When `persist` and candidateIds are given, the classification is written back to
 * CitationCandidate (dedupStatus + matchedRecordId).
 */
export async function dedupePreview(metaLabProjectId, { candidateIds = [], refs = [], persist = true } = {}) {
  const eng = await loadEngine();
  if (!eng || typeof eng.classifyAgainstExisting !== 'function') throw engineUnavailable();
  const existing = await loadExistingRecords(metaLabProjectId);

  let items = [];
  if (asArray(candidateIds).length) {
    const rows = await prisma.citationCandidate.findMany({ where: { id: { in: candidateIds }, metaLabProjectId } });
    items = rows.map((c) => ({ id: c.id, kind: 'candidate', row: c, rec: { title: c.title, doi: c.doi, pmid: c.pmid, year: c.year, authors: safeJson(c.authorsJson, []), journal: c.journal } }));
  } else {
    items = asArray(refs).map((r, i) => ({ id: r.id || String(i), kind: 'ref', rec: { title: r.title, doi: r.doi, pmid: r.pmid, year: r.year, authors: r.authors, journal: r.journal } }));
  }

  const results = [];
  for (const it of items) {
    let verdict;
    try { verdict = eng.classifyAgainstExisting(it.rec, existing) || {}; }
    catch { verdict = {}; }
    const status = String(verdict.outcome || verdict.status || 'new');
    const matchedRecordId = String(verdict.matchedRecordId || verdict.matchedId || '');
    results.push({ id: it.id, kind: it.kind, dedupStatus: status, matchedRecordId, score: verdict.score ?? null, reasons: verdict.reasons || [] });
    if (persist && it.kind === 'candidate') {
      await prisma.citationCandidate.update({ where: { id: it.row.id }, data: { dedupStatus: status.slice(0, 40), matchedRecordId: matchedRecordId.slice(0, 60) } }).catch(() => {});
    }
  }
  return { existingCount: existing.length, results };
}

// ── 4. Import candidates into screening (shared path + provenance) ─────────────
/**
 * importCandidates(metaLabProjectId, ids, user)
 * Land selected candidates as ScreenRecords through the SHARED import path so
 * dedup + PRISMA accounting behave identically to file/Pecan imports. Creates a
 * source:'citation-mining' ScreenImportBatch and preserves per-record provenance
 * (which seed/study/job produced each candidate) in the record's rawData. Flips
 * CitationCandidate.imported for landed candidates.
 */
export async function importCandidates(metaLabProjectId, ids, user) {
  const wanted = asArray(ids).filter(Boolean);
  if (!wanted.length) return { imported: 0, skippedDuplicates: 0, rejected: 0, batchId: null, requested: 0, source: 'citation-mining' };

  const candidates = await prisma.citationCandidate.findMany({
    where: { id: { in: wanted }, metaLabProjectId, imported: false },
  });
  if (!candidates.length) return { imported: 0, skippedDuplicates: 0, rejected: 0, batchId: null, requested: wanted.length, source: 'citation-mining' };

  const landing = await resolveLandingProject(metaLabProjectId, user?.id);
  if (!landing) { const e = new Error('Project not found'); e.code = 'AUTHORIZATION_FAILED'; throw e; }

  // ── Same gating as file/Pecan imports (adversarial-verify fix) ──────────────
  // 1) Admin import kill-switch.
  const settings = await getMetaSiftSettings();
  if (!settings.allowImport) { const e = new Error('Import is currently disabled by the administrator'); e.code = 'IMPORT_DISABLED'; throw e; }
  // 2) Product-tier: import entitlement (caller) + per-project record cap (owner
  //    governs capacity). These throw TierLimitError → mapped by the controller.
  await requireEntitlement(user, 'screening.import');
  const proj = await prisma.project.findUnique({ where: { id: metaLabProjectId }, select: { userId: true } });
  if (proj?.userId) {
    const owner = await loadUserForTier(proj.userId);
    if (owner) {
      const current = await prisma.screenRecord.count({ where: { projectId: landing.id } });
      await requireLimit(owner, 'screening.maxRecordsPerProject', current + 1, { message: 'This project has reached its plan record limit.' });
    }
  }
  // 3) Layered per-project hard cap (per-user → workspace → tier → Ops default →
  //    ceiling) — dedupeAndInsertRecords enforces it and throws CAPACITY.
  const maxRecords = resolveScreeningUploadLimit({ settings });

  const records = candidates.map((c) => ({
    // Provenance FIRST so it survives dedupeAndInsertRecords' 2000-char rawData
    // truncation even when the abstract is long (abstract also lands in its own column).
    citationProvenance: { candidateId: c.id, seedReviewId: c.seedReviewId || null, chaseJobId: c.chaseJobId || null, origin: c.source || '', openAlexId: c.openAlexId || '' },
    title: c.title || '',
    authors: safeJson(c.authorsJson, []),
    year: c.year || '',
    journal: c.journal || '',
    doi: c.doi || '',
    pmid: c.pmid || '',
    abstract: c.abstract || '',
    keywords: '',
    sourceDb: 'citation-mining',
    source: 'citation-mining',
  }));

  const result = await dedupeAndInsertRecords(landing.id, records, {
    source: 'citation-mining',
    format: 'citation-mining',
    parser: 'citation-mining',
    maxRecords,
    importedById: user?.id || null,
    importedByName: (user?.name || user?.email || '').slice(0, 200),
  });

  // Mark imported only candidates that were ELIGIBLE to land (have an identity —
  // title/DOI/PMID). Identity-less rows (e.g. id-only backward refs) are rejected
  // by the shared dedup, so leaving them imported:false keeps them re-importable
  // once enriched, instead of silently marking them done.
  const landableIds = candidates.filter((c) => (c.doi || c.pmid || (c.title && c.title.trim()))).map((c) => c.id);
  if (landableIds.length) {
    await prisma.citationCandidate.updateMany({ where: { id: { in: landableIds } }, data: { imported: true } });
  }

  return {
    imported: result.imported, skippedDuplicates: result.skippedDuplicates, rejected: result.rejected,
    batchId: result.batchId, requested: wanted.length, source: 'citation-mining',
  };
}

export async function listCandidates(metaLabProjectId, { chaseJobId, seedReviewId, imported, skip = 0, take = 100 } = {}) {
  const where = { metaLabProjectId };
  if (chaseJobId) where.chaseJobId = chaseJobId;
  if (seedReviewId) where.seedReviewId = seedReviewId;
  if (imported != null) where.imported = !!imported;
  const [rows, total] = await Promise.all([
    prisma.citationCandidate.findMany({ where, orderBy: { createdAt: 'desc' }, skip: clampInt(skip, 0, 0, 1e6), take: clampInt(take, 100, 1, 500) }),
    prisma.citationCandidate.count({ where }),
  ]);
  return { candidates: rows.map(shapeCandidate), total };
}

// ── 5. Citation chase (durable, bounded, cancellable) ──────────────────────────
/**
 * startChase(metaLabProjectId, { seedIds, direction, depth, maxCandidates, user })
 * Enqueue a durable CitationChaseJob. Bounds are clamped HERE so a hand-crafted
 * request can never exceed the hard caps.
 */
export async function startChase(metaLabProjectId, { seedIds = [], direction = 'backward', depth = 1, maxCandidates = DEFAULT_MAX_CANDIDATES, user } = {}, deps = {}) {
  const dir = direction === 'forward' ? 'forward' : 'backward';
  const job = await prisma.citationChaseJob.create({
    data: {
      id: uuid(),
      metaLabProjectId,
      direction: dir,
      depth: clampInt(depth, 1, 1, MAX_DEPTH),
      maxCandidates: clampInt(maxCandidates, DEFAULT_MAX_CANDIDATES, 1, MAX_CANDIDATES_CAP),
      seedIdsJson: JSON.stringify(asArray(seedIds).map(String).slice(0, 500)),
      status: 'queued',
      createdById: user?.id || null,
    },
  });
  if (deps.autoKick !== false) {
    try { const m = await import('./citationChaseWorker.js'); m.kickCitationChaseWorker(); } catch { /* boot hook drains */ }
  }
  return job;
}

export async function getChaseJob(jobId) {
  const j = await prisma.citationChaseJob.findUnique({ where: { id: jobId } });
  return j ? shapeChaseJob(j) : null;
}
/** Owned-lookup for a chase job scoped to a project (cross-project guard). */
export async function loadOwnedChaseJob(jobId, metaLabProjectId) {
  const j = await prisma.citationChaseJob.findUnique({ where: { id: jobId } });
  return j && j.metaLabProjectId === metaLabProjectId ? j : null;
}

/**
 * cancelChase(jobId) — set the durable cancel intent the BFS re-reads each step.
 * A still-QUEUED (unclaimed) job is flipped to cancelled synchronously so it can
 * never sit "cancelRequested" forever (mirrors pecan cancelRun).
 */
export async function cancelChase(jobId) {
  const j = await prisma.citationChaseJob.findUnique({ where: { id: jobId } });
  if (!j) return null;
  if (['completed', 'failed', 'cancelled'].includes(j.status)) return shapeChaseJob(j);
  await prisma.citationChaseJob.update({ where: { id: jobId }, data: { cancelRequested: true } });
  // Unclaimed (still queued) → finalize to cancelled now so it never sits pending.
  await prisma.citationChaseJob.updateMany({ where: { id: jobId, status: 'queued' }, data: { status: 'cancelled' } });
  const after = await prisma.citationChaseJob.findUnique({ where: { id: jobId } });
  return after ? shapeChaseJob(after) : null;
}

/** Build a frontier node from a resolved ExtractedReference row. */
function nodeFromReference(r) {
  return {
    key: bareOaId(r.resolvedOpenAlexId) || normalizeDoi(r.resolvedDoi || r.doi) || normalizePmid(r.resolvedPmid || r.pmid),
    openAlexId: bareOaId(r.resolvedOpenAlexId),
    doi: normalizeDoi(r.resolvedDoi || r.doi || ''),
    pmid: normalizePmid(r.resolvedPmid || r.pmid || ''),
  };
}

/** Cached backward edges (OpenAlex work ids) for a node, from CitationMetadata. */
async function cachedRefsFor(node) {
  const key = keyForRecord({ doi: node.doi, pmid: node.pmid });
  if (!key) return [];
  try {
    const row = await prisma.citationMetadata.findUnique({ where: { key }, select: { status: true, payload: true } });
    if (!row || row.status !== 'ok') return [];
    const refs = safeJson(row.payload, {}).refs;
    return Array.isArray(refs) ? refs.map(bareOaId).filter(Boolean) : [];
  } catch { return []; }
}

/**
 * processChase(job, deps) — execute a queued/processing chase job to completion.
 * Bounded BFS: depth ≤ 3, maxCandidates cap, per-node limit, cancel re-read each
 * node, heartbeat + progress written as it goes. Idempotent-ish: candidates are
 * de-duplicated within the job by identity key so a re-delivery adds no dupes.
 * Called ONLY by the worker (or a test).
 */
export async function processChase(job, deps = {}) {
  const jobId = job.id;
  const current = await prisma.citationChaseJob.findUnique({ where: { id: jobId } });
  if (!current) return;
  if (['completed', 'cancelled', 'failed'].includes(current.status) && !deps.force) return;

  const resolver = deps.resolver || await getDefaultResolver();
  const depth = clampInt(current.depth, 1, 1, MAX_DEPTH);
  const maxCandidates = clampInt(current.maxCandidates, DEFAULT_MAX_CANDIDATES, 1, MAX_CANDIDATES_CAP);
  const direction = current.direction === 'forward' ? 'forward' : 'backward';
  const seedIds = asArray(safeJson(current.seedIdsJson, []));

  const isCancelled = async () => {
    try { const r = await prisma.citationChaseJob.findUnique({ where: { id: jobId }, select: { cancelRequested: true } }); return !!(r && r.cancelRequested); }
    catch { return false; }
  };
  const heartbeat = async (patch = {}) => {
    try { await prisma.citationChaseJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date(), ...patch } }); } catch { /* ignore */ }
  };

  await prisma.citationChaseJob.update({ where: { id: jobId }, data: { status: 'processing', heartbeatAt: new Date() } }).catch(() => {});
  if (await isCancelled()) { await finishChase(jobId, 'cancelled'); return; }

  // Seed frontier from resolved references.
  const seedRefs = seedIds.length
    ? await prisma.extractedReference.findMany({ where: { id: { in: seedIds }, metaLabProjectId: current.metaLabProjectId } })
    : [];
  const seen = new Set();     // candidate identity keys already recorded (job-scoped dedupe)
  let frontier = [];
  // Register BOTH the 'seed:'-namespaced key (seed-vs-seed dedupe) AND the bare key
  // (so a work that is also produced later as a candidate is deduped against its seed
  // — otherwise it could be recorded/expanded a second time).
  for (const r of seedRefs) { const n = nodeFromReference(r); if (n.key && !seen.has('seed:' + n.key)) { seen.add('seed:' + n.key); seen.add(n.key); frontier.push({ node: n, seedReviewId: r.seedReviewId }); } }

  let nFound = current.nFound || 0;
  const perNode = Math.min(maxCandidates, PER_NODE_LIMIT);
  await heartbeat({ total: null, progress: 0 });

  try {
    for (let level = 0; level < depth && frontier.length && nFound < maxCandidates; level++) {
      if (await isCancelled()) { await finishChase(jobId, 'cancelled'); return; }
      const nextFrontier = [];
      for (const item of frontier) {
        if (nFound >= maxCandidates) break;
        if (await isCancelled()) { await finishChase(jobId, 'cancelled'); return; }
        const { node, seedReviewId } = item;
        const remaining = maxCandidates - nFound;
        const limit = Math.max(1, Math.min(perNode, remaining));

        let produced = [];
        try {
          if (direction === 'forward') {
            produced = await resolver.forwardCitingWorks(node.openAlexId, { limit });
          } else {
            const cachedRefs = await cachedRefsFor(node);
            produced = await resolver.backwardReferences({ openAlexId: node.openAlexId, doi: node.doi, pmid: node.pmid, cachedRefs }, { limit });
          }
        } catch { produced = []; }

        for (const cand of asArray(produced)) {
          if (nFound >= maxCandidates) break;
          const key = bareOaId(cand.openAlexId) || normalizeDoi(cand.doi) || normalizePmid(cand.pmid);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          await prisma.citationCandidate.create({
            data: {
              id: uuid(),
              metaLabProjectId: current.metaLabProjectId,
              chaseJobId: jobId,
              seedReviewId: seedReviewId || null,
              doi: normalizeDoi(cand.doi || '').slice(0, 200),
              pmid: normalizePmid(cand.pmid || '').slice(0, 50),
              openAlexId: bareOaId(cand.openAlexId || '').slice(0, 80),
              title: String(cand.title || '').slice(0, 1000),
              abstract: String(cand.abstract || '').slice(0, 6000),
              year: String(cand.year || '').slice(0, 20),
              journal: String(cand.journal || '').slice(0, 300),
              authorsJson: JSON.stringify(asArray(cand.authors)).slice(0, 4000),
              publicationType: String(cand.publicationType || '').slice(0, 80),
              source: direction,
              provenanceJson: JSON.stringify({ fromNode: node.key, seedReviewId: seedReviewId || null, level: level + 1, direction }).slice(0, 2000),
            },
          }).catch(() => {});
          nFound += 1;
          // A produced candidate with an OpenAlex id can extend the BFS one level deeper.
          if (level + 1 < depth && bareOaId(cand.openAlexId)) {
            nextFrontier.push({ node: { key, openAlexId: bareOaId(cand.openAlexId), doi: normalizeDoi(cand.doi || ''), pmid: normalizePmid(cand.pmid || '') }, seedReviewId: seedReviewId || null });
          }
        }
        await heartbeat({ nFound, progress: Math.min(99, Math.round((nFound / maxCandidates) * 100)) });
      }
      frontier = nextFrontier;
    }
    await finishChase(jobId, 'completed', nFound);
  } catch (e) {
    await finishChase(jobId, 'failed', nFound, String(e && e.message || 'Citation chase failed').slice(0, 500));
    throw e;
  }
}

async function finishChase(jobId, status, nFound, errorText = '') {
  const data = { status, progress: status === 'completed' ? 100 : undefined, cancelRequested: undefined };
  if (Number.isFinite(nFound)) data.nFound = nFound;
  if (errorText) data.errorText = errorText;
  // Prisma rejects `undefined`-valued keys only in certain versions; strip them.
  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
  try { await prisma.citationChaseJob.update({ where: { id: jobId }, data }); } catch { /* ignore */ }
}
