/**
 * screeningConflictService.js
 * Single source of truth for a record's ScreenConflict row. Recomputes the
 * conflict state from the reviewers' CURRENT ACTIVE decisions whenever a decision
 * is saved/changed, and keeps the persisted row in lockstep so the Conflicts tab
 * and every counter agree (prompt50 WS3).
 *
 * Scope: conflicts are a TITLE/ABSTRACT screening concept — two reviewers
 * independently include/exclude and disagree. Full-text "second review"
 * disagreements are resolved by the leader via finalizeRecord, NOT the Conflicts
 * tab, so this service only ever looks at one stage's decisions (default
 * title_abstract). That scoping is what stops a record that was INCLUDED BY BOTH
 * reviewers (and then promoted + re-decided at full text) from being
 * mis-flagged as a conflict.
 *
 * Row lifecycle (derived state, with a sticky manual override):
 *   disagreement                         → ensure an OPEN row (create / reopen)
 *   unanimous agreement (≥2 reviewers)   → auto-resolve an existing row (history)
 *   dropped below 2 active reviewers     → delete an existing auto/open row
 *   leader manual resolution (resolvedBy = userId) → never auto-touched
 */
import { prisma } from '../db/client.js';
import { detectConflict } from '../../src/research-engine/screening/conflicts.js';

/** The stage at which reviewer disagreements are tracked as conflicts. */
export const CONFLICT_STAGE = 'title_abstract';

/**
 * Recalculate and persist the conflict row for one record.
 * @returns {Promise<{state: 'conflict'|'resolved'|'cleared'|'none', resolvedBy?: string}>}
 */
export async function syncConflicts(projectId, recordId, { stage = CONFLICT_STAGE } = {}) {
  // ACTIVE decisions for the relevant stage only (stage-scoped → no cross-stage
  // mixing). One row per (record, reviewer, stage) is schema-enforced, but
  // detectConflict also collapses by reviewer defensively.
  const decisions = await prisma.screenDecision.findMany({
    where: { recordId, projectId, stage },
    select: { reviewerId: true, decision: true },
  });
  const { hasConflict, decisions: reviewerMap, uniqueDecisions, reviewerCount } = detectConflict(decisions);

  // There should be at most one row per (project, record); defensively collapse
  // any duplicates created by an older race so the tab never double-counts.
  const rows = await prisma.screenConflict.findMany({
    where: { projectId, recordId },
    orderBy: { createdAt: 'asc' },
  });
  const existing = rows[0] || null;
  if (rows.length > 1) {
    await prisma.screenConflict.deleteMany({
      where: { id: { in: rows.slice(1).map(r => r.id) } },
    });
  }

  // A leader's explicit resolution is authoritative and sticky — never recompute it.
  const manuallyResolved = !!(existing && existing.resolvedAt && existing.resolvedBy && existing.resolvedBy !== 'auto');
  if (manuallyResolved) return { state: 'resolved', resolvedBy: existing.resolvedBy };

  if (hasConflict) {
    const data = { reviewerDecisions: JSON.stringify(reviewerMap) };
    if (existing) {
      // Reopen if it had been auto-resolved (a prior agreement re-conflicted).
      if (existing.resolvedAt) Object.assign(data, { finalDecision: '', resolvedBy: '', resolvedAt: null });
      await prisma.screenConflict.update({ where: { id: existing.id }, data });
    } else {
      await prisma.screenConflict.create({ data: { projectId, recordId, ...data } });
    }
    return { state: 'conflict' };
  }

  // No disagreement. Reconcile any existing derived (open/auto) row so it leaves
  // the Conflicts tab immediately — without a reload.
  if (existing) {
    if (reviewerCount >= 2 && uniqueDecisions.length === 1) {
      // Unanimous agreement among ≥2 reviewers → auto-resolve (kept as history).
      await prisma.screenConflict.update({
        where: { id: existing.id },
        data: { reviewerDecisions: JSON.stringify(reviewerMap), finalDecision: uniqueDecisions[0], resolvedBy: 'auto', resolvedAt: new Date() },
      });
      return { state: 'resolved', resolvedBy: 'auto' };
    }
    // Fewer than 2 active reviewers (a decision was retracted) → the conflict no
    // longer exists; remove the auto-created row so the record returns to
    // awaiting-second-reviewer with nothing in Conflicts.
    await prisma.screenConflict.delete({ where: { id: existing.id } });
    return { state: 'cleared' };
  }

  return { state: 'none' };
}
