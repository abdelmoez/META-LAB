/**
 * shared/access/capabilities.js — 91.md "Role and Permission Consistency". The ONE
 * registry of named capabilities and how each is gated, so the frontend rendering,
 * frontend interactions, and backend enforcement all resolve the SAME rule instead
 * of scattering ad-hoc role checks. Keys mirror the project's existing permission
 * flags (src/research-engine/screening/permissionPresets.js PERMISSION_KEYS).
 *
 * Each capability declares:
 *   restriction  the RESTRICTION_TYPES id used when denied (owner_only/leader_only/
 *                admin_only/permission/tier)
 *   perm         (permission-type) the getProjectAccess/perms flag that grants it
 *   edit         true if it is an editing action (blocked on archived/read-only projects)
 *   entitlementKey (tier-type) the entitlement that grants it
 *   message      (role|current) → specific, actionable denial sentence
 *
 * Pure data — no DOM/React/network.
 */

const cap = (key, spec) => ({ key, ...spec });

export const CAPABILITIES = Object.freeze({
  // ── Project management (owner / leader) ─────────────────────────────────
  manageProject: cap('manageProject', {
    label: 'Manage project settings', restriction: 'leader_only', edit: true,
    message: (r) => `Your ${r || 'current'} role can view project settings, but only project owners and leaders can change them.`,
  }),
  manageMembers: cap('manageMembers', {
    label: 'Manage members & roles', restriction: 'leader_only', perm: 'canManageMembers', edit: true,
    message: (r) => `Only project owners and leaders can add, remove, or change members. Your role is ${r || 'a member'}.`,
  }),
  deleteProject: cap('deleteProject', {
    label: 'Delete this project', restriction: 'owner_only', edit: true,
    message: (r) => `Only the project owner can delete this project. You are currently a ${r || 'member'} — contact the owner if it should be deleted.`,
  }),

  // ── Workflow editing (per-member permission) ────────────────────────────
  editProtocol: cap('editProtocol', {
    label: 'Edit the protocol', restriction: 'permission', perm: 'canEditMetaLab', edit: true,
    message: () => 'You can view the protocol, but editing it requires edit access to the workspace. Ask a project leader to enable it.',
  }),
  runSearch: cap('runSearch', {
    label: 'Run the literature search', restriction: 'permission', perm: 'canEditMetaLab', edit: true,
    message: () => 'Running the search requires edit access to the workspace. Ask a project leader to enable it for you.',
  }),
  screen: cap('screen', {
    label: 'Record screening decisions', restriction: 'permission', perm: 'canScreen', edit: true,
    message: () => 'Your role can view screening, but recording decisions needs the Screening permission. Ask a project leader to enable it.',
  }),
  resolveConflicts: cap('resolveConflicts', {
    label: 'Resolve screening conflicts', restriction: 'permission', perm: 'canResolveConflicts', edit: true,
    message: () => 'Resolving screening conflicts is limited to leaders and reviewers with the Conflict-resolution permission.',
  }),
  runScoring: cap('runScoring', {
    label: 'Run AI article scoring', restriction: 'permission', perm: 'canScreen', edit: true,
    message: () => 'Running article scores needs the Screening permission. You can still view existing scores.',
  }),
  configureGuidedScreening: cap('configureGuidedScreening', {
    label: 'Configure Guided Screening', restriction: 'admin_only', edit: true,
    message: () => 'Guided Screening configuration (model settings, validation, versions, rollback) is available only to administrators. You can still run scoring and view article scores from the Screening toolbar.',
  }),
  editExtraction: cap('editExtraction', {
    label: 'Edit data extraction', restriction: 'permission', perm: 'canManageExtraction', edit: true,
    message: () => 'You can view extracted data, but editing it needs the Data-extraction permission. Ask a project leader to enable it.',
  }),
  assessRiskOfBias: cap('assessRiskOfBias', {
    label: 'Assess risk of bias', restriction: 'permission', perm: 'canAssessRiskOfBias', edit: true,
    message: () => 'Recording risk-of-bias judgments needs the Risk-of-bias permission. Ask a project leader to enable it.',
  }),
  runAnalysis: cap('runAnalysis', {
    label: 'Run the meta-analysis', restriction: 'permission', perm: 'canRunAnalysis', edit: true,
    message: () => 'You can view the rest of the project, but running the meta-analysis and its plots needs the Analysis permission. Ask the project owner or a leader to enable Analysis for you in Project Control ▸ Members & permissions.',
  }),
  exportProject: cap('exportProject', {
    label: 'Export the project', restriction: 'permission', perm: 'canExport', edit: false,
    message: () => 'Exporting this project needs the Export permission. Ask a project leader to enable it.',
  }),
  chat: cap('chat', {
    label: 'Post in project chat', restriction: 'permission', perm: 'canChat', edit: true,
    message: () => 'Chat is not enabled for your role in this project.',
  }),
  approveManuscriptUpdates: cap('approveManuscriptUpdates', {
    label: 'Approve manuscript updates', restriction: 'leader_only', edit: true,
    message: () => 'Approving manuscript updates is limited to project owners and leaders.',
  }),

  // ── Plan / tier gated (entitlement keys from src/shared/entitlements.js) ──
  exportProjectPlan: cap('exportProjectPlan', {
    label: 'Export project (plan gate)', restriction: 'tier', entitlementKey: 'projects.export', edit: false,
    message: () => 'Exporting projects is not included in your current plan.',
  }),
  wordExport: cap('wordExport', {
    label: 'Export to Word (.docx)', restriction: 'tier', entitlementKey: 'manuscript.wordExport', edit: false,
    message: () => 'Word (.docx) export is not included in your current plan.',
  }),
  networkMetaAnalysis: cap('networkMetaAnalysis', {
    label: 'Network meta-analysis', restriction: 'tier', entitlementKey: 'metaAnalysis.nma', edit: false,
    message: () => 'Network meta-analysis is not included in your current plan.',
  }),
  livingReview: cap('livingReview', {
    label: 'Living reviews', restriction: 'tier', entitlementKey: 'livingReview.enabled', edit: false,
    message: () => 'Living reviews are not included in your current plan.',
  }),

  // ── Site administration ─────────────────────────────────────────────────
  manageUsers: cap('manageUsers', {
    label: 'Manage users', restriction: 'admin_only', edit: true,
    message: () => 'User management is available only to administrators.',
  }),
  viewAdminMetrics: cap('viewAdminMetrics', {
    label: 'View admin metrics', restriction: 'admin_only', edit: false,
    message: () => 'The operations dashboard is available only to administrators.',
  }),
});

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES);

export function capabilitySpec(key) {
  return CAPABILITIES[key] || null;
}

export default { CAPABILITIES, CAPABILITY_KEYS, capabilitySpec };
