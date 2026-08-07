/**
 * screening/prismaFlowService.js — 103.md §10/§19. Loads a project's records and
 * derives the canonical PRISMA flow from them.
 *
 * This is the piece that makes the record-level model REACHABLE. The engine in
 * src/research-engine/prisma/ is pure and fully tested; without this loader nothing
 * in production ever supplied it, so the manuscript kept falling back to the legacy
 * precedence chain.
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
 * loadPrismaFlow(screenProjectId, opts) → { flow, reconciliation } or null.
 *
 * @param {string} pid  ScreenProject id
 * @param {object} [opts]
 *   previous   { studies, reports } for an UPDATED review (103.md §7)
 *   quantStudyIds  study ids contributing to the meta-analysis
 */
export async function loadPrismaFlow(pid, opts = {}) {
  if (!pid || !has('screenRecord')) return null;

  const [records, decisions, sources, candidates, requests, attachments, batches] = await Promise.all([
    safe(() => prisma.screenRecord.findMany({
      where: { projectId: pid },
      select: {
        id: true, sourceDb: true, isDuplicate: true, isPrimary: true,
        duplicateGroupId: true, currentStage: true, finalStatus: true,
        promotedAt: true, rejectedReason: true, handoffStudyId: true,
      },
    }), []),
    safe(() => prisma.screenDecision.findMany({
      where: { projectId: pid },
      select: { recordId: true, stage: true, decision: true, reason: true },
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
    // records that really were retrieved.
    safe(() => prisma.screenImportBatch.findMany({
      where: { projectId: pid }, select: { duplicateCount: true },
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

  const projections = buildRecordProjections({
    records,
    sourcesByRecord,
    dedupByRecord,
    // ScreenDecision stores its verdict in `decision`; the resolver expects `verdict`.
    decisionsByRecord: resolveDecisions(decisions.map((d) => ({
      recordId: d.recordId, stage: d.stage, verdict: d.decision, reason: d.reason,
    }))),
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

export default { loadPrismaFlow };
