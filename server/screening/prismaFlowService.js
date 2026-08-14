/**
 * screening/prismaFlowService.js — 103.md §10/§19, repaired + extended by 116.md
 * §13-§15. Loads a project's records and derives the canonical PRISMA flow from
 * them.
 *
 * This is the piece that makes the record-level model REACHABLE. The engine in
 * src/research-engine/prisma/ is pure and fully tested; without this loader nothing
 * in production ever supplied it, so the manuscript kept falling back to the legacy
 * precedence chain.
 *
 * ── 116.md §15 — THE BUG THIS FILE SHIPPED ─────────────────────────────────
 * The ScreenDecision select asked for a `reason` column. ScreenDecision has no
 * such column (the field is `exclusionReason`), so Prisma threw a
 * PrismaClientValidationError on EVERY call — and safe() swallowed it, returning
 * [] decisions. In every production project: "Records excluded" was 0, "Reports
 * excluded" was 0, and every reason breakdown read "Reasons not recorded". The
 * reconciliation still passed (the identities are derived from the same wrong
 * dispositions), so the failure was silent. tests/unit/screening/
 * prismaFlowLoader116.test.js now pins every selected column against the real
 * schema so an invalid select can never be swallowed again.
 *
 * Performance (§19): one indexed query per table, `select`ing only the columns the
 * projection reads, then a single in-memory pass. No per-record queries, and nothing
 * is fetched that the flow does not use. The tables that may not exist on an older
 * Prisma client (full-text retrieval) are probed first and skipped if absent, the
 * same graceful-degrade convention server/provenance/recordEvent.js uses.
 */
import { prisma } from '../db/client.js';
import {
  buildRecordProjections, resolveDecisions, resolveRetrieval,
  derivePrismaFlow, reconcilePrismaFlow, armOf,
} from '../../src/research-engine/prisma/index.js';
import { canonicalDbKey, dbLabel } from '../../src/research-engine/search/searchProvenance.js';

/** Is a model available on the current Prisma client? */
function has(model) {
  return !!(prisma && prisma[model] && typeof prisma[model].findMany === 'function');
}

const safe = async (fn, fallback) => {
  try { return await fn(); } catch { return fallback; }
};

/** The columns the PRISMA projection itself reads. Callers may ask for more. */
const BASE_RECORD_SELECT = Object.freeze({
  id: true, sourceDb: true, isDuplicate: true, isPrimary: true,
  duplicateGroupId: true, currentStage: true, finalStatus: true,
  promotedAt: true, rejectedReason: true, handoffStudyId: true,
  // 116.md §13/§14 — the batch link (legacy records with no ScreenRecordSource row
  // fall back to it for origin 'file' + effective batch attribution) and the
  // per-record identification correction.
  importBatchId: true, identificationSource: true, sourceDetail: true,
});

/** ScreenImportBatch.source → the ScreenRecordSource.origin an import of that kind writes. */
const ORIGIN_BY_BATCH_SOURCE = Object.freeze({
  'pecan-search': 'search',
  api: 'api',
  file: 'file',
});

/**
 * 116.md §13 (r2) — WHICH ARM a batch's never-inserted import duplicates belong to.
 *
 * `ScreenImportBatch.duplicateCount` records records that were parsed out of the file
 * and then discarded before insertion, so no ScreenRecord exists to classify. Before
 * this repair the whole sum was credited to the database column unconditionally,
 * which was self-consistent only while every file import was db-arm by construction.
 * §13 moved unattributed file imports to the other-methods arm, so an ordinary
 * hand-uploaded RIS with internal duplicates started FABRICATING a database search:
 * "Records identified from databases/registers (n = 40)" with no database, no record
 * and no source behind it — a false search claim in a publishable figure.
 *
 * Precedence, cheapest-and-strongest first:
 *   1. the batch's own (non-retracted) database declaration — the researcher said so;
 *   2. otherwise the arm its SURVIVING records actually resolved to (majority);
 *   3. otherwise the batch kind alone — a Pecan/API run really queried a database,
 *      a bare file upload did not.
 */
function armOfBatchDiscards(batch, survivors) {
  const declared = String((batch && batch.declaredDatabase) || '').trim();
  if (declared) {
    const key = canonicalDbKey(declared);
    return armOf({ origin: 'file', sourceDb: dbLabel(declared), sourceDbKey: key });
  }
  if (survivors && survivors.length) {
    let db = 0;
    for (const p of survivors) if (armOf(p) === 'db') db += 1;
    return db * 2 >= survivors.length ? 'db' : 'other';
  }
  const origin = ORIGIN_BY_BATCH_SOURCE[String((batch && batch.source) || 'file')] || 'file';
  return armOf({ origin, sourceDb: '' });
}

/**
 * The import batches, with a graceful degrade for a Prisma client generated before
 * the 104.md/116.md columns existed. Two attempts, never a silent [] — see the call
 * site's note on why safe() is the wrong tool here.
 */
async function loadImportBatches(pid) {
  try {
    return await prisma.screenImportBatch.findMany({
      where: { projectId: pid },
      select: {
        id: true, duplicateCount: true, sourceDatabase: true, contributesToReview: true,
        source: true, filename: true, format: true, createdAt: true,
      },
    });
  } catch {
    try {
      return await prisma.screenImportBatch.findMany({
        where: { projectId: pid },
        select: { id: true, duplicateCount: true, sourceDatabase: true },
      });
    } catch { return []; }
  }
}

/**
 * loadPrismaFlow(screenProjectId, opts) → { flow, reconciliation, projections,
 * records, batches } or null.
 *
 * @param {string} pid  ScreenProject id
 * @param {object} [opts]
 *   previous   { studies, reports } for an UPDATED review (103.md §7)
 *   quantStudyIds  study ids contributing to the meta-analysis
 *   recordSelect   extra ScreenRecord columns to fetch alongside the projection's
 *                  own (116.md §11 r2 — so the inspector reuses THIS scan instead
 *                  of issuing a second unbounded findMany over the same rows)
 *   recordOrderBy  Prisma orderBy for that scan, when the caller needs a stable page order
 */
export async function loadPrismaFlow(pid, opts = {}) {
  if (!pid || !has('screenRecord')) return null;

  const extraSelect = (opts.recordSelect && typeof opts.recordSelect === 'object') ? opts.recordSelect : null;
  const recordQuery = {
    where: { projectId: pid },
    select: extraSelect ? { ...BASE_RECORD_SELECT, ...extraSelect } : { ...BASE_RECORD_SELECT },
    ...(opts.recordOrderBy ? { orderBy: opts.recordOrderBy } : {}),
  };

  const [records, decisions, conflicts, sources, candidates, requests, attachments, batches] = await Promise.all([
    safe(() => prisma.screenRecord.findMany(recordQuery), []),
    // 116.md §15 — the field is `exclusionReason`. Selecting the nonexistent
    // `reason` here is the exact bug that silently zeroed every exclusion count.
    safe(() => prisma.screenDecision.findMany({
      where: { projectId: pid },
      select: { recordId: true, stage: true, decision: true, exclusionReason: true },
    }), []),
    // 116.md §15 — resolved conflicts ARE decisions. A leader resolution writes
    // ScreenConflict.finalDecision (+resolvedAt) and, for excludes, only the
    // record's rejectedReason — no ScreenDecision row. Without threading these
    // into the resolver as `resolved` rows, a resolved split stayed "awaiting
    // screening" in the diagram forever (unanimity was the only path to a verdict).
    safe(() => prisma.screenConflict.findMany({
      where: { projectId: pid },
      select: { recordId: true, finalDecision: true, resolvedAt: true, notes: true },
    }), []),
    safe(() => prisma.screenRecordSource.findMany({
      where: { projectId: pid },
      select: { screenRecordId: true, origin: true, runId: true, batchId: true, outcome: true },
    }), []),
    has('fullTextCandidate')
      ? safe(() => prisma.fullTextCandidate.findMany({
        where: { projectId: pid }, select: { recordId: true, status: true },
      }), []) : [],
    has('fullTextRequest')
      ? safe(() => prisma.fullTextRequest.findMany({
        where: { projectId: pid }, select: { recordId: true, status: true },
      }), []) : [],
    has('screenPdfAttachment')
      ? safe(() => prisma.screenPdfAttachment.findMany({
        where: { projectId: pid }, select: { recordId: true },
      }), []) : [],
    // 103.md §2 — import-time duplicates are DISCARDED before becoming records
    // (screeningImportService skips them), so the only trace is the batch's own
    // duplicateCount. Without this, "records identified" would silently exclude
    // records that really were retrieved. 116.md §14 — the batch's declared
    // sourceDatabase rides along so the projection can thread it into each record's
    // effective attribution.
    //
    // 116.md §14 (r2) — `contributesToReview` rides along too. It is the 104.md
    // retraction flag ("Excluded from the reported search methodology"), and PRISMA
    // was the ONLY consumer of ScreenImportBatch.sourceDatabase that ignored it —
    // so a test upload marked as not contributing was dropped from the Methods text
    // while its records were still drawn under "Embase" in the diagram. The extended
    // select is tried FIRST and falls back to the legacy column set on an
    // un-migrated client, deliberately NOT through safe(): letting a missing column
    // fall all the way to [] would silently zero `unrecordedDuplicates`.
    loadImportBatches(pid),
  ]);

  if (!records.length) return null;

  // ── how each record ENTERED the project ───────────────────────────────────
  // A record can have several source rows (found by two providers, or re-found by
  // a later run). The EARLIEST one is what PRISMA cares about: identification is
  // where a record first entered, not where it was seen again (§7).
  const sourcesByRecord = {};
  for (const s of sources) {
    const id = s.screenRecordId;
    if (!id) continue;
    if (!sourcesByRecord[id]) sourcesByRecord[id] = { origin: s.origin, runId: s.runId, batchId: s.batchId };
  }

  // ── where a duplicate was caught (§12 breakdown) ──────────────────────────
  // `outcome: 'merged_duplicate'` on a source row means that landing detected the
  // duplication, and the row's origin tells us the stage. Anything else is a
  // duplicate confirmed later, inside the Screening Engine.
  const dedupByRecord = {};
  for (const s of sources) {
    const id = s.screenRecordId;
    if (!id || s.outcome !== 'merged_duplicate') continue;
    const stage = s.origin === 'search' ? 'search' : (s.origin === 'file' || s.origin === 'api') ? 'import' : 'screening';
    if (!dedupByRecord[id]) dedupByRecord[id] = { stage, method: 'automatic' };
  }

  // 116.md §14 — batch attribution map for the projection's effective-database rule.
  //
  // 116.md §14 (r2) — a batch whose `contributesToReview` is FALSE has been retracted
  // from the reported search methodology (104.md), so its declaration must stop
  // attributing records here too; those records fall to the D6(c) other-methods path,
  // which is exactly what the Methods text then claims. `undefined` (legacy row or
  // un-migrated client) means "contributes", matching searchProvenanceService's own
  // `contributesToReview !== false` test.
  const batchById = {};
  for (const b of batches || []) {
    if (!b || !b.id) continue;
    batchById[b.id] = {
      sourceDatabase: b.contributesToReview === false ? '' : (b.sourceDatabase || ''),
    };
  }

  // 116.md §15 — synthesize each RESOLVED conflict as a `resolved: true` decision
  // row at the title/abstract stage (conflicts are T/A-stage entities: resolving
  // 'include' promotes to full_text, 'exclude' keeps the record out). The
  // resolver's precedence (resolved > unanimity > null) does the rest.
  const conflictRows = (conflicts || [])
    .filter((c) => c && c.recordId && c.resolvedAt
      && (c.finalDecision === 'include' || c.finalDecision === 'exclude'))
    .map((c) => ({
      recordId: c.recordId,
      stage: 'title_abstract',
      verdict: c.finalDecision,
      resolved: true,
      reason: c.finalDecision === 'exclude' ? String(c.notes || '').trim() : '',
    }));

  const projections = buildRecordProjections({
    records,
    sourcesByRecord,
    dedupByRecord,
    batchById,
    // ScreenDecision stores its verdict in `decision` and its reason in
    // `exclusionReason`; the resolver expects `verdict`/`reason`.
    decisionsByRecord: resolveDecisions(
      decisions
        .map((d) => ({
          recordId: d.recordId, stage: d.stage, verdict: d.decision, reason: d.exclusionReason,
        }))
        .concat(conflictRows),
    ),
    retrievalByRecord: resolveRetrieval({
      candidates, requests, attachments: attachments.map((a) => a.recordId),
    }),
    quantStudyIds: opts.quantStudyIds || [],
  });

  // 116.md §13 (r2) — the never-inserted import duplicates, ATTRIBUTED PER ARM.
  // Every batch still contributes its full duplicateCount (record accounting is
  // independent of whether the batch is reported in the Methods); what changed is
  // which column gets the credit.
  const survivorsByBatch = new Map();
  for (const p of projections) {
    const key = p.importBatchId || p.batchId;
    if (!key) continue;
    if (!survivorsByBatch.has(key)) survivorsByBatch.set(key, []);
    survivorsByBatch.get(key).push(p);
  }
  const unrecordedDuplicates = { db: 0, other: 0 };
  for (const b of batches || []) {
    const n = Number(b && b.duplicateCount) || 0;
    if (n <= 0) continue;
    const arm = armOfBatchDiscards(
      { declaredDatabase: (batchById[b.id] || {}).sourceDatabase || '', source: b.source },
      survivorsByBatch.get(b.id) || [],
    );
    unrecordedDuplicates[arm === 'db' ? 'db' : 'other'] += n;
  }

  const flow = derivePrismaFlow(projections, {
    previous: opts.previous || null,
    unrecordedDuplicates,
  });
  const reconciliation = reconcilePrismaFlow(flow);
  // `records` and `batches` are returned so a caller that needs display columns
  // (the §9 box inspector) reuses THIS scan rather than re-reading the project.
  return { flow: { ...flow, reconciliation }, reconciliation, projections, records, batches };
}

/**
 * 116.md §11 — the WIRE shape of the flow: counts + labelled breakdown rows, NO id
 * arrays. A 50k-record project used to ship several MB of UUIDs on every PRISMA
 * visit; the ids exist server-side and the per-box record lists are served
 * paginated by the box endpoint. Every client consumer (SVG builder, inspector
 * aggregates, manuscript adaptFlow, search-methodology cross-check) reads only
 * n/label/key/counts — verified before ids were dropped.
 * Pure.
 */
export function slimPrismaFlow(flow) {
  if (!flow) return flow;
  const noIdsRow = ({ ids, ...rest }) => rest;
  const noIdsBucket = (b) => (b && typeof b === 'object' ? { n: b.n } : b);
  const boxes = {};
  for (const [id, b] of Object.entries(flow.boxes || {})) boxes[id] = noIdsBucket(b);
  const dispositions = {};
  for (const [k, b] of Object.entries(flow.dispositions || {})) dispositions[k] = noIdsBucket(b);
  const rb = flow.removedBreakdown || {};
  const oa = flow.otherArm || null;
  return {
    ...flow,
    boxes,
    dispositions,
    // 116.md §13 (r2) — the other-methods arm's removal/screening accounting rides
    // the wire as counts only, exactly like the boxes.
    otherArm: oa
      ? {
        identified: noIdsBucket(oa.identified),
        removed: noIdsBucket(oa.removed),
        removedDuplicate: noIdsBucket(oa.removedDuplicate),
        removedAutomation: noIdsBucket(oa.removedAutomation),
        removedOther: noIdsBucket(oa.removedOther),
        screened: noIdsBucket(oa.screened),
        excludedScreening: noIdsBucket(oa.excludedScreening),
        awaitingScreening: noIdsBucket(oa.awaitingScreening),
        unrecordedDuplicates: oa.unrecordedDuplicates,
      }
      : oa,
    sources: {
      db: (flow.sources && flow.sources.db ? flow.sources.db : []).map(noIdsRow),
      other: (flow.sources && flow.sources.other ? flow.sources.other : []).map(noIdsRow),
    },
    removedBreakdown: {
      ...rb,
      duplicate: noIdsBucket(rb.duplicate),
      automation: noIdsBucket(rb.automation),
      other: noIdsBucket(rb.other),
      otherArm: rb.otherArm
        ? {
          total: noIdsBucket(rb.otherArm.total),
          duplicate: noIdsBucket(rb.otherArm.duplicate),
          automation: noIdsBucket(rb.otherArm.automation),
          other: noIdsBucket(rb.otherArm.other),
          byStage: (rb.otherArm.byStage || []).map(noIdsRow),
        }
        : rb.otherArm,
      byStage: (rb.byStage || []).map(noIdsRow),
      byMethod: (rb.byMethod || []).map(noIdsRow),
      byReason: (rb.byReason || []).map(noIdsRow),
    },
    exclusionReasons: (flow.exclusionReasons || []).map(noIdsRow),
    exclusionReasonsByArm: {
      db: (flow.exclusionReasonsByArm && flow.exclusionReasonsByArm.db ? flow.exclusionReasonsByArm.db : []).map(noIdsRow),
      other: (flow.exclusionReasonsByArm && flow.exclusionReasonsByArm.other ? flow.exclusionReasonsByArm.other : []).map(noIdsRow),
    },
    notRetrievedReasons: (flow.notRetrievedReasons || []).map(noIdsRow),
  };
}

export default { loadPrismaFlow, slimPrismaFlow };
