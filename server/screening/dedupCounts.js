/**
 * screening/dedupCounts.js — 119.md §1. The SHARED deduplication primitives every
 * PRISMA consumer reads.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Before 119 the project had FOUR independent answers to "how many duplicates were
 * removed?":
 *
 *   1. prismaFlowService.loadPrismaFlow  — batch.duplicateCount only (the canonical
 *      flow: GET /prisma, the box inspector, the manuscript, every export)
 *   2. getMetaLabSummary                 — batch.duplicateCount + isDuplicate records
 *                                          + the Pecan engine's exact/fuzzy counters
 *   3. livingService digest              — batch.duplicateCount only
 *   4. publicSynthesisService.derivePrisma — batch.duplicateCount only
 *
 * On a project whose records came from an automated search they DISAGREED: the Pecan
 * engine classifies cross-source duplicates BEFORE landing (pipeline.js only lands
 * 'new'/'ambiguous'), so those retrievals never became ScreenRecords and never
 * touched a batch's duplicateCount — they exist only on PecanSearchSource. The
 * dashboard summary folded them in; the canonical flow did not. The PRISMA figure in
 * the manuscript therefore under-reported both "records identified" and "duplicate
 * records removed" by exactDup+fuzzyDup, while the dashboard beside it showed the
 * right numbers.
 *
 * Everything here is either a pure function over already-loaded rows or a single
 * indexed query, so a consumer converges by DELEGATING rather than by keeping its own
 * arithmetic in step.
 *
 * ── RULES THAT ARE LOAD-BEARING (do not "simplify" these away) ──────────────
 * • RERUN SAFETY: the engine's `existingMatch` is counted NOWHERE (prismaDerive.js).
 *   A re-run of the same search re-finds every record as an existing match; summing
 *   that would inflate identified/duplicatesRemoved on every re-run forever.
 *   exact/fuzzy dups are duplicates of records NEW to the project and are rerun-stable.
 * • ROLLED-BACK RUNS ARE EXCLUDED (96.md D11): a screening reset deletes a run's
 *   landed records and batches and stamps `rolledBackAt`. Keeping its engine-side
 *   counters would over-report identified forever after a reset.
 * • SUPERSEDED RE-IMPORTS CONTRIBUTE NOTHING (119.md §1): a forced re-upload of a
 *   file whose sha256 already landed re-observes records that are already accounted
 *   for. See ScreenImportBatch.supersedesBatchId in the schema for the full note.
 * • `updated` ⊆ `skippedDuplicates` (96.md invariant 6): a metadata fill-blank merge
 *   is an ALREADY-PRESENT outcome and is never added to any dedup count.
 *
 * Pure functions here are unit-tested directly; the loaders are thin and typed by the
 * schema pins in tests/unit/screening/prismaFlowLoader116.test.js.
 */
import { prisma } from '../db/client.js';
import { armOf } from '../../src/research-engine/prisma/index.js';
import { canonicalDbKey, dbLabel } from '../../src/research-engine/search/searchProvenance.js';

const nonNegInt = (v) => Math.max(0, Math.trunc(Number(v) || 0));
const asArray = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

/**
 * 119.md §1 — a batch that REPEATS an earlier import of the same file contributes no
 * duplicate accounting. `supersedesBatchId` is stamped at landing time; an
 * un-migrated Prisma client returns `undefined` here, which reads as "not a
 * re-import" and keeps the legacy behaviour exactly.
 * Pure.
 */
export function isSupersededImport(batch) {
  return !!(batch && String(batch.supersedesBatchId || '').trim());
}

/**
 * Import-time duplicates across a set of ScreenImportBatch rows, excluding repeats.
 * Pure.
 */
export function sumImportDuplicates(batches) {
  let n = 0;
  for (const b of asArray(batches)) {
    if (!b || isSupersededImport(b)) continue;
    n += nonNegInt(b.duplicateCount);
  }
  return n;
}

/**
 * 119.md §1 — the record-level removed-duplicate rule, in ONE place.
 *
 * The canonical flow's disposition is `isDuplicate && !isPrimary` (prisma/model.js
 * dispositionOf): the group's retained record is not a removal. getMetaLabSummary
 * used to test `isDuplicate` alone, which agrees only for as long as no writer ever
 * flags a primary — a silent coupling, now an explicit shared rule.
 * Pure.
 */
export function isRemovedDuplicateRecord(rec) {
  return !!(rec && rec.isDuplicate && !rec.isPrimary);
}

/** How many records are currently REMOVED as duplicates. Pure. */
export function countRemovedDuplicateRecords(records) {
  let n = 0;
  for (const r of asArray(records)) if (isRemovedDuplicateRecord(r)) n += 1;
  return n;
}

/**
 * The Pecan engine's PRE-LANDING duplicates, per source row.
 *
 * These records were genuinely retrieved from a database and then removed by the
 * engine before insertion, so PRISMA must count them in BOTH "records identified"
 * and "duplicate records removed" — they are the automated-search analogue of a
 * file import's `duplicateCount`.
 *
 * BOTH exact AND fuzzy are counted, and that is a decision, not an oversight
 * (119.md §1 asked the question explicitly):
 *   • exact_dup / fuzzy_dup are AUTO-MERGED before landing — pipeline.js:156 lands
 *     only 'new' and 'ambiguous', and both write a PecanDedupDecision with
 *     decision:'merged'. Neither ever becomes a ScreenRecord, so neither can be
 *     counted by the record-level projection.
 *   • the SUGGESTION path is 'ambiguous' (ambiguousDupCount) — those DO land as
 *     records, go to the duplicate worker, and are counted record-by-record. They
 *     are deliberately absent here; counting them would double-count.
 * Excluding fuzzy would also re-open the divergence this file exists to close:
 * derivePrismaIdentification (the dashboard's arithmetic) sums exact+fuzzy.
 *
 * @param {string|string[]} pids  ScreenProject id(s)
 * @returns {Promise<Array<{runId,provider,exactDupCount,fuzzyDupCount}>>}
 */
export async function loadEngineDuplicateSources(pids) {
  const ids = asArray(pids).filter(Boolean);
  if (!ids.length) return [];
  if (!(prisma && prisma.pecanSearchSource && typeof prisma.pecanSearchSource.findMany === 'function')) return [];
  try {
    return await prisma.pecanSearchSource.findMany({
      // 96.md D11 — rolled-back runs are excluded AT THE QUERY, never after.
      where: { run: { screenProjectId: { in: ids }, rolledBackAt: null } },
      select: { runId: true, provider: true, exactDupCount: true, fuzzyDupCount: true },
    });
  } catch {
    // Fail-soft, exactly like getMetaLabSummary's original `.catch(() => [])`: an
    // older client without the run relation must not break the PRISMA page.
    return [];
  }
}

/** exact + fuzzy totals over engine source rows. Pure. */
export function engineDuplicateTotals(sources) {
  let exact = 0; let fuzzy = 0;
  for (const s of asArray(sources)) {
    exact += nonNegInt(s && s.exactDupCount);
    fuzzy += nonNegInt(s && s.fuzzyDupCount);
  }
  return { exact, fuzzy, total: exact + fuzzy };
}

/**
 * 119.md §1 — engine duplicates ATTRIBUTED PER PRISMA ARM.
 *
 * A Pecan source is a database or register that was genuinely queried, so its
 * duplicates belong to the database column. Rather than assert that, the arm is
 * resolved through the SAME `armOf` the records use, keyed on the provider's
 * canonical database key — so if a provider ever classifies as an other-methods
 * source, its duplicates follow it instead of fabricating a database search.
 * Pure.
 */
export function engineDuplicatesByArm(sources) {
  const out = { db: 0, other: 0 };
  for (const s of asArray(sources)) {
    const n = nonNegInt(s && s.exactDupCount) + nonNegInt(s && s.fuzzyDupCount);
    if (n <= 0) continue;
    const provider = String((s && s.provider) || '').trim();
    const key = provider ? canonicalDbKey(provider) : '';
    const arm = armOf({ origin: 'search', sourceDb: provider ? dbLabel(provider) : '', sourceDbKey: key });
    out[arm === 'db' ? 'db' : 'other'] += n;
  }
  return out;
}

/**
 * loadDedupIdentificationInputs(pids) — everything derivePrismaIdentification needs,
 * read once from the live tables.
 *
 * This is the seam the digest consumers (livingService, publicSynthesisService)
 * delegate to so they stop maintaining their own two-term arithmetic
 * (`identified = total + importDups`), which omitted both the record-level
 * duplicates and every automated-search duplicate.
 *
 * @param {string|string[]} pids  ScreenProject id(s)
 */
export async function loadDedupIdentificationInputs(pids) {
  const ids = asArray(pids).filter(Boolean);
  if (!ids.length) {
    return { recordCount: 0, importDuplicates: 0, postImportDuplicates: 0, pecanExactDup: 0, pecanFuzzyDup: 0 };
  }
  const [recordCount, batches, dupRecords, sources] = await Promise.all([
    prisma.screenRecord.count({ where: { projectId: { in: ids } } }),
    loadDedupBatches(ids),
    prisma.screenRecord.count({ where: { projectId: { in: ids }, isDuplicate: true, isPrimary: false } }),
    loadEngineDuplicateSources(ids),
  ]);
  const engine = engineDuplicateTotals(sources);
  return {
    recordCount,
    importDuplicates: sumImportDuplicates(batches),
    postImportDuplicates: dupRecords,
    pecanExactDup: engine.exact,
    pecanFuzzyDup: engine.fuzzy,
  };
}

/**
 * The batch columns the dedup accounting reads, with the same two-attempt degrade
 * prismaFlowService.loadImportBatches uses: a client generated before
 * `supersedesBatchId` existed falls back to the legacy column set rather than to a
 * silent [] (which would zero the duplicate accounting outright).
 */
async function loadDedupBatches(ids) {
  try {
    return await prisma.screenImportBatch.findMany({
      where: { projectId: { in: ids } },
      select: { duplicateCount: true, supersedesBatchId: true },
    });
  } catch {
    try {
      return await prisma.screenImportBatch.findMany({
        where: { projectId: { in: ids } },
        select: { duplicateCount: true },
      });
    } catch { return []; }
  }
}

export default {
  isSupersededImport,
  sumImportDuplicates,
  isRemovedDuplicateRecord,
  countRemovedDuplicateRecords,
  loadEngineDuplicateSources,
  engineDuplicateTotals,
  engineDuplicatesByArm,
  loadDedupIdentificationInputs,
};
