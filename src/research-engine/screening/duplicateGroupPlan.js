/**
 * duplicateGroupPlan.js — map a detected duplicate partition onto existing group rows (92.md).
 * Pure function, no database, no side effects — the write plan is unit-testable.
 *
 * Rules (data integrity, 92.md):
 *   - engine groups containing NO existing open group → one `create` plan;
 *   - engine groups overlapping existing open (unresolved) groups → one `extend` plan
 *     targeting the OLDEST group (deterministic tie-break by id); other overlapped
 *     groups are absorbed into it (their members repoint, the emptied rows delete);
 *   - a group whose persisted membership already equals the engine's partition and
 *     which has a primary produces NO plan → reruns on unchanged data are no-ops;
 *   - the target's existing primary is carried on the plan so a reviewer's radio
 *     selection survives an extend (never replaced by an absorbed group's primary).
 */

/**
 * @param {string[][]} engineGroups — partition from detectDuplicateGroups (each sorted)
 * @param {Array<{id:string, createdAt:Date|string, records:Array<{id:string,isPrimary:boolean}>}>} openGroups
 *   — the project's UNRESOLVED ScreenDuplicateGroup rows (resolved groups are frozen
 *     upstream and never appear here)
 * @returns {Array<
 *   { kind:'create', members:string[] } |
 *   { kind:'extend', targetId:string, members:string[], newMembers:string[],
 *     absorbedGroupIds:string[], targetPrimaryId:string|null }
 * >}
 */
export function planGroupWrites(engineGroups, openGroups) {
  const byRecord = new Map(); // recordId → open group id
  const meta = new Map();     // groupId → { id, createdAt, memberIds:Set, primaryId }
  for (const g of openGroups) {
    const memberIds = new Set((g.records || []).map((r) => r.id));
    const primaryId = ((g.records || []).find((r) => r.isPrimary) || {}).id || null;
    meta.set(g.id, { id: g.id, createdAt: g.createdAt, memberIds, primaryId });
    for (const id of memberIds) byRecord.set(id, g.id);
  }

  const plans = [];
  for (const members of engineGroups) {
    const gids = [...new Set(members.map((id) => byRecord.get(id)).filter(Boolean))];
    if (gids.length === 0) {
      plans.push({ kind: 'create', members });
      continue;
    }
    // Deterministic target: the OLDEST existing open group (tie → smallest id).
    gids.sort((a, b) => {
      const ta = new Date(meta.get(a).createdAt).getTime();
      const tb = new Date(meta.get(b).createdAt).getTime();
      if (ta !== tb) return ta - tb;
      return a < b ? -1 : 1;
    });
    const target = meta.get(gids[0]);
    const absorbedGroupIds = gids.slice(1);
    // Members that must be (re)pointed at the target: not-yet-grouped records and
    // members of absorbed groups. Existing target members stay put.
    const newMembers = members.filter((id) => byRecord.get(id) !== target.id);
    const unchanged = absorbedGroupIds.length === 0
      && newMembers.length === 0
      && members.length === target.memberIds.size
      && !!target.primaryId;
    if (unchanged) continue; // exact no-op — nothing to write
    plans.push({
      kind: 'extend', targetId: target.id, members, newMembers, absorbedGroupIds,
      targetPrimaryId: target.primaryId,
    });
  }
  return plans;
}
