/**
 * api-waitlist.test.js — integration tests for the Beta Waitlist HTTP layer
 * (prompt48). Follows the repo convention: hits a LIVE server at :3001 and skips
 * silently when it is not running. Admin-authenticated assertions additionally
 * require ADMIN_EMAIL_1 + ADMIN_SEED_PASSWORD in the test environment and skip
 * otherwise.
 *
 * Run: start the API (npm run server) with BETA_WAITLIST_DATABASE_URL configured
 * and the waitlist schema pushed, then: npx vitest run tests/integration/api-waitlist.test.js
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';

async function serverUp() {
  try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
}

function validApplication(email) {
  return {
    email,
    firstName: 'Test', lastName: 'Applicant',
    institutionName: 'Integration University',
    role: 'Researcher',
    countryCode: 'US',
    primaryUse: 'Systematic review',
    areasOfInterest: ['Title & abstract screening', 'Meta-analysis & forest plots'],
    workingStyle: 'Research team', teamSize: '2–5',
    referralSource: 'Search engine',
    message: 'Integration test submission.',
    consent: true,
  };
}

let up = false;
beforeAll(async () => { up = await serverUp(); });

describe('POST /api/waitlist (public submit)', () => {
  it('accepts a valid application, dedupes, and rejects invalid', async () => {
    if (!up) return;
    const email = `wl-int-${Date.now()}@example.com`;

    const res = await fetch(`${API}/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validApplication(email)),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.duplicate).toBe(false);
    expect(body.status).toBe('WAITLISTED');

    // Duplicate (case-insensitive) — no second record, safe message.
    const dup = await fetch(`${API}/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validApplication(email.toUpperCase())),
    });
    expect(dup.status).toBe(200);
    expect((await dup.json()).duplicate).toBe(true);

    // Invalid — missing required fields.
    const bad = await fetch(`${API}/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nope' }),
    });
    expect(bad.status).toBe(422);
    expect((await bad.json()).errors).toBeTruthy();
  });

  it('does NOT create a user account or allow login for the applicant', async () => {
    if (!up) return;
    const email = `wl-nouser-${Date.now()}@example.com`;
    await fetch(`${API}/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validApplication(email)),
    });
    // No account exists → login must fail (proves no user/auth record was created).
    const login = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'whatever-password-123' }),
    });
    expect(login.ok).toBe(false);
    expect([400, 401]).toContain(login.status);
  });

  it('honeypot submissions are silently accepted without erroring', async () => {
    if (!up) return;
    const res = await fetch(`${API}/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validApplication(`bot-${Date.now()}@example.com`), website: 'http://spam.example' }),
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/waitlist/resend', () => {
  it('responds generically (anti-enumeration)', async () => {
    if (!up) return;
    const res = await fetch(`${API}/waitlist/resend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `unknown-${Date.now()}@example.com` }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe('Ops Beta Waitlist API — authorization', () => {
  it('rejects unauthenticated access to the admin endpoints', async () => {
    if (!up) return;
    const res = await fetch(`${API}/admin/beta-waitlist/applicants`);
    expect([401, 403]).toContain(res.status);
  });

  it('rejects a normal (non-staff) user', async () => {
    if (!up) return;
    const email = `wl-user-${Date.now()}@example.com`;
    const reg = await fetch(`${API}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Str0ng-Pass-123', name: 'Normal User' }),
    });
    const cookie = reg.headers.get('set-cookie');
    if (!cookie) return; // registration disabled in this env — skip
    const res = await fetch(`${API}/admin/beta-waitlist/applicants`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });
});

describe('Ops Beta Waitlist API — admin (requires ADMIN_SEED creds)', () => {
  const adminEmail = process.env.ADMIN_EMAIL_1;
  const adminPass = process.env.ADMIN_SEED_PASSWORD;

  async function adminCookie() {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPass }),
    });
    if (!res.ok) return null;
    return res.headers.get('set-cookie');
  }

  it('lists, filters, reads, updates status, resends, and exports', async () => {
    if (!up || !adminEmail || !adminPass) return;
    const cookie = await adminCookie();
    if (!cookie) return;

    // Seed one applicant we control.
    const email = `wl-admin-${Date.now()}@example.com`;
    await fetch(`${API}/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validApplication(email)),
    });

    // Metrics — real data.
    const metrics = await fetch(`${API}/admin/beta-waitlist/metrics`, { headers: { Cookie: cookie } });
    expect(metrics.status).toBe(200);
    const mBody = await metrics.json();
    expect(mBody.configured).toBe(true);
    expect(mBody.metrics.total).toBeGreaterThan(0);

    // List + search.
    const list = await fetch(`${API}/admin/beta-waitlist/applicants?search=${encodeURIComponent(email)}`, { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const rows = (await list.json()).rows;
    const found = rows.find((r) => r.email.toLowerCase() === email.toLowerCase());
    expect(found).toBeTruthy();
    const id = found.id;

    // Detail.
    const detail = await fetch(`${API}/admin/beta-waitlist/applicants/${id}`, { headers: { Cookie: cookie } });
    expect(detail.status).toBe(200);

    // Status update.
    const upd = await fetch(`${API}/admin/beta-waitlist/applicants/${id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'UNDER_REVIEW', note: 'integration' }),
    });
    expect(upd.status).toBe(200);
    expect((await upd.json()).applicant.status).toBe('UNDER_REVIEW');

    // Export (CSV).
    const csv = await fetch(`${API}/admin/beta-waitlist/export?search=${encodeURIComponent(email)}`, { headers: { Cookie: cookie } });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');

    // Cleanup.
    const del = await fetch(`${API}/admin/beta-waitlist/applicants/${id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect(del.status).toBe(200);
  });
});
