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
  derivePrismaFlow, reconcilePrismaFlow,
} from '../../src/research-engine/prisma/index.js';

/** Is a model available on the current Prisma client? */
function has(model) {
  return !!(prisma && prisma[model] && typeof prisma[model].findMany === 'function');
}

const safe = async (fn, fallback) => {
  try { return await fn(); } catch { return fallback; }
};

/**
 * loadPrismaFlow(screenProjectId, opts) → { flow, reconciliation, projections } or null.
 *
 * @param {string} pid  ScreenProject id
 * @param {object} [opts]
 *   previous   { studies, reports } for an UPDATED review (103.md §7)
 *   quantStudyIds  study ids contributing to the meta-analysis
 */
export async function loadPrismaFlow(pid, opts = {}) {
  if (!pid || !has('screenRecord')) return null;

  const [records, decisions, conflicts, sources, candidates, requests, attachments, batches] = await Promise.all([
    safe(() => prisma.screenRecord.findMany({
      where: { projectId: pid },
      select: {
        id: true, sourceDb: true, isDuplicate: true, isPrimary: true,
        duplicateGroupId: true, currentStage: true, finalStatus: true,
        promotedAt: true, rejectedReason: true, handoffStudyId: true,
        // 116.md §13/§14 — the batch link (legacy records with no
        // ScreenRecordSource row fall back to it for origin 'file' + effective
        // batch attribution) and the per-record identification correction.
        importBatchId: true, identificationSource: true, sourceDetail: true,
      },
    }), []),
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
    // sourceDatabase now rides along so the projection can thread it into each
    // record's effective attribution.
    safe(() => prisma.screenImportBatch.findMany({
      where: { projectId: pid },
      select: { id: true, duplicateCount: true, sourceDatabase: true },
    }), []),
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
  const batchById = {};
  for (const b of batches || []) {
    if (b && b.id) batchById[b.id] = { sourceDatabase: b.sourceDatabase || '' };
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

  const unrecordedDuplicates = (batches || [])
    .reduce((a, b) => a + (Number(b.duplicateCount) || 0), 0);

  const flow = derivePrismaFlow(projections, {
    previous: opts.previous || null,
    unrecordedDuplicates,
  });
  const reconciliation = reconcilePrismaFlow(flow);
  return { flow: { ...flow, reconciliation }, reconciliation, projections };
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
  return {
    ...flow,
    boxes,
    dispositions,
    sources: {
      db: (flow.sources && flow.sources.db ? flow.sources.db : []).map(noIdsRow),
      other: (flow.sources && flow.sources.other ? flow.sources.other : []).map(noIdsRow),
    },
    removedBreakdown: {
      ...rb,
      duplicate: noIdsBucket(rb.duplicate),
      automation: noIdsBucket(rb.automation),
      other: noIdsBucket(rb.other),
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
