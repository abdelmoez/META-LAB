/**
 * api-google-auth.test.js — 94.md — integration tests for the Google OAuth
 * surface, run OUT-OF-PROCESS against the live dev server on 127.0.0.1:3001
 * (house convention: `npm run server` first; suite skips when it is down, with
 * an anti-vacuous-green guard as T1).
 *
 * Google itself is NEVER contacted: these tests cover the surface that needs no
 * IdP — redirect construction, transaction-cookie handling, callback parameter
 * validation, error mapping, auth gating and cache headers. The full mocked-IdP
 * flow coverage (registration/login/linking/invitation against a stub issuer via
 * the GOOGLE_*_URL test-only overrides) lives in the unit suites + the e2e drive
 * documented in docs/manager/google-oauth-setup.md.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Never 'localhost' — node fetch can resolve ::1 and hang on Windows. The env
// override lets an isolated worktree run this suite against its own server
// instance without fighting the shared dev server for port 3001.
const BASE = `${process.env.GAUTH_TEST_BASE || 'http://127.0.0.1:3001'}/api`;
const rnd = () => Math.random().toString(36).slice(2, 10);

let up = false;
let googleConfigured = false;

async function api(path, { method = 'GET', body, cookie, redirect = 'manual' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect,
  });
  let json = null;
  try { json = await res.clone().json(); } catch { /* redirects/streams have no json */ }
  return { res, json };
}

const cookieFrom = (res, name = 'metalab_session') => {
  const all = res.headers.getSetCookie?.() || [];
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0] : null;
};

async function register() {
  const email = `gauth-${rnd()}@example.com`;
  const password = 'integration-pass-1234';
  const { res } = await api('/auth/register', { method: 'POST', body: { email, password, name: 'GAuth Tester' } });
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
  return { email, password, cookie: cookieFrom(res) };
}

beforeAll(async () => {
  try {
    const r = await fetch(`${BASE}/health`);
    up = r.ok;
    if (up) {
      const s = await (await fetch(`${BASE}/settings/public`)).json();
      googleConfigured = !!s.googleAuthEnabled;
    }
  } catch { up = false; }
});

describe('google auth surface (94.md)', () => {
  it('T1 server reachable (anti-vacuous guard — start `npm run server` if this fails)', () => {
    expect(up).toBe(true);
  });

  it('GET /auth/google/start → 302 with no-store, and a txn cookie when configured', async () => {
    if (!up) return;
    const { res } = await api('/auth/google/start');
    expect(res.status).toBe(302);
    expect((res.headers.get('cache-control') || '').toLowerCase()).toContain('no-store');
    const loc = res.headers.get('location') || '';
    if (googleConfigured) {
      // Redirect to the (real or test-override) authorize endpoint with the
      // full code+PKCE parameter set, and the Lax txn cookie is minted.
      expect(loc).toMatch(/response_type=code/);
      expect(loc).toMatch(/code_challenge_method=S256/);
      expect(loc).toMatch(/state=/);
      expect(loc).toMatch(/nonce=/);
      const txn = cookieFrom(res, 'metalab_gauth_txn');
      expect(txn).toBeTruthy();
      const raw = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith('metalab_gauth_txn='));
      expect(raw).toMatch(/SameSite=Lax/i);        // Strict would never survive the return hop
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/Path=\/api\/auth\/google/i);
    } else {
      expect(loc).toContain('googleError=GOOGLE_NOT_CONFIGURED');
    }
  });

  it('start?returnTo rejects external/auth-page targets (anti-open-redirect)', async () => {
    if (!up || !googleConfigured) return;
    // The returnTo only surfaces at callback time, but the txn cookie is minted at
    // start — a hostile returnTo must not round-trip. We can at least assert the
    // start still 302s to Google (not to the hostile URL) for junk values.
    for (const rt of ['https://evil.example', '//evil.example', '/login']) {
      const { res } = await api(`/auth/google/start?returnTo=${encodeURIComponent(rt)}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).not.toContain('evil.example');
    }
  });

  it('callback without a transaction cookie → error redirect, never a session', async () => {
    if (!up) return;
    const { res } = await api('/auth/google/callback?code=x&state=y');
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') || '';
    expect(loc).toContain('googleError=');
    expect(cookieFrom(res)).toBeNull(); // no metalab_session minted
  });

  it('callback with a garbage transaction cookie → error redirect + cookie cleared', async () => {
    if (!up) return;
    const { res } = await api('/auth/google/callback?code=x&state=y', { cookie: 'metalab_gauth_txn=AAAA.BBBB' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('googleError=');
    const cleared = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith('metalab_gauth_txn='));
    expect(cleared).toBeTruthy(); // single-use: always cleared on callback
  });

  it('callback ?error=access_denied → GOOGLE_DENIED (no provider details leak)', async () => {
    if (!up || !googleConfigured) return;
    // Mint a REAL txn cookie via start so the callback reaches the error branch
    // with mode context, then simulate the user cancelling on Google's screen.
    const start = await api('/auth/google/start');
    const txn = cookieFrom(start.res, 'metalab_gauth_txn');
    const { res } = await api('/auth/google/callback?error=access_denied', { cookie: txn });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') || '';
    expect(loc).toContain('googleError=GOOGLE_DENIED');
    expect(loc).not.toMatch(/access_denied|token|state=/); // only OUR code rides the URL
  });

  it('link/start + unlink + profile/security require authentication', async () => {
    if (!up) return;
    expect((await api('/auth/google/link/start', { method: 'POST' })).res.status).toBe(401);
    expect((await api('/auth/google/unlink', { method: 'POST' })).res.status).toBe(401);
    expect((await api('/profile/security')).res.status).toBe(401);
  });

  it('profile/security reports hasPassword+providers for a password account; unlink is idempotent', async () => {
    if (!up) return;
    const u = await register();
    const sec = await api('/profile/security', { cookie: u.cookie });
    expect(sec.res.status).toBe(200);
    expect(sec.json).toMatchObject({ hasPassword: true, providers: [] });
    // No Google linked → unlink is an idempotent 200 (nothing to remove).
    const un = await api('/auth/google/unlink', { method: 'POST', cookie: u.cookie });
    expect(un.res.status).toBe(200);
    expect(un.json).toMatchObject({ ok: true });
  });

  it('link/start (authed) returns a Google URL + link-mode txn cookie when configured', async () => {
    if (!up) return;
    const u = await register();
    const { res, json } = await api('/auth/google/link/start', { method: 'POST', cookie: u.cookie });
    if (!googleConfigured) {
      expect(res.status).toBe(503);
      expect(json?.code).toBe('GOOGLE_NOT_CONFIGURED');
      return;
    }
    expect(res.status).toBe(200);
    expect(json?.url).toMatch(/response_type=code/);
    expect(cookieFrom(res, 'metalab_gauth_txn')).toBeTruthy();
  });

  it('password login still works for password accounts (regression, 94.md §7)', async () => {
    if (!up) return;
    const u = await register();
    const { res } = await api('/auth/login', { method: 'POST', body: { email: u.email, password: u.password } });
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toBeTruthy();
  });

  it('public settings expose the two frontend availability flags', async () => {
    if (!up) return;
    const { res, json } = await api('/settings/public');
    expect(res.status).toBe(200);
    expect(typeof json.googleAuthEnabled).toBe('boolean');
    expect('turnstileSiteKey' in json).toBe(true);
  });
});
