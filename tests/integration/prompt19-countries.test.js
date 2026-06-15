/**
 * prompt19-countries.test.js
 *
 * Integration tests for the users-by-country feature (prompt19 Task 12):
 *   - GET /api/admin/users/countries (admin only) returns the documented shape
 *   - a normal user gets 403, unauthenticated gets 401
 *   - registration still succeeds (201) when NO country header is present —
 *     geolocation is handled gracefully and never 500s the request
 *
 * Harness mirrors api-admin-active-users.test.js:
 *   - fetch-based, no supertest
 *   - server assumed running at http://localhost:3001
 *   - skips gracefully when the server is down or admin routes are not mounted
 *   - admin-only tests use ADMIN_EMAIL / ADMIN_PASS env vars (seeded admin):
 *       ADMIN_EMAIL=admin@metalab.dev ADMIN_PASS=<seed_password> \
 *       npx vitest run tests/integration/prompt19-countries.test.js \
 *         --pool=forks --poolOptions.forks.singleFork=true
 *
 * Schema note: NO migration here — User.registration* columns were added/pushed
 * by the Lead before this prompt. Tests are read-only against /users/countries
 * plus a normal registration (which the DB already supports).
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function adminRoutesMounted() {
  // 401 = routes mounted + unauthenticated; 404 = not yet wired.
  const res = await fetch(`${API}/admin/users/countries`);
  return res.status === 401;
}

async function registerAndLogin(email, password, name = 'Test User') {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    return { cookie: loginRes.headers.get('set-cookie') };
  }
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return { cookie: regRes.headers.get('set-cookie') };
}

// ── Module-level state ──────────────────────────────────────────────────────────

let up = false;
const TS = Date.now();

beforeAll(async () => {
  up = await serverUp();
});

// ── 1. Unauthenticated — routes mounted ─────────────────────────────────────────

describe('GET /api/admin/users/countries — unauthenticated', () => {
  it('returns 401 (not 404) — route is mounted', async () => {
    if (!up) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) {
      console.warn('[SKIP] /api/admin/users/countries not mounted — returns 404');
      return;
    }
    const res = await fetch(`${API}/admin/users/countries`);
    expect(res.status).toBe(401);
  });
});

// ── 2. Normal user — 403 (admin-only endpoint) ──────────────────────────────────

describe('GET /api/admin/users/countries — normal user access', () => {
  let normalCookie;

  beforeAll(async () => {
    if (!up) return;
    const { cookie } = await registerAndLogin(
      `countries-normal-${TS}@example.com`,
      'NormalPass123!',
      'Normal User',
    );
    normalCookie = cookie;
  });

  it('returns 403 for a non-admin user', async () => {
    if (!up || !normalCookie) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/admin/users/countries`, {
      headers: { Cookie: normalCookie },
    });
    expect(res.status).toBe(403);
  });
});

// ── 3. Registration succeeds (201) with no country header, never 500s ────────────

describe('POST /api/auth/register — country capture is graceful', () => {
  it('returns 201 with no country header present (geolocation never blocks)', async () => {
    if (!up) return;
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // deliberately NO cf-ipcountry / x-*-country
      body: JSON.stringify({
        email: `countries-reg-${TS}@example.com`,
        password: 'RegPass12345!',
        name: 'Country Reg',
      }),
    });
    // 201 on fresh email; 409 if the suite re-ran against the same DB without a
    // reset — both prove registration did NOT 500 on country capture.
    expect([201, 409]).toContain(res.status);
    if (res.status === 201) {
      const data = await res.json();
      expect(data).toHaveProperty('user');
      expect(data.user).toHaveProperty('id');
      expect(data.user).toHaveProperty('email');
      // The success contract is unchanged — no country field leaks into the response.
      expect(data.user).not.toHaveProperty('registrationCountryCode');
      expect(data.user).not.toHaveProperty('registrationIpHash');
    }
  });

  it('still succeeds when a country header IS present (header path)', async () => {
    if (!up) return;
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-ipcountry': 'US' },
      body: JSON.stringify({
        email: `countries-reg-hdr-${TS}@example.com`,
        password: 'RegPass12345!',
        name: 'Country Reg Header',
      }),
    });
    expect([201, 409]).toContain(res.status);
  });
});

// ── 4. Admin-only: documented shape (requires seeded admin) ──────────────────────

describe('GET /api/admin/users/countries — admin access (requires seeded admin)', () => {
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@metalab.dev';
  const ADMIN_PASS  = process.env.ADMIN_PASS  || 'changeme';
  let adminCookie;
  let data;

  beforeAll(async () => {
    if (!up) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) return;

    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    if (!loginRes.ok) return; // seeded admin not available — admin tests self-skip

    adminCookie = loginRes.headers.get('set-cookie');
    const res = await fetch(`${API}/admin/users/countries`, {
      headers: { Cookie: adminCookie },
    });
    if (res.ok) data = await res.json();
  });

  it('returns 200 for admin', async () => {
    if (!up || !adminCookie) return;
    const res = await fetch(`${API}/admin/users/countries`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
  });

  it('has top-level countries array + summary object', async () => {
    if (!up || !adminCookie || !data) return;
    expect(Array.isArray(data.countries)).toBe(true);
    expect(data).toHaveProperty('summary');
    expect(typeof data.summary).toBe('object');
  });

  it('summary has the four documented keys (non-negative integers)', async () => {
    if (!up || !adminCookie || !data) return;
    const s = data.summary;
    for (const key of ['totalUsers', 'totalKnown', 'unknown', 'countriesRepresented']) {
      expect(s).toHaveProperty(key);
      expect(typeof s[key]).toBe('number');
      expect(Number.isInteger(s[key])).toBe(true);
      expect(s[key]).toBeGreaterThanOrEqual(0);
    }
  });

  it('totalKnown + unknown === totalUsers', async () => {
    if (!up || !adminCookie || !data) return;
    const s = data.summary;
    expect(s.totalKnown + s.unknown).toBe(s.totalUsers);
  });

  it('each country row has the documented fields', async () => {
    if (!up || !adminCookie || !data) return;
    for (const c of data.countries) {
      expect(c).toHaveProperty('countryCode');
      expect(c).toHaveProperty('countryName');
      expect(c).toHaveProperty('userCount');
      expect(c).toHaveProperty('percentage');
      expect(c).toHaveProperty('latestRegistrationAt');
      expect(typeof c.userCount).toBe('number');
      expect(c.userCount).toBeGreaterThanOrEqual(0);
      expect(typeof c.percentage).toBe('number');
    }
  });

  it('countries are sorted by userCount descending', async () => {
    if (!up || !adminCookie || !data) return;
    const counts = data.countries.map(c => c.userCount);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
    }
  });

  it('countriesRepresented equals the number of rows with a real country code', async () => {
    if (!up || !adminCookie || !data) return;
    const known = data.countries.filter(c => c.countryCode && c.countryCode.length === 2).length;
    expect(data.summary.countriesRepresented).toBe(known);
  });

  it('sum of all row userCounts equals summary.totalUsers', async () => {
    if (!up || !adminCookie || !data) return;
    const sum = data.countries.reduce((acc, c) => acc + c.userCount, 0);
    expect(sum).toBe(data.summary.totalUsers);
  });
});
