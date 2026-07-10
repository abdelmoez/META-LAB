/**
 * invitationAdminController.js — Ops Console waitlist → account invitation actions
 * (80.md). ADMIN ONLY (requireAdmin on every route in routes/admin.js). Coordinates
 * the two databases: reads the applicant from the strictly-separate waitlist data
 * layer, mints/sends the invitation in the MAIN db (invitationService), then writes
 * the applicant's waitlist status back through the waitlist service. No waitlist
 * query is ever issued outside server/waitlist/*.
 */

import crypto from 'crypto';
import * as invitationService from '../services/invitationService.js';
import * as waitlist from '../waitlist/waitlistService.js';
import { normalizeEmail } from '../../src/shared/betaWaitlist.js';
import { deriveInviteState, inviteEligibility, isBulkInvitable } from '../../src/shared/waitlistInvitation.js';
import { logAdminAction } from '../utils/audit.js';

const UNAVAILABLE = { error: 'The Beta Waitlist database is not configured or unavailable.', code: 'unavailable' };

function isUnavailable(code) {
  return code === 'not_configured' || code === 'client_unavailable';
}

/** Proxy-safe public origin for the emailed accept link (matches authController). */
function baseUrlFrom(req) {
  return (process.env.APP_BASE_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
}

/** Validate an optional admin-supplied tierId (Phase 14 — future tier selector). */
function cleanTierId(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 64);
  return s || null;
}

// Whitelist + string-coerce a bulk filter object. Only known list-filter keys pass,
// and each value is forced to a scalar string — a client can never smuggle a Prisma
// operator object (e.g. { status: { in: ['REMOVED'] } }) through the bulk endpoint.
const BULK_FILTER_KEYS = ['status', 'role', 'countryCode', 'emailStatus', 'institutionType', 'covidenceLicense', 'primaryField', 'search', 'dateFrom', 'dateTo'];
function sanitizeFilter(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of BULK_FILTER_KEYS) {
    const v = input[k];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const s = String(v).trim();
      if (s) out[k] = s;
    }
  }
  return out;
}

/** Compute the derived invite state for a single applicant (one cheap lookup each). */
async function stateFor(applicant) {
  const ne = normalizeEmail(applicant.email);
  const [invMap, userMap] = await Promise.all([
    invitationService.latestInvitationsForEmails([ne]),
    invitationService.existingUsersForEmails([ne]),
  ]);
  const existingUser = userMap.get(ne) || null;
  const latest = invMap.get(ne) || null;
  const state = existingUser ? 'accepted' : deriveInviteState(applicant, latest, Date.now());
  return { state, existingUser, latest };
}

/** Run `fn` over items with bounded concurrency (Phase 6 — never fan out unbounded). */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); }
      catch (err) { results[i] = { code: 'error', error: err?.message || 'error' }; }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Invite ONE applicant end-to-end (mint + email + waitlist status). Shared by the
 * single, resend, and bulk endpoints. `resend` enforces the persisted cooldown and
 * is used for an already-`invited` entry. Returns a per-entry result object.
 */
async function inviteOne({ applicant, invitedByUserId, tierId, batchId, ip, baseUrl, resend, state }) {
  const result = await invitationService.inviteApplicant({
    applicant,
    invitedByUserId,
    tierId,
    batchId,
    ip,
    baseUrl,
    resend,
  });

  // A valid invitation WAS generated → advance the waitlist status to INVITED
  // (best-effort; the derived 'failed'/'expired' display comes from the invitation
  // itself, so an email failure still surfaces correctly). Skip when we didn't mint
  // one (already_registered / cooldown). The status-history note reflects the ACTUAL
  // email outcome so it never claims "sent" when nothing was sent or the send failed.
  if (['invited', 'invited_no_email', 'email_failed'].includes(result.code)) {
    const verb = resend ? 'Invitation re-issued' : 'Invitation created';
    const outcome = result.code === 'invited' ? 'email sent'
      : result.code === 'email_failed' ? 'email FAILED'
      : 'email not configured';
    waitlist.setStatus(applicant.id, 'INVITED', { changedBy: invitedByUserId, note: `${verb} — ${outcome}` }).catch(() => {});
  }

  return {
    applicantId: applicant.id,
    email: applicant.email,
    priorState: state,
    ...result,
  };
}

// ── POST /api/admin/beta-waitlist/applicants/:id/invite ─────────────────────────
export async function adminInviteApplicant(req, res) {
  try {
    const got = await waitlist.getApplicant(req.params.id);
    if (!got.ok) {
      if (isUnavailable(got.code)) return res.status(503).json(UNAVAILABLE);
      if (got.code === 'not_found') return res.status(404).json({ error: 'Applicant not found' });
      return res.status(500).json({ error: 'Internal server error' });
    }
    const applicant = got.applicant;
    const { state, existingUser } = await stateFor(applicant);
    const elig = inviteEligibility(state);

    if (existingUser) {
      return res.status(409).json({ error: 'This person already has an account.', code: 'already_registered', existingUser: { id: existingUser.id, userNumber: existingUser.userNumber } });
    }
    if (state === 'accepted') {
      return res.status(409).json({ error: 'This invitation has already been accepted.', code: 'accepted' });
    }
    if (!elig.canInvite && !elig.canResend) {
      return res.status(409).json({ error: 'This applicant cannot be invited in their current state.', code: 'not_eligible' });
    }

    const tierId = cleanTierId(req.body?.tierId);
    const result = await inviteOne({
      applicant,
      invitedByUserId: req.user.id,
      tierId,
      batchId: null,
      ip: req.ip || '',
      baseUrl: baseUrlFrom(req),
      resend: state === 'invited', // an existing live invite → resend semantics
      state,
    });

    await logAdminAction(req, 'WAITLIST_INVITE', 'BetaWaitlistApplicant', applicant.id, { code: result.code, emailStatus: result.emailStatus });
    const httpStatus = result.code === 'cooldown' ? 429 : 200;
    return res.status(httpStatus).json({ result, emailConfigured: result.emailConfigured });
  } catch (err) {
    console.error('[waitlist-invite] invite error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/beta-waitlist/applicants/:id/invite/resend ──────────────────
export async function adminResendInvitation(req, res) {
  try {
    const got = await waitlist.getApplicant(req.params.id);
    if (!got.ok) {
      if (isUnavailable(got.code)) return res.status(503).json(UNAVAILABLE);
      if (got.code === 'not_found') return res.status(404).json({ error: 'Applicant not found' });
      return res.status(500).json({ error: 'Internal server error' });
    }
    const applicant = got.applicant;
    const { state, existingUser } = await stateFor(applicant);

    if (existingUser || state === 'accepted') {
      return res.status(409).json({ error: 'This person already has an account.', code: 'accepted' });
    }
    if (state === 'waiting') {
      return res.status(409).json({ error: 'There is no invitation to resend. Send an invitation first.', code: 'no_active_invitation' });
    }

    const result = await inviteOne({
      applicant,
      invitedByUserId: req.user.id,
      tierId: null,
      batchId: null,
      ip: req.ip || '',
      baseUrl: baseUrlFrom(req),
      resend: true,
      state,
    });

    if (result.code === 'cooldown') {
      return res.status(429).json({ error: 'An invitation was sent very recently. Please wait before resending.', code: 'cooldown', cooldownMs: result.cooldownMs || 0 });
    }
    await logAdminAction(req, 'WAITLIST_INVITE_RESEND', 'BetaWaitlistApplicant', applicant.id, { code: result.code, emailStatus: result.emailStatus });
    return res.json({ result, emailConfigured: result.emailConfigured });
  } catch (err) {
    console.error('[waitlist-invite] resend error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/beta-waitlist/applicants/:id/invite/revoke ──────────────────
export async function adminRevokeInvitation(req, res) {
  try {
    const got = await waitlist.getApplicant(req.params.id);
    if (!got.ok) {
      if (isUnavailable(got.code)) return res.status(503).json(UNAVAILABLE);
      if (got.code === 'not_found') return res.status(404).json({ error: 'Applicant not found' });
      return res.status(500).json({ error: 'Internal server error' });
    }
    const applicant = got.applicant;
    const revoked = await invitationService.revokeInvitationForApplicant(applicant.id, { revokedByUserId: req.user.id });
    if (!revoked.ok) {
      return res.status(409).json({ error: 'There is no active invitation to revoke.', code: revoked.code });
    }
    // Preserve the waitlist record; return the applicant to a non-invited status so
    // Ops can re-invite intentionally later. UNDER_REVIEW keeps them on the list.
    waitlist.setStatus(applicant.id, 'UNDER_REVIEW', { changedBy: req.user.id, note: 'Invitation revoked' }).catch(() => {});
    await logAdminAction(req, 'WAITLIST_INVITE_REVOKE', 'BetaWaitlistApplicant', applicant.id, { revoked: revoked.count });
    return res.json({ ok: true, revoked: revoked.count });
  } catch (err) {
    console.error('[waitlist-invite] revoke error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/beta-waitlist/applicants/:id/invitations ─────────────────────
export async function adminInvitationHistory(req, res) {
  try {
    const got = await waitlist.getApplicant(req.params.id);
    if (!got.ok) {
      if (isUnavailable(got.code)) return res.status(503).json(UNAVAILABLE);
      if (got.code === 'not_found') return res.status(404).json({ error: 'Applicant not found' });
      return res.status(500).json({ error: 'Internal server error' });
    }
    const applicant = got.applicant;
    const invitations = await invitationService.invitationHistoryForApplicant(applicant.id, applicant.normalizedEmail || applicant.email);
    return res.json({ invitations });
  } catch (err) {
    console.error('[waitlist-invite] history error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/beta-waitlist/invitations/bulk ──────────────────────────────
/**
 * Bulk invite. Body: { ids?: string[], allMatchingFilter?: object, tierId? }.
 * Resolves the target applicants (explicit ids OR the filter set), dedupes,
 * skips ineligible entries, mints invitations with bounded concurrency, and
 * returns per-entry results + a summary (80.md Phase 6).
 */
export async function adminBulkInvite(req, res) {
  try {
    const body = req.body || {};
    const tierId = cleanTierId(body.tierId);
    const cap = invitationService.maxBulkInvite();

    // Fetch cap+1 so we can DETECT (not just silently cap) an over-limit selection.
    let resolved;
    if (Array.isArray(body.ids) && body.ids.length) {
      resolved = await waitlist.applicantsForInvite({ ids: body.ids }, cap + 1);
    } else if (body.allMatchingFilter && typeof body.allMatchingFilter === 'object') {
      resolved = await waitlist.applicantsForInvite({ filters: sanitizeFilter(body.allMatchingFilter) }, cap + 1);
    } else {
      return res.status(400).json({ error: 'Provide ids[] or allMatchingFilter.', code: 'bad_request' });
    }
    if (!resolved.ok) {
      if (isUnavailable(resolved.code)) return res.status(503).json(UNAVAILABLE);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // More rows matched than we will process this batch (the resolver returned cap+1).
    const hasMore = resolved.rows.length > cap;

    // Dedupe by id AND by normalized email (two waitlist rows, same address → one).
    const seenIds = new Set();
    const seenEmails = new Set();
    let applicants = [];
    for (const a of resolved.rows) {
      const ne = normalizeEmail(a.email);
      if (seenIds.has(a.id) || seenEmails.has(ne)) continue;
      seenIds.add(a.id); seenEmails.add(ne);
      applicants.push(a);
    }
    // Process at most `cap` this batch; the admin re-runs the action to continue.
    if (applicants.length > cap) applicants = applicants.slice(0, cap);

    // One batched lookup for state (existing users + latest invitations).
    const emails = applicants.map((a) => normalizeEmail(a.email));
    const [invMap, userMap] = await Promise.all([
      invitationService.latestInvitationsForEmails(emails),
      invitationService.existingUsersForEmails(emails),
    ]);

    const batchId = crypto.randomBytes(8).toString('hex');
    const baseUrl = baseUrlFrom(req);
    const now = Date.now();

    const results = await mapPool(applicants, 5, async (a) => {
      const ne = normalizeEmail(a.email);
      const existingUser = userMap.get(ne) || null;
      const latest = invMap.get(ne) || null;
      const state = existingUser ? 'accepted' : deriveInviteState(a, latest, now);

      if (existingUser) return { applicantId: a.id, email: a.email, priorState: state, code: 'already_registered' };
      if (state === 'accepted') return { applicantId: a.id, email: a.email, priorState: state, code: 'already_accepted' };
      if (!isBulkInvitable(state)) return { applicantId: a.id, email: a.email, priorState: state, code: 'skipped' };

      return inviteOne({
        applicant: a,
        invitedByUserId: req.user.id,
        tierId,
        batchId,
        ip: req.ip || '',
        baseUrl,
        resend: state === 'invited',
        state,
      });
    });

    // Summarize. `processed` is the number actually attempted this batch; `hasMore`
    // + `limit` honestly signal an over-limit selection (never a misleading "1").
    const summary = { processed: results.length, limit: cap, hasMore, invited: 0, resent: 0, invited_no_email: 0, email_failed: 0, already_registered: 0, already_accepted: 0, skipped: 0, cooldown: 0, error: 0 };
    for (const r of results) {
      if (r.code === 'invited') { r.priorState === 'invited' ? summary.resent++ : summary.invited++; }
      else if (r.code in summary) summary[r.code]++;
      else summary.error++;
    }

    await logAdminAction(req, 'WAITLIST_BULK_INVITE', 'BetaWaitlistApplicant', null, { batchId, summary });
    return res.json({ batchId, summary, results });
  } catch (err) {
    console.error('[waitlist-invite] bulk error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
