/**
 * googleAuthService.js — 94.md §2.4/§2.5 — what a VERIFIED Google identity means
 * for a PecanRev account. All DB decisions live here; the controller only does
 * the OAuth mechanics (state/nonce/PKCE, token exchange) and redirects.
 *
 * Outcome contract (every path returns a typed object, never throws):
 *   { kind:'session', user }           — mint the normal session for this user
 *   { kind:'linked', userId }          — link succeeded (idempotent included)
 *   { kind:'error',  code, reason? }   — redirect with ?googleError=<code>
 *
 * Invariants enforced here (94.md acceptance criteria):
 *   - Google's stable `sub` is the ONLY identity key; email is display metadata.
 *   - An unverified Google email is rejected BEFORE any account lookup — an
 *     unverified bearer never learns whether an email has an account.
 *   - Google login never bypasses: registrationOpen (fail-CLOSED here, unlike the
 *     email path's documented fail-open — a settings-read error during a closed
 *     beta must not open a side door), waitlist invitations, suspension.
 *   - Existing email ⇒ NEVER auto-link, NEVER duplicate: the user signs in with
 *     their password and links from Profile → Security (§2.5 "sign in through an
 *     already trusted method").
 *   - Duplicate/concurrent links die on the AuthAccount DB uniques (P2002), not
 *     on best-effort application checks.
 *   - User-edited profile fields are never overwritten on later logins (§2.6) —
 *     only AuthAccount provider metadata is refreshed.
 */

import { prisma } from '../db/client.js';
import { allocateUserNumber } from './userNumber.js';
import { recordEvent, recordFirstEvent } from './analytics.js';
import { USAGE } from '../utils/usage.js';
import { acceptInvitationWithGoogle } from './invitationService.js';
import * as waitlist from '../waitlist/waitlistService.js';
import { claimPendingScreenInvites, captureRegistrationCountry } from '../controllers/authController.js';

const PROVIDER = 'google';

/** Fire-and-forget SecurityEvent (never awaited in the caller's response path). */
function securityEvent(type, { userId = null, email = null, req = null, details = null } = {}) {
  prisma.securityEvent.create({
    data: {
      type,
      userId,
      email,
      ip: req?.ip || null,
      userAgent: req?.get?.('user-agent') || null,
      details: details ? JSON.stringify(details) : null,
    },
  }).catch(() => {});
}

/**
 * Closed-beta gate for the GOOGLE path. Reads the same appSettings.registrationOpen
 * the email path reads, but FAILS CLOSED on a read error (documented divergence:
 * authController.register defaults open on error; replicating that here would let
 * a DB blip open registration to any Google account during a closed beta).
 * @returns {Promise<boolean>} true when open
 */
async function isRegistrationOpen() {
  const row = await prisma.siteSetting.findUnique({ where: { key: 'appSettings' } });
  const appSettings = row ? JSON.parse(row.value || '{}') : {};
  return appSettings.registrationOpen !== false;
}

/** Refresh provider metadata on an AuthAccount at login (never touches User fields). */
function touchAuthAccount(accountId, claims) {
  return prisma.authAccount.update({
    where: { id: accountId },
    data: {
      lastLoginAt: new Date(),
      providerEmail: claims.email,
      providerEmailVerified: claims.emailVerified,
      displayName: claims.name || null,
      avatarUrl: claims.picture || null,
    },
  });
}

/**
 * LOGIN-mode callback: existing linked user → session; unlinked existing email →
 * link-required; unknown → registration (open) or invitation match (closed).
 * @param {{claims:object, req:object}} opts
 */
export async function resolveGoogleLogin({ claims, req }) {
  try {
    // §2.4.3 — verified email is a precondition for EVERYTHING (including lookups).
    if (!claims.emailVerified) {
      securityEvent('GOOGLE_LOGIN_REJECTED', { email: null, req, details: { reason: 'email_unverified' } });
      return { kind: 'error', code: 'GOOGLE_EMAIL_UNVERIFIED' };
    }

    // 1) Known Google identity (stable sub) → login.
    const account = await prisma.authAccount.findUnique({
      where: { provider_providerAccountId: { provider: PROVIDER, providerAccountId: claims.sub } },
      include: { user: true },
    });
    if (account) {
      const user = account.user;
      if (!user) return { kind: 'error', code: 'GOOGLE_AUTH_FAILED' };
      if (user.suspended) {
        // Mirror password login: failed LoginEvent + generic suspended message.
        prisma.loginEvent.create({
          data: { userId: user.id, email: user.email || '', ip: req.ip || '', userAgent: req.get('user-agent') || '', success: false },
        }).catch(() => {});
        securityEvent('GOOGLE_LOGIN_REJECTED', { userId: user.id, email: user.email, req, details: { reason: 'suspended' } });
        return { kind: 'error', code: 'GOOGLE_SUSPENDED' };
      }

      touchAuthAccount(account.id, claims).catch(() => {});
      // Mailbox control proven by Google for the SAME address → backfill verification
      // (precedent: invitation accept sets emailVerifiedAt for the same reason).
      if (!user.emailVerifiedAt && claims.email === (user.email || '').trim().toLowerCase()) {
        prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }).catch(() => {});
      }

      // Login side effects — exact parity with authController.login.
      prisma.loginEvent.create({
        data: { userId: user.id, email: user.email || '', ip: req.ip || '', userAgent: req.get('user-agent') || '', success: true },
      }).catch(() => {});
      prisma.user.update({ where: { id: user.id }, data: { lastActive: new Date() } }).catch(() => {});
      recordFirstEvent(USAGE.FIRST_LOGIN, user.id);
      return { kind: 'session', user };
    }

    // 2) No linked identity. Existing account with this (verified) email?
    const existing = await prisma.user.findUnique({ where: { email: claims.email } });
    if (existing) {
      // §2.5 — never auto-link, never duplicate. (Suspension note: linking is not
      // an account entry — the user is sent to password sign-in, which enforces it.)
      securityEvent('GOOGLE_LOGIN_REJECTED', { userId: existing.id, email: existing.email, req, details: { reason: 'link_required' } });
      return { kind: 'error', code: 'ACCOUNT_EXISTS_LINK_REQUIRED' };
    }

    // 3) Unknown identity + unknown email → registration path.
    let open;
    try { open = await isRegistrationOpen(); }
    catch (e) {
      console.error('[google-auth] registrationOpen read failed (failing CLOSED):', e?.message || e);
      open = false;
    }

    if (!open) {
      // Closed beta: the ONLY door is a pending waitlist invitation for this email.
      const invited = await acceptInvitationWithGoogle({ normalizedEmail: claims.email, claims });
      if (invited.ok) {
        waitlist.setStatus(invited.applicantId, 'ACCEPTED', { changedBy: null, note: 'Accepted invitation — account created via Google sign-in' }).catch(() => {});
        claimPendingScreenInvites(invited.user).catch(() => {});
        captureRegistrationCountry(req, invited.user).catch(() => {});
        securityEvent('WAITLIST_INVITATION_ACCEPTED', { userId: invited.userId, email: invited.user.email, req, details: { source: 'google' } });
        recordEvent(USAGE.ACCOUNT_CREATED, { userId: invited.userId, meta: { source: 'google_invitation' } });
        recordFirstEvent(USAGE.FIRST_LOGIN, invited.userId);
        return { kind: 'session', user: invited.user };
      }
      if (invited.code === 'account_exists') return { kind: 'error', code: 'ACCOUNT_EXISTS_LINK_REQUIRED' };
      if (invited.code === 'server_error') return { kind: 'error', code: 'GOOGLE_AUTH_FAILED' };
      securityEvent('GOOGLE_LOGIN_REJECTED', { email: claims.email, req, details: { reason: 'not_invited' } });
      return { kind: 'error', code: 'GOOGLE_NOT_INVITED' };
    }

    // Open registration → create User (password:null, Google-verified email) +
    // AuthAccount atomically. §2.4.7: role 'user', tier null (site default
    // resolves at read time — same as email registration), onboarding untouched
    // so the client routes the new user to onboarding.
    const userNumber = await allocateUserNumber().catch(() => null);
    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: claims.email,
            name: claims.name ? String(claims.name).trim().slice(0, 100) : null,
            password: null,
            role: 'user',
            userNumber,
            emailVerifiedAt: new Date(), // §2.4.3 — Google-verified
            termsAcceptedAt: null,
          },
          select: { id: true, email: true, name: true, role: true, sessionEpoch: true, createdAt: true, onboardingCompletedAt: true, suspended: true, emailVerifiedAt: true },
        });
        await tx.authAccount.create({
          data: {
            userId: user.id,
            provider: PROVIDER,
            providerAccountId: claims.sub,
            providerEmail: claims.email,
            providerEmailVerified: true,
            displayName: claims.name || null,
            avatarUrl: claims.picture || null,
            lastLoginAt: new Date(),
          },
        });
        return user;
      });
    } catch (err) {
      if (err && err.code === 'P2002') {
        // Concurrent-callback race: either the email or the (provider, sub) landed
        // first elsewhere. Re-resolve as a login — the winner's rows are authoritative.
        const again = await prisma.authAccount.findUnique({
          where: { provider_providerAccountId: { provider: PROVIDER, providerAccountId: claims.sub } },
          include: { user: true },
        }).catch(() => null);
        if (again?.user && !again.user.suspended) return { kind: 'session', user: again.user };
        return { kind: 'error', code: 'ACCOUNT_EXISTS_LINK_REQUIRED' };
      }
      console.error('[google-auth] register tx failed:', err?.message || err);
      return { kind: 'error', code: 'GOOGLE_AUTH_FAILED' };
    }

    // Registration parity side effects (fire-and-forget — mirror register()).
    claimPendingScreenInvites(created).catch(() => {});
    captureRegistrationCountry(req, created).catch(() => {});
    securityEvent('GOOGLE_REGISTER', { userId: created.id, email: created.email, req, details: { source: 'google' } });
    recordEvent(USAGE.ACCOUNT_CREATED, { userId: created.id, meta: { source: 'google' } });
    recordFirstEvent(USAGE.FIRST_LOGIN, created.id);
    return { kind: 'session', user: created };
  } catch (err) {
    console.error('[google-auth] login resolve failed:', err?.message || err);
    return { kind: 'error', code: 'GOOGLE_AUTH_FAILED' };
  }
}

/**
 * LINK-mode callback: bind this Google identity to the signed-in user captured in
 * the SIGNED transaction cookie (the Strict session cookie is absent on the
 * cross-site callback navigation — the txn cookie's uid, minted by an authed
 * POST /link/start, is the identity carrier).
 * @param {{claims:object, uid:string, req:object}} opts
 */
export async function resolveGoogleLink({ claims, uid, req }) {
  try {
    if (!uid) return { kind: 'error', code: 'GOOGLE_AUTH_FAILED' };
    if (!claims.emailVerified) return { kind: 'error', code: 'GOOGLE_EMAIL_UNVERIFIED' };

    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) return { kind: 'error', code: 'GOOGLE_AUTH_FAILED' };
    if (user.suspended) return { kind: 'error', code: 'GOOGLE_SUSPENDED' };

    // Idempotent success: this exact identity already linked to this user.
    const existing = await prisma.authAccount.findUnique({
      where: { provider_providerAccountId: { provider: PROVIDER, providerAccountId: claims.sub } },
    });
    if (existing) {
      if (existing.userId === user.id) {
        touchAuthAccount(existing.id, claims).catch(() => {});
        return { kind: 'linked', userId: user.id };
      }
      securityEvent('GOOGLE_LINK_REJECTED', { userId: user.id, email: user.email, req, details: { reason: 'identity_linked_elsewhere' } });
      return { kind: 'error', code: 'GOOGLE_ALREADY_LINKED_OTHER_USER' };
    }

    try {
      await prisma.authAccount.create({
        data: {
          userId: user.id,
          provider: PROVIDER,
          providerAccountId: claims.sub,
          providerEmail: claims.email,
          providerEmailVerified: true,
          displayName: claims.name || null,
          avatarUrl: claims.picture || null,
          lastLoginAt: new Date(),
        },
      });
    } catch (err) {
      if (err && err.code === 'P2002') {
        // The DB uniques arbitrate BOTH races: (provider,sub) taken → linked
        // elsewhere (or a concurrent duplicate of this same link — re-check);
        // (userId,provider) taken → this user already has a different Google.
        const again = await prisma.authAccount.findUnique({
          where: { provider_providerAccountId: { provider: PROVIDER, providerAccountId: claims.sub } },
        }).catch(() => null);
        if (again?.userId === user.id) return { kind: 'linked', userId: user.id };
        if (again) return { kind: 'error', code: 'GOOGLE_ALREADY_LINKED_OTHER_USER' };
        return { kind: 'error', code: 'GOOGLE_LINK_CONFLICT' };
      }
      throw err;
    }

    securityEvent('GOOGLE_ACCOUNT_LINKED', { userId: user.id, email: user.email, req });
    recordEvent(USAGE.GOOGLE_ACCOUNT_LINKED, { userId: user.id });
    return { kind: 'linked', userId: user.id };
  } catch (err) {
    console.error('[google-auth] link resolve failed:', err?.message || err);
    return { kind: 'error', code: 'GOOGLE_AUTH_FAILED' };
  }
}

/**
 * Unlink Google from a signed-in user. Refused while the account has no password —
 * never remove the last working sign-in method (§2.9).
 * @returns {Promise<{ok:true}|{ok:false, code:'PASSWORD_REQUIRED_TO_UNLINK'|'SERVER_ERROR'}>}
 */
export async function unlinkGoogle({ userId, req }) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, password: true } });
    if (!user) return { ok: false, code: 'SERVER_ERROR' };
    if (!user.password) return { ok: false, code: 'PASSWORD_REQUIRED_TO_UNLINK' };
    await prisma.authAccount.deleteMany({ where: { userId, provider: PROVIDER } }); // idempotent
    securityEvent('GOOGLE_ACCOUNT_UNLINKED', { userId, email: user.email, req });
    recordEvent(USAGE.GOOGLE_ACCOUNT_UNLINKED, { userId });
    return { ok: true };
  } catch (err) {
    console.error('[google-auth] unlink failed:', err?.message || err);
    return { ok: false, code: 'SERVER_ERROR' };
  }
}
