/**
 * api-tier-management.test.js — the 72.md tier MANAGEMENT API (admin-only).
 *
 * Self-skipping integration harness (repo convention): every assertion no-ops
 * when the dev server is not up, and the admin-only assertions additionally
 * no-op when a real admin session cannot be obtained (so the file is safe in the
 * plain unit+integration vitest run). When a server IS up and the seeded admin
 * password is available it runs for real against 127.0.0.1:3001.
 *
 * 127.0.0.1, never localhost — node fetch can resolve ::1 on Windows and fail
 * flakily mid-suite (repo convention).
 *
 * Coverage:
 *   - assign a tier → writes a UserTierAssignment history row with the changeType
 *     and flips isCurrent (exactly one current);
 *   - GET tier-history lists the trail (desc);
 *   - GET /tiers/analytics returns counts / % / recent changes / promotions;
 *   - GET /tiers/:id/users lists users-in-tier with current-assignment detail;
 *   - GET /tiers/:id/users/export streams CSV;
 *   - revert restores the previous tier + marks the row reverted;
 *   - the subscription placeholder round-trips;
 *   - a normal user is 403 on the admin endpoints; unknown tier → 400.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
const ADMIN_PW_CANDIDATES = [process.env.ADMIN_SEED_PASSWORD, process.env.ADMIN_PASS, 'LocalDevAdmin!2026'].filter(Boolean);

async function serverUp() {
  try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
}

async function jsonFetch(path, { method = 'GET', cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return res;
}

async function loginAdmin() {
  for (const pw of ADMIN_PW_CANDIDATES) {
    const res = await jsonFetch('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: pw } });
    if (res.ok) {
      const data = await res.json();
      if (data?.user?.role === 'admin') return res.headers.get('set-cookie');
    }
  }
  return null;
}

async function registerNormal(email, password = 'TierMgmt123!') {
  const login = await jsonFetch('/auth/login', { method: 'POST', body: { email, password } });
  if (login.ok) { const d = await login.json(); return { user: d.user, cookie: login.headers.get('set-cookie') }; }
  const reg = await jsonFetch('/auth/register', { method: 'POST', body: { email, password, name: 'Tier Mgmt Target' } });
  const d = await reg.json().catch(() => ({}));
  return { user: d?.user, cookie: reg.headers.get('set-cookie') };
}

let up = false;
let adminCookie = null;
let target = null;      // { user, cookie } — the user admin operates on
let normal = null;      // { user, cookie } — a normal user for 403 checks
const TS = Date.now();

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;
  adminCookie = await loginAdmin();
  target = await registerNormal(`tier-target-${TS}@example.com`);
  normal = await registerNormal(`tier-normal-${TS}@example.com`);
});

const haveAdmin = () => up && adminCookie && target?.user?.id;

describe('assign a tier — writes history + flips isCurrent', () => {
  it('PATCH /users/:id/tier with a changeType records a current assignment', async () => {
    if (!haveAdmin()) return;
    const res = await jsonFetch(`/admin/users/${target.user.id}/tier`, {
      method: 'PATCH', cookie: adminCookie,
      body: { tierId: 'plus', changeType: 'promotion', reason: 'integration test promote' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.user.tierId).toBe('plus');

    const hist = await jsonFetch(`/admin/users/${target.user.id}/tier-history`, { cookie: adminCookie }).then(r => r.json());
    expect(Array.isArray(hist.history)).toBe(true);
    expect(hist.history.length).toBeGreaterThanOrEqual(1);
    const current = hist.history.find(h => h.isCurrent);
    expect(current).toBeTruthy();
    expect(current.tierId).toBe('plus');
    expect(current.changeType).toBe('promotion');
    expect(hist.history.filter(h => h.isCurrent).length).toBe(1); // exactly one current
  });

  it('a second assignment flips the prior current row to false', async () => {
    if (!haveAdmin()) return;
    const res = await jsonFetch(`/admin/users/${target.user.id}/tier`, {
      method: 'PATCH', cookie: adminCookie,
      body: { tierId: 'pro', changeType: 'promotion', reason: 'integration test promote 2' },
    });
    expect(res.status).toBe(200);
    const hist = await jsonFetch(`/admin/users/${target.user.id}/tier-history`, { cookie: adminCookie }).then(r => r.json());
    expect(hist.history.length).toBeGreaterThanOrEqual(2);
    expect(hist.history.filter(h => h.isCurrent).length).toBe(1);
    expect(hist.history.find(h => h.isCurrent).tierId).toBe('pro');
    // the earlier 'plus' row exists and is no longer current
    const plusRow = hist.history.find(h => h.tierId === 'plus' && h.changeType === 'promotion');
    expect(plusRow).toBeTruthy();
    expect(plusRow.isCurrent).toBe(false);
    expect(plusRow.previousTierDisplayName === null || typeof plusRow.previousTierDisplayName === 'string').toBe(true);
  });

  it('an unknown tier id is rejected (400)', async () => {
    if (!haveAdmin()) return;
    const res = await jsonFetch(`/admin/users/${target.user.id}/tier`, {
      method: 'PATCH', cookie: adminCookie, body: { tierId: 'no-such-tier' },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/tiers/analytics', () => {
  it('returns totals, per-tier counts/%, recent changes and promotion tallies', async () => {
    if (!haveAdmin()) return;
    const res = await jsonFetch('/admin/tiers/analytics', { cookie: adminCookie });
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(typeof a.totalUsers).toBe('number');
    expect(Array.isArray(a.byTier)).toBe(true);
    for (const b of a.byTier) {
      expect(typeof b.tierId).toBe('string');
      expect(typeof b.count).toBe('number');
      expect(typeof b.pct).toBe('number');
    }
    expect(typeof a.unassigned).toBe('number');
    expect(typeof a.avgDaysInCurrentTier).toBe('number');
    expect(Array.isArray(a.recentChanges)).toBe(true);
    expect(Array.isArray(a.expiringSoon)).toBe(true);
    expect(Array.isArray(a.newByTier)).toBe(true);
    expect(a.recentPromotions).toBeGreaterThanOrEqual(1); // we just promoted twice
    // our target shows up in recentChanges
    expect(a.recentChanges.some(c => c.userId === target.user.id)).toBe(true);
  });

  it('73.md Part 10 — window tallies stay NUMBERS and the additive *List keys are row ARRAYS', async () => {
    if (!haveAdmin()) return;
    const res = await jsonFetch('/admin/tiers/analytics', { cookie: adminCookie });
    expect(res.status).toBe(200);
    const a = await res.json();
    // The tallies keep the shipped numeric contract.
    expect(typeof a.recentPromotions).toBe('number');
    expect(typeof a.recentDowngrades).toBe('number');
    expect(typeof a.manualChanges).toBe('number');
    expect(typeof a.trialUsers).toBe('number');
    // The *List keys carry the rows the dashboard lists render.
    expect(Array.isArray(a.recentPromotionsList)).toBe(true);
    expect(Array.isArray(a.recentDowngradesList)).toBe(true);
    expect(Array.isArray(a.trialUsersList)).toBe(true);
    expect(a.recentPromotionsList.length).toBeLessThanOrEqual(20);
    expect(a.recentDowngradesList.length).toBeLessThanOrEqual(20);
    expect(a.trialUsersList.length).toBeLessThanOrEqual(100);
    // Our just-promoted target appears in the promotions list, email-joined,
    // in the same row shape as recentChanges.
    const mine = a.recentPromotionsList.find(c => c.userId === target.user.id);
    expect(mine).toBeTruthy();
    expect(mine.email).toBe(target.user.email);
    expect(mine.changeType).toBe('promotion');
    expect(typeof mine.to).toBe('string');
    // Every user-bearing row carries an email key (null for vanished users —
    // never undefined; the mini lists no longer fall back to raw userIds).
    for (const r of [...a.recentPromotionsList, ...a.recentDowngradesList, ...a.trialUsersList, ...a.expiringSoon]) {
      expect(typeof r.userId).toBe('string');
      expect('email' in r).toBe(true);
    }
  });
});

describe('GET /admin/tiers/:id/users (+ CSV export)', () => {
  it('lists users currently in the tier with current-assignment detail', async () => {
    if (!haveAdmin()) return;
    // Filter by the target's email so the assertion is deterministic regardless of
    // how many other users share the default tier (also exercises the ?q= filter).
    const res = await jsonFetch(`/admin/tiers/pro/users?take=100&q=${encodeURIComponent(target.user.email)}`, { cookie: adminCookie });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tierId).toBe('pro');
    expect(typeof data.total).toBe('number');
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.users)).toBe(true);
    const mine = data.users.find(u => u.id === target.user.id);
    expect(mine).toBeTruthy();
    expect(mine.tierId).toBe('pro');
    expect(mine.changeType).toBe('promotion');
    expect(typeof mine.daysInTier === 'number' || mine.daysInTier === null).toBe(true);
    expect(['active', 'suspended']).toContain(mine.status);
  });

  it('exports the users as CSV', async () => {
    if (!haveAdmin()) return;
    const res = await jsonFetch(`/admin/tiers/pro/users/export`, { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect((res.headers.get('content-type') || '').toLowerCase()).toContain('text/csv');
    const csv = await res.text();
    expect(csv.split('\r\n')[0]).toContain('id,email,name,role,tierId');
    expect(csv).toContain(target.user.email);
  });
});

describe('POST /admin/users/:id/tier/revert', () => {
  it('reverts the current assignment and restores the previous tier', async () => {
    if (!haveAdmin()) return;
    const before = await jsonFetch(`/admin/users/${target.user.id}/tier-history`, { cookie: adminCookie }).then(r => r.json());
    const current = before.history.find(h => h.isCurrent);
    expect(current.tierId).toBe('pro');
    const res = await jsonFetch(`/admin/users/${target.user.id}/tier/revert`, {
      method: 'POST', cookie: adminCookie, body: { assignmentId: current.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    // previous tier of the reverted 'pro' row was 'plus' → restored
    expect(data.user.tierId).toBe('plus');
    expect(data.current.tierId).toBe('plus');

    const after = await jsonFetch(`/admin/users/${target.user.id}/tier-history`, { cookie: adminCookie }).then(r => r.json());
    const revertedRow = after.history.find(h => h.id === current.id);
    expect(revertedRow.reverted).toBe(true);
    expect(after.history.filter(h => h.isCurrent).length).toBe(1);
    expect(after.history.find(h => h.isCurrent).tierId).toBe('plus');
  });

  it('reverting an already-reverted assignment is a 409', async () => {
    if (!haveAdmin()) return;
    const hist = await jsonFetch(`/admin/users/${target.user.id}/tier-history`, { cookie: adminCookie }).then(r => r.json());
    const reverted = hist.history.find(h => h.reverted);
    if (!reverted) return;
    const res = await jsonFetch(`/admin/users/${target.user.id}/tier/revert`, {
      method: 'POST', cookie: adminCookie, body: { assignmentId: reverted.id },
    });
    expect(res.status).toBe(409);
  });
});

describe('subscription placeholder round-trip', () => {
  it('GET returns a placeholder, PUT persists, GET reflects it', async () => {
    if (!haveAdmin()) return;
    const before = await jsonFetch(`/admin/users/${target.user.id}/subscription`, { cookie: adminCookie }).then(r => r.json());
    expect(before.isPlaceholder).toBe(true);
    expect(before.subscription.status).toBe('none');

    const put = await jsonFetch(`/admin/users/${target.user.id}/subscription`, {
      method: 'PUT', cookie: adminCookie,
      body: { status: 'trialing', provider: 'stripe', cancelAtPeriodEnd: true, trialEnd: '2026-12-31T00:00:00.000Z', failedPaymentCount: 2 },
    });
    expect(put.status).toBe(200);
    const putData = await put.json();
    expect(putData.subscription.status).toBe('trialing');

    const after = await jsonFetch(`/admin/users/${target.user.id}/subscription`, { cookie: adminCookie }).then(r => r.json());
    expect(after.subscription.status).toBe('trialing');
    expect(after.subscription.provider).toBe('stripe');
    expect(after.subscription.cancelAtPeriodEnd).toBe(true);
    expect(after.subscription.failedPaymentCount).toBe(2);
  });

  it('rejects an invalid subscription status (400)', async () => {
    if (!haveAdmin()) return;
    const res = await jsonFetch(`/admin/users/${target.user.id}/subscription`, {
      method: 'PUT', cookie: adminCookie, body: { status: 'bogus' },
    });
    expect(res.status).toBe(400);
  });
});

describe('permissions — a normal user is forbidden (403)', () => {
  it('GET /admin/tiers/analytics as a normal user → 403', async () => {
    if (!up || !normal?.cookie) return;
    const res = await jsonFetch('/admin/tiers/analytics', { cookie: normal.cookie });
    expect(res.status).toBe(403);
  });
  it('GET /admin/users/:id/tier-history as a normal user → 403', async () => {
    if (!up || !normal?.cookie || !normal?.user?.id) return;
    const res = await jsonFetch(`/admin/users/${normal.user.id}/tier-history`, { cookie: normal.cookie });
    expect(res.status).toBe(403);
  });
  it('PUT /admin/users/:id/subscription as a normal user → 403', async () => {
    if (!up || !normal?.cookie || !normal?.user?.id) return;
    const res = await jsonFetch(`/admin/users/${normal.user.id}/subscription`, {
      method: 'PUT', cookie: normal.cookie, body: { status: 'active' },
    });
    expect(res.status).toBe(403);
  });
  it('unauthenticated access → 401/403', async () => {
    if (!up) return;
    const res = await jsonFetch('/admin/tiers/analytics');
    expect([401, 403]).toContain(res.status);
  });
});
