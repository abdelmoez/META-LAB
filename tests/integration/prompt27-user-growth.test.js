/**
 * prompt27-user-growth.test.js
 *
 * Integration tests for the new-user registration analytics (prompt27):
 *   - GET /api/admin/user-growth          (admin only)
 *   - GET /api/admin/user-analytics?window=…  (window filter + new breakdowns)
 *   - GET /api/admin/users?createdWithin=…    (server-side registration filter)
 *
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 * Seeded admin (admin@metalab.local) — never mutated.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

async function serverUp() {
  try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
}
function cookieFrom(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/metalab_session=[^;]+/);
  return m ? m[0] : '';
}
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function registerAndLogin(email, password, name = 'Test User') {
  const login = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (login.status === 200) return { user: login.data?.user, cookie: login.cookie };
  const reg = await api('/auth/register', { method: 'POST', body: { email, password, name } });
  return { user: reg.data?.user, cookie: reg.cookie };
}
function localDayKey(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

let up = false;
let adminCookie = '';
const TS = Date.now();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@metalab.local';
const ADMIN_PASS = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';

beforeAll(async () => {
  up = await serverUp();
  if (up) {
    const r = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
    adminCookie = r.status === 200 ? r.cookie : '';
  }
}, 30000);

// ── 1. Permission protection ──────────────────────────────────────────────────

describe('GET /api/admin/user-growth — auth enforcement', () => {
  it('401 when unauthenticated', async () => {
    if (!up) return;
    const res = await api('/admin/user-growth');
    expect(res.status).toBe(401);
  });
  it('403 for a normal (non-admin) user', async () => {
    if (!up) return;
    const { cookie } = await registerAndLogin(`growth-normal-${TS}@example.com`, 'NormalPass123!', 'Growth Normal');
    expect(cookie).toBeTruthy();
    const res = await api('/admin/user-growth', { cookie });
    expect(res.status).toBe(403);
  });
});

// ── 2. Shape ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/user-growth — shape', () => {
  it('200 for admin: windows + series + insights + stats', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ skipped (no admin cookie — seed admins first)'); return; }

    const res = await api('/admin/user-growth', { cookie: adminCookie });
    expect(res.status).toBe(200);
    const d = res.data;

    // Windows: each has a numeric count; today/week/month/quarter/year carry delta fields.
    for (const k of ['today', 'week', 'month', 'quarter', 'year']) {
      expect(typeof d.windows[k].count).toBe('number');
      expect(d.windows[k]).toHaveProperty('prev');
      expect(d.windows[k]).toHaveProperty('deltaPct');
    }
    expect(typeof d.windows.total.count).toBe('number');

    // byDay: 90 ascending zero-filled buckets, last = today.
    expect(Array.isArray(d.byDay)).toBe(true);
    expect(d.byDay.length).toBe(90);
    for (const b of d.byDay) {
      expect(b.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof b.count).toBe('number');
      expect(b.count).toBeGreaterThanOrEqual(0);
    }
    expect(d.byDay[d.byDay.length - 1].date).toBe(localDayKey());

    // byMonth12 trailing 12 months; byYear ascending with growthPct.
    expect(d.byMonth12.length).toBe(12);
    expect(Array.isArray(d.byYear)).toBe(true);
    for (const y of d.byYear) expect(y).toHaveProperty('growthPct');

    // byMonth (selected year) = 12 buckets; byQuarter multiple-of-4.
    expect(d.byMonth.length).toBe(12);
    expect(d.byQuarter.length % 4).toBe(0);

    expect(Array.isArray(d.availableYears)).toBe(true);
    expect(typeof d.selectedYear).toBe('number');
    expect(d.insights).toHaveProperty('topCountry');
    expect(d.insights).toHaveProperty('topPrimaryRole');
    expect(d.stats).toHaveProperty('avgPerDayThisMonth');
    expect(d.timezone).toBe('server-local');
    expect(d.weekStart).toBe('sunday');
  });

  it('a fresh registration lands in today + this-year windows', async () => {
    if (!up || !adminCookie) return;
    const before = await api('/admin/user-growth', { cookie: adminCookie });
    await registerAndLogin(`growth-fresh-${TS}@example.com`, 'FreshPass123!', 'Growth Fresh');
    const after = await api('/admin/user-growth', { cookie: adminCookie });
    expect(after.data.windows.today.count).toBeGreaterThanOrEqual(before.data.windows.today.count + 1);
    expect(after.data.windows.year.count).toBeGreaterThanOrEqual(before.data.windows.year.count + 1);
    expect(after.data.byDay[after.data.byDay.length - 1].count)
      .toBeGreaterThanOrEqual(before.data.byDay[before.data.byDay.length - 1].count + 1);
  });
});

// ── 3. Analytics window filter + new breakdowns ───────────────────────────────

describe('GET /api/admin/user-analytics — window + breakdowns', () => {
  it('default (no window) is all-time and carries the new keys', async () => {
    if (!up || !adminCookie) return;
    const res = await api('/admin/user-analytics', { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.data.window).toBe('all');
    expect(Array.isArray(res.data.byMainUseCase)).toBe(true);
    expect(res.data.institution).toMatchObject({ provided: expect.any(Number), missing: expect.any(Number), total: expect.any(Number) });
  });
  it('?window=month filters to month and never exceeds the all-time total', async () => {
    if (!up || !adminCookie) return;
    const all = await api('/admin/user-analytics?window=all', { cookie: adminCookie });
    const month = await api('/admin/user-analytics?window=month', { cookie: adminCookie });
    expect(month.status).toBe(200);
    expect(month.data.window).toBe('month');
    expect(month.data.totalUsers).toBeLessThanOrEqual(all.data.totalUsers);
  });
  it('403 for a normal user', async () => {
    if (!up) return;
    const { cookie } = await registerAndLogin(`analytics-normal-${TS}@example.com`, 'NormalPass123!');
    const res = await api('/admin/user-analytics', { cookie });
    expect(res.status).toBe(403);
  });
});

// ── 4. Users registration-window server filter ────────────────────────────────

describe('GET /api/admin/users — createdWithin filter', () => {
  it('createdWithin=year returns ≤ the unfiltered total', async () => {
    if (!up || !adminCookie) return;
    const allRes = await api('/admin/users', { cookie: adminCookie });
    const yearRes = await api('/admin/users?createdWithin=year', { cookie: adminCookie });
    expect(yearRes.status).toBe(200);
    expect(yearRes.data.total).toBeLessThanOrEqual(allRes.data.total);
  });
  it('verified=false returns only unverified users (rows carry emailVerified=false)', async () => {
    if (!up || !adminCookie) return;
    const res = await api('/admin/users?verified=false&limit=10', { cookie: adminCookie });
    expect(res.status).toBe(200);
    for (const u of res.data.users) expect(u.emailVerified).toBe(false);
  });
});
