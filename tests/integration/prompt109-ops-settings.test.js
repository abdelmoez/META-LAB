/**
 * prompt109-ops-settings.test.js — 109.md §§5, 42, 43, 56, 60.
 *
 * End-to-end checks for the Ops control-plane settings surface:
 *   - authorization (401 unauthenticated, 403 ordinary user) on every new route,
 *     because "frontend controls alone are not authorization" (§56);
 *   - the typed research-governance GET/PUT/reset round-trip, including clamping,
 *     enum filtering and read-only rejection;
 *   - the validated feature-flag writers (whole-blob PUT stays backward
 *     compatible; the single-key PATCH is read-merge-write);
 *   - the new 107/108 flags default ON in the public payload.
 *
 * GLOBAL-STATE SAFETY: every mutating case captures the original value through
 * the API and restores it in a finally block, exactly like e2e/ops/ops.spec.ts.
 * The whole file self-skips when the API on :3001 is down, and authenticated
 * cases additionally skip when the seeded admin password is unknown here.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false;
let adminCookie = '';
let userCookie = '';

function cookieFrom(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/metalab_session=[^;]+/);
  return m ? m[0] : '';
}
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data, cookie: cookieFrom(res) };
}

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (!up) return;
  for (const email of ['ops@example.com', 'admin@example.com']) {
    const r = await api('/auth/login', {
      method: 'POST',
      body: { email, password: process.env.ADMIN_SEED_PASSWORD || 'LocalTestAdmin#2026' },
    });
    if (r.status === 200) { adminCookie = r.cookie; break; }
  }
  const reg = await api('/auth/register', {
    method: 'POST', body: { email: `ops109-${rnd()}@example.com`, password: 'Password123!', name: 'ops109' },
  });
  userCookie = reg.cookie || '';
});

const GOV = '/admin/research-governance/settings';

describe('109 — authorization on the new Ops control-plane routes', () => {
  const CASES = [
    ['GET', GOV],
    ['PUT', GOV],
    ['POST', `${GOV}/reset`],
    ['PATCH', '/admin/feature-flags/projectUndoRedo'],
  ];

  it.each(CASES)('%s %s → 401 unauthenticated', async (method, path) => {
    if (!up) return;
    const r = await api(path, { method, body: method === 'GET' ? undefined : {} });
    expect(r.status).toBe(401);
  });

  it.each(CASES)('%s %s → 403 for an ordinary signed-in user', async (method, path) => {
    if (!up || !userCookie) return;
    const r = await api(path, { method, cookie: userCookie, body: method === 'GET' ? undefined : {} });
    expect(r.status).toBe(403);
  });
});

describe('109 — research-governance settings (typed, clamped, audited)', () => {
  it('GET returns settings + defaults with the catalogue shape', async () => {
    if (!up || !adminCookie) return;
    const r = await api(GOV, { cookie: adminCookie });
    expect(r.status).toBe(200);
    expect(r.data.settings).toBeTruthy();
    expect(r.data.defaults).toBeTruthy();
    expect(r.data.defaults.historyCap).toBe(20);
    expect(r.data.defaults.conflictBehavior).toBe('flag_for_review');
    expect(typeof r.data.settings.autoLoadMoreEnabled).toBe('boolean');
  });

  it('PUT round-trips a value and clamps an out-of-range one', async () => {
    if (!up || !adminCookie) return;
    const before = (await api(GOV, { cookie: adminCookie })).data.settings;
    try {
      const ok = await api(GOV, { method: 'PUT', cookie: adminCookie, body: { historyCap: 45, reason: 'integration test' } });
      expect(ok.status).toBe(200);
      expect(ok.data.settings.historyCap).toBe(45);
      expect(ok.data.changed).toContain('interaction.historyCap');

      const clamped = await api(GOV, { method: 'PUT', cookie: adminCookie, body: { historyCap: 99999 } });
      expect(clamped.data.settings.historyCap).toBe(100);

      // Omitted keys keep their stored value (read-merge-write, not whole-blob).
      const partial = await api(GOV, { method: 'PUT', cookie: adminCookie, body: { undoToastEnabled: false } });
      expect(partial.data.settings.historyCap).toBe(100);
      expect(partial.data.settings.undoToastEnabled).toBe(false);
    } finally {
      await api(GOV, { method: 'PUT', cookie: adminCookie, body: before });
    }
  });

  it('rejects unknown keys, bad enums and read-only scientific settings', async () => {
    if (!up || !adminCookie) return;
    const before = (await api(GOV, { cookie: adminCookie })).data.settings;
    try {
      const bad = await api(GOV, {
        method: 'PUT', cookie: adminCookie,
        body: { notASetting: 1, conflictBehavior: 'put_it_in_both', 'analysis.compatibilityGuard': false },
      });
      expect(bad.status).toBe(400);
      expect(bad.data.rejected.map((x) => x.key)).toContain('keywords.conflictBehavior');
      const after = (await api(GOV, { cookie: adminCookie })).data.settings;
      expect(after.conflictBehavior).toBe(before.conflictBehavior);
      expect(after.notASetting).toBeUndefined();
      expect(after.compatibilityGuard).toBeUndefined();
    } finally {
      await api(GOV, { method: 'PUT', cookie: adminCookie, body: before });
    }
  });

  it('reset previews the changes before writing, then restores defaults', async () => {
    if (!up || !adminCookie) return;
    const before = (await api(GOV, { cookie: adminCookie })).data.settings;
    try {
      await api(GOV, { method: 'PUT', cookie: adminCookie, body: { historyCap: 95 } });
      const preview = await api(`${GOV}/reset`, { method: 'POST', cookie: adminCookie, body: { preview: true } });
      expect(preview.status).toBe(200);
      expect(preview.data.preview).toBe(true);
      expect(preview.data.changes.map((c) => c.key)).toContain('interaction.historyCap');
      // A preview must not write.
      expect((await api(GOV, { cookie: adminCookie })).data.settings.historyCap).toBe(95);

      const done = await api(`${GOV}/reset`, { method: 'POST', cookie: adminCookie, body: { reason: 'integration test' } });
      expect(done.status).toBe(200);
      expect(done.data.settings.historyCap).toBe(20);
    } finally {
      await api(GOV, { method: 'PUT', cookie: adminCookie, body: before });
    }
  });

  it('a governance change writes an audit entry with a from→to diff', async () => {
    if (!up || !adminCookie) return;
    const before = (await api(GOV, { cookie: adminCookie })).data.settings;
    try {
      await api(GOV, { method: 'PUT', cookie: adminCookie, body: { historyCap: 55, reason: 'audit check' } });
      const log = await api('/admin/audit-log?action=UPDATE_RESEARCH_GOVERNANCE&limit=5', { cookie: adminCookie });
      expect(log.status).toBe(200);
      const row = (log.data.logs || [])[0];
      expect(row).toBeTruthy();
      const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      expect(d.scope).toBe('global');
      expect(d.updatedKeys).toContain('interaction.historyCap');
      expect(d.after['interaction.historyCap']).toBe(55);
      expect(row.reason).toBe('audit check');
    } finally {
      await api(GOV, { method: 'PUT', cookie: adminCookie, body: before });
    }
  });
});

describe('109 — validated feature-flag writers', () => {
  const FLAG = 'projectUndoRedo';

  it('the new 107/108 flags default ON in the public settings payload', async () => {
    if (!up) return;
    const res = await fetch(`${BASE}/settings/public`);
    const data = await res.json();
    for (const k of ['keywordSuggestions', 'abstractKeywordShortcuts', 'keywordContextMenu', 'projectUndoRedo']) {
      expect(data.featureFlags[k], k).toBe(true);
    }
    // The research-governance block rides the same payload (one client fetch).
    expect(data.researchGovernanceSettings).toBeTruthy();
    expect(typeof data.researchGovernanceSettings.historyCap).toBe('number');
  });

  it('PATCH /feature-flags/:key flips ONE flag and leaves the rest alone', async () => {
    if (!up || !adminCookie) return;
    const before = (await api('/admin/feature-flags', { cookie: adminCookie })).data;
    try {
      const r = await api(`/admin/feature-flags/${FLAG}`, {
        method: 'PATCH', cookie: adminCookie, body: { enabled: false, reason: 'integration test' },
      });
      expect(r.status).toBe(200);
      expect(r.data.enabled).toBe(false);
      const after = (await api('/admin/feature-flags', { cookie: adminCookie })).data;
      expect(after[FLAG]).toBe(false);
      expect(after.autosave).toBe(before.autosave);
      expect(after.keywordSuggestions).toBe(before.keywordSuggestions);
    } finally {
      await api(`/admin/feature-flags/${FLAG}`, { method: 'PATCH', cookie: adminCookie, body: { enabled: before[FLAG] !== false } });
    }
  });

  it('PATCH rejects an unknown flag (404) and a non-boolean value (400)', async () => {
    if (!up || !adminCookie) return;
    expect((await api('/admin/feature-flags/notARealFlag', { method: 'PATCH', cookie: adminCookie, body: { enabled: true } })).status).toBe(404);
    expect((await api(`/admin/feature-flags/${FLAG}`, { method: 'PATCH', cookie: adminCookie, body: { enabled: 'yes' } })).status).toBe(400);
  });

  it('the whole-blob PUT stays backward compatible but drops junk keys', async () => {
    if (!up || !adminCookie) return;
    const before = (await api('/admin/feature-flags', { cookie: adminCookie })).data;
    try {
      const r = await api('/admin/feature-flags', {
        method: 'PUT', cookie: adminCookie, body: { ...before, [FLAG]: false, notARealFlag: true, autosave: 'yes' },
      });
      expect(r.status).toBe(200);
      expect(r.data[FLAG]).toBe(false);
      expect(r.data.notARealFlag).toBeUndefined();
      expect(r.data.autosave).toBe(before.autosave); // the string was rejected, not coerced
    } finally {
      await api('/admin/feature-flags', { method: 'PUT', cookie: adminCookie, body: before });
    }
  });

  it('a flag flip writes a per-flag from→to audit entry', async () => {
    if (!up || !adminCookie) return;
    const before = (await api('/admin/feature-flags', { cookie: adminCookie })).data;
    try {
      await api(`/admin/feature-flags/${FLAG}`, { method: 'PATCH', cookie: adminCookie, body: { enabled: false, reason: 'flag audit check' } });
      const log = await api('/admin/audit-log?action=UPDATE_FEATURE_FLAG&limit=5', { cookie: adminCookie });
      const row = (log.data.logs || [])[0];
      expect(row).toBeTruthy();
      const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      expect(d.changes[0].key).toBe(FLAG);
      expect(d.changes[0].to).toBe(false);
      expect(d.before[FLAG]).toBe(true);
    } finally {
      await api(`/admin/feature-flags/${FLAG}`, { method: 'PATCH', cookie: adminCookie, body: { enabled: before[FLAG] !== false } });
    }
  });
});
