/**
 * shared/access/restrictionTypes.js — 91.md "Distinguish Permission Problems From
 * Other Unavailable States". The controlled vocabulary of WHY something is
 * unavailable, so the UI can show a DIFFERENT message + action per condition
 * instead of one generic "Access denied". Each type carries display defaults
 * (title, tone, icon, badge) the reusable access components read.
 *
 * Pure data — no DOM/React/network. Client + server + test safe.
 */

/**
 * RESTRICTION_TYPES — id → { title, tone, icon, badge, category }.
 *   tone   maps to StitchBadge tones (danger|warn|info|brand|neutral).
 *   icon   a lucide/Stitch icon name the access components render.
 *   category: 'permission' | 'plan' | 'state' | 'system' — groups for analytics/messages.
 */
export const RESTRICTION_TYPES = Object.freeze({
  // ── Permission (role / membership) ──────────────────────────────────────
  permission: { title: 'You do not have permission', tone: 'warn', icon: 'lock', badge: 'Restricted', category: 'permission' },
  admin_only: { title: 'Admin access required', tone: 'warn', icon: 'shield', badge: 'Admins only', category: 'permission' },
  owner_only: { title: 'Available to the project owner', tone: 'warn', icon: 'lock', badge: 'Owner only', category: 'permission' },
  leader_only: { title: 'Available to project leaders', tone: 'warn', icon: 'lock', badge: 'Leaders only', category: 'permission' },
  membership: { title: 'You are not a member of this project', tone: 'warn', icon: 'userX', badge: 'No access', category: 'permission' },
  read_only: { title: 'You have view-only access', tone: 'info', icon: 'eye', badge: 'View only', category: 'permission' },

  // ── Plan / tier ─────────────────────────────────────────────────────────
  tier: { title: 'Not included in your current plan', tone: 'brand', icon: 'sparkles', badge: 'Upgrade', category: 'plan' },

  // ── Project state / data / processing ───────────────────────────────────
  project_state: { title: 'A previous step is required', tone: 'info', icon: 'listChecks', badge: 'Setup needed', category: 'state' },
  insufficient_data: { title: 'Not enough data yet', tone: 'info', icon: 'database', badge: 'Needs data', category: 'state' },
  processing: { title: 'This is being prepared', tone: 'info', icon: 'loader', badge: 'Processing', category: 'state' },
  archived: { title: 'This project is archived', tone: 'neutral', icon: 'archive', badge: 'Archived', category: 'state' },
  feature_disabled: { title: 'Turned off for this project', tone: 'neutral', icon: 'slash', badge: 'Disabled', category: 'state' },

  // ── System / flag ───────────────────────────────────────────────────────
  temporarily_unavailable: { title: 'Temporarily unavailable', tone: 'neutral', icon: 'cloudOff', badge: 'Unavailable', category: 'system' },
  maintenance: { title: 'Down for maintenance', tone: 'neutral', icon: 'wrench', badge: 'Maintenance', category: 'system' },
  flag_off: { title: 'This feature is not available', tone: 'neutral', icon: 'eyeOff', badge: 'Unavailable', category: 'system' },
});

export const RESTRICTION_TYPE_IDS = Object.keys(RESTRICTION_TYPES);

/** Default "what can I do next" action per restriction type. UI only renders REAL actions. */
export const DEFAULT_NEXT_ACTION = Object.freeze({
  permission: { type: 'contact_owner', label: 'Contact the project owner' },
  owner_only: { type: 'contact_owner', label: 'Contact the project owner' },
  leader_only: { type: 'contact_owner', label: 'Contact a project leader' },
  admin_only: { type: 'contact_admin', label: 'Contact an administrator' },
  membership: { type: 'none', label: null },
  read_only: { type: 'contact_owner', label: 'Ask for edit access' },
  tier: { type: 'upgrade', label: 'View plans' },
  project_state: { type: 'go_to_step', label: 'Go to the required step' },
  insufficient_data: { type: 'go_to_step', label: 'Add more data' },
  processing: { type: 'retry', label: 'Check again' },
  archived: { type: 'unarchive', label: 'Unarchive project' },
  feature_disabled: { type: 'contact_owner', label: 'Ask the project owner to enable it' },
  temporarily_unavailable: { type: 'retry', label: 'Try again' },
  maintenance: { type: 'none', label: null },
  flag_off: { type: 'none', label: null },
});

export function restrictionMeta(type) {
  return RESTRICTION_TYPES[type] || RESTRICTION_TYPES.permission;
}

export function isValidRestriction(type) {
  return Object.prototype.hasOwnProperty.call(RESTRICTION_TYPES, type);
}

export default { RESTRICTION_TYPES, RESTRICTION_TYPE_IDS, DEFAULT_NEXT_ACTION, restrictionMeta, isValidRestriction };
