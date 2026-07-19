/**
 * src/shared/adminUsers.js — 95.md — PURE derivations for the Ops user
 * management area, shared by the admin API (server) and the Ops console
 * (client) so badges and filters can never drift (editableUserFields precedent).
 *
 * Two deliberately separate concepts (95.md Phase 10):
 *   - registrationMethod: how the account was ORIGINALLY created. Immutable,
 *     stored on User (written at creation; historical rows classified once by
 *     the conclusive backfill below). 'email' | 'google' | 'unknown'.
 *   - current login methods: what works TODAY. Always DERIVED live from
 *     password-presence + AuthAccount rows — never stored, never guessed from
 *     the email domain.
 * Invitation SOURCE is a third, orthogonal axis derived from
 * WaitlistInvitation.acceptedUserId (never duplicated onto User).
 */

// The Google provider shipped 2026-07-18 (94.md, v4.1.0, commit 07a716b): no
// account created before this instant can possibly be Google-registered.
export const GOOGLE_AUTH_EPOCH = '2026-07-18T00:00:00.000Z';

// AuthAccount rows created in the SAME transaction as the User row prove a
// Google registration. Same-tx rows land within milliseconds; anything under
// this window is registration, anything over is a later link. The gap between
// real registrations (~ms) and real link-later flows (minutes+) is enormous,
// so the exact value is not sensitive.
export const SAME_TX_WINDOW_MS = 120_000;

export const REGISTRATION_METHODS = ['email', 'google', 'unknown'];

/**
 * Conclusive historical classification (95.md Phase 10) — the backfill rule.
 * Returns 'email' | 'google' | 'unknown'. NEVER guesses from the email domain.
 * @param {{createdAt: Date|string, hasPassword: boolean, googleAccountCreatedAt?: Date|string|null}} u
 */
export function classifyRegistrationMethod(u) {
  const created = new Date(u.createdAt).getTime();
  const googleAt = u.googleAccountCreatedAt ? new Date(u.googleAccountCreatedAt).getTime() : null;

  // Rule A (conclusive): a Google AuthAccount born with the user row = Google
  // registration (both rows are written in one $transaction on every Google
  // registration path — direct and invitation-accept).
  if (googleAt != null && Math.abs(googleAt - created) <= SAME_TX_WINDOW_MS) return 'google';

  // Rule B (conclusive): a password with NO same-tx Google account = email
  // registration. Covers every pre-Google-epoch account (password was
  // non-nullable then) and every later email registration that linked Google
  // afterwards (their AuthAccount is minutes/days younger than the user row).
  if (u.hasPassword) return 'email';

  // Rule C: password-less with no same-tx Google account — practically
  // nonexistent (would require an unlink after losing the password); classified
  // honestly rather than guessed.
  return 'unknown';
}

/**
 * Current login methods, derived live (95.md Phase 10).
 * @param {{hasPassword: boolean, providers?: Array<{provider: string}>}} u
 * @returns {string[]} e.g. ['email','google'] — order stable: email first.
 */
export function deriveAuthMethods(u) {
  const methods = [];
  if (u.hasPassword) methods.push('email');
  for (const p of u.providers || []) if (!methods.includes(p.provider)) methods.push(p.provider);
  return methods;
}

/**
 * Human badge label for the Sign-in column. 95.md Phase 2 examples verbatim.
 * An account with NO usable method is an administrative warning state.
 */
export function authMethodLabel(methods) {
  const hasEmail = methods.includes('email');
  const hasGoogle = methods.includes('google');
  if (hasEmail && hasGoogle) return 'Google + Email';
  if (hasGoogle) return 'Google';
  if (hasEmail) return 'Email';
  return 'No login method';
}

/**
 * Derived account status for list/detail (95.md Phase 2). Suspension dominates;
 * 'pending_verification' = the mailbox was never proven (verification may be a
 * runtime toggle, but an unverified address is still worth surfacing to Ops).
 * 'Never logged in' is a parallel boolean, not a status (a user can be
 * suspended AND never-logged-in).
 * @param {{suspended?: boolean, emailVerifiedAt?: Date|string|null}} u
 */
export function deriveStatus(u) {
  if (u.suspended) return 'suspended';
  if (!u.emailVerifiedAt) return 'pending_verification';
  return 'active';
}

export const STATUS_LABELS = {
  active: 'Active',
  suspended: 'Suspended',
  pending_verification: 'Pending verification',
};

export const REGISTRATION_METHOD_LABELS = {
  email: 'Email',
  google: 'Google',
  unknown: 'Unknown',
};

// ── Filter vocabularies (single source of truth for zod schema + UI options) ──
export const USER_LIST_SORTS = ['created', 'lastActive', 'name', 'email', 'projects'];
export const USER_LIST_STATUS_FILTERS = ['active', 'suspended', 'pending_verification', 'never_logged_in'];
export const USER_LIST_AUTH_FILTERS = ['google_only', 'email_only', 'both', 'none'];
export const USER_LIST_REG_FILTERS = ['email', 'google', 'unknown', 'invited'];
export const USER_LIST_CREATED_WINDOWS = ['today', 'week', 'month', 'quarter', 'year'];
export const USER_LIST_ACTIVE_WINDOWS = ['day', 'week', 'month'];

/** Bulk actions (95.md Phase 7) + per-target skip codes the UI explains. */
export const BULK_USER_ACTIONS = ['assign_tier', 'suspend', 'restore', 'revoke_sessions', 'resend_verification'];
export const BULK_SKIP_CODES = {
  SKIP_ADMIN: 'Admins cannot be modified by bulk actions.',
  SKIP_SELF: 'You cannot apply this action to your own account.',
  SKIP_NOT_SUSPENDED: 'User is not suspended.',
  SKIP_ALREADY_SUSPENDED: 'User is already suspended.',
  ALREADY_VERIFIED: 'Email is already verified.',
  TIER_NOT_FOUND: 'The selected tier does not exist or is archived.',
  NOT_FOUND: 'User no longer exists.',
  FAILED: 'The action failed for this user.',
};
