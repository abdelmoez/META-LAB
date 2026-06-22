/**
 * cors-cookies.test.js — prompt49 item 6 hardening.
 * The CORS allowlist + delegate (explicit, never wildcard, credential-safe) and
 * the centralised session-cookie attributes (HttpOnly/SameSite/Secure/Path).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolveCorsAllowlist, corsOriginDelegate, resolveCorsOrigin } from '../../../server/config/cors.js';
import { sessionCookieName, sessionCookieOptions, clearSessionCookieOptions } from '../../../server/config/cookies.js';

describe('resolveCorsAllowlist', () => {
  it('parses a comma-separated CORS_ORIGIN (apex + www) and unions APP_BASE_URL', () => {
    const list = resolveCorsAllowlist({
      CORS_ORIGIN: 'https://pecanrev.com, https://www.pecanrev.com',
      APP_BASE_URL: 'https://pecanrev.com',
    });
    expect(list).toContain('https://pecanrev.com');
    expect(list).toContain('https://www.pecanrev.com');
    expect(list.filter((o) => o === 'https://pecanrev.com')).toHaveLength(1); // de-duped
  });

  it('strips trailing slashes so it matches the Origin header', () => {
    expect(resolveCorsAllowlist({ CORS_ORIGIN: 'https://pecanrev.com/' })).toContain('https://pecanrev.com');
  });

  it('defaults to the local dev origin when nothing is set (no prod host baked in)', () => {
    expect(resolveCorsAllowlist({})).toEqual(['http://localhost:3000']);
  });
});

describe('corsOriginDelegate (credential-safe, never wildcard)', () => {
  const env = { CORS_ORIGIN: 'https://pecanrev.com,https://www.pecanrev.com' };
  const decide = (origin) => new Promise((res) => corsOriginDelegate(env)(origin, (_e, allow) => res(allow)));

  it('allows an allowlisted origin', async () => {
    expect(await decide('https://pecanrev.com')).toBe(true);
    expect(await decide('https://www.pecanrev.com')).toBe(true);
  });

  it('rejects an origin not on the allowlist (no error, just no CORS headers)', async () => {
    expect(await decide('https://evil.example')).toBe(false);
  });

  it('allows requests with no Origin header (same-origin / curl / health checks)', async () => {
    expect(await decide(undefined)).toBe(true);
  });

  it('never echoes a wildcard', async () => {
    expect(await decide('*')).toBe(false);
  });
});

describe('resolveCorsOrigin (back-compat single value, unchanged)', () => {
  it('still prefers CORS_ORIGIN, then APP_BASE_URL, then localhost', () => {
    expect(resolveCorsOrigin({ CORS_ORIGIN: 'https://a.example', APP_BASE_URL: 'https://b.example' })).toBe('https://a.example');
    expect(resolveCorsOrigin({ APP_BASE_URL: 'https://b.example' })).toBe('https://b.example');
    expect(resolveCorsOrigin({})).toBe('http://localhost:3000');
  });
});

describe('session cookie attributes', () => {
  const orig = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = orig; });

  it('keeps the internal cookie name metalab_session', () => {
    expect(sessionCookieName()).toBe('metalab_session');
  });

  it('is HttpOnly + SameSite=strict + Path=/ + 7-day maxAge', () => {
    const o = sessionCookieOptions();
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe('strict');
    expect(o.path).toBe('/');
    expect(o.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('is Secure in production, not in development', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionCookieOptions().secure).toBe(true);
    process.env.NODE_ENV = 'development';
    expect(sessionCookieOptions().secure).toBe(false);
  });

  it('clear options mirror set options (name + path + flags) so the cookie actually clears, with no maxAge', () => {
    process.env.NODE_ENV = 'production';
    const clear = clearSessionCookieOptions();
    expect(clear.path).toBe('/');
    expect(clear.httpOnly).toBe(true);
    expect(clear.sameSite).toBe('strict');
    expect(clear.secure).toBe(true);
    expect(clear).not.toHaveProperty('maxAge');
  });
});
