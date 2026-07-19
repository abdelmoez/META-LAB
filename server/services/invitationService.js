/**
 * invitationService.js — waitlist → user-account invitation lifecycle (80.md).
 *
 * SCOPE: this service touches ONLY the MAIN application database (the
 * WaitlistInvitation table + User + tier assignment). It NEVER imports the
 * strictly-separate Beta Waitlist data layer — the controllers coordinate the two
 * databases (read the applicant from waitlistService, mint/accept the invitation
 * here, then update the applicant's waitlist status through waitlistService). This
 * preserves the prompt48 isolation boundary: no waitlist query lives outside
 * server/waitlist/*, and no cross-database Prisma relation exists.
 *
 * Security model (mirrors passwordResetService.js + invitesController.js):
 *   - Tokens are 32-byte CSPRNG hex; ONLY the SHA-256 hash is stored. The raw
 *     token appears only in the emailed link and is NEVER logged or returned to a
 *     read endpoint. toInvitationView() never exposes tokenHash.
 *   - Single-use: acceptance flips status pending→accepted behind a race-safe
 *     `updateMany where status:'pending'` guard, inside the same transaction that
 *     creates the User. A concurrent double-accept resolves to count 0 and aborts.
 *   - Time-limited: expiresAt = now + WAITLIST_INVITE_TTL_MINUTES. EXPIRY IS
 *     DERIVED from expiresAt at validation time, never trusted from a stored flag,
 *     so security does not depend on any cleanup job (80.md Phase 11).
 *   - Token rotation: issuing a new invitation marks the email's prior `pending`
 *     rows `superseded` — only the newest link works.
 */

import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { hashPassword } from '../auth/password.js';
import { allocateUserNumber } from './userNumber.js';
import { getDefaultTierId, recordTierAssignment } from './entitlementService.js';
import {
  sendEmail,
  isEmailConfigured,
  renderWaitlistInvitationEmail,
  renderWelcomeEmail,
  configuredSupportEmail,
} from './emailService.js';
import { normalizeEmail } from '../../src/shared/betaWaitlist.js';
import {
  validateInvitePassword,
  deriveInviteState,
  inviteEligibility,
} from '../../src/shared/waitlistInvitation.js';

const DEFAULT_TTL_MINUTES = 7 * 24 * 60; // 7 days
const DEFAULT_RESEND_COOLDOWN_MS = 60_000; // 60s between resends for one applicant
const DEFAULT_MAX_BULK = 200;

/** Configured invitation lifetime in minutes (env override, secure default). */
export function inviteTtlMinutes() {
  const n = parseInt(process.env.WAITLIST_INVITE_TTL_MINUTES, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MINUTES;
}

/** Minimum interval between resends for a single applicant (abuse guard). */
export function resendCooldownMs() {
  const n = parseInt(process.env.WAITLIST_INVITE_RESEND_COOLDOWN_MS, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RESEND_COOLDOWN_MS;
}

/** Maximum applicants a single bulk-invite request may target. */
export function maxBulkInvite() {
  const n = parseInt(process.env.WAITLIST_MAX_BULK_INVITE, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : DEFAULT_MAX_BULK;
}

/** SHA-256 hex of a raw token — the only form ever stored or compared. */
export function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function supportEmail() {
  const v = process.env.WAITLIST_SUPPORT_EMAIL;
  return v && String(v).trim() ? String(v).trim() : '';
}

/** The relative accept path (single source of truth for client + email links). */
export function inviteAcceptPath(token) {
  return `/accept-invitation?token=${encodeURIComponent(token)}`;
}

/** Sentinel thrown to abort the accept transaction when the token was already burned. */
class ConsumedError extends Error {}

/**
 * SAFE projection of an invitation row for any read endpoint. NEVER includes
 * tokenHash. `effectiveStatus` folds in derived expiry so the UI never has to
 * recompute it. `now` is injectable for tests.
 */
export function toInvitationView(row, now = Date.now()) {
  if (!row) return null;
  const expMs = row.expiresAt ? new Date(row.expiresAt).getTime() : NaN;
  const expired = row.status === 'pending' && Number.isFinite(expMs) && expMs < now;
  return {
    id: row.id,
    status: row.status,
    effectiveStatus: expired ? 'expired' : row.status,
    expired,
    expiresAt: row.expiresAt,
    attempt: row.attempt,
    acceptedAt: row.acceptedAt,
    acceptedUserId: row.acceptedUserId,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
    tierId: row.tierId,
    emailStatus: row.emailStatus,
    emailSentAt: row.emailSentAt,
    lastEmailError: row.lastEmailError,
    invitedByUserId: row.invitedByUserId,
    batchId: row.batchId,
    cohort: row.cohort ?? null, // 93.md §9.1 — beta-wave label, surfaced everywhere
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── 93.md §9.1 — cohort label + invitation controls ─────────────────────────────
/**
 * Normalize an admin-supplied cohort label: trimmed string ≤64 chars, or null.
 * Returns `{ ok:false }` for a non-empty value that is not usable (wrong type /
 * too long) so controllers can 400 instead of silently truncating.
 */
export function cleanCohortLabel(v) {
  if (v == null || v === '') return { ok: true, cohort: null };
  if (typeof v !== 'string') return { ok: false, error: 'cohort must be a string' };
  const s = v.trim();
  if (!s) return { ok: true, cohort: null };
  if (s.length > 64) return { ok: false, error: 'cohort must be at most 64 characters' };
  return { ok: true, cohort: s };
}

/**
 * Read the invitation admin controls from the appSettings SiteSetting (93.md
 * §9.1): `invitationsPaused` (default false) and `maxActiveInvitations`
 * (null = unlimited). Fail-open to the defaults — a settings-read hiccup must
 * never brick the invite pipeline harder than "not paused, no cap".
 * @returns {Promise<{paused:boolean, maxActive:number|null}>}
 */
export async function getInvitationControls() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'appSettings' } });
    const s = row ? JSON.parse(row.value || '{}') : {};
    const rawMax = s.maxActiveInvitations;
    const maxActive = Number.isFinite(Number(rawMax)) && rawMax !== null && rawMax !== '' && Number(rawMax) > 0
      ? Math.floor(Number(rawMax))
      : null;
    return { paused: s.invitationsPaused === true, maxActive };
  } catch {
    return { paused: false, maxActive: null };
  }
}

/** Count currently-ACTIVE (pending, unexpired) invitations — the cap's basis. */
export async function countActivePendingInvitations() {
  return prisma.waitlistInvitation.count({ where: { status: 'pending', expiresAt: { gt: new Date() } } });
}

/**
 * Distinct normalized emails carrying a given cohort label (any status). Used to
 * filter the waitlist applicants list by cohort (read-only cross-DB join key).
 * Capped so a pathological cohort can never materialize an unbounded IN list.
 */
export async function normalizedEmailsForCohort(cohort, cap = 2000) {
  const c = String(cohort || '').trim();
  if (!c) return [];
  const rows = await prisma.waitlistInvitation.findMany({
    where: { cohort: c },
    select: { normalizedEmail: true },
    distinct: ['normalizedEmail'],
    take: Math.min(Math.max(1, cap | 0), 5000),
  });
  return rows.map((r) => r.normalizedEmail);
}

/**
 * Paginated main-DB invitations list for Ops (93.md §9.1) — filterable by
 * cohort and status, newest first. Returns SAFE views (never tokenHash) plus the
 * display email (admin-only endpoint; email already lives in this table).
 */
export async function listInvitations({ cohort = '', status = '', page = 1, limit = 25 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const where = {};
  const c = String(cohort || '').trim();
  if (c) where.cohort = c;
  const st = String(status || '').trim();
  if (st) where.status = st;
  const [total, rows] = await Promise.all([
    prisma.waitlistInvitation.count({ where }),
    prisma.waitlistInvitation.findMany({
      where,
      select: { ...INVITATION_VIEW_SELECT, email: true },
      orderBy: { createdAt: 'desc' },
      skip: (p - 1) * l,
      take: l,
    }),
  ]);
  const now = Date.now();
  return {
    invitations: rows.map((r) => ({ ...toInvitationView(r, now), email: r.email })),
    total,
    page: p,
    limit: l,
    pages: Math.max(1, Math.ceil(total / l)),
  };
}

// ── Token creation + rotation ──────────────────────────────────────────────────
/**
 * Mint a single-use invitation for a waitlist applicant. Supersedes any prior live
 * (pending) invitation for the same normalized email (one live link at a time).
 * Returns the RAW token (to email) + the created row. Does NOT send email or touch
 * the waitlist DB — the caller orchestrates those.
 *
 * @param {{applicantId:string, email:string, name?:string, invitedByUserId:string,
 *          tierId?:string|null, batchId?:string|null, cohort?:string|null, ip?:string}} o
 * @returns {Promise<{token:string, invitation:object, expiresAt:Date}>}
 */
export async function createInvitation({ applicantId, email, name = '', invitedByUserId, tierId = null, batchId = null, cohort = null, ip = '' }) {
  const normalized = normalizeEmail(email);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + inviteTtlMinutes() * 60 * 1000);

  const prior = await prisma.waitlistInvitation.count({ where: { normalizedEmail: normalized } });

  // Rotate + create ATOMICALLY (one live link at a time). Wrapping the supersede
  // and the create in one transaction means a single issue can never leave two
  // live rows for this email (the read-only `prior` count stays outside — an
  // off-by-one in the attempt number under concurrency is cosmetic).
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.waitlistInvitation.updateMany({
      where: { normalizedEmail: normalized, status: 'pending' },
      data: { status: 'superseded' },
    });
    return tx.waitlistInvitation.create({
      data: {
        waitlistApplicantId: applicantId,
        email: String(email || ''),
        normalizedEmail: normalized,
        name: name || null,
        tokenHash,
        status: 'pending',
        expiresAt,
        attempt: prior + 1,
        tierId: tierId || null,
        invitedByUserId,
        batchId: batchId || null,
        // 93.md §9.1 — optional beta-wave label (validated/trimmed by the caller).
        cohort: (cohort && String(cohort).trim().slice(0, 64)) || null,
        ip: ip || '',
      },
    });
  });
  return { token, invitation, expiresAt };
}

/** Persist an email-delivery result for an invitation (SAFE short error only). */
export async function recordInvitationEmailResult(invitationId, result) {
  const data = { emailStatus: result.status };
  if (result.status === 'sent') {
    data.emailSentAt = new Date();
    data.lastEmailError = null;
  } else if (result.status === 'failed') {
    data.lastEmailError = (result.error || 'send failed').slice(0, 300);
  }
  return prisma.waitlistInvitation.update({ where: { id: invitationId }, data }).catch(() => null);
}

/**
 * Render + send the invitation email and persist the delivery result. Never
 * throws. `baseUrl` should be the proxy-safe public origin derived by the caller
 * (falls back to APP_BASE_URL). status mapping mirrors the waitlist confirmation:
 * sent → 'sent'; provider error → 'failed'; SMTP unconfigured → 'skipped'.
 *
 * @returns {Promise<{sent:boolean, emailStatus:string, emailConfigured:boolean}>}
 */
export async function sendInvitationEmail({ invitation, token, baseUrl = '', toName = '' }) {
  if (!isEmailConfigured()) {
    await recordInvitationEmailResult(invitation.id, { status: 'skipped' });
    return { sent: false, emailStatus: 'skipped', emailConfigured: false };
  }
  const base = String(baseUrl || process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  const link = `${base}${inviteAcceptPath(token)}`;
  const { html, text } = renderWaitlistInvitationEmail({
    appName: 'PecanRev',
    toName: toName || invitation.name || '',
    link,
    expiresAt: invitation.expiresAt,
    supportEmail: supportEmail(),
  });
  let result;
  try {
    result = await sendEmail({
      to: invitation.email,
      subject: "You're invited to PecanRev — create your account",
      html,
      text,
      context: 'waitlist_invitation',
    });
  } catch (e) {
    result = { sent: false, reason: 'send_failed', error: e?.message };
  }
  if (result.sent === true) {
    await recordInvitationEmailResult(invitation.id, { status: 'sent' });
    return { sent: true, emailStatus: 'sent', emailConfigured: true };
  }
  const safeReason = result.reason === 'send_failed' ? 'Provider temporarily unavailable' : (result.reason || 'unknown');
  // 93.md §6.1 — 'recipients_skipped' means the staging allowlist dropped every
  // recipient: nothing was attempted, so it records as 'skipped', not 'failed'.
  const status = (result.reason === 'not_configured' || result.reason === 'recipients_skipped') ? 'skipped' : 'failed';
  await recordInvitationEmailResult(invitation.id, { status, error: safeReason });
  return { sent: false, emailStatus: status, emailConfigured: isEmailConfigured() };
}

// ── High-level invite orchestration (MAIN-DB side only) ─────────────────────────
/**
 * Invite one applicant: guards against an existing account, mints the token, sends
 * the email. Returns a per-entry RESULT the controller maps into the bulk/single
 * response. The caller is responsible for updating the waitlist applicant status
 * (INVITED) through waitlistService afterwards.
 *
 * result.code ∈ 'invited' | 'invited_no_email' | 'email_failed' | 'already_registered'
 *
 * @param {{applicant:{id:string,email:string,firstName?:string,lastName?:string},
 *          invitedByUserId:string, tierId?:string|null, batchId?:string|null,
 *          cohort?:string|null, ip?:string, baseUrl?:string, resend?:boolean}} o
 */
export async function inviteApplicant({ applicant, invitedByUserId, tierId = null, batchId = null, cohort = null, ip = '', baseUrl = '', resend = false }) {
  const normalized = normalizeEmail(applicant.email);

  // Phase 10 — an existing real user must never get a second account. Report it;
  // do not mint a password-creation link for someone who already has a password.
  const existing = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true, userNumber: true } });
  if (existing) {
    return { code: 'already_registered', userId: existing.id, userNumber: existing.userNumber };
  }

  // Resend cooldown — protects against accidental/abusive rapid re-sends.
  if (resend) {
    const last = await prisma.waitlistInvitation.findFirst({
      where: { waitlistApplicantId: applicant.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last) {
      const elapsed = Date.now() - new Date(last.createdAt).getTime();
      const cd = resendCooldownMs();
      if (elapsed < cd) {
        return { code: 'cooldown', cooldownMs: cd - elapsed };
      }
    }
  }

  const toName = [applicant.firstName, applicant.lastName].filter(Boolean).join(' ').trim();
  const { token, invitation } = await createInvitation({
    applicantId: applicant.id,
    email: applicant.email,
    name: toName,
    invitedByUserId,
    tierId,
    batchId,
    cohort,
    ip,
  });

  const email = await sendInvitationEmail({ invitation, token, baseUrl, toName });

  let code = 'invited';
  if (email.emailStatus === 'failed') code = 'email_failed';
  else if (email.emailStatus === 'skipped') code = 'invited_no_email';

  return {
    code,
    invitationId: invitation.id,
    emailStatus: email.emailStatus,
    emailConfigured: email.emailConfigured,
    expiresAt: invitation.expiresAt,
    attempt: invitation.attempt,
  };
}

// ── Revoke ───────────────────────────────────────────────────────────────────
/**
 * Revoke the applicant's currently-live invitation (Phase 11). Race-safe. Leaves
 * the waitlist record intact. Records who + when.
 * @returns {Promise<{ok:true, invitationId:string} | {ok:false, code:'no_active_invitation'}>}
 */
export async function revokeInvitationForApplicant(applicantId, { revokedByUserId = null } = {}) {
  // Revoke EVERY live (pending) invitation for the applicant — not just the newest.
  // Even though issuing rotates prior links to `superseded`, a concurrent double-issue
  // could leave more than one `pending` row; revoking all of them guarantees no live
  // link survives a revoke (the invariant the admin expects).
  const upd = await prisma.waitlistInvitation.updateMany({
    where: { waitlistApplicantId: applicantId, status: 'pending' },
    data: { status: 'revoked', revokedAt: new Date(), revokedByUserId: revokedByUserId || null },
  });
  if (upd.count === 0) return { ok: false, code: 'no_active_invitation' };
  return { ok: true, count: upd.count };
}

// ── Token resolution (public accept page) ───────────────────────────────────────
/**
 * Resolve a raw token to its invitation row. Expiry is checked dynamically.
 * @returns {Promise<{status:'invalid'|'expired'|'revoked'|'accepted'|'superseded'|'ok', row?:object}>}
 */
export async function resolveInvitationToken(token) {
  if (!token || typeof token !== 'string' || token.length > 256) return { status: 'invalid' };
  const row = await prisma.waitlistInvitation.findFirst({ where: { tokenHash: hashInviteToken(token) } });
  if (!row) return { status: 'invalid' };
  if (row.status === 'accepted') return { status: 'accepted', row };
  if (row.status === 'revoked') return { status: 'revoked', row };
  if (row.status === 'superseded') return { status: 'superseded', row };
  if (new Date(row.expiresAt).getTime() < Date.now()) return { status: 'expired', row };
  return { status: 'ok', row };
}

// ── Accept: create (or safely decline to overwrite) the account ─────────────────
/**
 * Consume a valid invitation and create the user account + assign the default
 * (or invitation-pinned) tier. Single-use + idempotent + transactional.
 *
 * @param {string} token raw invitation token
 * @param {{password:string, name?:string, acceptedTerms?:boolean, ip?:string}} opts
 * @returns {Promise<
 *   {ok:true, userId:string, user:object, applicantId:string}
 * | {ok:false, code:'validation'|'invalid'|'expired'|'revoked'|'accepted'|'superseded'|'account_exists'|'server_error', message?:string, userId?:string}
 * >}
 */
export async function acceptInvitation(token, { password, name = '', acceptedTerms = false, ip = '' } = {}) {
  const pw = validateInvitePassword(password);
  if (!pw.ok) return { ok: false, code: 'validation', message: pw.error };

  // Outer guard: ANY unexpected throw (transient DB blip in resolve / existence
  // check / hashPassword) returns a typed code so the controller never emits a
  // code-less 500 and the accept page can show a friendly message.
  try {
    const resolved = await resolveInvitationToken(token);
    if (resolved.status !== 'ok') return { ok: false, code: resolved.status };
    const row = resolved.row;
    const normalized = row.normalizedEmail;

    // Phase 10 — the email already belongs to a real account. NEVER overwrite an
    // existing password. Burn+link the invitation (single-use) and point them at
    // sign-in. Do NOT sign them in (we did not verify they own that account).
    const existing = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (existing) {
      await prisma.waitlistInvitation.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'accepted', acceptedAt: new Date(), acceptedUserId: existing.id },
      }).catch(() => {});
      return { ok: false, code: 'account_exists', userId: existing.id, applicantId: row.waitlistApplicantId };
    }

    const hashed = await hashPassword(password);
    const userNumber = await allocateUserNumber().catch(() => null);
    const cleanName = (name && String(name).trim().slice(0, 100)) || row.name || null;

    let createdUser;
    try {
      createdUser = await prisma.$transaction(async (tx) => {
        // Single-use burn FIRST behind the pending guard; if lost, abort the whole tx.
        const burn = await tx.waitlistInvitation.updateMany({
          where: { id: row.id, status: 'pending' },
          data: { status: 'accepted', acceptedAt: new Date() },
        });
        if (burn.count === 0) throw new ConsumedError();

        // Return the created row DIRECTLY (superset of what the controller needs) so
        // there is no undefended post-commit re-read that could 500 an account that
        // already exists + a token that is already burned.
        const user = await tx.user.create({
          data: {
            email: normalized,
            name: cleanName,
            password: hashed,
            role: 'user',
            userNumber,
            // The invitation link proves control of the mailbox → treat as verified.
            emailVerifiedAt: new Date(),
            termsAcceptedAt: acceptedTerms ? new Date() : null,
          },
          select: { id: true, email: true, name: true, role: true, sessionEpoch: true, createdAt: true, onboardingCompletedAt: true },
        });
        await tx.waitlistInvitation.update({ where: { id: row.id }, data: { acceptedUserId: user.id } });
        return user;
      });
    } catch (err) {
      if (err instanceof ConsumedError) {
        // The link was consumed / rotated / revoked in the tiny window between
        // resolve and burn — return the ACCURATE reason so the page shows the right
        // message ("already used" vs "a newer invitation was issued" vs "revoked").
        const r2 = await resolveInvitationToken(token).catch(() => ({ status: 'accepted' }));
        const code = ['accepted', 'superseded', 'revoked', 'expired'].includes(r2.status) ? r2.status : 'accepted';
        return { ok: false, code };
      }
      // Unique-email race: another accept (or a registration) created the account
      // between our existence check and the create — treat as an existing account.
      if (err && (err.code === 'P2002' || /unique/i.test(err.message || ''))) {
        const u = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } }).catch(() => null);
        return { ok: false, code: 'account_exists', userId: u?.id, applicantId: row.waitlistApplicantId };
      }
      console.error('[invitation] accept tx failed:', err?.message || err);
      return { ok: false, code: 'server_error' };
    }

    const userId = createdUser.id;

    // ── Post-commit side effects (best-effort — never fail an accepted account) ──
    // Assign the initial tier through the ONE centralized writer (Phase 14). The tier
    // pinned on the invitation wins; otherwise the site default is resolved.
    try {
      const tierId = row.tierId || (await getDefaultTierId());
      if (tierId) {
        await recordTierAssignment({
          userId,
          tierId,
          userTierId: tierId,
          changeType: 'beta_access',
          reason: 'Waitlist invitation accepted',
          assignedByName: 'system',
        });
        if (!row.tierId) {
          await prisma.waitlistInvitation.update({ where: { id: row.id }, data: { tierId } }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[invitation] tier assignment failed:', e?.message || e);
    }

    // 93.md §6.3 — welcome / getting-started email. Accept-time coverage is
    // COMPLETE for beta users: every beta account is created exactly here (the
    // invitation accept is the only registration path while the waitlist gates
    // signups), so no first-login fallback is needed. Best-effort: a welcome
    // email failure must never fail an accepted account.
    try {
      await sendWelcomeEmailOnce(userId, { email: createdUser.email, toName: createdUser.name || '' });
    } catch (e) {
      console.error('[invitation] welcome email failed:', e?.message || e);
    }

    return { ok: true, userId, user: createdUser, applicantId: row.waitlistApplicantId };
  } catch (err) {
    console.error('[invitation] accept failed:', err?.message || err);
    return { ok: false, code: 'server_error' };
  }
}

// ── 94.md §2.4 — accept a pending invitation through VERIFIED Google identity ───
/**
 * Google-registration path for an invited email. There is NO raw token here: the
 * proof of mailbox control is the VERIFIED Google email (id_token email_verified,
 * signature-checked upstream), matched against the invitation's normalizedEmail —
 * the same trim+lowercase policy used everywhere. The caller (googleAuthService)
 * has already established: registration is closed, the Google email is verified,
 * and no User exists for this email.
 *
 * Reuses the exact acceptInvitation guarantees: single-use burn behind the
 * `status:'pending'` updateMany guard, user-create in the SAME transaction (plus
 * the AuthAccount row binding Google's stable `sub`), ConsumedError/P2002 race
 * mapping, invitation-pinned tier assignment, and the idempotent welcome email.
 * The user is created with password:null (Google-only) and emailVerifiedAt:now.
 *
 * @param {{normalizedEmail:string, claims:{sub:string,email:string,name?:string,picture?:string}}} opts
 * @returns {Promise<
 *   {ok:true, userId:string, user:object, applicantId:string}
 * | {ok:false, code:'not_invited'|'account_exists'|'server_error'}
 * >}
 */
export async function acceptInvitationWithGoogle({ normalizedEmail, claims } = {}) {
  try {
    if (!normalizedEmail || !claims?.sub) return { ok: false, code: 'server_error' };

    // Newest pending, unexpired invitation for this email (rotation marks older
    // rows superseded, so `pending` is effectively unique — newest-first is a
    // belt-and-braces tiebreak). Expiry is DERIVED from expiresAt, never a flag.
    const row = await prisma.waitlistInvitation.findFirst({
      where: { normalizedEmail, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || new Date(row.expiresAt).getTime() < Date.now()) {
      return { ok: false, code: 'not_invited' };
    }

    const userNumber = await allocateUserNumber().catch(() => null);
    const cleanName = (claims.name && String(claims.name).trim().slice(0, 100)) || row.name || null;

    let createdUser;
    try {
      createdUser = await prisma.$transaction(async (tx) => {
        const burn = await tx.waitlistInvitation.updateMany({
          where: { id: row.id, status: 'pending' },
          data: { status: 'accepted', acceptedAt: new Date() },
        });
        if (burn.count === 0) throw new ConsumedError();

        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            name: cleanName,
            password: null, // Google-only account (94.md §2.3)
            role: 'user',
            userNumber,
            // The VERIFIED Google email proves control of the mailbox → verified.
            emailVerifiedAt: new Date(),
            termsAcceptedAt: null,
          },
          select: { id: true, email: true, name: true, role: true, sessionEpoch: true, createdAt: true, onboardingCompletedAt: true },
        });
        await tx.authAccount.create({
          data: {
            userId: user.id,
            provider: 'google',
            providerAccountId: claims.sub,
            providerEmail: claims.email || normalizedEmail,
            providerEmailVerified: true,
            displayName: claims.name || null,
            avatarUrl: claims.picture || null,
            lastLoginAt: new Date(),
          },
        });
        await tx.waitlistInvitation.update({ where: { id: row.id }, data: { acceptedUserId: user.id } });
        return user;
      });
    } catch (err) {
      if (err instanceof ConsumedError) {
        // Consumed in the race window — for the Google flow every non-pending
        // outcome reads as "this email has no usable invitation".
        return { ok: false, code: 'not_invited' };
      }
      // Unique race on User.email (concurrent register/accept) or on the
      // AuthAccount uniques (concurrent duplicate callback): never overwrite —
      // the caller re-resolves the identity as a login/link-required case.
      if (err && (err.code === 'P2002' || /unique/i.test(err.message || ''))) {
        return { ok: false, code: 'account_exists' };
      }
      console.error('[invitation] google accept tx failed:', err?.message || err);
      return { ok: false, code: 'server_error' };
    }

    // Post-commit side effects — identical to the password accept path.
    try {
      const tierId = row.tierId || (await getDefaultTierId());
      if (tierId) {
        await recordTierAssignment({
          userId: createdUser.id,
          tierId,
          userTierId: tierId,
          changeType: 'beta_access',
          reason: 'Waitlist invitation accepted (Google sign-in)',
          assignedByName: 'system',
        });
        if (!row.tierId) {
          await prisma.waitlistInvitation.update({ where: { id: row.id }, data: { tierId } }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[invitation] google-accept tier assignment failed:', e?.message || e);
    }
    try {
      await sendWelcomeEmailOnce(createdUser.id, { email: createdUser.email, toName: createdUser.name || '' });
    } catch (e) {
      console.error('[invitation] google-accept welcome email failed:', e?.message || e);
    }

    return { ok: true, userId: createdUser.id, user: createdUser, applicantId: row.waitlistApplicantId };
  } catch (err) {
    console.error('[invitation] google accept failed:', err?.message || err);
    return { ok: false, code: 'server_error' };
  }
}

// ── 93.md §6.3 — one-time welcome email (idempotent) ────────────────────────────
/**
 * Send the welcome/getting-started email to a user EXACTLY once. Idempotency is
 * an ATOMIC claim on User.welcomeEmailSentAt (updateMany where null) BEFORE the
 * send — two concurrent accepts/retries can never double-send: the loser of the
 * race sees count 0 and returns 'already_sent'. At-most-once by design: if the
 * claim succeeds and the provider then fails, we do NOT unclaim (a security-notice
 * style retry loop is worse than one missed welcome; the beta user already has a
 * working account).
 *
 * When SMTP is not configured we return WITHOUT claiming, so an environment that
 * gains SMTP later has not silently burned everyone's welcome flag.
 *
 * @param {string} userId
 * @param {{email?:string, toName?:string}} opts (email looked up when omitted)
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
export async function sendWelcomeEmailOnce(userId, { email = '', toName = '' } = {}) {
  if (!userId) return { sent: false, reason: 'no_user' };
  if (!isEmailConfigured()) return { sent: false, reason: 'not_configured' };

  // Atomic claim FIRST (never double-send).
  const claim = await prisma.user.updateMany({
    where: { id: userId, welcomeEmailSentAt: null },
    data: { welcomeEmailSentAt: new Date() },
  });
  if (claim.count === 0) return { sent: false, reason: 'already_sent' };

  let to = email;
  let name = toName;
  if (!to) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }).catch(() => null);
    if (!u) return { sent: false, reason: 'no_user' };
    to = u.email;
    name = name || u.name || '';
  }

  const { html, text } = renderWelcomeEmail({
    appName: 'PecanRev',
    toName: name || '',
    supportEmail: configuredSupportEmail(),
  });
  const result = await sendEmail({
    to,
    subject: 'Welcome to PecanRev — your first review starts here',
    html,
    text,
    context: 'welcome',
  });
  if (!result.sent) {
    console.error('[invitation] welcome email not delivered:', result.reason || 'unknown');
    return { sent: false, reason: result.reason || 'send_failed' };
  }
  return { sent: true };
}

// ── Enrichment for the Ops list/detail (cross-DB READ only) ─────────────────────
/**
 * Latest invitation per normalized email. Used to enrich a page of waitlist rows.
 * @param {string[]} normalizedEmails
 * @returns {Promise<Map<string, object>>} normalizedEmail → latest raw invitation row
 */
// Columns needed to derive state + build a safe view. Deliberately EXCLUDES
// tokenHash so the raw hash is never materialized into an in-memory enrichment map.
const INVITATION_VIEW_SELECT = {
  id: true, normalizedEmail: true, status: true, expiresAt: true, attempt: true,
  acceptedAt: true, acceptedUserId: true, revokedAt: true, revokedByUserId: true,
  tierId: true, emailStatus: true, emailSentAt: true, lastEmailError: true,
  invitedByUserId: true, batchId: true, cohort: true, createdAt: true, updatedAt: true,
};

export async function latestInvitationsForEmails(normalizedEmails) {
  const emails = [...new Set((normalizedEmails || []).map((e) => normalizeEmail(e)).filter(Boolean))];
  if (!emails.length) return new Map();
  const rows = await prisma.waitlistInvitation.findMany({
    where: { normalizedEmail: { in: emails } },
    select: INVITATION_VIEW_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  const map = new Map();
  for (const r of rows) if (!map.has(r.normalizedEmail)) map.set(r.normalizedEmail, r);
  return map;
}

/**
 * Existing main-DB users for a set of normalized emails (for "Existing account"
 * detection + "View user account"). User.email is stored normalized.
 * @returns {Promise<Map<string, {id:string, userNumber:number|null, suspended:boolean}>>}
 */
export async function existingUsersForEmails(normalizedEmails) {
  const emails = [...new Set((normalizedEmails || []).map((e) => normalizeEmail(e)).filter(Boolean))];
  if (!emails.length) return new Map();
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, userNumber: true, suspended: true, createdAt: true },
  });
  const map = new Map();
  for (const u of users) map.set(u.email, u);
  return map;
}

/**
 * Compute the enriched invitation view for ONE applicant summary: derived state,
 * eligibility, the latest invitation view, and any existing user. Pure given the
 * two lookups.
 */
export function enrichApplicant(applicant, latestInvitationRow, existingUser, now = Date.now()) {
  const invitationView = toInvitationView(latestInvitationRow, now);
  // An existing account is terminal — the person is already a user.
  const state = existingUser ? 'accepted' : deriveInviteState(applicant, latestInvitationRow, now);
  return {
    inviteState: state,
    eligibility: inviteEligibility(state),
    invitation: invitationView,
    existingUser: existingUser ? { id: existingUser.id, userNumber: existingUser.userNumber, suspended: !!existingUser.suspended } : null,
  };
}

/** Full invitation history for one applicant (by opaque id OR normalized email). */
export async function invitationHistoryForApplicant(applicantId, normalizedEmail) {
  const or = [{ waitlistApplicantId: applicantId }];
  const ne = normalizeEmail(normalizedEmail);
  if (ne) or.push({ normalizedEmail: ne });
  const rows = await prisma.waitlistInvitation.findMany({ where: { OR: or }, select: INVITATION_VIEW_SELECT, orderBy: { createdAt: 'desc' } });
  return rows.map((r) => toInvitationView(r));
}

// ── Metrics (Ops) ───────────────────────────────────────────────────────────────
export async function invitationMetrics() {
  const now = new Date();
  const d7 = new Date(Date.now() - 7 * 86400000);
  const d30 = new Date(Date.now() - 30 * 86400000);
  const [pendingActive, expired, accepted, revoked, failedEmail, acceptedLast7, acceptedLast30] = await Promise.all([
    prisma.waitlistInvitation.count({ where: { status: 'pending', expiresAt: { gt: now } } }),
    prisma.waitlistInvitation.count({ where: { status: 'pending', expiresAt: { lte: now } } }),
    prisma.waitlistInvitation.count({ where: { status: 'accepted' } }),
    prisma.waitlistInvitation.count({ where: { status: 'revoked' } }),
    prisma.waitlistInvitation.count({ where: { status: 'pending', emailStatus: 'failed' } }),
    prisma.waitlistInvitation.count({ where: { status: 'accepted', acceptedAt: { gte: d7 } } }),
    prisma.waitlistInvitation.count({ where: { status: 'accepted', acceptedAt: { gte: d30 } } }),
  ]);
  return { pendingActive, expired, accepted, revoked, failedEmail, acceptedLast7, acceptedLast30 };
}
