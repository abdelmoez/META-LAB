/**
 * progressEvidence.js — 98.md §14 (Defect 2b). Loads the screening SUBSTEP counts
 * + the server-computed `complete` boolean that feed the canonical workflow
 * progress model (computeProjectProgress → screeningRule) and the sign-off
 * corroboration warning (screeningController.updateProject).
 *
 * The counts deliberately mirror getMetaLabSummary's substep math
 * (screeningController.js, prompt29 Part 9 / 81.md quorum audit) but are computed
 * with CHEAP scoped queries (counts + one per-record decision groupBy for the
 * quorum-aware title/abstract pending) instead of loading every record/decision
 * row — this runs on every project detail GET.
 *
 * ONE deliberate divergence from isScreeningComplete: `complete` uses
 * isScreeningWorkComplete, which does NOT require includedFinal > 0 — an
 * all-rejected screen IS finished screening work (see screeningCompletion.js).
 */
import { prisma } from '../db/client.js';
import { getEffectiveQuorum } from './settings.js';
import { isScreeningWorkComplete } from '../utils/screeningCompletion.js';
import { DECIDED_FINAL_STATUSES } from '../utils/screeningCounts.js';

/**
 * @param {object|string} screenProjectOrId a ScreenProject row (needs `id`;
 *   `requiredScreeningReviewers` is used when present) or a ScreenProject id.
 * @returns {Promise<{
 *   total:number, decidedCount:number, screenablePool:number,
 *   titleAbstractPending:number, unresolvedConflicts:number,
 *   unresolvedDuplicateGroups:number, secondReviewPending:number,
 *   includedFinal:number, complete:boolean }>}
 * Throws on query failure — callers treat this as best-effort evidence.
 */
export async function loadScreeningProgressEvidence(screenProjectOrId) {
  let project = typeof screenProjectOrId === 'string' ? null : screenProjectOrId;
  const projectId = project ? project.id : screenProjectOrId;
  if (project && !Number.isFinite(Number(project.requiredScreeningReviewers))) project = null;
  if (!project) {
    project = await prisma.screenProject.findUnique({
      where: { id: projectId }, select: { id: true, requiredScreeningReviewers: true },
    });
  }
  // 81.md — the SAME admin-driven quorum the promotion gate uses
  // (effectiveRequiredReviewers = max(per-project, global)), never below 2.
  const effectiveRequired = Math.max(
    Number(project?.requiredScreeningReviewers) || 2,
    await getEffectiveQuorum(),
  );

  const [
    total, screenablePool, decidedCount, taRecords, taDecisionRows,
    unresolvedConflicts, unresolvedDuplicateGroups,
    fullTextAssessed, includedFinal, fullTextExcluded,
  ] = await Promise.all([
    prisma.screenRecord.count({ where: { projectId } }),
    prisma.screenRecord.count({ where: { projectId, isDuplicate: false } }),
    // 98.md §14 Defect 2a — decided is isDuplicate-filtered: a record finalized and
    // THEN swept into a duplicate group must not keep counting toward progress.
    prisma.screenRecord.count({
      where: { projectId, isDuplicate: false, finalStatus: { in: DECIDED_FINAL_STATUSES } },
    }),
    // Quorum-aware title/abstract pending: the non-duplicate records still at the
    // title_abstract stage…
    prisma.screenRecord.findMany({
      where: { projectId, isDuplicate: false, currentStage: 'title_abstract' },
      select: { id: true },
    }),
    // …versus each record's DISTINCT non-undecided title/abstract reviewers.
    // @@unique([recordId, reviewerId, stage]) makes the row count per recordId
    // exactly the distinct reviewer count.
    prisma.screenDecision.groupBy({
      by: ['recordId'],
      where: { projectId, stage: 'title_abstract', decision: { not: 'undecided' } },
      _count: { _all: true },
    }),
    prisma.screenConflict.count({ where: { projectId, resolvedAt: null } }),
    prisma.screenDuplicateGroup.count({ where: { projectId, resolvedAt: null } }),
    // 98.md review — Finding B: the whole full_text population is isDuplicate:false-
    // filtered TOGETHER (all three counts, so the subtraction below stays consistent),
    // matching decidedCount/screenablePool/titleAbstractPending. Without the filter, a
    // full_text record later swept into a resolved duplicate group inflated
    // secondReviewPending forever — permanently blocking `complete:true` and demoting
    // legitimate sign-offs.
    prisma.screenRecord.count({ where: { projectId, isDuplicate: false, currentStage: 'full_text' } }),
    prisma.screenRecord.count({ where: { projectId, isDuplicate: false, finalStatus: 'accepted' } }),
    prisma.screenRecord.count({ where: { projectId, isDuplicate: false, finalStatus: 'rejected' } }),
  ]);

  const reviewersByRecord = new Map(taDecisionRows.map(r => [
    r.recordId,
    typeof r._count === 'number' ? r._count : (r._count?._all || 0),
  ]));
  const titleAbstractPending = taRecords
    .filter(r => (reviewersByRecord.get(r.id) || 0) < effectiveRequired).length;
  // Mirrors getMetaLabSummary: full-text records without a terminal finalStatus.
  const secondReviewPending = Math.max(0, fullTextAssessed - includedFinal - fullTextExcluded);

  return {
    total,
    decidedCount,
    screenablePool,
    titleAbstractPending,
    unresolvedConflicts,
    unresolvedDuplicateGroups,
    secondReviewPending,
    includedFinal,
    complete: isScreeningWorkComplete({
      total, unresolvedDuplicateGroups, titleAbstractPending,
      unresolvedConflicts, secondReviewPending, includedFinal,
    }),
  };
}
