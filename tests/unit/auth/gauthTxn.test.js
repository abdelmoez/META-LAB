/**
 * gauthTxn.test.js — 94.md §2.1 — the signed OAuth transaction cookie.
 * The callback trusts NOTHING it didn't sign: these tests pin the signature,
 * expiry, single-version and returnTo-whitelist behavior.
 */
import { describe, it, expect, beforeAll, vi, afterAll } from 'vitest';
import {
  createTxn, verifyTxnCookie, txnCookieOptions, clearTxnCookieOptions, safeReturnTo,
  GAUTH_TXN_TTL_MS,
} from '../../../server/auth/gauthTxn.js';

beforeAll(() => { process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-16chars'; });
afterAll(() => { vi.useRealTimers(); });

describe('createTxn / verifyTxnCookie roundtrip', () => {
  it('mints unique sid/nonce/pkce and verifies its own cookie', () => {
    const a = createTxn({ mode: 'login', returnTo: '/app/projects/1' });
    const b = createTxn({ mode: 'login' });
    expect(a.sid).not.toBe(b.sid);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/); // S256 challenge, base64url(32B)

    const v = verifyTxnCookie(a.cookieValue);
    expect(v.ok).toBe(true);
    expect(v.txn.sid).toBe(a.sid);
    expect(v.txn.mode).toBe('login');
    expect(v.txn.uid).toBeNull();          // login mode carries NO user id
    expect(v.txn.rt).toBe('/app/projects/1');
  });
  it('link mode carries the uid (the callback has no session cookie to lean on)', () => {
    const t = createTxn({ mode: 'link', uid: 'user-9' });
    const v = verifyTxnCookie(t.cookieValue);
    expect(v.ok).toBe(true);
    expect(v.txn.mode).toBe('link');
    expect(v.txn.uid).toBe('user-9');
  });
  it('rejects tampered payloads and signatures (timing-safe compare path)', () => {
    const t = createTxn({ mode: 'login' });
    const [body, sig] = [t.cookieValue.slice(0, t.cookieValue.lastIndexOf('.')), t.cookieValue.slice(t.cookieValue.lastIndexOf('.') + 1)];
    // Body swap keeps a syntactically valid cookie but breaks the HMAC.
    const other = createTxn({ mode: 'link', uid: 'attacker' });
    const otherBody = other.cookieValue.slice(0, other.cookieValue.lastIndexOf('.'));
    expect(verifyTxnCookie(`${otherBody}.${sig}`).ok).toBe(false);
    expect(verifyTxnCookie(`${body}.` + sig.slice(0, -2) + 'aa').ok).toBe(false);
    expect(verifyTxnCookie('garbage').ok).toBe(false);
    expect(verifyTxnCookie('').ok).toBe(false);
    expect(verifyTxnCookie(null).ok).toBe(false);
  });
  it('expires after GAUTH_TXN_TTL_MS', () => {
    vi.useFakeTimers();
    try {
      const t = createTxn({ mode: 'login' });
      vi.setSystemTime(Date.now() + GAUTH_TXN_TTL_MS + 1000);
      const v = verifyTxnCookie(t.cookieValue);
      expect(v).toMatchObject({ ok: false, error: 'expired' });
    } finally { vi.useRealTimers(); }
  });
});

describe('safeReturnTo — anti-open-redirect whitelist (mirrors src/App.jsx safeFrom)', () => {
  it('accepts internal non-auth paths only', () => {
    expect(safeReturnTo('/app')).toBe('/app');
    expect(safeReturnTo('/app/projects/3?tab=screening')).toBe('/app/projects/3?tab=screening');
    for (const bad of [
      'https://evil.example/', '//evil.example', '/\\evil', 'app', '',
      '/login', '/register?x=1', '/reset', '/verify-email', '/accept-invitation',
      null, undefined, 42, '/' + 'a'.repeat(600),
    ]) {
      expect(safeReturnTo(bad), String(bad)).toBeNull();
    }
  });
});

describe('cookie attributes', () => {
  it('is Lax (MUST survive the cross-site top-level GET back from Google), scoped + short-lived', () => {
    const set = txnCookieOptions();
    expect(set.sameSite).toBe('lax');       // Strict would never reach the callback
    expect(set.httpOnly).toBe(true);
    expect(set.path).toBe('/api/auth/google');
    expect(set.maxAge).toBe(GAUTH_TXN_TTL_MS);
    // Clear options must mirror name-determining attributes or clearing fails.
    const clear = clearTxnCookieOptions();
    expect(clear.path).toBe(set.path);
    expect(clear.sameSite).toBe(set.sameSite);
  });
});
