/**
 * permissionPresets.js — shared Review Workspace permission model (prompt4 Task 9).
 *
 * One source of truth for the per-member module permissions, used by the server
 * (member controller + access resolver) and the frontend (Members & Permissions
 * UI). Owners and leaders are NOT governed by these stored flags — they are
 * computed as full-access in access.js; presets describe member/viewer roles.
 *
 * Dependency-free plain data so both Node (ESM) and Vite can import it.
 */

// All module-permission flag keys (kept in sync with ScreenProjectMember columns).
export const PERMISSION_KEYS = [
  // META·SIFT
  'canViewMetaSift', 'canScreen', 'canSecondReview', 'canResolveConflicts',
  'canManageDuplicates', 'canImportRecords', 'canExportRecords', 'canChat', 'readOnlyMetaSift',
  // META·LAB
  'canViewMetaLab', 'canEditMetaLab', 'canManageExtraction', 'canRunAnalysis', 'canExport', 'readOnlyMetaLab',
  // Global
  'canManageMembers', 'canManageSettings',
];

const ALL_FALSE = Object.fromEntries(PERMISSION_KEYS.map(k => [k, false]));
const fill = (overrides) => ({ ...ALL_FALSE, ...overrides });

// Full access — used for owner/leader display (enforcement treats them as full).
const FULL = Object.fromEntries(PERMISSION_KEYS.map(k => [k, k.startsWith('readOnly') ? false : true]));

/**
 * Permission presets. `label`/`description` drive the UI; `perms` are the flags.
 * `role` maps the preset to the member.role column (owner|leader|reviewer|viewer).
 */
export const PERMISSION_PRESETS = {
  owner: {
    label: 'Owner', role: 'owner', description: 'Full control of the workspace (cannot be changed by others).',
    perms: { ...FULL, canManageMembers: true, canManageSettings: true },
  },
  leader: {
    label: 'Leader', role: 'leader', description: 'Manage workflow, members (except owner), settings, and both modules.',
    perms: { ...FULL, canManageMembers: true, canManageSettings: true },
  },
  reviewer: {
    label: 'Reviewer', role: 'reviewer', description: 'Screen, second review, and chat. View META·LAB.',
    perms: fill({ canViewMetaSift: true, canScreen: true, canSecondReview: true, canResolveConflicts: false, canChat: true, canViewMetaLab: true }),
  },
  data_extractor: {
    label: 'Data Extractor', role: 'reviewer', description: 'View screening; edit META·LAB Data Extraction and run/export analysis.',
    perms: fill({ canViewMetaSift: true, canChat: true, canViewMetaLab: true, canEditMetaLab: true, canManageExtraction: true, canRunAnalysis: true, canExport: true }),
  },
  viewer: {
    label: 'Viewer (read-only both)', role: 'viewer', description: 'View both modules read-only. Can chat.',
    perms: fill({ canViewMetaSift: true, readOnlyMetaSift: true, canViewMetaLab: true, readOnlyMetaLab: true, canChat: true }),
  },
  readonly_metalab: {
    label: 'Read-only META·LAB', role: 'viewer', description: 'View META·LAB only, read-only.',
    perms: fill({ canViewMetaLab: true, readOnlyMetaLab: true }),
  },
  readonly_metasift: {
    label: 'Read-only META·SIFT', role: 'viewer', description: 'View META·SIFT only, read-only. Can chat.',
    perms: fill({ canViewMetaSift: true, readOnlyMetaSift: true, canChat: true }),
  },
  readonly_both: {
    label: 'Read-only (both)', role: 'viewer', description: 'View both modules, read-only.',
    perms: fill({ canViewMetaSift: true, readOnlyMetaSift: true, canViewMetaLab: true, readOnlyMetaLab: true }),
  },
};

// Presets a leader/owner can assign in the UI (owner is implicit, not assignable).
export const ASSIGNABLE_PRESETS = ['leader', 'reviewer', 'data_extractor', 'readonly_metasift', 'readonly_metalab', 'readonly_both', 'viewer'];

// Leader-level GLOBAL management flags. Granting these confers leader-equivalent
// authority, so they are OWNER-ONLY to grant/revoke (enforced in the member
// controller). Kept here so the controller and access resolver stay in sync.
export const GLOBAL_PERMISSION_KEYS = ['canManageMembers', 'canManageSettings'];

/** Resolve a preset name → { role, perms }. Falls back to reviewer. */
export function resolvePreset(name) {
  const p = PERMISSION_PRESETS[name] || PERMISSION_PRESETS.reviewer;
  return { role: p.role, perms: { ...p.perms } };
}

/** Full-access permission object for owner/leader (used by access.js). */
export function fullPermissions() {
  return { ...FULL, canManageMembers: true, canManageSettings: true };
}
