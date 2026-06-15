/**
 * prompt20-user-edit.test.js
 *
 * Integration coverage for the rebuilt Ops user editor (prompt20 Task 5):
 *   - admin PATCH /api/admin/users/:id can edit the safe profile fields
 *     (name, theme, registration country) and the change round-trips via GET
 *   - GET /api/admin/users/:id returns the editable fields but NEVER a secret
 *     (no password hash, no registrationIpHash)
 *   - password / role / suspended sent in the edit body are IGNORED — the edit
 *     endpoint never changes a credential or privilege (those have their own
 *     dedicated, protected endpoints); the password reset flow is untouched
 *   - invalid email / country code are rejected (400)
 *   - the change is audited as USER_UPDATED_BY_ADMIN
 *   - unauthenticated → 401, ordinary user → 403
 *
 * Harness mirrors prompt19-countries.test.js: fetch-based, server assumed running
 * at http://localhost:3001, self-skips when the server / seeded admin is absent.
 *   ADMIN_SEED_PASSWORD env (default matches server/.env) unlocks the admin path.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';
const TS = Date.now();
const ADMIN_EMAIL = 'admin@metalab.local';
const ADMIN_PASS  = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';

async function api(path, { method = 'GET', cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data, cookie: res.headers.get('set-cookie') };
}

async function serverUp() {
  try { return (await fetch(`${API}/health`)).ok; } catch { return false; }
}

let up = false, adminCookie = '';

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;
  const r = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
  adminCookie = r.status === 200 ? r.cookie : '';
});

// Register a fresh ordinary user and return { id, email, password, cookie }.
async function freshUser(tag) {
  const email = `p20-edit-${tag}-${TS}@example.com`;
  const password = 'OrigPass12345!';
  const r = await api('/auth/register', { method: 'POST', body: { email, password, name: 'Edit Target' } });
  return { id: r.data?.user?.id, email, password, cookie: r.cookie };
}

describe('PATCH /api/admin/users/:id — schema-driven safe edits (admin)', () => {
  it('edits name + theme + registration country, and the change round-trips', async () => {
    if (!up || !adminCookie) return;
    const u = await freshUser('safe');
    expect(u.id).toBeTruthy();

    const patch = await api(`/admin/users/${u.id}`, {
      method: 'PATCH', cookie: adminCookie,
      body: { name: 'Renamed Person', themePreference: 'day', registrationCountryCode: 'fr', registrationCountryName: 'France' },
    });
    expect(patch.status).toBe(200);
    expect(patch.data.user.name).toBe('Renamed Person');
    expect(patch.data.user.themePreference).toBe('day');
    expect(patch.data.user.registrationCountryCode).toBe('FR'); // uppercased by the schema

    const read = await api(`/admin/users/${u.id}`, { cookie: adminCookie });
    expect(read.status).toBe(200);
    expect(read.data.name).toBe('Renamed Person');
    expect(read.data.themePreference).toBe('day');
    expect(read.data.registrationCountryCode).toBe('FR');
    expect(read.data.registrationCountryName).toBe('France');
    // Secrets are never exposed by the read endpoint.
    expect(read.data).not.toHaveProperty('password');
    expect(read.data).not.toHaveProperty('registrationIpHash');
  });

  it('IGNORES password / role / suspended in the edit body (no credential or privilege change)', async () => {
    if (!up || !adminCookie) return;
    const u = await freshUser('ignore');
    expect(u.id).toBeTruthy();

    // Mix a real edit (name) with forbidden fields — the edit lands, the rest are dropped.
    const patch = await api(`/admin/users/${u.id}`, {
      method: 'PATCH', cookie: adminCookie,
      body: { name: 'Only Name Changes', password: 'hacked-by-admin', role: 'admin', suspended: true },
    });
    expect(patch.status).toBe(200);
    expect(patch.data.user.name).toBe('Only Name Changes');
    expect(patch.data.user.role).toBe('user');       // role NOT escalated via this endpoint
    expect(patch.data.user.suspended).toBe(false);   // status NOT changed via this endpoint

    // The original password STILL works → the edit never touched the credential.
    const relog = await api('/auth/login', { method: 'POST', body: { email: u.email, password: u.password } });
    expect(relog.status).toBe(200);

    // A body of ONLY forbidden fields changes nothing → 400 (no editable field).
    const empty = await api(`/admin/users/${u.id}`, {
      method: 'PATCH', cookie: adminCookie,
      body: { password: 'x', registrationIpHash: 'y', role: 'admin' },
    });
    expect(empty.status).toBe(400);
  });

  it('rejects an invalid email and an invalid country code (400)', async () => {
    if (!up || !adminCookie) return;
    const u = await freshUser('valid');
    expect((await api(`/admin/users/${u.id}`, { method: 'PATCH', cookie: adminCookie, body: { email: 'not-an-email' } })).status).toBe(400);
    expect((await api(`/admin/users/${u.id}`, { method: 'PATCH', cookie: adminCookie, body: { registrationCountryCode: 'USA' } })).status).toBe(400);
  });

  it('records a USER_UPDATED_BY_ADMIN audit entry', async () => {
    if (!up || !adminCookie) return;
    const u = await freshUser('audit');
    await api(`/admin/users/${u.id}`, { method: 'PATCH', cookie: adminCookie, body: { name: 'Audited Name' } });
    const log = await api('/admin/audit-log?limit=50', { cookie: adminCookie });
    expect(log.status).toBe(200);
    const entries = log.data?.logs || log.data?.entries || log.data?.auditLogs || [];
    const hit = entries.find(e => e.action === 'USER_UPDATED_BY_ADMIN' && (e.entityId === u.id));
    expect(hit, 'expected a USER_UPDATED_BY_ADMIN audit entry for the edited user').toBeTruthy();
  });
});

describe('PATCH /api/admin/users/:id — authorization', () => {
  it('rejects unauthenticated (401)', async () => {
    if (!up) return;
    const res = await api(`/admin/users/some-id`, { method: 'PATCH', body: { name: 'x' } });
    expect(res.status).toBe(401);
  });

  it('rejects an ordinary user (403)', async () => {
    if (!up) return;
    const victim = await freshUser('victim');
    const attacker = await freshUser('attacker');
    if (!attacker.cookie) return;
    const res = await api(`/admin/users/${victim.id}`, { method: 'PATCH', cookie: attacker.cookie, body: { name: 'pwned' } });
    expect(res.status).toBe(403);
  });
});
