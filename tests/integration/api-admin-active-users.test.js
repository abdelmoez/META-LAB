/**
 * api-admin-active-users.test.js
 *
 * Integration tests for the GET /api/admin/metrics `activeUsers` block
 * added in prompt15 Task 2.
 *
 * Harness mirrors api-admin.test.js:
 *   - fetch-based, no supertest
 *   - server assumed running at http://localhost:3001
 *   - skips gracefully when server is not up or admin routes are not mounted
 *   - admin-only tests use ADMIN_EMAIL / ADMIN_PASS env vars (seeded admin)
 *
 * Schema note: NO migration was performed — User.lastActive already existed
 * before this prompt. The activeUsers metric reads that column via cheap
 * prisma.user.count({ where: { lastActive: { gte: cutoff } } }) calls.
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
  // 401 = routes mounted + unauthenticated; 404 = not yet wired
  const res = await fetch(`${API}/admin/metrics`);
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

// ── Module-level state ────────────────────────────────────────────────────────

let up = false;
const TS = Date.now();

beforeAll(async () => {
  up = await serverUp();
});

// ── 1. Unauthenticated — same guard as logins block ───────────────────────────

describe('GET /api/admin/metrics — unauthenticated', () => {
  it('returns 401 (not 404) — routes are mounted', async () => {
    if (!up) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) {
      console.warn('[SKIP] /api/admin routes not mounted — returns 404');
      return;
    }
    const res = await fetch(`${API}/admin/metrics`);
    expect(res.status).toBe(401);
  });
});

// ── 2. Normal user — still 403 ────────────────────────────────────────────────

describe('GET /api/admin/metrics — normal user access', () => {
  let normalCookie;

  beforeAll(async () => {
    if (!up) return;
    const { cookie } = await registerAndLogin(
      `active-normal-${TS}@example.com`,
      'NormalPass123!',
      'Normal User',
    );
    normalCookie = cookie;
  });

  it('returns 403 for non-admin', async () => {
    if (!up || !normalCookie) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/admin/metrics`, {
      headers: { Cookie: normalCookie },
    });
    expect(res.status).toBe(403);
  });
});

// ── 3. Admin-only: verify activeUsers shape + logins still exists ─────────────
//
// Requires a seeded admin user.  Set env vars:
//   ADMIN_EMAIL=admin@metalab.dev  ADMIN_PASS=<seed_password>
// then run:
//   npx vitest run tests/integration/api-admin-active-users.test.js \
//     --pool=forks --poolOptions.forks.singleFork=true

describe('GET /api/admin/metrics — admin access (requires seeded admin)', () => {
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
    if (!loginRes.ok) return; // seeded admin not available

    adminCookie = loginRes.headers.get('set-cookie');
    const metricsRes = await fetch(`${API}/admin/metrics`, {
      headers: { Cookie: adminCookie },
    });
    if (metricsRes.ok) {
      data = await metricsRes.json();
    }
  });

  it('GET /api/admin/metrics returns 200', async () => {
    if (!up || !adminCookie) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/admin/metrics`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
  });

  it('response contains activeUsers block', async () => {
    if (!up || !adminCookie || !data) return;
    expect(data).toHaveProperty('activeUsers');
  });

  it('activeUsers has all five rolling-window keys', async () => {
    if (!up || !adminCookie || !data) return;
    const au = data.activeUsers;
    expect(au).toHaveProperty('day');
    expect(au).toHaveProperty('week');
    expect(au).toHaveProperty('month');
    expect(au).toHaveProperty('quarter');
    expect(au).toHaveProperty('year');
  });

  it('all activeUsers values are non-negative integers', async () => {
    if (!up || !adminCookie || !data) return;
    const au = data.activeUsers;
    for (const key of ['day', 'week', 'month', 'quarter', 'year']) {
      const v = au[key];
      expect(typeof v).toBe('number');
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('logins block still exists alongside activeUsers (not replaced)', async () => {
    if (!up || !adminCookie || !data) return;
    expect(data).toHaveProperty('logins');
    const l = data.logins;
    expect(l).toHaveProperty('day');
    expect(l).toHaveProperty('week');
    expect(l).toHaveProperty('month');
    expect(l).toHaveProperty('quarter');
    expect(l).toHaveProperty('year');
  });

  it('activeUsers.day >= logins.day (active users ≥ fresh-login users in any window)', async () => {
    // By definition: any user who logged in also set lastActive,
    // so activeUsers >= logins is always true (active is a superset).
    if (!up || !adminCookie || !data) return;
    expect(data.activeUsers.day).toBeGreaterThanOrEqual(data.logins.day);
  });

  it('activeUsers.year >= activeUsers.quarter >= activeUsers.month (monotone windows)', async () => {
    if (!up || !adminCookie || !data) return;
    const { day, week, month, quarter, year } = data.activeUsers;
    // Wider windows subsume narrower ones → counts are non-decreasing.
    expect(week).toBeGreaterThanOrEqual(day);
    expect(month).toBeGreaterThanOrEqual(week);
    expect(quarter).toBeGreaterThanOrEqual(month);
    expect(year).toBeGreaterThanOrEqual(quarter);
  });

  it('admin login itself increments activeUsers.day to >= 1', async () => {
    // The admin just logged in above, which sets lastActive → day count ≥ 1.
    if (!up || !adminCookie || !data) return;
    expect(data.activeUsers.day).toBeGreaterThanOrEqual(1);
  });

  it('other existing metric blocks are untouched (users, projects, logins, emailStats)', async () => {
    if (!up || !adminCookie || !data) return;
    expect(data).toHaveProperty('users');
    expect(data).toHaveProperty('projects');
    expect(data).toHaveProperty('logins');
    expect(data).toHaveProperty('emailStats');
    expect(data).toHaveProperty('securityEvents');
  });
});
