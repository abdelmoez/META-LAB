/**
 * searchEngine/searchProvenanceService.js — 101.md §1/§2/§17. The SERVER-side
 * loader that feeds the pure derivation in
 * src/research-engine/search/searchProvenance.js.
 *
 * Its only job is to read EXECUTION records and adapt them to that engine's input
 * shape. It deliberately reads no settings page: 101.md §1 ("If a database was
 * configured but never actually searched, it should not be represented as though
 * it had been searched") and §17 ("Do not claim 'Embase was searched' because
 * Embase was selected in a settings page") make that a hard scientific rule. The
 * caller's `configured` list is passed straight through so the UI can still SHOW a
 * selected-but-never-run database as such — the engine files it under state
 * 'configured', which `reportableDatabases()` excludes from anything the
 * manuscript states.
 *
 * Two sources of truth are read, matching the two search workflows §1 requires
 * (and their hybrid):
 *   automated → PecanSearchRun + PecanSearchSource (per-provider execution state)
 *   manual    → ScreenImportBatch + the per-record ScreenRecord.sourceDb attribution
 *
 * DEGRADATION (§17): if anything fails, this returns an EMPTY provenance — "we
 * cannot name any database" — never a partially-populated one that the manuscript
 * would present as a complete list. Model access is additionally guarded with a
 * typeof check (same convention as server/provenance/recordEvent.js
 * `ledgerAvailable()`) so a Prisma client generated before a migration degrades
 * instead of throwing.
 */
import { deriveSearchProvenance } from '../../src/research-engine/search/searchProvenance.js';

/** Is `model.fn` present on this Prisma client? (pre-migration client → false). */
function modelReady(client, model, fn = 'findMany') {
  return !!(client && client[model] && typeof client[model][fn] === 'function');
}

/**
 * The honest "we know nothing" answer. Shape-identical to deriveSearchProvenance's
 * return so every consumer (endpoint, manuscript facts, UI) takes one code path.
 */
export function emptyProvenance() {
  return {
    databases: [],
    reportable: [],
    latestValidSearchAt: '',
    latestValidSource: null,
    counts: { configured: 0, searched: 0, failed: 0, invalidated: 0, zeroResult: 0 },
  };
}

/**
 * A manual-search import batch is any batch that did NOT come from an automated
 * Pecan run. Pecan batches are already represented by their run's PecanSearchSource
 * rows, so counting them here too would inflate the database list with a second
 * copy of the same execution.
 *
 * Three tests, because the tagging changed over time: the modern `source` column
 * (58.md §7), the `searchRunId` attribution (96.md D10/D12), and — for batches that
 * predate both — the synthetic `pecan:<runId>:…` fileHash the pipeline writes.
 */
export function isManualImportBatch(batch) {
  const source = String((batch && batch.source) || 'file').trim().toLowerCase();
  if (source === 'pecan-search') return false;
  if (String((batch && batch.searchRunId) || '').trim()) return false;
  if (String((batch && batch.fileHash) || '').startsWith('pecan:')) return false;
  return true;
}

/** Prisma groupBy `_count` is `{_all:n}` or a bare number depending on the shape asked for. */
function countOf(row) {
  const c = row && row._count;
  if (typeof c === 'number') return c;
  if (c && typeof c._all === 'number') return c._all;
  return 0;
}

/** Automated executions: every run for the project, with its per-provider sources. */
async function loadRuns(prisma, metaLabProjectId) {
  if (!metaLabProjectId || !modelReady(prisma, 'pecanSearchRun')) return [];
  const rows = await prisma.pecanSearchRun.findMany({
    where: { metaLabProjectId },
    select: {
      id: true, name: true, state: true, origin: true,
      rolledBackAt: true, completedAt: true, createdAt: true,
      sources: {
        select: {
          provider: true, state: true, rawCount: true, importedCount: true,
          startedAt: true, completedAt: true, errorClass: true, errorDetail: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ ...r, sources: Array.isArray(r.sources) ? r.sources : [] }));
}

/**
 * Per-batch database attribution for manual imports. One grouped query for every
 * batch at once (batch id × sourceDb), not one query per batch.
 *
 * Records whose `sourceDb` is blank are DROPPED, deliberately (101.md §17): a file
 * with no source attribution cannot name a database. Those records still count in
 * PRISMA — they simply cannot make the manuscript claim a database was searched.
 */
async function loadBatchDatabases(prisma, screenProjectId, batchIds) {
  const out = new Map();
  if (!batchIds.length || !modelReady(prisma, 'screenRecord', 'groupBy')) return out;
  const rows = await prisma.screenRecord.groupBy({
    by: ['importBatchId', 'sourceDb'],
    where: { projectId: screenProjectId, importBatchId: { in: batchIds } },
    _count: { _all: true },
  });
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const batchId = String((r && r.importBatchId) || '');
    const name = String((r && r.sourceDb) || '').trim();
    if (!batchId || !name) continue;
    const list = out.get(batchId) || [];
    list.push({ name, count: countOf(r) });
    out.set(batchId, list);
  }
  return out;
}

/** Manual/file/API import batches, each with its own sourceDb breakdown. */
async function loadImports(prisma, screenProjectId) {
  if (!screenProjectId || !modelReady(prisma, 'screenImportBatch')) return [];
  const batches = await prisma.screenImportBatch.findMany({
    where: { projectId: screenProjectId },
    select: {
      id: true, source: true, filename: true, createdAt: true,
      recordCount: true, searchRunId: true, fileHash: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const manual = (Array.isArray(batches) ? batches : []).filter(isManualImportBatch);
  if (!manual.length) return [];
  const byBatch = await loadBatchDatabases(prisma, screenProjectId, manual.map((b) => b.id));
  return manual.map((b) => ({
    id: b.id,
    source: b.source || 'file',
    filename: b.filename || '',
    createdAt: b.createdAt,
    recordCount: b.recordCount || 0,
    databases: byBatch.get(b.id) || [],
  }));
}

/** Resolve the ScreenProject that this META·LAB project's records land in. */
async function resolveScreenProjectId(prisma, screenProjectId, metaLabProjectId) {
  const given = String(screenProjectId || '').trim();
  if (given) return given;
  if (!metaLabProjectId || !modelReady(prisma, 'screenProject', 'findFirst')) return '';
  const row = await prisma.screenProject.findFirst({
    where: { linkedMetaLabProjectId: metaLabProjectId, deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return row ? row.id : '';
}

/**
 * loadSearchProvenance(prisma, opts) — the project's honest search provenance.
 *
 * @param {object} prisma  a Prisma client (injected so this is unit-testable and so
 *                         the atomic paths can pass a transaction client).
 * @param {object} opts
 *   metaLabProjectId  META·LAB Project id (the search workspace) — scopes the runs.
 *   screenProjectId   ScreenProject id (the landing target). Optional: resolved from
 *                     the link when omitted.
 *   configured        string[] of database keys selected in project settings. Shown
 *                     as "configured, not searched"; can NEVER make a database
 *                     reportable (§1/§17).
 * @returns {Promise<object>} deriveSearchProvenance()'s result, or emptyProvenance().
 */
export async function loadSearchProvenance(prisma, opts = {}) {
  const metaLabProjectId = String(opts.metaLabProjectId || '').trim();
  const configured = Array.isArray(opts.configured)
    ? opts.configured.map((d) => String(d || '').trim()).filter(Boolean)
    : [];
  try {
    const screenProjectId = await resolveScreenProjectId(prisma, opts.screenProjectId, metaLabProjectId);
    // Sequential rather than parallel: the import read depends on the resolved
    // ScreenProject, and a finalizing run writing counts concurrently is fine —
    // provenance is derived from terminal per-source state, not from a snapshot lock.
    const runs = await loadRuns(prisma, metaLabProjectId);
    const imports = await loadImports(prisma, screenProjectId);
    return deriveSearchProvenance({ runs, imports, configured });
  } catch (err) {
    // §17 — degrade to "we cannot name databases", never to a wrong claim.
    console.error('[searchProvenance] loadSearchProvenance failed:', (err && err.message) || err);
    return emptyProvenance();
  }
}

export default { loadSearchProvenance, emptyProvenance, isManualImportBatch };
