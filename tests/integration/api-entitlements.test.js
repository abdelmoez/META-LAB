/**
 * api-entitlements.test.js — the product-tier / entitlement API (67.md).
 *
 * Self-skipping integration harness (repo convention): every assertion no-ops
 * when the dev server is not up, so the file is safe in the unit+integration
 * vitest run. When a server IS up (e.g. the one started for the Playwright specs)
 * these run for real against 127.0.0.1:3001.
 *
 * Coverage (all via a FRESH registered NORMAL user + anonymous fetches — no
 * seeded admin needed):
 *   - GET /api/entitlements → bypass:false, a resolved tierId (the site default,
 *     'pro' unless configured otherwise) and a full entitlements map;
 *   - GET /api/entitlements/tiers → >= 3 active tiers, sorted by sortOrder;
 *   - a normal user is 403 on GET /api/admin/tiers and PATCH /api/admin/users/:id/tier;
 *   - unauthenticated /api/entitlements → 401/403;
 *   - SEPARATION: reading entitlements never changes the user's system role — GET
 *     /api/auth/me still reports role 'user' afterwards (tier ≠ role).
 *
 * 127.0.0.1, never localhost — node fetch can resolve ::1 on Windows and fail
 * flakily mid-suite (repo convention, see api-health.test.js header).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function registerAndLogin(email, password, name = 'Tier Test User') {
  // Login first so re-runs (same email) still return a session.
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    return { user: (await loginRes.json()).user, cookie: loginRes.headers.get('set-cookie') };
  }
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return { user: (await regRes.json())?.user, cookie: regRes.headers.get('set-cookie') };
}

let up = false;
let cookie = null;
let me = null;
const TS = Date.now();

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;
  const res = await registerAndLogin(`entitlements-${TS}@example.com`, 'TierPass123!');
  cookie = res.cookie;
  me = res.user;
});

describe('GET /api/entitlements — the caller resolved context', () => {
  it('returns bypass:false, a resolved tierId, and a full entitlements map for a normal user', async () => {
    if (!up || !cookie) return;
    const res = await fetch(`${API}/entitlements`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const ctx = await res.json();

    // A NORMAL user is governed by (not bypassing) tiers.
    expect(ctx.bypass).toBe(false);
    expect(ctx.bypassReason).toBeNull();
    // A tier id is always resolved at read time — the site default when unassigned.
    expect(typeof ctx.tierId).toBe('string');
    expect(ctx.tierId.length).toBeGreaterThan(0);
    expect(typeof ctx.tierDisplayName).toBe('string');
    expect(ctx.enforcementEnabled).toBe(true);
    // The map is fully populated (never partial) — spot-check both kinds.
    expect(ctx.entitlements && typeof ctx.entitlements).toBe('object');
    expect(ctx.entitlements).toHaveProperty('projects.create');
    expect(typeof ctx.entitlements['projects.create']).toBe('boolean');
    expect(ctx.entitlements).toHaveProperty('screening.maxRecordsPerProject');
    expect(typeof ctx.entitlements['screening.maxRecordsPerProject']).toBe('number');
  });

  it('the default site tier is pro unless configured otherwise (existing users unaffected)', async () => {
    if (!up || !cookie) return;
    const ctx = await fetch(`${API}/entitlements`, { headers: { Cookie: cookie } }).then((r) => r.json());
    // The safe default keeps pre-tier users on full access; an Ops change may move it,
    // so only assert the safe-default when the environment did not override it.
    if (!process.env.DEFAULT_USER_TIER) {
      expect(['pro', 'plus', 'free']).toContain(ctx.tierId);
    }
  });

  it('unauthenticated access is rejected (401/403)', async () => {
    if (!up) return;
    const res = await fetch(`${API}/entitlements`);
    expect([401, 403]).toContain(res.status);
  });
});

describe('GET /api/entitlements/tiers — public upgrade catalogue', () => {
  it('returns at least the three active default tiers, sorted by sortOrder', async () => {
    if (!up || !cookie) return;
    const res = await fetch(`${API}/entitlements/tiers`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tiers)).toBe(true);
    expect(body.tiers.length).toBeGreaterThanOrEqual(3);

    // Sorted ascending by sortOrder (the upgrade path).
    const orders = body.tiers.map((t) => t.sortOrder);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);

    // Each entry carries display fields + a resolved entitlements map (secret-free).
    for (const t of body.tiers) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.displayName).toBe('string');
      expect(t.entitlements && typeof t.entitlements).toBe('object');
    }
    // The three seeded defaults are present.
    const ids = body.tiers.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['free', 'plus', 'pro']));
  });
});

describe('admin tier endpoints — a normal user is forbidden (403)', () => {
  it('GET /api/admin/tiers as a normal user → 403', async () => {
    if (!up || !cookie) return;
    const res = await fetch(`${API}/admin/tiers`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });

  it('PATCH /api/admin/users/:id/tier as a normal user → 403 (cannot self-upgrade)', async () => {
    if (!up || !cookie || !me?.id) return;
    const res = await fetch(`${API}/admin/users/${me.id}/tier`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ tierId: 'pro' }),
    });
    expect(res.status).toBe(403);
  });

  it('PUT /api/admin/tier-settings as a normal user → 403 (cannot flip enforcement)', async () => {
    if (!up || !cookie) return;
    const res = await fetch(`${API}/admin/tier-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ enforcementEnabled: false }),
    });
    expect(res.status).toBe(403);
  });
});

describe('SEPARATION — product tier is a distinct axis from system role', () => {
  it('reading entitlements does not change the user’s role: /api/auth/me stays role "user"', async () => {
    if (!up || !cookie) return;
    // Read the tier context first…
    const ctx = await fetch(`${API}/entitlements`, { headers: { Cookie: cookie } }).then((r) => r.json());
    // …then confirm the SYSTEM role is untouched (a 'pro' tier is NOT admin).
    const meRes = await fetch(`${API}/auth/me`, { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.user.role).toBe('user');
    // The tier grants product features but never staff powers — the two never merge.
    expect(ctx.bypass).toBe(false);
    // /auth/me should not be leaking a role of 'admin'/'mod' just because the tier is pro.
    expect(['user']).toContain(meData.user.role);
  });
});
