/**
 * prompt50-ops-projects.test.js — WS1: Ops Console Projects analytics + server-
 * side sorting. Verifies (a) the new admin endpoints reject unauthorized callers
 * (401 unauth, 403 normal user — Scenario 8 step 6), (b) authoritative analytics
 * shapes, and (c) sort-before-pagination correctness across pages.
 *
 * Authenticated assertions need the seeded admin; they skip gracefully when the
 * seed password isn't known to the test process. Requires the API on :3001.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false;
let adminCookie = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: 'ops-t' } }); return r.cookie; }

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (!up) return;
  // Best-effort admin login (matches the local dev seed). Authenticated tests
  // skip when this is unavailable (CI / different seed password).
  for (const [email, pass] of [['ops@example.com', process.env.ADMIN_SEED_PASSWORD || 'LocalTestAdmin#2026'], ['admin@example.com', process.env.ADMIN_SEED_PASSWORD || 'LocalTestAdmin#2026']]) {
    const r = await api('/auth/login', { method: 'POST', body: { email, password: pass } });
    if (r.status === 200) { adminCookie = r.cookie; break; }
  }
});

const ENDPOINTS = ['/admin/projects/overview', '/admin/project-growth', '/admin/project-analytics'];

describe('prompt50 WS1 — Ops Projects analytics: authorization', () => {
  it('unauthenticated → 401 on every analytics endpoint', async () => {
    if (!up) return;
    for (const e of ENDPOINTS) {
      expect((await api(e)).status).toBe(401);
    }
  });

  it('a normal (non-admin) user → 403 on every analytics endpoint', async () => {
    if (!up) return;
    const cookie = await register(`opsn_${rnd()}@t.local`);
    for (const e of ENDPOINTS) {
      expect((await api(e, { cookie })).status).toBe(403);
    }
    // ...and the project list itself is admin-only.
    expect((await api('/admin/projects', { cookie })).status).toBe(403);
  });
});

describe('prompt50 WS1 — Ops Projects analytics: shapes (admin)', () => {
  it('overview returns authoritative totals + screening rollups', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/projects/overview', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(typeof data.totals.total).toBe('number');
    expect(typeof data.totals.active).toBe('number');
    expect(data.created.total).toBeTruthy();
    expect(data.screening).toBeTruthy();
    expect(typeof data.screening.withScreening).toBe('number');
  });

  it('growth mirrors the user-growth shape', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/project-growth', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(data.windows).toBeTruthy();
    expect(Array.isArray(data.byYear)).toBe(true);
    expect(Array.isArray(data.byDay)).toBe(true);
  });

  it('analytics returns distributions', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/project-analytics', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(Array.isArray(data.byStatus)).toBe(true);
    expect(Array.isArray(data.byOwner)).toBe(true);
    if (data.byOwner.length) {
      expect(typeof data.byOwner[0].key).toBe('string');
      expect(typeof data.byOwner[0].count).toBe('number');
    }
    expect(data.byScreeningLink).toBeTruthy();
  });
});

describe('prompt50 WS1 — server-side sort is applied BEFORE pagination', () => {
  it('paginated results equal the globally-sorted order (created asc) and reverse with dir', async () => {
    if (!up || !adminCookie) return;
    const asc = await api('/admin/projects?sort=created&dir=asc&limit=100&page=1', { cookie: adminCookie });
    expect(asc.status).toBe(200);
    const ids = asc.data.projects.map(p => p.id);
    if (ids.length < 4) return; // not enough data to prove pagination ordering

    // Page through with a small page size; the concatenation must match the
    // single-shot global order exactly (→ sort happened before pagination).
    const p1 = await api('/admin/projects?sort=created&dir=asc&limit=2&page=1', { cookie: adminCookie });
    const p2 = await api('/admin/projects?sort=created&dir=asc&limit=2&page=2', { cookie: adminCookie });
    expect(p1.data.projects.map(p => p.id)).toEqual(ids.slice(0, 2));
    expect(p2.data.projects.map(p => p.id)).toEqual(ids.slice(2, 4));

    // dir=desc reverses the order.
    const desc = await api('/admin/projects?sort=created&dir=desc&limit=100&page=1', { cookie: adminCookie });
    expect(desc.data.projects.map(p => p.id)).toEqual([...ids].reverse());

    // Rows carry the new ops fields.
    const row = asc.data.projects[0];
    expect('lastActivityAt' in row).toBe(true);
    expect('memberCount' in row).toBe(true);
    expect('conflictsOpen' in row).toBe(true);
  });
});
