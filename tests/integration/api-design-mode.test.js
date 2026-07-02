/**
 * api-design-mode.test.js — server-side enforcement of the Ops-governed design
 * mode (65.md: "Be protected on the server or authorization layer, not merely
 * hidden with CSS").
 *
 * Verifies:
 *   - GET /api/auth/me returns the uiDesignMode field
 *   - an ordinary user CANNOT persist ANY uiDesignMode (403 for both values —
 *     the theme is Ops-governed for users)
 *   - an invalid value is rejected (400)
 *   - an admin CAN persist both values and they round-trip via getMe
 *   - PUT /api/admin/design-settings round-trips allowLegacyFallback (boolean
 *     strictly validated)
 *   - GET /api/settings/public exposes designSettings.allowLegacyFallback
 *
 * Harness mirrors prompt20-user-edit.test.js: fetch-based, server assumed running
 * at http://localhost:3001, self-skips when the server / seeded admin is absent.
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

async function freshUser(tag) {
  const email = `design-mode-${tag}-${TS}@example.com`;
  const password = 'OrigPass12345!';
  const r = await api('/auth/register', { method: 'POST', body: { email, password, name: 'Design Tester' } });
  return { id: r.data?.user?.id, email, password, cookie: r.cookie };
}

describe('design mode — server enforcement', () => {
  it('getMe exposes the uiDesignMode field', async () => {
    if (!up) return;
    const u = await freshUser('me');
    const me = await api('/auth/me', { cookie: u.cookie });
    expect(me.status).toBe(200);
    expect('uiDesignMode' in me.data.user).toBe(true);
  });

  it('refuses to persist ANY uiDesignMode for an ordinary user (403 both values)', async () => {
    if (!up) return;
    const u = await freshUser('block');
    for (const mode of ['stitch', 'legacy']) {
      const put = await api('/profile', { method: 'PUT', cookie: u.cookie, body: { uiDesignMode: mode } });
      expect(put.status, `non-admin uiDesignMode=${mode} must 403`).toBe(403);
    }
    const me = await api('/auth/me', { cookie: u.cookie });
    expect(me.data.user.uiDesignMode == null).toBe(true); // nothing was stored
  });

  it('rejects an invalid mode (400)', async () => {
    if (!up) return;
    const u = await freshUser('invalid');
    const put = await api('/profile', { method: 'PUT', cookie: u.cookie, body: { uiDesignMode: 'vivid' } });
    expect(put.status).toBe(400);
  });

  it('other profile fields still save for an ordinary user (403 scope is uiDesignMode only)', async () => {
    if (!up) return;
    const u = await freshUser('name');
    const put = await api('/profile', { method: 'PUT', cookie: u.cookie, body: { name: 'Renamed Tester' } });
    expect(put.status).toBe(200);
    expect(put.data.user.name).toBe('Renamed Tester');
  });

  it('lets an admin persist both values and round-trips them', async () => {
    if (!up || !adminCookie) return;
    const put = await api('/profile', { method: 'PUT', cookie: adminCookie, body: { uiDesignMode: 'legacy' } });
    expect(put.status).toBe(200);
    expect(put.data.user.uiDesignMode).toBe('legacy');
    const me = await api('/auth/me', { cookie: adminCookie });
    expect(me.data.user.uiDesignMode).toBe('legacy');
    // Leave the admin on stitch — the product UI (and what the e2e suite expects).
    const reset = await api('/profile', { method: 'PUT', cookie: adminCookie, body: { uiDesignMode: 'stitch' } });
    expect(reset.status).toBe(200);
    expect(reset.data.user.uiDesignMode).toBe('stitch');
  });
});

describe('design settings — Ops governance (allowLegacyFallback)', () => {
  it('PUT /api/admin/design-settings round-trips allowLegacyFallback', async () => {
    if (!up || !adminCookie) return;
    const original = await api('/admin/design-settings', { cookie: adminCookie });
    expect(original.status).toBe(200);
    expect(typeof original.data.allowLegacyFallback).toBe('boolean');

    try {
      const flipped = !original.data.allowLegacyFallback;
      const put = await api('/admin/design-settings', {
        method: 'PUT', cookie: adminCookie, body: { allowLegacyFallback: flipped },
      });
      expect(put.status).toBe(200);
      expect(put.data.allowLegacyFallback).toBe(flipped);
      // Untouched fields survive the partial PUT.
      expect(put.data.defaultMode).toBe(original.data.defaultMode);

      const readBack = await api('/admin/design-settings', { cookie: adminCookie });
      expect(readBack.data.allowLegacyFallback).toBe(flipped);
    } finally {
      // Restore the global setting so sibling tests/specs are never poisoned.
      await api('/admin/design-settings', {
        method: 'PUT', cookie: adminCookie, body: { allowLegacyFallback: original.data.allowLegacyFallback },
      });
    }
  });

  it('rejects a non-boolean allowLegacyFallback (400, strict validation)', async () => {
    if (!up || !adminCookie) return;
    const put = await api('/admin/design-settings', {
      method: 'PUT', cookie: adminCookie, body: { allowLegacyFallback: 'yes' },
    });
    expect(put.status).toBe(400);
  });

  it('GET /api/settings/public exposes designSettings.allowLegacyFallback', async () => {
    if (!up) return;
    const pub = await api('/settings/public');
    expect(pub.status).toBe(200);
    expect(pub.data.designSettings).toBeTruthy();
    expect(typeof pub.data.designSettings.allowLegacyFallback).toBe('boolean');
    expect(['legacy', 'stitch']).toContain(pub.data.designSettings.defaultMode);
  });
});
