/**
 * acceptInvitationController.js — PUBLIC waitlist-invitation acceptance (80.md).
 *
 * Mounted at /api/accept-invitation OUTSIDE the auth-gated bare '/api' router so
 * GET /:token and POST /:token/accept work pre-auth (the invitee has no account
 * yet). The mount carries the shared inviteLimiter (server/index.js).
 *
 * Security model (mirrors invitesController + authController.resetPassword):
 *   - The URL token IS the capability (SHA-256-hashed at rest, single-use); there
 *     is no CSRF token (consistent with every other public token endpoint here).
 *   - Responses carry NO account-existence oracle beyond the invitation itself and
 *     the invited email is masked on the landing GET.
 *   - Cache-Control:no-store + Referrer-Policy:no-referrer are set so the token is
 *     never cached by an intermediary nor leaked through the Referer header
 *     (80.md Phase 12).
 */

import * as invitationService from '../services/invitationService.js';
import * as waitlist from '../waitlist/waitlistService.js';
import { maskInviteEmail } from '../../src/shared/waitlistInvitation.js';
import { signToken } from '../auth/jwt.js';
import { sessionCookieName, sessionCookieOptions } from '../config/cookies.js';
import { claimPendingScreenInvites, captureRegistrationCountry } from './authController.js';
import { prisma } from '../db/client.js';

const COOKIE_NAME = sessionCookieName();

/** Non-sensitive messages per token state (never reveal unrelated-email existence). */
const VALIDATE_MESSAGE = {
  invalid: 'This invitation link is invalid.',
  expired: 'This invitation has expired. Please contact the PecanRev team for a new invitation.',
  revoked: 'This invitation is no longer valid.',
  accepted: 'This invitation has already been used. You can sign in to your account.',
  superseded: 'This invitation is no longer valid because a newer invitation was issued.',
};

const ACCEPT_MESSAGE = {
  validation: 'Please choose a valid password.',
  invalid: 'This invitation link is invalid.',
  expired: 'This invitation has expired. Please contact the PecanRev team for a new invitation.',
  revoked: 'This invitation is no longer valid.',
  accepted: 'This invitation has already been used. You can sign in to your account.',
  superseded: 'This invitation is no longer valid because a newer invitation was issued.',
  account_exists: 'An account already exists for this email. Please sign in instead.',
  server_error: 'Something went wrong activating your account. Please try again.',
};

const VALIDATE_STATUS = { invalid: 404, expired: 410, revoked: 410, accepted: 409, superseded: 409 };
const ACCEPT_STATUS = {
  validation: 400, invalid: 404, expired: 410, revoked: 410,
  accepted: 409, superseded: 409, account_exists: 409, server_error: 500,
};

/** Harden the response so the token is not cached or leaked via Referer. */
function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

/**
 * GET /api/accept-invitation/:token (PUBLIC)
 * Sanitized landing info for a valid token; a typed non-2xx otherwise. The email
 * is masked; no raw token or internal id is echoed back.
 */
export async function validateInvitation(req, res) {
  noStore(res);
  try {
    const resolved = await invitationService.resolveInvitationToken(req.params.token);
    if (resolved.status === 'ok') {
      return res.json({
        valid: true,
        email: maskInviteEmail(resolved.row.email),
        name: resolved.row.name || '',
        expiresAt: resolved.row.expiresAt,
      });
    }
    const status = VALIDATE_STATUS[resolved.status] || 400;
    return res.status(status).json({ valid: false, code: resolved.status, error: VALIDATE_MESSAGE[resolved.status] || 'This invitation link is invalid.' });
  } catch (err) {
    console.error('[accept-invitation] validate error:', err?.message || err);
    return res.status(500).json({ valid: false, code: 'server_error', error: 'Internal server error' });
  }
}

/**
 * POST /api/accept-invitation/:token/accept (PUBLIC)
 * Body: { password, name?, acceptedTerms? }. Consumes the single-use token, creates
 * the account + assigns the default tier, marks the waitlist entry accepted, then
 * auto-signs-in via the normal session cookie. Idempotent + transactional.
 */
export async function acceptInvitation(req, res) {
  noStore(res);
  try {
    const token = req.params.token;
    const { password, name, acceptedTerms } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing invitation token', code: 'invalid' });
    }

    const result = await invitationService.acceptInvitation(token, {
      password,
      name,
      acceptedTerms: acceptedTerms === true,
      ip: req.ip || '',
    });

    if (!result.ok) {
      const status = ACCEPT_STATUS[result.code] || 400;
      return res.status(status).json({ error: result.message || ACCEPT_MESSAGE[result.code] || 'This invitation is not valid.', code: result.code });
    }

    // Best-effort waitlist status → ACCEPTED. The waitlist DB is strictly separate
    // and may be unavailable; the account already exists, so this NEVER blocks or
    // fails the accept. Written only through the waitlist service (isolation).
    waitlist.setStatus(result.applicantId, 'ACCEPTED', { changedBy: null, note: 'Accepted invitation — account created' }).catch(() => {});

    // Registration parity side effects (fire-and-forget, never block).
    claimPendingScreenInvites(result.user).catch(() => {});
    captureRegistrationCountry(req, result.user).catch(() => {});

    // Record the acceptance for security forensics (no token, no password).
    prisma.securityEvent.create({
      data: {
        type: 'WAITLIST_INVITATION_ACCEPTED',
        userId: result.userId,
        email: result.user.email,
        ip: req.ip || null,
        userAgent: req.get('user-agent') || null,
        details: JSON.stringify({ source: 'waitlist_invitation' }),
      },
    }).catch(() => {});

    // Auto-sign-in through the EXISTING session mechanism (no parallel auth).
    const user = result.user;
    const jwt = signToken({ id: user.id, email: user.email, role: user.role, se: user.sessionEpoch ?? 0 });
    res.cookie(COOKIE_NAME, jwt, sessionCookieOptions());

    return res.status(201).json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        onboardingCompleted: !!user.onboardingCompletedAt,
      },
    });
  } catch (err) {
    console.error('[accept-invitation] accept error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
