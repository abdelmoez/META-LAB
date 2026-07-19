/**
 * api-admin-users-mgmt.test.js — 95.md — integration coverage for the redesigned
 * admin user-management surface, against the LIVE dev server on 127.0.0.1:3001
 * (house conventions: singleFork via npm run test:integration, self-skip when
 * the server is down + T1 anti-vacuous guard, loginAdmin candidate passwords
 * from api-tier-management, direct-prisma fixtures for status diversity).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = Math.random().toString(36).slice(2, 8);
const DUMMY_HASH = '$2a$12$Q9amMXjr1gpuRD3d3tHdveV5cEeESz/cevQS.7sfa35nS1FpMMLfq';

let up = false;
let admin = null; // session cookie
const fixtures = { g: null, b: null, s: null };

const cookieFrom = (res) => (res.headers.getSetCookie?.() || []).find((c) => c.startsWith('metalab_session='))?.split(';')[0] || null;
async function api(p, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.clone().json(); } catch { /* csv/redirects */ }
  return { res, json };
}
async function loginAdmin() {
  for (const password of [process.env.ADMIN_SEED_PASSWORD, process.env.ADMIN_PASS, 'LocalDevAdmin!2026'].filter(Boolean)) {
    const { res } = await api('/auth/login', { method: 'POST', body: { email: 'admin@example.com', password } });
    const c = cookieFrom(res);
    if (res.status === 200 && c) return c;
  }
  return null;
}

beforeAll(async () => {
  try { up = (await fetch(`${BASE}/health`)).ok; } catch { up = false; }
  if (!up) return;
  admin = await loginAdmin();
  if (!admin) return;
  // Status-diverse fixtures the 14.8k-user dev DB lacks (google-only / both / suspended-unverified).
  fixtures.g = await prisma.user.create({ data: { email: `mgmt95-g-${rnd}@example.test`, name: 'Mgmt G', password: null, role: 'user', registrationMethod: 'google', emailVerifiedAt: new Date() } });
  await prisma.authAccount.create({ data: { userId: fixtures.g.id, provider: 'google', providerAccountId: `mgmt95-${rnd}`, providerEmail: fixtures.g.email, providerEmailVerified: true, createdAt: fixtures.g.createdAt } });
  fixtures.b = await prisma.user.create({ data: { email: `mgmt95-b-${rnd}@example.test`, name: 'Mgmt B', password: DUMMY_HASH, role: 'user', registrationMethod: 'email', emailVerifiedAt: new Date() } });
  await prisma.authAccount.create({ data: { userId: fixtures.b.id, provider: 'google', providerAccountId: `mgmt95b-${rnd}`, providerEmail: fixtures.b.email, providerEmailVerified: true } });
  fixtures.s = await prisma.user.create({ data: { email: `mgmt95-s-${rnd}@example.test`, name: 'Mgmt S', password: DUMMY_HASH, role: 'user', registrationMethod: 'email', suspended: true, suspendedAt: new Date() } });
}, 30000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: `mgmt95-` } } }).catch(() => {});
});

describe('95.md admin user management', () => {
  it('T1 server + admin session (anti-vacuous guard — start `npm run server`; seed admin must exist)', () => {
    expect(up).toBe(true);
    expect(admin).toBeTruthy();
  });

  it('list rows carry the auth axes (hasPassword, providers, registrationMethod, status)', async () => {
    if (!admin) return;
    const { json } = await api(`/admin/users?search=mgmt95-b-${rnd}`, { cookie: admin });
    const row = json.users[0];
    expect(row).toMatchObject({ hasPassword: true, registrationMethod: 'email', status: 'active', invitedViaInvitation: false });
    expect(row.authProviders[0].provider).toBe('google');
    expect(row.password).toBeUndefined(); // hashes never serialize
  });

  it('auth-method, registration-method and status filters are server-side and correct', async () => {
    if (!admin) return;
    const g = await api('/admin/users?authMethod=google_only&limit=50', { cookie: admin });
    expect(g.json.users.some((u) => u.id === fixtures.g.id)).toBe(true);
    expect(g.json.users.every((u) => !u.hasPassword)).toBe(true);
    const b = await api('/admin/users?authMethod=both&limit=50', { cookie: admin });
    expect(b.json.users.some((u) => u.id === fixtures.b.id)).toBe(true);
    const s = await api('/admin/users?status=suspended&limit=50', { cookie: admin });
    expect(s.json.users.some((u) => u.id === fixtures.s.id)).toBe(true);
    expect(s.json.users.every((u) => u.suspended)).toBe(true);
    const r = await api('/admin/users?regMethod=google&limit=50', { cookie: admin });
    expect(r.json.users.some((u) => u.id === fixtures.g.id)).toBe(true);
  });

  it('pagination stays fast and sorted at the 14k-user dev DB scale', async () => {
    if (!admin) return;
    const t0 = Date.now();
    const { json } = await api('/admin/users?page=100&limit=25&sort=created&order=asc', { cookie: admin });
    expect(json.users.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(3000);
    const ts = json.users.map((u) => new Date(u.createdAt).getTime());
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('metrics respect filters and flag filtered:true', async () => {
    if (!admin) return;
    const all = await api('/admin/users/metrics', { cookie: admin });
    expect(all.json.filtered).toBe(false);
    expect(all.json.metrics.total).toBeGreaterThan(1000);
    expect(all.json.metrics.googleRegistered).toBeGreaterThanOrEqual(1);
    const f = await api('/admin/users/metrics?status=suspended', { cookie: admin });
    expect(f.json.filtered).toBe(true);
    expect(f.json.metrics.total).toBeLessThan(all.json.metrics.total);
  });

  it('detail + timeline expose auth truth without secrets', async () => {
    if (!admin) return;
    const d = await api(`/admin/users/${fixtures.g.id}`, { cookie: admin });
    expect(d.json).toMatchObject({ hasPassword: false, registrationMethod: 'google' });
    expect(d.json.password).toBeUndefined();
    const t = await api(`/admin/users/${fixtures.g.id}/timeline`, { cookie: admin });
    expect(t.json.events.some((e) => e.kind === 'registered' && /Google/.test(e.label))).toBe(true);
  });

  it('notes lifecycle: create → edit → soft-delete, hidden after delete', async () => {
    if (!admin) return;
    const c = await api(`/admin/users/${fixtures.g.id}/notes`, { method: 'POST', body: { body: 'note' }, cookie: admin });
    expect(c.res.status).toBe(201);
    const e = await api(`/admin/users/${fixtures.g.id}/notes/${c.json.note.id}`, { method: 'PATCH', body: { body: 'edited' }, cookie: admin });
    expect(e.json.note.editedAt).toBeTruthy();
    await api(`/admin/users/${fixtures.g.id}/notes/${c.json.note.id}`, { method: 'DELETE', cookie: admin });
    const l = await api(`/admin/users/${fixtures.g.id}/notes`, { cookie: admin });
    expect(l.json.notes.find((n) => n.id === c.json.note.id)).toBeUndefined();
  });

  it('revoke-sessions kills a live session; resend-verification 409s when verified', async () => {
    if (!admin) return;
    const reg = await api('/auth/register', { method: 'POST', body: { email: `mgmt95-v-${rnd}@example.test`, password: 'password-1234' } });
    const victim = cookieFrom(reg.res);
    const rs = await api(`/admin/users/${reg.json.user.id}/revoke-sessions`, { method: 'POST', cookie: admin });
    expect(rs.res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect((await api('/auth/me', { cookie: victim })).res.status).toBe(401);
    const rv = await api(`/admin/users/${fixtures.g.id}/resend-verification`, { method: 'POST', cookie: admin });
    expect(rv.res.status).toBe(409);
    expect(rv.json.code).toBe('ALREADY_VERIFIED');
  });

  it('bulk suspend/restore: self-skip, per-target audit rows share bulkOperationId', async () => {
    if (!admin) return;
    const me = (await api('/auth/me', { cookie: admin })).json.user;
    const b = await api('/admin/users/bulk', { method: 'POST', body: { action: 'suspend', ids: [fixtures.b.id, me.id], reason: 'test' }, cookie: admin });
    expect(b.json.summary).toMatchObject({ requested: 2, succeeded: 1, skipped: 1 });
    expect(b.json.results.find((r) => r.id === me.id).code).toBe('SKIP_SELF');
    const audits = await prisma.adminAuditLog.count({ where: { bulkOperationId: b.json.bulkOperationId } });
    expect(audits).toBe(2); // one per-target + one summary
    const r = await api('/admin/users/bulk', { method: 'POST', body: { action: 'restore', ids: [fixtures.b.id] }, cookie: admin });
    expect(r.json.summary.succeeded).toBe(1);
  });

  it('filtered CSV export works and is admin-only', async () => {
    if (!admin) return;
    const ex = await fetch(`${BASE}/admin/users/export.csv?status=suspended`, { headers: { cookie: admin } });
    expect(ex.status).toBe(200);
    expect((await ex.text()).startsWith('userNumber,')).toBe(true);
  });

  it('normal users are denied every new endpoint', async () => {
    if (!admin) return;
    const nu = await api('/auth/register', { method: 'POST', body: { email: `mgmt95-n-${rnd}@example.test`, password: 'password-1234' } });
    const nc = cookieFrom(nu.res);
    for (const [p, method, body] of [
      ['/admin/users/metrics', 'GET'], [`/admin/users/${fixtures.g.id}/timeline`, 'GET'],
      ['/admin/users/bulk', 'POST', { action: 'suspend', ids: ['x'] }],
      [`/admin/users/${fixtures.g.id}/notes`, 'GET'],
    ]) {
      const { res } = await api(p, { method, body, cookie: nc });
      expect([401, 403]).toContain(res.status);
    }
    const ex = await fetch(`${BASE}/admin/users/export.csv`, { headers: { cookie: nc } });
    expect([401, 403]).toContain(ex.status);
  });
});
