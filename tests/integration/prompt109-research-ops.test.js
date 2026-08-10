/**
 * prompt109-research-ops.test.js — W1-B: Ops › Research Governance server half.
 *
 * Verifies (a) the §39 capability seam on the NEW routes (401 unauthenticated,
 * 403 for an ordinary user, on both the read and the write endpoints), (b) the
 * §8 duplicate-job telemetry shapes including the "no cpuMs / heapUsedMb" leakage
 * guarantee, (c) §24 pagination + filters on the reworked screening audit feed,
 * (d) the §9 requeue preconditions over HTTP, and (e) the §6 client-error beacon
 * still 204s (now persisting a bounded row).
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
  let data = null; try { data = await res.json(); } catch { /* 204 / non-JSON */ }
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: 'ops-109' } }); return r.cookie; }

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (!up) return;
  for (const [email, pass] of [['ops@example.com', process.env.ADMIN_SEED_PASSWORD || 'LocalTestAdmin#2026'], ['admin@example.com', process.env.ADMIN_SEED_PASSWORD || 'LocalTestAdmin#2026']]) {
    const r = await api('/auth/login', { method: 'POST', body: { email, password: pass } });
    if (r.status === 200) { adminCookie = r.cookie; break; }
  }
});

const READ_ENDPOINTS = [
  '/admin/research/duplicate-jobs',
  '/admin/research/duplicate-jobs/health',
  '/admin/research/duplicate-jobs/does-not-exist',
  '/admin/research/client-errors',
];

describe('109 W1-B — Research Governance authorization (§39/§56)', () => {
  it('unauthenticated → 401 on every new endpoint', async () => {
    if (!up) return;
    for (const e of READ_ENDPOINTS) expect((await api(e)).status).toBe(401);
    expect((await api('/admin/research/duplicate-jobs/x/requeue', { method: 'POST' })).status).toBe(401);
  });

  it('a normal (non-staff) user → 403 on every new endpoint', async () => {
    if (!up) return;
    const cookie = await register(`ops109_${rnd()}@t.local`);
    for (const e of READ_ENDPOINTS) expect((await api(e, { cookie })).status).toBe(403);
    expect((await api('/admin/research/duplicate-jobs/x/requeue', { method: 'POST', cookie })).status).toBe(403);
  });

  it('the reworked screening audit feed is still admin-gated', async () => {
    if (!up) return;
    expect((await api('/admin/screening/audit')).status).toBe(401);
    const cookie = await register(`ops109a_${rnd()}@t.local`);
    expect((await api('/admin/screening/audit', { cookie })).status).toBe(403);
  });
});

describe('109 §8 — duplicate-job telemetry (admin)', () => {
  it('health returns real, backed counters and env-managed worker config', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/research/duplicate-jobs/health', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(['healthy', 'degraded', 'disabled']).toContain(data.health);
    for (const k of ['queued', 'processing', 'completed', 'failed', 'cancelled', 'stale']) {
      expect(typeof data.queue[k]).toBe('number');
    }
    expect(typeof data.failures24h).toBe('number');
    expect(data.durations).toHaveProperty('sampleSize');
    expect(Array.isArray(data.recentFailures)).toBe(true);
    // §45 — the nine worker knobs render read-only, sourced from the environment.
    expect(data.workerConfig.source).toBe('environment');
    expect(data.workerConfig.restartRequired).toBe(true);
    expect(Object.keys(data.workerConfig.values)).toHaveLength(9);
  });

  it('NEVER echoes process resource telemetry to the browser', async () => {
    if (!up || !adminCookie) return;
    for (const path of ['/admin/research/duplicate-jobs?limit=100', '/admin/research/duplicate-jobs/health']) {
      const { status, data } = await api(path, { cookie: adminCookie });
      expect(status).toBe(200);
      const blob = JSON.stringify(data);
      expect(blob).not.toContain('cpuMs');
      expect(blob).not.toContain('heapUsedMb');
    }
  });

  it('the job list paginates and validates its filters', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/research/duplicate-jobs?limit=5&page=1&status=failed', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(data.limit).toBe(5);
    expect(data.page).toBe(1);
    expect(Array.isArray(data.jobs)).toBe(true);
    expect(data.jobs.length).toBeLessThanOrEqual(5);
    for (const j of data.jobs) expect(j.status).toBe('failed');
    // A junk status is ignored (not a 400) so the Ops filter bar cannot wedge.
    expect((await api('/admin/research/duplicate-jobs?status=nonsense', { cookie: adminCookie })).status).toBe(200);
    // limit is clamped, never honoured verbatim — §24 forbids whole-history loads.
    expect((await api('/admin/research/duplicate-jobs?limit=99999', { cookie: adminCookie })).data.limit).toBe(100);
  });

  it('an unknown job id 404s on both detail and requeue', async () => {
    if (!up || !adminCookie) return;
    expect((await api('/admin/research/duplicate-jobs/no-such-job', { cookie: adminCookie })).status).toBe(404);
    expect((await api('/admin/research/duplicate-jobs/no-such-job/requeue', { method: 'POST', cookie: adminCookie })).status).toBe(404);
  });
});

describe('109 §24 — screening audit pagination + filters (admin)', () => {
  it('returns a paged envelope instead of the old take:200 list', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/screening/audit?limit=5', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(data.limit).toBe(5);
    expect(data.page).toBe(1);
    expect(typeof data.total).toBe('number');
    expect(typeof data.hasMore).toBe('boolean');
    expect(data.entries.length).toBeLessThanOrEqual(5);
  });

  it('clamps limit and honours the action filter', async () => {
    if (!up || !adminCookie) return;
    expect((await api('/admin/screening/audit?limit=100000', { cookie: adminCookie })).data.limit).toBe(100);
    const { data } = await api('/admin/screening/audit?action=KEYWORD_REMOVED&limit=10', { cookie: adminCookie });
    for (const e of data.entries) expect(e.action).toBe('KEYWORD_REMOVED');
  });

  it('page 2 does not repeat page 1 (skip is applied)', async () => {
    if (!up || !adminCookie) return;
    const p1 = await api('/admin/screening/audit?limit=2&page=1', { cookie: adminCookie });
    if ((p1.data.total || 0) < 3) return; // not enough history on this box
    const p2 = await api('/admin/screening/audit?limit=2&page=2', { cookie: adminCookie });
    const ids1 = new Set(p1.data.entries.map(e => e.id));
    for (const e of p2.data.entries) expect(ids1.has(e.id)).toBe(false);
  });
});

describe('109 §6 — client-error beacon persists without changing its contract', () => {
  it('still answers 204 with an empty body (no reflection)', async () => {
    if (!up) return;
    const res = await fetch(BASE + '/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Prompt109TestError', message: `probe ${rnd()}`, route: '/t', engine: 'test' }),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('the admin feed exposes the capture bounds honestly', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/research/client-errors?limit=5', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(Array.isArray(data.errors)).toBe(true);
    expect(data.capture.limits).toEqual({ kind: 80, message: 500, context: 500 });
    expect(data.capture.maxRows).toBeGreaterThan(0);
    for (const row of data.errors) {
      expect(row.message.length).toBeLessThanOrEqual(500);
      expect(row.context.length).toBeLessThanOrEqual(500);
      expect(row.count).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('109 §4 — the research section is advertised to admins only', () => {
  it('GET /admin/console lists "research" for an admin', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/console', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(data.sections).toContain('research');
  });
});
