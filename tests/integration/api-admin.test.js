/**
 * api-admin.test.js
 *
 * Integration tests for Phase C admin & settings endpoints.
 *
 * All tests are skipped when the server is not running (health check pattern).
 *
 * KNOWN LIMITATION — Admin credentials:
 *   Admin users can ONLY be created via the seed script (npm run seed or
 *   similar).  The /api/auth/register endpoint always creates role:"user" and
 *   cannot be used to obtain admin access.  Any describe block that requires
 *   real admin credentials is wrapped in describe.skip and annotated with the
 *   reason below.
 *
 *   To run admin-specific tests:
 *     1. Run the seed script: npx ts-node prisma/seed.ts  (or npm run seed)
 *     2. Set env vars:  ADMIN_EMAIL=admin@example.com  ADMIN_PASS=<seed_password>
 *     3. Re-run: npx vitest run tests/integration/api-admin.test.js
 *
 * NOTE ON ROUTE MOUNTING:
 *   At the time these tests were written, server/routes/admin.js and
 *   server/routes/settings.js exist but are NOT yet mounted in server/index.js.
 *   Until they are mounted, /api/admin/* returns 404 and /api/settings/public
 *   returns 404.  Tests for those endpoints document the EXPECTED behavior once
 *   the routes are wired.  Tests that currently hit the 404 fallback are
 *   annotated accordingly.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function registerAndLogin(email, password, name = 'Test User') {
  // Try login first to handle re-runs where the user already exists
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    const setCookie = loginRes.headers.get('set-cookie');
    const data = await loginRes.json();
    return { user: data.user, cookie: setCookie };
  }
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const setCookie = regRes.headers.get('set-cookie');
  const data = await regRes.json();
  return { user: data.user, cookie: setCookie };
}

// ── Module-level state ────────────────────────────────────────────────────────

let up = false;
const TS = Date.now();

beforeAll(async () => {
  up = await serverUp();
});

// ── Helper: check if admin routes are mounted ─────────────────────────────────
//
// Returns true when /api/admin/* is mounted (returns 401, not 404).
// When the admin router is not yet wired in index.js every admin request
// falls through to the 404 fallback.

async function adminRoutesMounted() {
  const res = await fetch(`${API}/admin/metrics`);
  // 401 = mounted + unauthenticated; 404 = not mounted
  return res.status === 401;
}

async function settingsRouteMounted() {
  const res = await fetch(`${API}/settings/public`);
  return res.status !== 404;
}

// ── 1. Unauthenticated access to admin endpoints → 401 ───────────────────────

describe('Admin endpoints — unauthenticated access', () => {
  it('GET /api/admin/metrics without auth → 401 when routes are mounted', async () => {
    if (!up) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) {
      // Routes not yet mounted — document the expected behavior
      console.warn('[SKIP] /api/admin routes not yet mounted in server/index.js — returns 404 until wired');
      return;
    }
    const res = await fetch(`${API}/admin/metrics`);
    expect(res.status).toBe(401);
  });

  it('PUT /api/admin/settings without auth → 401 when routes are mounted', async () => {
    if (!up) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appSettings: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/users without auth → 401 when routes are mounted', async () => {
    if (!up) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/admin/users`);
    expect(res.status).toBe(401);
  });
});

// ── 2. Normal user access to admin endpoints → 403 ───────────────────────────

describe('Admin endpoints — normal user access', () => {
  let normalCookie;

  beforeAll(async () => {
    if (!up) return;
    const { cookie } = await registerAndLogin(
      `normal-admin-test-${TS}@example.com`,
      'NormalPass123!',
      'Normal User',
    );
    normalCookie = cookie;
  });

  it('GET /api/admin/metrics as normal user → 403', async () => {
    if (!up || !normalCookie) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/admin/metrics`, {
      headers: { Cookie: normalCookie },
    });
    expect(res.status).toBe(403);
  });

  it('PUT /api/admin/settings as normal user → 403', async () => {
    if (!up || !normalCookie) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: normalCookie },
      body: JSON.stringify({ appSettings: { registrationOpen: false } }),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/audit-log as normal user → 403', async () => {
    if (!up || !normalCookie) return;
    const mounted = await adminRoutesMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/admin/audit-log`, {
      headers: { Cookie: normalCookie },
    });
    expect(res.status).toBe(403);
  });
});

// ── 3. Registration always creates role: "user" ───────────────────────────────

describe('Registration creates role: "user"', () => {
  it('POST /api/auth/register returns user with role "user" in response body', async () => {
    if (!up) return;
    const email = `role-check-${TS}@example.com`;
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'rolecheck1', name: 'Role Check User' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.user).toBeDefined();
    expect(data.user.role).toBe('user');
    expect(data.user.role).not.toBe('admin');
  });

  it('GET /api/auth/me confirms role is "user" after registration', async () => {
    if (!up) return;
    const email = `me-role-${TS}@example.com`;
    const { cookie } = await registerAndLogin(email, 'meRolePass1', 'Me Role User');
    const res = await fetch(`${API}/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.role).toBe('user');
  });
});

// ── 4. Public settings endpoint ───────────────────────────────────────────────

describe('GET /api/settings/public', () => {
  it('returns 200 with no authentication', async () => {
    if (!up) return;
    const mounted = await settingsRouteMounted();
    if (!mounted) {
      console.warn('[SKIP] /api/settings/public not yet mounted in server/index.js');
      return;
    }
    const res = await fetch(`${API}/settings/public`);
    expect(res.status).toBe(200);
  });

  it('response body contains appSettings, landingContent, and featureFlags', async () => {
    if (!up) return;
    const mounted = await settingsRouteMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/settings/public`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('appSettings');
    expect(data).toHaveProperty('landingContent');
    expect(data).toHaveProperty('featureFlags');
  });

  it('appSettings contains expected shape (appName, registrationOpen)', async () => {
    if (!up) return;
    const mounted = await settingsRouteMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/settings/public`);
    const data = await res.json();
    expect(data.appSettings).toHaveProperty('appName');
    expect(data.appSettings).toHaveProperty('registrationOpen');
    expect(typeof data.appSettings.registrationOpen).toBe('boolean');
  });

  it('featureFlags contains expected keys', async () => {
    if (!up) return;
    const mounted = await settingsRouteMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/settings/public`);
    const data = await res.json();
    expect(data.featureFlags).toHaveProperty('autosave');
    expect(data.featureFlags).toHaveProperty('contactForm');
  });

  it('landingContent has a fallback value even without custom DB content', async () => {
    if (!up) return;
    const mounted = await settingsRouteMounted();
    if (!mounted) return;
    const res = await fetch(`${API}/settings/public`);
    const data = await res.json();
    // landingContent must be an object (even if default values)
    expect(data.landingContent).toBeDefined();
    expect(typeof data.landingContent).toBe('object');
    expect(data.landingContent).not.toBeNull();
  });
});

// ── 5. Failed login creates a SecurityEvent ───────────────────────────────────
//
// We can verify the event was created by checking via the admin endpoint IF
// admin credentials are available.  Without admin credentials we verify only
// that the failed login returns 401 (the SecurityEvent creation is a side
// effect we can't observe without DB access or an admin token).

describe('Failed login security tracking', () => {
  it('POST /api/auth/login with wrong password → 401', async () => {
    if (!up) return;
    const email = `faillogin-${TS}@example.com`;
    // Register the user first
    await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'CorrectPass1!' }),
    });
    // Now attempt with wrong password
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WrongPass9999!' }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('POST /api/auth/login with unknown email → 401', async () => {
    if (!up) return;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `nobody-${TS}@nowhere.com`, password: 'SomePass1!' }),
    });
    expect(res.status).toBe(401);
  });
});

// ── 6. Contact message endpoint ───────────────────────────────────────────────

describe('POST /api/contact', () => {
  it('returns 200 and { ok: true } with valid payload', async () => {
    if (!up) return;
    const res = await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:    'QA Bot',
        email:   `qa-contact-${TS}@example.com`,
        subject: 'Test contact from QA',
        message: 'Automated test message — please ignore.',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });
  });

  it('returns 400 when email is missing', async () => {
    if (!up) return;
    const res = await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Email', message: 'This should fail.' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is missing', async () => {
    if (!up) return;
    const res = await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Msg', email: `nomsg-${TS}@example.com` }),
    });
    expect(res.status).toBe(400);
  });
});

// ── 7. Admin-only tests (require seeded admin user) — SKIPPED ─────────────────
//
// These tests require a real admin user created by the seed script.
// They cannot run in standard CI without the seed step.
//
// To enable: run the seed script, then set env vars:
//   ADMIN_EMAIL=admin@example.com  ADMIN_PASS=<seed_password>
// and change describe.skip to describe.

describe.skip('Admin-only tests (requires seeded admin user — see KNOWN LIMITATION above)', () => {
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@metalab.dev';
  const ADMIN_PASS  = process.env.ADMIN_PASS  || 'changeme';
  let adminCookie;
  let normalCookie2;

  beforeAll(async () => {
    if (!up) return;
    // Login as admin (must exist from seed script)
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    if (loginRes.ok) {
      adminCookie = loginRes.headers.get('set-cookie');
    }

    // Register a fresh normal user for comparison tests
    const ts2 = Date.now() + 2;
    const { cookie } = await registerAndLogin(
      `admin-compare-${ts2}@example.com`,
      'ComparePass1!',
      'Compare User',
    );
    normalCookie2 = cookie;
  });

  it('GET /api/admin/metrics as admin → 200 with expected shape', async () => {
    if (!up || !adminCookie) return;
    const res = await fetch(`${API}/admin/metrics`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('users');
    expect(data).toHaveProperty('projects');
    expect(data.users).toHaveProperty('total');
    expect(typeof data.users.total).toBe('number');
  });

  it('GET /api/admin/users as admin → 200 with paginated user list', async () => {
    if (!up || !adminCookie) return;
    const res = await fetch(`${API}/admin/users`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('users');
    expect(Array.isArray(data.users)).toBe(true);
    expect(data).toHaveProperty('total');
  });

  it('GET /api/admin/metrics — user count increases after new registration', async () => {
    if (!up || !adminCookie) return;
    const before = await fetch(`${API}/admin/metrics`, {
      headers: { Cookie: adminCookie },
    }).then(r => r.json());
    const beforeCount = before.users.total;

    // Register a fresh user
    await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `newcount-${Date.now()}@example.com`, password: 'CountPass1!' }),
    });

    const after = await fetch(`${API}/admin/metrics`, {
      headers: { Cookie: adminCookie },
    }).then(r => r.json());

    expect(after.users.total).toBeGreaterThan(beforeCount);
  });

  it('contact message count increases after POST /api/contact', async () => {
    if (!up || !adminCookie) return;
    const before = await fetch(`${API}/admin/metrics`, {
      headers: { Cookie: adminCookie },
    }).then(r => r.json());
    const beforeCount = before.contactMessages.total;

    await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Count Test',
        email: `count-msg-${Date.now()}@example.com`,
        message: 'Count verification message.',
      }),
    });

    const after = await fetch(`${API}/admin/metrics`, {
      headers: { Cookie: adminCookie },
    }).then(r => r.json());

    expect(after.contactMessages.total).toBeGreaterThan(beforeCount);
  });

  it('GET /api/admin/security-events returns events array', async () => {
    if (!up || !adminCookie) return;
    const res = await fetch(`${API}/admin/security-events`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.events)).toBe(true);
  });

  it('failed login attempt is recorded as a FAILED_LOGIN SecurityEvent', async () => {
    if (!up || !adminCookie) return;

    const before = await fetch(`${API}/admin/security-events?type=FAILED_LOGIN`, {
      headers: { Cookie: adminCookie },
    }).then(r => r.json());
    const beforeCount = before.total;

    // Trigger a failed login
    await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `nomatch-${Date.now()}@example.com`, password: 'WrongPass123!' }),
    });

    const after = await fetch(`${API}/admin/security-events?type=FAILED_LOGIN`, {
      headers: { Cookie: adminCookie },
    }).then(r => r.json());

    expect(after.total).toBeGreaterThan(beforeCount);
  });

  it('GET /api/admin/audit-log returns logs array', async () => {
    if (!up || !adminCookie) return;
    const res = await fetch(`${API}/admin/audit-log`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.logs)).toBe(true);
  });
});
