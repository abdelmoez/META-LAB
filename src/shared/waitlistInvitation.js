/**
 * waitlistInvitation.js — SINGLE source of truth for the waitlist → user-account
 * invitation domain (80.md). Dependency-free (no JSX, no Node/browser globals) so
 * BOTH the server (invitationService, admin + accept controllers) and the client
 * (Ops console, AcceptInvitationPage) import the same constants + pure logic —
 * mirroring the src/shared/betaWaitlist.js pattern.
 *
 * The server is always the AUTHORITATIVE actor: it owns the stored invitation
 * status, timestamps, token, and every state transition. The client mirrors the
 * derived display state + eligibility only for instant, non-authoritative UX.
 */

// ── Stored invitation status (WaitlistInvitation.status in the MAIN DB) ─────────
// EXPIRED is intentionally NOT a stored status — it is derived from expiresAt so
// security never depends on a cleanup job (80.md Phase 11). `superseded` is set
// when a newer invitation is issued for the same email (one live link at a time).
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'superseded'];

// ── Per-invitation email-delivery status (never conflated with the waitlist
// confirmation email). 'skipped' = SMTP not configured (honest: nothing sent). ──
export const INVITATION_EMAIL_STATUSES = ['pending', 'sent', 'failed', 'skipped'];

// ── Coarse, user-facing lifecycle state shown in the Ops console. This is the
// 80.md Phase-2 status model, DERIVED by joining the (waitlist-DB) applicant with
// its latest (main-DB) invitation. Kept separate from the applicant's own
// WAITLIST_STATUSES so we never have to widen that closed allow-list.
export const INVITE_STATES = ['waiting', 'invited', 'accepted', 'expired', 'revoked', 'failed'];

export const INVITE_STATE_LABELS = {
  waiting: 'Waiting',
  invited: 'Invited',
  accepted: 'Accepted',
  expired: 'Expired',
  revoked: 'Revoked',
  failed: 'Failed',
};

// Password policy for the acceptance page. Kept here so client + server agree.
// Matches the existing register()/resetPassword() floor (>= 8) — deliberately not
// stricter, to avoid frustration while still enforced on BOTH sides (80.md Phase 9).
export const INVITE_PASSWORD_MIN = 8;
export const INVITE_PASSWORD_MAX = 200; // guardrail against absurd inputs / DoS

/**
 * validateInvitePassword — authoritative password check (also used client-side).
 * @param {string} password
 * @param {string} [confirm] when provided, must match
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validateInvitePassword(password, confirm) {
  const p = typeof password === 'string' ? password : '';
  if (p.length < INVITE_PASSWORD_MIN) {
    return { ok: false, error: `Password must be at least ${INVITE_PASSWORD_MIN} characters.` };
  }
  if (p.length > INVITE_PASSWORD_MAX) {
    return { ok: false, error: `Password must be at most ${INVITE_PASSWORD_MAX} characters.` };
  }
  if (confirm !== undefined && p !== confirm) {
    return { ok: false, error: 'Passwords do not match.' };
  }
  return { ok: true };
}

/**
 * deriveInviteState — the ONE place that folds an applicant + its latest
 * invitation into a single coarse INVITE_STATES value. Pure + deterministic; the
 * caller passes `now` (ms) so it is testable and SSR/clock-injection safe.
 *
 * @param {{status?:string}|null} applicant   waitlist-DB applicant summary (may be null)
 * @param {{status?:string, expiresAt?:Date|string|number|null, emailStatus?:string}|null} invitation  latest main-DB invitation (may be null)
 * @param {number} [now=Date.now()]
 * @returns {'waiting'|'invited'|'accepted'|'expired'|'revoked'|'failed'}
 */
export function deriveInviteState(applicant, invitation, now = Date.now()) {
  // Accepted is terminal — true if EITHER side records it (defensive against a
  // cross-DB write that only half-completed).
  if (invitation && invitation.status === 'accepted') return 'accepted';
  if (applicant && applicant.status === 'ACCEPTED') return 'accepted';

  if (!invitation) return 'waiting';

  if (invitation.status === 'revoked') return 'revoked';
  // A superseded row should never be the "latest" one, but if it is (e.g. the
  // newer row was hard-deleted), treat the applicant as freshly invitable.
  if (invitation.status === 'superseded') return 'waiting';

  if (invitation.status === 'pending') {
    const exp = invitation.expiresAt ? new Date(invitation.expiresAt).getTime() : NaN;
    if (Number.isFinite(exp) && exp < now) return 'expired';
    if (invitation.emailStatus === 'failed') return 'failed';
    return 'invited';
  }

  return 'waiting';
}

/**
 * inviteEligibility — which actions are valid for a given derived state
 * (80.md Phase 5 "Eligibility rules"). Server RE-checks this authoritatively; the
 * client uses it only to enable/disable buttons.
 *
 *   waiting  → can invite
 *   expired  → can reinvite (fresh invite)
 *   failed   → can retry (fresh invite)
 *   revoked  → can reinvite ONLY through an intentional action (canInvite true,
 *              but the UI routes it through a confirm)
 *   invited  → can RESEND (not a fresh uncontrolled duplicate) + can revoke
 *   accepted → nothing (already a user)
 *
 * @param {string} state one of INVITE_STATES
 * @returns {{canInvite:boolean, canResend:boolean, canRevoke:boolean, reason:string}}
 */
export function inviteEligibility(state) {
  switch (state) {
    case 'waiting':
      return { canInvite: true, canResend: false, canRevoke: false, reason: '' };
    case 'expired':
    case 'failed':
      return { canInvite: true, canResend: false, canRevoke: false, reason: '' };
    case 'invited':
      return { canInvite: false, canResend: true, canRevoke: true, reason: 'already_invited' };
    case 'revoked':
      // Reinvite is allowed but is an intentional re-issue, not a passive invite.
      return { canInvite: true, canResend: false, canRevoke: false, reason: 'revoked' };
    case 'accepted':
      return { canInvite: false, canResend: false, canRevoke: false, reason: 'accepted' };
    default:
      return { canInvite: false, canResend: false, canRevoke: false, reason: 'unknown' };
  }
}

/** True when a derived state can receive a NEW invitation in a BULK operation. */
export function isBulkInvitable(state) {
  const e = inviteEligibility(state);
  return e.canInvite || e.canResend; // invited entries get a resend in bulk
}

/**
 * Mask an email for a public/landing surface: jane@example.com → j***@e***.com.
 * Identical shape to invitesController.maskEmail so the accept page and project
 * invite landing read consistently.
 */
export function maskInviteEmail(email) {
  const raw = String(email || '');
  const at = raw.indexOf('@');
  if (at <= 0) return '';
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const domName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const mask = (s) => (s ? `${s[0]}***` : '***');
  return `${mask(local)}@${mask(domName)}${tld}`;
}
