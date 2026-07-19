/**
 * server/security/turnstile.js — 94.md §3.10 — Cloudflare Turnstile verification.
 *
 * Backend-verified (frontend widget output is NEVER trusted alone). Scope is the
 * abuse-sensitive PUBLIC forms only: registration, forgot-password, waitlist
 * signup, contact. Deliberately NOT on login: sign-in is already rate-limited
 * (authLimiter 20/15min prod) and a Cloudflare outage must never lock users out
 * of their accounts (§3.10 "avoid permanently locking out users").
 *
 * Availability model (fail SAFELY, §3.10):
 *   - Feature is OFF unless BOTH keys are set (site key ships to the widget via
 *     /api/settings/public; the secret never leaves the server).
 *   - Explicit verification failure (success:false) → 403 TURNSTILE_FAILED.
 *   - Cloudflare siteverify unreachable/5xx → TURNSTILE_FAIL_OPEN (default true)
 *     decides: allow-with-one-log-line (availability) or 403 TURNSTILE_UNAVAILABLE.
 *   - hostname / action mismatch in the verify response → reject in production
 *     (token minted for another site/widget), warn-only otherwise.
 */

import { timeoutSignal, describeFetchError } from '../utils/fetchTimeout.js';
import { verifyToken } from '../auth/jwt.js';
import { sessionCookieName } from '../config/cookies.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5_000;
const SESSION_COOKIE = sessionCookieName();

export function turnstileEnabled(env = process.env) {
  return !!((env.TURNSTILE_SITE_KEY || '').trim() && (env.TURNSTILE_SECRET_KEY || '').trim());
}

/** The PUBLIC site key for the widget (null while the feature is off). */
export function turnstilePublicSiteKey(env = process.env) {
  return turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY.trim() : null;
}

function expectedHostname() {
  try { return new URL(process.env.APP_BASE_URL || '').hostname || null; } catch { return null; }
}

/**
 * Express middleware factory. `action` labels the protected form and is checked
 * against the widget's data-action echo when Cloudflare returns one.
 */
export function requireTurnstile(action) {
  return async function turnstileGuard(req, res, next) {
    if (!turnstileEnabled()) return next();

    // §3.10 "do not unnecessarily challenge users during every normal
    // authenticated action" — a request carrying a VALID signed session is a real
    // account, not an anonymous bot; skip the challenge (e.g. the in-app feedback
    // form posts to the same public /api/contact route). Signature check only —
    // bot-protection needs proof-of-account, not the full suspended/epoch gate.
    const session = req.cookies?.[SESSION_COOKIE];
    if (session) {
      try { verifyToken(session); return next(); } catch { /* fall through to challenge */ }
    }

    const token = typeof req.body?.turnstileToken === 'string' ? req.body.turnstileToken.trim() : '';
    if (!token || token.length > 4096) {
      return res.status(403).json({
        error: 'Please complete the verification challenge and try again.',
        code: 'TURNSTILE_FAILED',
      });
    }

    let outcome;
    try {
      const body = new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY.trim(),
        response: token,
        remoteip: req.ip || '',
      });
      const r = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
        signal: timeoutSignal(VERIFY_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`siteverify_http_${r.status}`);
      outcome = await r.json();
    } catch (e) {
      // Cloudflare unreachable — the availability decision, not a security one.
      const failOpen = process.env.TURNSTILE_FAIL_OPEN !== 'false';
      console.warn(`[turnstile] siteverify unavailable (${describeFetchError(e, VERIFY_TIMEOUT_MS)}) — ${failOpen ? 'allowing (fail-open)' : 'rejecting (fail-closed)'} action=${action}`);
      if (failOpen) return next();
      return res.status(403).json({
        error: 'Verification is temporarily unavailable. Please try again shortly.',
        code: 'TURNSTILE_UNAVAILABLE',
      });
    }

    if (!outcome?.success) {
      return res.status(403).json({
        error: 'Verification failed. Please try the challenge again.',
        code: 'TURNSTILE_FAILED',
      });
    }

    // §3.10 — validate hostname + action where supported. A mismatched token was
    // minted for a different site/widget: reject in prod, warn in dev (localhost
    // hostnames legitimately differ there).
    const prod = process.env.NODE_ENV === 'production';
    const host = expectedHostname();
    if (outcome.hostname && host && outcome.hostname !== host) {
      if (prod) return res.status(403).json({ error: 'Verification failed. Please try again.', code: 'TURNSTILE_FAILED' });
      console.warn(`[turnstile] hostname mismatch (got ${outcome.hostname}, expected ${host}) — allowed outside production`);
    }
    if (outcome.action && action && outcome.action !== action) {
      if (prod) return res.status(403).json({ error: 'Verification failed. Please try again.', code: 'TURNSTILE_FAILED' });
      console.warn(`[turnstile] action mismatch (got ${outcome.action}, expected ${action}) — allowed outside production`);
    }

    return next();
  };
}
