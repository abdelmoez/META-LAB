/**
 * server/auth/gauthTxn.js — 94.md §2.1/§2.7 — the OAuth TRANSACTION cookie.
 *
 * The redirect dance needs state/nonce/PKCE-verifier to survive the round-trip to
 * accounts.google.com. They CANNOT ride the session cookie: metalab_session is
 * SameSite=Strict, and Strict cookies are not sent on the cross-site top-level
 * navigation back from Google — the callback request would arrive cookie-less.
 * So the transaction rides its own short-lived cookie:
 *
 *   - SameSite=Lax  — Lax cookies ARE attached to top-level GET navigations, which
 *                     is exactly (and only) what the callback is.
 *   - HttpOnly + Secure(prod) + Path=/api/auth/google — never readable by JS,
 *                     never sent anywhere but the Google auth routes.
 *   - 10-minute expiry + single-use (cleared on every callback).
 *   - HMAC-SHA256 signed (subkey derived from JWT_SECRET) — the callback trusts
 *     NOTHING it didn't sign: sid (the `state` value), nonce, PKCE verifier, the
 *     flow mode, the link-mode user id, and the validated returnTo path.
 *
 * The `state` parameter sent to Google is the cookie's random sid — the callback
 * requires state === sid, which binds the browser session that STARTED the flow
 * to the one FINISHING it (CSRF defense for the cross-site entry point; the
 * app-wide originCheck deliberately lets top-level GETs through).
 */

import crypto from 'crypto';

export const GAUTH_TXN_COOKIE = 'metalab_gauth_txn';
export const GAUTH_TXN_TTL_MS = 10 * 60 * 1000; // 10 minutes — ample for consent

const COOKIE_PATH = '/api/auth/google';

function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  // Domain-separated subkey: a gauth-txn blob can never be confused with (or
  // replayed as) any other JWT_SECRET-signed artifact.
  return crypto.createHmac('sha256', secret).update('gauth-txn-v1').digest();
}

function hmac(data) {
  return crypto.createHmac('sha256', signingKey()).update(data).digest('base64url');
}

/**
 * Validate a post-login redirect target: INTERNAL path only (single leading
 * slash), never an auth page (mirrors the safeFrom whitelist in src/App.jsx —
 * same anti-open-redirect rule, enforced server-side).
 */
export function safeReturnTo(raw) {
  if (typeof raw !== 'string') return null;
  const p = raw.trim();
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\')) return null;
  if (p.length > 512) return null;
  if (/^\/(login|register|reset|verify-email|accept-invitation)(\/|\?|$)/.test(p)) return null;
  return p;
}

/**
 * Mint a new transaction: random sid (the OAuth `state`), nonce, PKCE verifier +
 * S256 challenge, and the signed cookie value carrying them.
 * @param {{mode:'login'|'link', uid?:string|null, returnTo?:string|null}} opts
 */
export function createTxn({ mode = 'login', uid = null, returnTo = null } = {}) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const pkceVerifier = crypto.randomBytes(48).toString('base64url'); // 64 chars — within RFC 7636's 43-128
  const codeChallenge = crypto.createHash('sha256').update(pkceVerifier).digest('base64url');

  const payload = {
    v: 1,
    sid,
    nonce,
    pkce: pkceVerifier,
    mode: mode === 'link' ? 'link' : 'login',
    uid: mode === 'link' ? String(uid || '') : null,
    rt: safeReturnTo(returnTo),
    iat: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { sid, nonce, codeChallenge, cookieValue: `${body}.${hmac(body)}` };
}

/**
 * Verify + decode a transaction cookie. Typed result, never throws.
 * @returns {{ok:true, txn:object} | {ok:false, error:'missing'|'invalid'|'expired'}}
 */
export function verifyTxnCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return { ok: false, error: 'missing' };
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return { ok: false, error: 'invalid' };
  const body = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  let expected;
  try { expected = hmac(body); } catch { return { ok: false, error: 'invalid' }; }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid' };
  let txn;
  try { txn = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, error: 'invalid' }; }
  if (!txn || txn.v !== 1 || !txn.sid || !txn.nonce || !txn.pkce) return { ok: false, error: 'invalid' };
  if (typeof txn.iat !== 'number' || Date.now() - txn.iat > GAUTH_TXN_TTL_MS) return { ok: false, error: 'expired' };
  return { ok: true, txn };
}

/** Cookie attributes for SETTING the transaction cookie (see header rationale). */
export function txnCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: COOKIE_PATH,
    maxAge: GAUTH_TXN_TTL_MS,
  };
}

/** Clear options MUST mirror set options (name + Path) or the clear silently fails. */
export function clearTxnCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: COOKIE_PATH,
  };
}
