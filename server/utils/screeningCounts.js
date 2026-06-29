/**
 * screeningCounts.js — pure, side-effect-free helpers for the project-list cards
 * (63.md AREAS 2/4/6). These keep the ONE canonical definition of "how many
 * records / active members / terminally-decided records does a linked
 * ScreenProject have" in a single place so the META·LAB project list, the
 * META·SIFT project list, and the project Overview can never drift apart.
 *
 * No Prisma import here on purpose — these are the SHAPES + the post-query
 * reducer, so they unit-test without a database.
 */

/**
 * The canonical Prisma `_count.select` fragment for a ScreenProject card.
 *   records = total imported ScreenRecords (the study count).
 *   members = ACTIVE accepted members only (status:'active') — the 58.md §1
 *             canonical member count (all roles, owner included), NOT pending
 *             invites or removed/inactive rows. This is the ONE denominator the
 *             list reads, matching projectsController.js getLinkedSiftByProjectIds.
 * Returned fresh each call so a caller can never mutate a shared object.
 */
export function screeningCountSelect() {
  return { records: true, members: { where: { status: 'active' } } };
}

/**
 * A ScreenRecord is "decided" — i.e. it counts toward real screening progress —
 * once it has reached a terminal finalStatus. These are the two terminal values
 * of ScreenRecord.finalStatus (the column default is "", an undecided record).
 */
export const DECIDED_FINAL_STATUSES = ['accepted', 'rejected'];

/**
 * Reduce the rows from
 *   prisma.screenRecord.groupBy({ by:['projectId'],
 *     where:{ ..., finalStatus:{ in: DECIDED_FINAL_STATUSES } }, _count:{ _all:true } })
 * into a Map<screenProjectId, decidedCount>. Robust to either `_count._all`
 * (the groupBy shape we issue) or a plain numeric `_count`; missing/garbled
 * rows contribute 0. Pure — never touches the DB.
 */
export function classifyDecided(groupByRows) {
  const byProject = new Map();
  if (!Array.isArray(groupByRows)) return byProject;
  for (const r of groupByRows) {
    if (!r || r.projectId == null) continue;
    const c = r._count;
    const n = typeof c === 'number' ? c : (c && typeof c._all === 'number' ? c._all : 0);
    byProject.set(r.projectId, (byProject.get(r.projectId) || 0) + (n > 0 ? n : 0));
  }
  return byProject;
}
