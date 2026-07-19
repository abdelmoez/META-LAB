/**
 * googleAuthController.js — 94.md §2 — the OAuth redirect mechanics.
 *
 * Flow shape (Authorization Code + PKCE, response_mode=query GET callback —
 * chosen deliberately: the app-wide originCheck CSRF layer 403s cross-site
 * POSTs, so a form_post callback would be dead on arrival, while a top-level
 * GET navigation passes; a GET callback also needs zero CSP changes):
 *
 *   GET  /api/auth/google/start       (public) → txn cookie + 302 to Google
 *   GET  /api/auth/google/callback    (public) → validate → session/link/error 302
 *   POST /api/auth/google/link/start  (auth)   → txn cookie(mode:link) + {url}
 *   POST /api/auth/google/unlink      (auth)   → remove link (password required)
 *
 * Redirect hygiene (§2.8): error redirects carry ONLY a machine code in
 * ?googleError= — never provider error strings, state values, or token material.
 * Nothing from the provider response is ever logged.
 */

import { googleOidc } from '../auth/googleOidc.js';
import {
  GAUTH_TXN_COOKIE, createTxn, verifyTxnCookie, txnCookieOptions, clearTxnCookieOptions, safeReturnTo,
} from '../auth/gauthTxn.js';
import { resolveGoogleLogin, resolveGoogleLink, unlinkGoogle } from '../services/googleAuthService.js';
import { signToken } from '../auth/jwt.js';
import { sessionCookieName, sessionCookieOptions } from '../config/cookies.js';
import { recordEvent } from '../services/analytics.js';
import { USAGE } from '../utils/usage.js';

const COOKIE_NAME = sessionCookieName();

/** Where an ERROR lands: link failures go to the (authed) profile, login failures
 * to the login page (env-overridable). Only internal paths are ever used. */
function errorRedirect(mode, code) {
  const base = mode === 'link'
    ? '/profile'
    : (safeReturnTo(process.env.GOOGLE_POST_ERROR_REDIRECT) || '/login');
  return `${base}?googleError=${encodeURIComponent(code)}`;
}

function successLoginRedirect(rt) {
  return safeReturnTo(rt)
    || safeReturnTo(process.env.GOOGLE_POST_LOGIN_REDIRECT)
    || '/app';
}

/**
 * GET /api/auth/google/start?returnTo=<internal path>
 * Public. Mints the transaction (state/nonce/PKCE), sets the SameSite=Lax txn
 * cookie, redirects to Google. Not-configured → friendly error redirect (this is
 * a top-level navigation, so JSON would strand the user).
 */
export function googleStart(req, res) {
  try {
    if (!googleOidc.enabled()) {
      return res.redirect(302, errorRedirect('login', 'GOOGLE_NOT_CONFIGURED'));
    }
    const { sid, nonce, codeChallenge, cookieValue } = createTxn({
      mode: 'login',
      returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : null,
    });
    res.cookie(GAUTH_TXN_COOKIE, cookieValue, txnCookieOptions());
    recordEvent(USAGE.GOOGLE_AUTH_STARTED, { meta: { mode: 'login' } });
    return res.redirect(302, googleOidc.buildAuthUrl({ state: sid, nonce, codeChallenge }));
  } catch (err) {
    console.error('[google-auth] start error:', err?.message || err);
    return res.redirect(302, errorRedirect('login', 'GOOGLE_AUTH_FAILED'));
  }
}

/**
 * POST /api/auth/google/link/start (requireAuth)
 * The SPA calls this with the session cookie (same-origin POST → originCheck ok),
 * gets the Google URL back, and NAVIGATES to it. The txn cookie carries the
 * user id — the Strict session cookie will NOT accompany the eventual callback.
 */
export function googleLinkStart(req, res) {
  try {
    if (!googleOidc.enabled()) {
      return res.status(503).json({ error: 'Google sign-in is not configured.', code: 'GOOGLE_NOT_CONFIGURED' });
    }
    const { sid, nonce, codeChallenge, cookieValue } = createTxn({ mode: 'link', uid: req.user.id });
    res.cookie(GAUTH_TXN_COOKIE, cookieValue, txnCookieOptions());
    recordEvent(USAGE.GOOGLE_AUTH_STARTED, { userId: req.user.id, meta: { mode: 'link' } });
    return res.json({ url: googleOidc.buildAuthUrl({ state: sid, nonce, codeChallenge }) });
  } catch (err) {
    console.error('[google-auth] link start error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/auth/google/callback?code=&state=  (public — Google redirects here)
 * Every validation failure clears the single-use txn cookie and redirects with a
 * machine code only.
 */
export async function googleCallback(req, res) {
  // Decode the txn FIRST so even error paths know whether this was a link flow
  // (errors then land on /profile instead of /login).
  const verified = verifyTxnCookie(req.cookies?.[GAUTH_TXN_COOKIE]);
  const mode = verified.ok ? verified.txn.mode : 'login';
  res.clearCookie(GAUTH_TXN_COOKIE, clearTxnCookieOptions()); // single-use, always

  const fail = (code, reason) => {
    recordEvent(USAGE.GOOGLE_AUTH_FAILED, { meta: { mode, reason: reason || code } });
    return res.redirect(302, errorRedirect(mode, code));
  };

  try {
    if (!googleOidc.enabled()) return fail('GOOGLE_NOT_CONFIGURED');

    // User denied consent (or Google reported an error) — no code to exchange.
    if (typeof req.query.error === 'string' && req.query.error) {
      return fail(req.query.error === 'access_denied' ? 'GOOGLE_DENIED' : 'GOOGLE_PROVIDER_UNAVAILABLE', 'provider_error');
    }

    if (!verified.ok) {
      return fail(verified.error === 'expired' ? 'GOOGLE_EXPIRED' : 'GOOGLE_AUTH_FAILED', `txn_${verified.error}`);
    }
    const txn = verified.txn;
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || !state || state !== txn.sid) return fail('GOOGLE_AUTH_FAILED', 'state_mismatch');

    const exchanged = await googleOidc.exchangeCode({ code, codeVerifier: txn.pkce });
    if (!exchanged.ok) return fail('GOOGLE_PROVIDER_UNAVAILABLE', exchanged.error);

    const idt = await googleOidc.verifyIdToken(exchanged.idToken, { nonce: txn.nonce });
    if (!idt.ok) {
      return fail(idt.error === 'jwks_unavailable' ? 'GOOGLE_PROVIDER_UNAVAILABLE' : 'GOOGLE_AUTH_FAILED', idt.error);
    }

    if (txn.mode === 'link') {
      const out = await resolveGoogleLink({ claims: idt.claims, uid: txn.uid, req });
      if (out.kind === 'linked') {
        recordEvent(USAGE.GOOGLE_AUTH_COMPLETED, { userId: out.userId, meta: { mode: 'link' } });
        return res.redirect(302, '/profile?googleLinked=1');
      }
      return fail(out.code, 'link_rejected');
    }

    const out = await resolveGoogleLogin({ claims: idt.claims, req });
    if (out.kind !== 'session') return fail(out.code, 'login_rejected');

    // §2.7 — the SAME session mechanism as password auth: fresh JWT (inherent
    // fixation-safety in a stateless design), same cookie, same downstream
    // suspended/sessionEpoch enforcement in requireAuth.
    const user = out.user;
    const jwt = signToken({ id: user.id, email: user.email, role: user.role, se: user.sessionEpoch ?? 0 });
    res.cookie(COOKIE_NAME, jwt, sessionCookieOptions());
    recordEvent(USAGE.GOOGLE_AUTH_COMPLETED, { userId: user.id, meta: { mode: 'login' } });
    return res.redirect(302, successLoginRedirect(txn.rt));
  } catch (err) {
    console.error('[google-auth] callback error:', err?.message || err);
    return fail('GOOGLE_AUTH_FAILED', 'unhandled');
  }
}

/** POST /api/auth/google/unlink (requireAuth) */
export async function googleUnlink(req, res) {
  const out = await unlinkGoogle({ userId: req.user.id, req });
  if (!out.ok) {
    if (out.code === 'PASSWORD_REQUIRED_TO_UNLINK') {
      return res.status(400).json({
        error: 'Set a password first so you keep a way to sign in, then disconnect Google.',
        code: 'PASSWORD_REQUIRED_TO_UNLINK',
      });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res.json({ ok: true });
}
