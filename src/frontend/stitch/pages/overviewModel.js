/**
 * overviewModel.js — pure, role-aware derivations for the project Overview
 * (56.md §1 D "Attention Required" + E "My Work"). No React/DOM → unit-testable.
 *
 * Everything here is derived from REAL project state (the same stepStatus /
 * readinessCheck / auditProject / screening summary the rest of the app uses) and
 * gated by the user's permissions — never fabricated collaboration data. Each
 * builder returns [] when there is nothing to show, so the Overview can omit empty
 * sections entirely (acceptance #7).
 */

/**
 * "My Work" — the concrete next actions THIS user can take now, gated by role +
 * permissions. Returns an ordered list (most urgent first):
 *   { key, label, desc, stage, icon, tone }
 * ctx = { statusMap, readiness, conflictsCount, perms, studyCount }
 */
export function buildMyWork(ctx = {}) {
  const { statusMap = {}, readiness, conflictsCount = 0, perms = {}, studyCount = 0 } = ctx;
  const items = [];
  const canEdit = !perms.readOnly;

  // Resolve screening conflicts — anyone who can screen should act on open conflicts.
  if (canEdit && conflictsCount > 0) {
    items.push({
      key: 'conflicts', label: 'Resolve screening conflicts',
      desc: `${conflictsCount} open conflict${conflictsCount === 1 ? '' : 's'} awaiting a decision`,
      stage: 'screening', icon: 'alertTriangle', tone: 'danger',
    });
  }
  // Protocol gaps block screening — surface to editors only.
  if (canEdit && readiness && !readiness.ok && Array.isArray(readiness.missing) && readiness.missing.length) {
    items.push({
      key: 'protocol', label: 'Finish the protocol',
      desc: `${readiness.missing.length} item${readiness.missing.length === 1 ? '' : 's'} to resolve before screening`,
      stage: 'pico', icon: 'target', tone: 'warn',
    });
  }
  // Risk of bias — only for owners / RoB assessors, only once there are studies.
  if (canEdit && studyCount > 0 && (perms.isOwner || perms.canAssessRiskOfBias)
      && (statusMap.rob === 'partial' || statusMap.rob === 'empty')) {
    items.push({
      key: 'rob', label: 'Assess risk of bias',
      desc: statusMap.rob === 'partial' ? 'Assessment in progress' : 'Not started yet',
      stage: 'rob', icon: 'scale', tone: 'brand',
    });
  }
  // Data extraction in progress.
  if (canEdit && studyCount > 0 && statusMap.extraction === 'partial') {
    items.push({
      key: 'extraction', label: 'Complete data extraction',
      desc: 'Some studies still need effect-size data',
      stage: 'extraction', icon: 'table', tone: 'brand',
    });
  }
  return items;
}

const SEV_RANK = { high: 0, med: 1, low: 2 };

/**
 * "Attention Required" — prioritized methodology/quality items from auditProject,
 * with the live unresolved-conflicts count promoted to the top when present.
 * Returns at most `limit` items: { key, sev, msg, stage }.
 * ctx = { auditItems, conflictsCount, phasePrimary }
 */
export function buildAttention(ctx = {}) {
  const { auditItems = [], conflictsCount = 0, phasePrimary = {}, limit = 6 } = ctx;
  const items = [];
  if (conflictsCount > 0) {
    items.push({ key: 'conflicts', sev: 'high', stage: 'screening', msg: `${conflictsCount} unresolved screening conflict${conflictsCount === 1 ? '' : 's'} need a decision.` });
  }
  const ranked = [...auditItems].sort((a, b) => (SEV_RANK[a.sev] ?? 3) - (SEV_RANK[b.sev] ?? 3));
  for (const it of ranked) {
    items.push({ key: `audit-${items.length}`, sev: it.sev, stage: phasePrimary[it.phase] || 'overview', msg: it.msg });
  }
  return items.slice(0, limit);
}
