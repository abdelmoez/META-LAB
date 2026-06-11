/**
 * api-admin-timeseries.test.js
 *
 * Integration tests for GET /api/admin/metrics/timeseries (prompt8 — ops
 * console per-day activity sparklines).
 *
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 *
 * Admin access uses the seeded admin (admin@metalab.local) with
 * ADMIN_SEED_PASSWORD (fallback: the dev seed default) — same convention as
 * the screening integration suites. Seeded admins are never mutated.
 *
 * Contract under test:
 *   - ?days= optional, default 14, clamped to [7, 90], non-numeric → default
 *   - response { days: [...] } ascending by date, exactly N zero-filled
 *     entries, every field a number ≥ 0, last entry = today (server local)
 *   - 401 unauthenticated, 403 for non-admin (requireAdmin)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
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
  try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}

async function registerAndLogin(email, password, name = 'Test User') {
  // Try login first to handle re-runs where the user already exists
  const login = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (login.status === 200) return { user: login.data?.user, cookie: login.cookie };
  const reg = await api('/auth/register', { method: 'POST', body: { email, password, name } });
  return { user: reg.data?.user, cookie: reg.cookie };
}

/** Local-time YYYY-MM-DD — mirrors the server's local-day bucketing. */
function localDayKey(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const FIELDS = [
  'logins', 'uniqueLogins', 'newUsers', 'newProjects',
  'screeningDecisions', 'doneTransitions', 'contactMessages', 'failedLogins',
];

// ── Module-level state ────────────────────────────────────────────────────────

let up = false;
let adminCookie = '';
const TS = Date.now();

const ADMIN_EMAIL = 'admin@metalab.local';
const ADMIN_PASS = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';

beforeAll(async () => {
  up = await serverUp();
  if (up) {
    const r = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
    adminCookie = r.status === 200 ? r.cookie : '';
  }
}, 30000);

// ── 1. Auth enforcement ───────────────────────────────────────────────────────

describe('GET /api/admin/metrics/timeseries — auth enforcement', () => {
  it('401 when unauthenticated', async () => {
    if (!up) return;
    const res = await api('/admin/metrics/timeseries');
    expect(res.status).toBe(401);
  });

  it('403 for a normal (non-admin) user', async () => {
    if (!up) return;
    const { cookie } = await registerAndLogin(
      `timeseries-normal-${TS}@example.com`,
      'NormalPass123!',
      'Timeseries Normal',
    );
    expect(cookie).toBeTruthy();
    const res = await api('/admin/metrics/timeseries', { cookie });
    expect(res.status).toBe(403);
  });
});

// ── 2. Shape, defaults and clamping ──────────────────────────────────────────

describe('GET /api/admin/metrics/timeseries — shape and window', () => {
  it('200 for admin: exactly 14 ascending zero-filled days, numeric fields ≥ 0, last = today', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ skipped (no admin cookie — seed admins first)'); return; }

    const res = await api('/admin/metrics/timeseries', { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.days)).toBe(true);
    expect(res.data.days.length).toBe(14);

    for (const entry of res.data.days) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const field of FIELDS) {
        expect(typeof entry[field], `${entry.date}.${field} must be a number`).toBe('number');
        expect(entry[field], `${entry.date}.${field} must be ≥ 0`).toBeGreaterThanOrEqual(0);
      }
      // uniqueLogins can never exceed total logins for the day.
      expect(entry.uniqueLogins).toBeLessThanOrEqual(entry.logins);
    }

    // Strictly ascending by date, every consecutive pair.
    for (let i = 1; i < res.data.days.length; i++) {
      expect(res.data.days[i].date > res.data.days[i - 1].date).toBe(true);
    }

    // Last entry is today (server local time = this machine's local time).
    expect(res.data.days[res.data.days.length - 1].date).toBe(localDayKey());
  });

  it('?days=7 returns exactly 7 entries', async () => {
    if (!up || !adminCookie) return;
    const res = await api('/admin/metrics/timeseries?days=7', { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.data.days.length).toBe(7);
    expect(res.data.days[res.data.days.length - 1].date).toBe(localDayKey());
  });

  it('?days=500 clamps to 90 entries', async () => {
    if (!up || !adminCookie) return;
    const res = await api('/admin/metrics/timeseries?days=500', { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.data.days.length).toBe(90);
    expect(res.data.days[res.data.days.length - 1].date).toBe(localDayKey());
  });

  it('?days=abc (non-numeric) falls back to the default 14', async () => {
    if (!up || !adminCookie) return;
    const res = await api('/admin/metrics/timeseries?days=abc', { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.data.days.length).toBe(14);
  });
});

// ── 3. Live data lands in today's bucket ─────────────────────────────────────

describe('GET /api/admin/metrics/timeseries — live login counting', () => {
  it("a fresh successful login increments today's logins bucket", async () => {
    if (!up || !adminCookie) return;

    const today = localDayKey();
    const before = await api('/admin/metrics/timeseries', { cookie: adminCookie });
    expect(before.status).toBe(200);
    const beforeToday = before.data.days.find(d => d.date === today);
    expect(beforeToday).toBeDefined();

    // Fresh successful login as a throwaway test user (register, then login
    // again explicitly so a LoginEvent row is definitely written).
    const email = `timeseries-login-${TS}@example.com`;
    await registerAndLogin(email, 'LoginBump123!', 'Timeseries Login');
    const login = await api('/auth/login', { method: 'POST', body: { email, password: 'LoginBump123!' } });
    expect(login.status).toBe(200);

    const after = await api('/admin/metrics/timeseries', { cookie: adminCookie });
    expect(after.status).toBe(200);
    const afterToday = after.data.days.find(d => d.date === today);
    expect(afterToday).toBeDefined();

    expect(afterToday.logins).toBeGreaterThanOrEqual(beforeToday.logins + 1);
    expect(afterToday.logins).toBeGreaterThanOrEqual(1);
    expect(afterToday.uniqueLogins).toBeGreaterThanOrEqual(1);
  });
});
