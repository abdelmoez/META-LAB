/**
 * turnstile.test.js — 94.md §3.10 — backend Turnstile verification middleware.
 * Global fetch is stubbed per-test and ALWAYS unstubbed (65.md leak gotcha).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requireTurnstile, turnstileEnabled, turnstilePublicSiteKey } from '../../../server/security/turnstile.js';
import { signToken } from '../../../server/auth/jwt.js';
import { sessionCookieName } from '../../../server/config/cookies.js';

const ENV_KEYS = ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_FAIL_OPEN', 'APP_BASE_URL', 'NODE_ENV'];
const saved = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-16chars';
  process.env.TURNSTILE_SITE_KEY = 'site-1';
  process.env.TURNSTILE_SECRET_KEY = 'secret-1';
  delete process.env.TURNSTILE_FAIL_OPEN;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const reqWith = (over = {}) => ({ body: { turnstileToken: 'tok-1' }, cookies: {}, ip: '1.2.3.4', ...over });

function stubSiteverify(result) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (result instanceof Error) throw result;
    return { ok: true, status: 200, json: async () => result };
  }));
}

describe('feature gating', () => {
  it('is enabled only when BOTH keys are set; site key exposed only then', () => {
    expect(turnstileEnabled()).toBe(true);
    expect(turnstilePublicSiteKey()).toBe('site-1');
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileEnabled()).toBe(false);
    expect(turnstilePublicSiteKey()).toBe(null);
  });
  it('passes through untouched when disabled (no fetch, no 403)', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const next = vi.fn(); const res = mockRes();
    stubSiteverify({ success: false });
    await requireTurnstile('register')(reqWith({ body: {} }), res, next);
    expect(next).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('challenge outcomes', () => {
  it('403s a missing token without spending a siteverify round-trip', async () => {
    const next = vi.fn(); const res = mockRes();
    stubSiteverify({ success: true });
    await requireTurnstile('register')(reqWith({ body: {} }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('TURNSTILE_FAILED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('403s on success:false; passes on success:true', async () => {
    let next = vi.fn(); let res = mockRes();
    stubSiteverify({ success: false });
    await requireTurnstile('register')(reqWith(), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();

    next = vi.fn(); res = mockRes();
    stubSiteverify({ success: true });
    await requireTurnstile('register')(reqWith(), res, next);
    expect(next).toHaveBeenCalled();
  });
  it('sends secret+response+remoteip form-encoded', async () => {
    const next = vi.fn();
    stubSiteverify({ success: true });
    await requireTurnstile('register')(reqWith(), mockRes(), next);
    const body = new URLSearchParams(fetch.mock.calls[0][1].body);
    expect(body.get('secret')).toBe('secret-1');
    expect(body.get('response')).toBe('tok-1');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });
});

describe('availability (Cloudflare down)', () => {
  it('fails OPEN by default with one warning', async () => {
    const next = vi.fn(); const res = mockRes();
    stubSiteverify(new Error('ECONNRESET'));
    await requireTurnstile('register')(reqWith(), res, next);
    expect(next).toHaveBeenCalled();
  });
  it('fails CLOSED when TURNSTILE_FAIL_OPEN=false', async () => {
    process.env.TURNSTILE_FAIL_OPEN = 'false';
    const next = vi.fn(); const res = mockRes();
    stubSiteverify(new Error('ECONNRESET'));
    await requireTurnstile('register')(reqWith(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('TURNSTILE_UNAVAILABLE');
  });
});

describe('hostname/action validation (§3.10)', () => {
  it('rejects mismatches in production, warns-through otherwise', async () => {
    process.env.APP_BASE_URL = 'https://pecanrev.com';
    stubSiteverify({ success: true, hostname: 'evil.example', action: 'register' });

    process.env.NODE_ENV = 'production';
    let next = vi.fn(); let res = mockRes();
    await requireTurnstile('register')(reqWith(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);

    process.env.NODE_ENV = 'test';
    next = vi.fn(); res = mockRes();
    await requireTurnstile('register')(reqWith(), res, next);
    expect(next).toHaveBeenCalled();
  });
  it('rejects a token minted for a different widget action in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://pecanrev.com';
    stubSiteverify({ success: true, hostname: 'pecanrev.com', action: 'waitlist_signup' });
    const next = vi.fn(); const res = mockRes();
    await requireTurnstile('register')(reqWith(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('authenticated-session skip (§3.10 — no challenges on normal authed actions)', () => {
  it('skips the challenge for a VALID session cookie (no fetch)', async () => {
    const token = signToken({ id: 'u1', email: 'a@b.c', role: 'user', se: 0 });
    const next = vi.fn();
    stubSiteverify({ success: false }); // would 403 if consulted
    await requireTurnstile('contact')(reqWith({ body: {}, cookies: { [sessionCookieName()]: token } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('still challenges a FORGED session cookie', async () => {
    const next = vi.fn(); const res = mockRes();
    stubSiteverify({ success: false });
    await requireTurnstile('contact')(reqWith({ body: {}, cookies: { [sessionCookieName()]: 'garbage.jwt.here' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
