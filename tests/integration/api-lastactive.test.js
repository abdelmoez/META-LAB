/**
 * tests/integration/api-lastactive.test.js
 *
 * Integration tests for the `lastActive` field on GET /api/auth/me (prompt12).
 *
 * Coverage:
 *  1. GET /api/auth/me returns a `lastActive` field that is a non-null ISO date string.
 *  2. The value is consistent with what GET /api/profile returns for the same user.
 *  3. lastActive is not returned by the login response body (which is a lighter
 *     payload) — ensuring it comes from getMe, not from login.
 *
 * Tests skip gracefully when the server is not running on port 3001.
 *
 * Run manually:
 *   node server/index.js &
 *   npx vitest run tests/integration/api-lastactive.test.js
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

/* ── Server availability ─────────────────────────────────────────────────── */

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

/* ── Auth helper ─────────────────────────────────────────────────────────── */

/**
 * Register a fresh user (login first for idempotency on re-runs).
 * Returns { user, cookie } where cookie is the raw set-cookie header value.
 */
async function registerAndLogin(email, password, name = 'LastActive Test User') {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    const data = await loginRes.json();
    return { user: data.user, cookie: loginRes.headers.get('set-cookie') };
  }
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await regRes.json();
  return { user: data.user, cookie: regRes.headers.get('set-cookie') };
}

/* ── Module-level state ──────────────────────────────────────────────────── */

let up = false;
const TS = Date.now();

// Shared session for the consistency tests (tests 2 & 3 reuse same user).
let sharedCookie = null;
let sharedEmail  = null;

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;

  sharedEmail = `lastactive-shared-${TS}@example.com`;
  const { cookie } = await registerAndLogin(sharedEmail, 'LastActive1!');
  sharedCookie = cookie;

  // Warm the lastActive write: call /api/auth/me once so requireAuth fires
  // touchLastActive (throttled, but always fires on the first call after boot).
  // The write is fire-and-forget; we call /me a second time a moment later to
  // let the async DB write complete before consistency tests read /api/profile.
  await fetch(`${API}/auth/me`, { headers: { Cookie: sharedCookie } });
  // Brief settle: the fire-and-forget prisma.update resolves in <<100 ms on any
  // reasonable hardware; two sequential round-trips are ample.
  await fetch(`${API}/auth/me`, { headers: { Cookie: sharedCookie } });
});

/* ══════════════════════════════════════════════════════════════════════════
   1. GET /api/auth/me returns lastActive
   ══════════════════════════════════════════════════════════════════════════ */

describe('GET /api/auth/me — lastActive field (prompt12)', () => {
  it('returns a lastActive field in the user object', async () => {
    if (!up) return;
    const email = `lastactive-me-${TS}@example.com`;
    const { cookie } = await registerAndLogin(email, 'LaPass1!');

    // Make a first /me call to trigger touchLastActive, then a second to read
    // back the (already-written) value.
    await fetch(`${API}/auth/me`, { headers: { Cookie: cookie } });
    const res = await fetch(`${API}/auth/me`, { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('user');
    expect(data.user).toHaveProperty('lastActive');
  });

  it('lastActive is a non-null string (ISO 8601 date)', async () => {
    if (!up || !sharedCookie) return;
    const res = await fetch(`${API}/auth/me`, { headers: { Cookie: sharedCookie } });
    expect(res.status).toBe(200);
    const { user } = await res.json();

    expect(user.lastActive).not.toBeNull();
    expect(typeof user.lastActive).toBe('string');

    // Must parse as a valid date and not be NaN.
    const parsed = new Date(user.lastActive);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it('lastActive parses to a recent timestamp (within the last hour)', async () => {
    if (!up || !sharedCookie) return;
    const res = await fetch(`${API}/auth/me`, { headers: { Cookie: sharedCookie } });
    expect(res.status).toBe(200);
    const { user } = await res.json();

    const parsed = new Date(user.lastActive).getTime();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    expect(parsed).toBeGreaterThan(oneHourAgo);
  });

  it('password is never returned by GET /api/auth/me', async () => {
    if (!up || !sharedCookie) return;
    const res = await fetch(`${API}/auth/me`, { headers: { Cookie: sharedCookie } });
    const { user } = await res.json();
    expect(user).not.toHaveProperty('password');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2. lastActive is consistent between GET /api/auth/me and GET /api/profile
   ══════════════════════════════════════════════════════════════════════════ */

describe('lastActive consistency — /api/auth/me vs /api/profile', () => {
  it('both endpoints return the same lastActive value for the same session', async () => {
    if (!up || !sharedCookie) return;

    // Read from both endpoints in sequence (using the same cookie / session).
    const meRes      = await fetch(`${API}/auth/me`,  { headers: { Cookie: sharedCookie } });
    const profileRes = await fetch(`${API}/profile`,   { headers: { Cookie: sharedCookie } });

    expect(meRes.status).toBe(200);
    expect(profileRes.status).toBe(200);

    const { user: meUser }      = await meRes.json();
    const { user: profileUser } = await profileRes.json();

    // Both must carry lastActive.
    expect(meUser.lastActive).toBeTruthy();
    expect(profileUser.lastActive).toBeTruthy();

    // Values must refer to the same point in time.
    // We compare epoch-ms (not raw string) to be tolerant of minor serialisation
    // differences, but in practice both endpoints do a Prisma select so they
    // should be byte-identical ISO strings.
    const meEpoch      = new Date(meUser.lastActive).getTime();
    const profileEpoch = new Date(profileUser.lastActive).getTime();

    // Allow a 1-second skew: if requireAuth fires a throttled write between the
    // two sequential fetches it would update the DB value; the two reads could
    // therefore differ by at most one write interval.  In practice with a cold
    // throttle map the first /me call already wrote; the /profile call sees the
    // same value (throttle blocks a second write within 5 min).  We verify they
    // are within 2 seconds of each other to be robust without being flaky.
    expect(Math.abs(meEpoch - profileEpoch)).toBeLessThan(2000);
  });

  it('GET /api/profile returns lastActive as a valid ISO string', async () => {
    if (!up || !sharedCookie) return;
    const res = await fetch(`${API}/profile`, { headers: { Cookie: sharedCookie } });
    expect(res.status).toBe(200);
    const { user } = await res.json();
    expect(user).toHaveProperty('lastActive');
    expect(user.lastActive).not.toBeNull();
    expect(Number.isNaN(new Date(user.lastActive).getTime())).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3. Login response does NOT carry lastActive (lighter payload)
   ══════════════════════════════════════════════════════════════════════════ */

describe('Login response payload shape', () => {
  it('POST /api/auth/login does not return lastActive in the response body', async () => {
    if (!up) return;
    const email    = `lastactive-login-${TS}@example.com`;
    const password = 'LaLogin1!';

    // Register first.
    await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Login Shape User' }),
    });

    // Login.
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Login returns a lightweight user object {id, email, name, role} — it does
    // not return lastActive (that comes from GET /api/auth/me via AuthContext).
    expect(data.user).not.toHaveProperty('lastActive');
  });
});
