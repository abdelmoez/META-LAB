/**
 * userTimeline.js — 95.md Phase 5 — a concise per-user activity timeline for
 * the Ops detail view, merged from the sources that already exist (no new
 * event writes): column timestamps on User (so pre-event-era accounts still
 * show a history — the event tables only start 2026-06/07), AdminAuditLog
 * (per-target via the new [entityType, entityId] index), SecurityEvent,
 * LoginEvent (successful sign-ins, capped), UserTierAssignment and selected
 * UsageEvents. Deliberately EXCLUDES minor/high-volume events (autosaves,
 * APP_ACTIVE) per the spec.
 *
 * buildUserTimeline() is PURE (unit-testable with fixture rows); the fetch
 * wrapper batches one query per source.
 */
import { prisma } from '../db/client.js';

const MAX_EVENTS = 50;
const MAX_LOGINS = 10;

/** Map an AdminAuditLog action to a timeline kind + label. Unknown → admin_edit. */
function auditToEvent(row) {
  const details = safeParse(row.details);
  switch (row.action) {
    case 'ASSIGN_ROLE':
      return { kind: 'role_changed', label: `Role changed${details?.before ? ` (${details.before} → ${details.after})` : ''}` };
    case 'SUSPEND_USER':
      return details?.suspended === false
        ? { kind: 'restored', label: 'Account restored' }
        : { kind: 'suspended', label: 'Account suspended' };
    case 'UPDATE_USER_TIER':
      return { kind: 'tier_changed', label: `Tier changed${details?.to ? ` to ${details.to}` : ''}` };
    case 'SEND_PASSWORD_RESET':
    case 'RESET_PASSWORD':
      return { kind: 'password_reset_sent', label: 'Password-reset email sent by Ops' };
    case 'REVOKE_SESSIONS':
      return { kind: 'sessions_revoked', label: 'All sessions revoked by Ops' };
    case 'RESEND_VERIFICATION':
      return { kind: 'verification_resent', label: 'Verification email resent by Ops' };
    case 'USER_NOTE_CREATED':
      return { kind: 'note_added', label: 'Internal note added' };
    case 'USER_UPDATED_BY_ADMIN':
      return { kind: 'admin_edit', label: `Profile edited by Ops${details?.changed ? ` (${details.changed.join(', ')})` : ''}` };
    default:
      return { kind: 'admin_edit', label: row.action.replaceAll('_', ' ').toLowerCase() };
  }
}

function safeParse(json) {
  try { return json ? JSON.parse(json) : null; } catch { return null; }
}

/**
 * PURE merge. Every input optional. Returns newest-first, capped events:
 * [{ ts, kind, label, actor? }].
 */
export function buildUserTimeline({
  user,
  auditRows = [],
  securityEvents = [],
  loginEvents = [],
  tierAssignments = [],
  usageEvents = [],
  authAccounts = [],
  adminNames = new Map(),
} = {}) {
  const events = [];
  const push = (ts, kind, label, actor) => { if (ts) events.push({ ts: new Date(ts).toISOString(), kind, label, actor: actor || undefined }); };

  // Column-timestamp fallbacks — the only history pre-event-era users have.
  if (user) {
    const reg = user.registrationMethod === 'google' ? 'Registered with Google'
      : user.registrationMethod === 'email' ? 'Registered with email' : 'Registered';
    push(user.createdAt, 'registered', reg);
    push(user.emailVerifiedAt, 'email_verified', 'Email verified');
    if (user.suspended) push(user.suspendedAt, 'suspended', 'Account suspended');
    push(user.passwordChangedAt, 'password_changed', 'Password changed');
  }

  const seenSecurity = new Set();
  for (const e of securityEvents) {
    const map = {
      WAITLIST_INVITATION_ACCEPTED: ['invitation_accepted', 'Accepted invitation'],
      GOOGLE_REGISTER: null, // duplicate of 'registered' above
      GOOGLE_ACCOUNT_LINKED: ['google_linked', 'Connected Google'],
      GOOGLE_ACCOUNT_UNLINKED: ['google_unlinked', 'Disconnected Google'],
      PASSWORD_RESET_COMPLETED: ['password_changed', 'Password reset completed'],
      PASSWORD_RESET_REQUESTED: ['password_reset_sent', 'Password reset requested'],
    };
    if (!(e.type in map) || map[e.type] === null) continue;
    // One entry per type+minute — a resend burst is one line, not five.
    const key = `${e.type}:${new Date(e.createdAt).toISOString().slice(0, 16)}`;
    if (seenSecurity.has(key)) continue;
    seenSecurity.add(key);
    push(e.createdAt, map[e.type][0], map[e.type][1]);
  }

  for (const a of auditRows) {
    const { kind, label } = auditToEvent(a);
    push(a.createdAt, kind, label, adminNames.get(a.adminId) || 'Ops');
  }
  for (const t of tierAssignments) {
    // AdminAuditLog also carries admin tier changes — dedupe by minute+kind later;
    // assignment rows additionally cover system changes (beta_access at accept).
    push(t.createdAt, 'tier_changed', `Tier set to ${t.tierId}${t.changeType ? ` (${t.changeType})` : ''}`, t.assignedByName || undefined);
  }
  for (const l of loginEvents.slice(0, MAX_LOGINS)) push(l.createdAt, 'login', 'Signed in');
  for (const u of usageEvents) {
    if (u.type === 'PROJECT_CREATED') push(u.createdAt, 'project_created', 'Created a project');
  }
  for (const a of authAccounts) {
    // The link event may predate SecurityEvent coverage; the row itself is proof.
    push(a.createdAt, 'google_linked', 'Connected Google');
  }

  // Sort newest-first, then drop same-minute duplicates of the same kind
  // (e.g. tier_changed from both AdminAuditLog and UserTierAssignment).
  events.sort((x, y) => (x.ts < y.ts ? 1 : -1));
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = `${e.kind}:${e.ts.slice(0, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= MAX_EVENTS) break;
  }
  return out;
}

/** Fetch + merge for one user. One bounded query per source (all indexed). */
export async function getUserTimelineEvents(userId) {
  const [user, auditRows, securityEvents, loginEvents, tierAssignments, usageEvents, authAccounts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, emailVerifiedAt: true, suspended: true, suspendedAt: true, passwordChangedAt: true, registrationMethod: true },
    }),
    prisma.adminAuditLog.findMany({
      where: { entityType: 'User', entityId: userId },
      select: { action: true, details: true, createdAt: true, adminId: true },
      orderBy: { createdAt: 'desc' }, take: 50,
    }).catch(() => []),
    prisma.securityEvent.findMany({
      where: { userId },
      select: { type: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 100,
    }).catch(() => []),
    prisma.loginEvent.findMany({
      where: { userId, success: true },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' }, take: MAX_LOGINS,
    }).catch(() => []),
    prisma.userTierAssignment.findMany({
      where: { userId },
      select: { tierId: true, changeType: true, assignedByName: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 20,
    }).catch(() => []),
    prisma.usageEvent.findMany({
      where: { userId, type: 'PROJECT_CREATED' },
      select: { type: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 10,
    }).catch(() => []),
    prisma.authAccount.findMany({
      where: { userId },
      select: { createdAt: true },
    }).catch(() => []),
  ]);
  if (!user) return null;

  const adminIds = [...new Set(auditRows.map((a) => a.adminId))];
  const admins = adminIds.length
    ? await prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true, email: true } }).catch(() => [])
    : [];
  const adminNames = new Map(admins.map((a) => [a.id, a.name || a.email]));

  return buildUserTimeline({ user, auditRows, securityEvents, loginEvents, tierAssignments, usageEvents, authAccounts, adminNames });
}
