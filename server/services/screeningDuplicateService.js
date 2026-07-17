/**
 * screeningDuplicateService.js
 * Duplicate-detection support for META·SIFT Beta.
 *
 * 92.md — the actual detection no longer lives here. The old detectDuplicatesInProject
 * ran an O(n²) full-matrix Levenshtein sweep synchronously inside the HTTP request
 * (~30s of blocked event loop at 500 records, ~8min at 2,000 — measured) and persisted
 * groups with N+1 non-transactional writes. Detection is now a durable background job:
 * see server/services/screeningDuplicateWorker.js (job lifecycle) and
 * src/research-engine/screening/duplicateDetectionEngine.js (pure matching engine).
 * This module keeps the reviewer-label accrual + classifier evaluation used by the
 * resolve endpoints (se2.md §10).
 */
import { classifyPair, evaluateDuplicateLabels, DUP_MODEL_VERSION } from '../../src/research-engine/screening/deduplication.js';

/**
 * recordDuplicateLabels — persist a reviewer-confirmed label for EVERY pair in a group
 * (se2.md §10), stamping the classifier's verdict at label time so the engine can later
 * be evaluated against real decisions. Pairs are stored in canonical (A<B) order and
 * upserted, so re-resolving a group updates rather than duplicates. Best-effort: callers
 * wrap this so a labelling failure never blocks the resolution itself.
 *
 * @param {{projectId:string, records:Array<object>, label:string, reviewerId?:string, prisma:object}} args
 * @returns {Promise<number>} number of pair-labels written
 */
export async function recordDuplicateLabels({ projectId, records, label, reviewerId, prisma }) {
  const recs = Array.isArray(records) ? records : [];
  let n = 0;
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const [a, b] = recs[i].id < recs[j].id ? [recs[i], recs[j]] : [recs[j], recs[i]];
      const c = classifyPair(a, b);
      await prisma.screenDuplicateLabel.upsert({
        where: { projectId_recordIdA_recordIdB: { projectId, recordIdA: a.id, recordIdB: b.id } },
        create: {
          projectId, recordIdA: a.id, recordIdB: b.id, label,
          predictedType: c.type, score: c.score, reason: (c.reasons || []).join('; '),
          modelVersion: DUP_MODEL_VERSION, reviewerId: reviewerId || null,
        },
        update: { label, predictedType: c.type, score: c.score, reason: (c.reasons || []).join('; '), modelVersion: DUP_MODEL_VERSION, reviewerId: reviewerId || null },
      });
      n++;
    }
  }
  return n;
}

/**
 * getDuplicateEvaluation — run the evaluation harness over the project's accrued
 * reviewer labels (se2.md §10). Returns precision/recall/false-merge/false-split + the
 * label count, so a leader can see whether the heuristic is trustworthy yet. Until there
 * are enough labels, the duplicate engine stays honestly marked unvalidated.
 */
export async function getDuplicateEvaluation(projectId, prisma) {
  const labels = await prisma.screenDuplicateLabel.findMany({
    where: { projectId }, select: { predictedType: true, label: true, score: true },
  });
  return { ...evaluateDuplicateLabels(labels), labelCount: labels.length };
}
