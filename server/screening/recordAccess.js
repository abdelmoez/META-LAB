/**
 * screening/recordAccess.js — 116.md §10 (r2). The record-editing permission bar,
 * defined ONCE.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Two surfaces answer the same question and must never disagree: the PRISMA box
 * endpoint ADVERTISES `canEdit`/`canFinalize` (screeningOverviewController), and
 * the metadata PATCH ENFORCES them (screeningController). The expression was
 * duplicated in both, and both copies carried the same defect:
 *
 *     access.isOwner || access.isLeader || (access.active && …)
 *
 * The `access.active` conjunct sat only on the third branch, so `isLeader` alone
 * passed. getProjectAccess (access.js) nulls out only a 'pending' membership, so a
 * DEACTIVATED leader keeps `{ isLeader: true, active: false }` — and deactivation is
 * the product's only revocation short of removal. That user was refused by
 * importRecords, by every decision endpoint and by listDecisions, but could still
 * PATCH a record's `identificationSource` (which moves it between the PRISMA
 * database and other-methods arms, changing the review's reported identification
 * counts) and, through the equally status-blind `canFinalize`, rewrite the
 * `rejectedReason` that becomes the published exclusion-reason table.
 *
 * The bar implemented here is the one importRecords already uses
 * (screeningController: `isOwner || (active && (isLeader || perms.canImportRecords))`)
 * and the one the PATCH's own doc comment claims to mirror. Owner stays exempt
 * because the owner has no membership row to deactivate.
 *
 * Pure — takes a getProjectAccess() result, returns a boolean. No I/O.
 */

/**
 * May this caller edit record METADATA (title/DOI/sourceDb/identificationSource…)?
 * Same bar as putting records into the project.
 * @param {object|null} access  getProjectAccess() result
 */
export function canEditRecordMetadata(access) {
  if (!access) return false;
  if (access.isOwner) return true;
  if (!access.active) return false;
  if (access.isLeader) return true;
  const member = access.member;
  const perms = access.perms || {};
  return !!(member && member.role !== 'viewer' && perms.canImportRecords);
}

/**
 * May this caller take FINAL-REVIEW actions (finalize/revert) and rewrite the final
 * exclusion reason? `access.canResolveConflicts` is itself status-blind
 * (access.js:69-71), so the active requirement is applied here rather than trusted.
 * @param {object|null} access  getProjectAccess() result
 */
export function canFinalizeRecords(access) {
  if (!access) return false;
  if (access.isOwner) return true;
  if (!access.active) return false;
  return !!(access.isLeader || access.canResolveConflicts);
}

export default { canEditRecordMetadata, canFinalizeRecords };
