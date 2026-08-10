/**
 * auditFormat.js — human-readable descriptions + consistent severity for admin
 * audit-log entries and security events (prompt49 item 10). Dependency-free and
 * pure, so it is imported by BOTH the Ops console UI (row rendering + filters)
 * and the server (severity → WHERE clause for server-side filtering), and is
 * fully unit-testable.
 *
 * Design: an admin reading the console must understand an event WITHOUT parsing
 * raw JSON. Each known action maps to a stable severity, a category, and a
 * describe() that produces a one-line sentence from the actor + target + a few
 * safe detail fields. Severity is STATIC per action (so the severity filter and
 * the displayed badge always agree). Unknown actions fall back to a humanised
 * label at INFO severity. Secrets are never in audit details (enforced
 * elsewhere), so nothing here can leak one.
 */

export const SEVERITY = { INFO: 'info', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' };
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

/** Parse a details value that may be a JSON string or already an object. */
export function parseDetails(details) {
  if (details == null) return {};
  if (typeof details === 'object') return details;
  try { return JSON.parse(details); } catch { return { _raw: String(details) }; }
}

function actorName(log) {
  return log?.admin?.name || log?.admin?.email || log?.actorName || 'An administrator';
}
function targetLabel(d, log) {
  return d.email || d.name || d.title || log?.entityId || (log?.entityType ? `${log.entityType}` : 'the record');
}
function fieldList(d) {
  const f = d.changed || d.updatedKeys || d.fields;
  if (Array.isArray(f) && f.length) return f.join(', ');
  return '';
}

// ── 109.md §42 helpers — the Ops settings writers log a `changes` array of
// {key, label, scope, from, to}. These render it without assuming it is present,
// so an older row (key names only) still produces a sensible sentence.
function changeRows(d) {
  return Array.isArray(d?.changes) ? d.changes : [];
}
function countChanges(d) {
  const rows = changeRows(d);
  if (rows.length) return rows.length;
  const f = d?.updatedKeys;
  return Array.isArray(f) ? f.length : 0;
}
function flagLabel(d, log) {
  const row = changeRows(d)[0];
  return row?.label || log?.entityId || 'a';
}
function onOffPhrase(d) {
  const row = changeRows(d)[0];
  if (!row || typeof row.to !== 'boolean') return 'changed';
  return row.to ? 'enabled' : 'DISABLED';
}

/**
 * Catalogue of known admin audit actions. severity is static; describe(d, log)
 * returns a sentence (without the actor prefix, which the caller may add).
 */
export const AUDIT_ACTIONS = {
  USER_UPDATED_BY_ADMIN: { severity: 'medium', category: 'user', label: 'Updated user',
    describe: (d, log) => `updated ${targetLabel(d, log)}${fieldList(d) ? ` (${fieldList(d)})` : ''}` },
  EDIT_USER: { severity: 'medium', category: 'user', label: 'Edited user',
    describe: (d, log) => `edited ${targetLabel(d, log)}${fieldList(d) ? ` (${fieldList(d)})` : ''}` },
  SUSPEND_USER:   { severity: 'high', category: 'account', label: 'Suspended user',
    describe: (d, log) => `suspended ${targetLabel(d, log)}` },
  UNSUSPEND_USER: { severity: 'medium', category: 'account', label: 'Reactivated user',
    describe: (d, log) => `reactivated ${targetLabel(d, log)}` },
  ASSIGN_ROLE: { severity: 'high', category: 'permission', label: 'Changed role',
    describe: (d, log) => `changed ${targetLabel(d, log)}'s role${d.before || d.after ? `: ${d.before || '?'} → ${d.after || '?'}` : ''}` },
  SEND_PASSWORD_RESET: { severity: 'medium', category: 'account', label: 'Sent password reset',
    describe: (d, log) => `sent a password-reset link to ${targetLabel(d, log)}` },
  RESET_PASSWORD: { severity: 'medium', category: 'account', label: 'Reset password',
    describe: (d, log) => `initiated a password reset for ${targetLabel(d, log)}` },
  DELETE_USER: { severity: 'critical', category: 'account', label: 'Deleted user',
    describe: (d, log) => `deleted user ${targetLabel(d, log)}` },
  UPDATE_SETTING: { severity: 'low', category: 'settings', label: 'Updated settings',
    describe: (d) => `updated settings${fieldList(d) ? ` (${fieldList(d)})` : ''}` },
  APP_THEME_UPDATED: { severity: 'low', category: 'settings', label: 'Changed appearance',
    describe: (d) => `changed the app theme${d.newPreset ? ` to "${d.newPreset}"` : ''}` },
  DESIGN_SETTINGS_UPDATED: { severity: 'medium', category: 'settings', label: 'Changed UI design rollout',
    describe: (d) => `changed the Ops-governed UI design${d.defaultMode ? ` (default: ${d.defaultMode})` : ''}` },
  // ── 109.md §§42, 23 — Ops control-plane actions ────────────────────────────
  // Registering them here is what gives them a stable severity + a real sentence
  // in the Ops Security table; an unregistered action degrades to a humanised
  // INFO label and is unreachable from the severity filter.
  UPDATE_FEATURE_FLAG: { severity: 'high', category: 'settings', label: 'Changed a feature flag',
    describe: (d, log) => `${onOffPhrase(d)} the ${flagLabel(d, log)} feature flag` },
  UPDATE_FEATURE_FLAGS: { severity: 'high', category: 'settings', label: 'Changed feature flags',
    describe: (d) => `changed ${countChanges(d)} feature flag${countChanges(d) === 1 ? '' : 's'}${fieldList(d) ? ` (${fieldList(d)})` : ''}` },
  UPDATE_RESEARCH_GOVERNANCE: { severity: 'medium', category: 'settings', label: 'Updated research governance settings',
    describe: (d) => `updated the research governance settings${fieldList(d) ? ` (${fieldList(d)})` : ''}` },
  RESET_SETTINGS_GROUP: { severity: 'high', category: 'settings', label: 'Reset settings to defaults',
    describe: (d, log) => `reset ${d.domain || log?.entityId || 'a settings group'} to system defaults${fieldList(d) ? ` (${fieldList(d)})` : ''}` },
  // W1-B note: this is the action string the Research Governance requeue endpoint
  // writes (server/controllers/researchOpsJobsController.js). `previousStatus` is
  // rendered when present so an admin can tell a stuck-job recovery from a
  // failed-job retry without opening the details JSON.
  DUPLICATE_JOB_REQUEUE: { severity: 'medium', category: 'jobs', label: 'Requeued duplicate-detection job',
    describe: (d, log) => `requeued duplicate-detection job ${log?.entityId || d.jobId || ''}`.trim()
      + (d.previousStatus ? ` (was ${d.previousStatus})` : '') },
  DUPLICATE_JOB_RERUN: { severity: 'high', category: 'jobs', label: 'Force-reran duplicate detection',
    describe: (d, log) => `force-reran duplicate detection for project ${d.projectId || log?.entityId || ''}`.trim() },
  DUPLICATE_JOB_CANCEL: { severity: 'medium', category: 'jobs', label: 'Cancelled duplicate-detection job',
    describe: (d, log) => `cancelled duplicate-detection job ${log?.entityId || d.jobId || ''}`.trim() },
  UPDATE_AI_SCREENING: { severity: 'low', category: 'settings', label: 'Updated screening engine policy',
    describe: () => 'updated the screening engine policy' },
  UPDATE_SIFT_SETTINGS: { severity: 'low', category: 'settings', label: 'Updated screening settings',
    describe: () => 'updated a screening project\'s settings' },
  SIFT_PROJECT_STATUS: { severity: 'low', category: 'project', label: 'Changed screening status',
    describe: (d) => `changed a screening project's status${d.toStatus ? ` to ${d.toStatus}` : ''}` },
  DELETE_MESSAGE: { severity: 'medium', category: 'content', label: 'Deleted message',
    describe: (d, log) => `deleted a contact message${d.email ? ` from ${d.email}` : ''}` },
  ARCHIVE_PROJECT: { severity: 'medium', category: 'project', label: 'Archived project',
    describe: (d, log) => `archived project ${targetLabel(d, log)}` },
  RESTORE_PROJECT: { severity: 'low', category: 'project', label: 'Restored project',
    describe: (d, log) => `restored project ${targetLabel(d, log)}` },
  RESTORE_SIFT_PROJECT: { severity: 'low', category: 'project', label: 'Restored screening project',
    describe: (d, log) => `restored a screening project` },
  COMPOSE_EMAIL: { severity: 'low', category: 'content', label: 'Sent email',
    describe: (d) => `composed an email${d.to ? ` to ${d.to}` : ''}` },
  REPLY_MESSAGE: { severity: 'info', category: 'content', label: 'Replied to message',
    describe: (d) => `replied to a contact message${d.to ? ` (${d.to})` : ''}` },
  MERGE_INSTITUTION: { severity: 'low', category: 'content', label: 'Merged institution',
    describe: () => 'merged an institution record' },
  WAITLIST_STATUS_CHANGE: { severity: 'low', category: 'content', label: 'Changed waitlist status',
    describe: (d) => `changed a waitlist applicant's status${d.toStatus ? ` to ${d.toStatus}` : ''}` },
  WAITLIST_REMOVE: { severity: 'medium', category: 'content', label: 'Removed waitlist applicant',
    describe: () => 'removed a waitlist applicant' },
  WAITLIST_EXPORT: { severity: 'medium', category: 'content', label: 'Exported waitlist',
    describe: () => 'exported the beta waitlist' },
};

/** Catalogue of known security-event types. */
export const SECURITY_TYPES = {
  FAILED_LOGIN: { severity: 'medium', category: 'auth', label: 'Failed login',
    describe: (d, ev) => `failed login for ${ev.email || 'an account'}${ev.ip ? ` from ${ev.ip}` : ''}` },
  ADMIN_ACCESS_DENIED: { severity: 'high', category: 'authz', label: 'Admin access denied',
    describe: (d, ev) => `denied admin access${ev.email ? ` for ${ev.email}` : ''}${ev.ip ? ` from ${ev.ip}` : ''}` },
  MOD_TARGET_DENIED: { severity: 'high', category: 'authz', label: 'Moderator action denied',
    describe: (d, ev) => `blocked a moderator from acting on a protected account${ev.ip ? ` from ${ev.ip}` : ''}` },
  RATE_LIMITED: { severity: 'low', category: 'abuse', label: 'Rate limited',
    describe: (d, ev) => `rate-limited${ev.ip ? ` ${ev.ip}` : ''}` },
  PASSWORD_RESET_REQUESTED: { severity: 'info', category: 'account', label: 'Password reset requested',
    describe: (d, ev) => `password reset requested${ev.email ? ` for ${ev.email}` : ''}` },
  PASSWORD_RESET_COMPLETED: { severity: 'info', category: 'account', label: 'Password reset completed',
    describe: (d, ev) => `password reset completed${ev.email ? ` for ${ev.email}` : ''}` },
};

/** Humanise an unknown SNAKE_CASE action into Title Case. */
export function humanizeAction(action) {
  return String(action || '')
    .toLowerCase().replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Structured before/after changes from a details object, when present. */
export function extractChanges(details) {
  const d = parseDetails(details);
  const before = d.before && typeof d.before === 'object' ? d.before : null;
  const after = d.after && typeof d.after === 'object' ? d.after : null;
  if (!before && !after) return [];
  const keys = new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]);
  return [...keys].map((k) => ({ field: k, before: before ? before[k] : undefined, after: after ? after[k] : undefined }));
}

/** Describe an AdminAuditLog row → { description, severity, category, label, changes }. */
export function describeAuditEvent(log) {
  const d = parseDetails(log?.details);
  const meta = AUDIT_ACTIONS[log?.action];
  const verb = meta ? meta.describe(d, log) : `performed ${humanizeAction(log?.action)}`;
  return {
    description: `${actorName(log)} ${verb}`,
    severity: meta ? meta.severity : SEVERITY.INFO,
    category: meta ? meta.category : 'other',
    label: meta ? meta.label : humanizeAction(log?.action),
    changes: extractChanges(log?.details),
  };
}

/** Describe a SecurityEvent row → { description, severity, category, label }. */
export function describeSecurityEvent(ev) {
  const d = parseDetails(ev?.details);
  const meta = SECURITY_TYPES[ev?.type];
  return {
    description: meta ? meta.describe(d, ev) : humanizeAction(ev?.type),
    severity: meta ? meta.severity : SEVERITY.INFO,
    category: meta ? meta.category : 'other',
    label: meta ? meta.label : humanizeAction(ev?.type),
  };
}

/**
 * Translate a severity filter into a Prisma WHERE fragment over `action`
 * (audit) — `{ in:[...] }` for a specific level, or `{ notIn:[...] }` for INFO
 * (so unknown/uncatalogued actions fall into the INFO bucket). Returns null for
 * an unknown severity (→ no filter).
 */
export function auditActionWhereForSeverity(severity) {
  if (!severity || !SEVERITY_ORDER.includes(severity)) return null;
  const entries = Object.entries(AUDIT_ACTIONS);
  if (severity === SEVERITY.INFO) {
    const nonInfo = entries.filter(([, m]) => m.severity !== SEVERITY.INFO).map(([k]) => k);
    return { notIn: nonInfo };
  }
  return { in: entries.filter(([, m]) => m.severity === severity).map(([k]) => k) };
}

/** Same translation for SecurityEvent `type`. */
export function securityTypeWhereForSeverity(severity) {
  if (!severity || !SEVERITY_ORDER.includes(severity)) return null;
  const entries = Object.entries(SECURITY_TYPES);
  if (severity === SEVERITY.INFO) {
    const nonInfo = entries.filter(([, m]) => m.severity !== SEVERITY.INFO).map(([k]) => k);
    return { notIn: nonInfo };
  }
  return { in: entries.filter(([, m]) => m.severity === severity).map(([k]) => k) };
}
