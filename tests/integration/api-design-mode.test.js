/**
 * api-design-mode.test.js — server-side enforcement of the parallel design-mode
 * preference (design.md §5: "Be protected on the server or authorization layer,
 * not merely hidden with CSS").
 *
 * Verifies:
 *   - GET /api/auth/me returns the uiDesignMode field
 *   - an ordinary user CANNOT persist "stitch" (403) — admin-only
 *   - an ordinary user CAN persist "legacy" (the safe default / reset value)
 *   - an admin CAN persist "stitch" and it round-trips via getMe
 *   - an admin can reset back to "legacy"
 *   - an invalid value is rejected (400)
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

  it('refuses to persist "stitch" for an ordinary user (403)', async () => {
    if (!up) return;
    const u = await freshUser('block');
    const put = await api('/profile', { method: 'PUT', cookie: u.cookie, body: { uiDesignMode: 'stitch' } });
    expect(put.status).toBe(403);
    const me = await api('/auth/me', { cookie: u.cookie });
    expect(me.data.user.uiDesignMode == null || me.data.user.uiDesignMode === 'legacy').toBe(true);
  });

  it('allows an ordinary user to set "legacy" (the safe default)', async () => {
    if (!up) return;
    const u = await freshUser('legacy');
    const put = await api('/profile', { method: 'PUT', cookie: u.cookie, body: { uiDesignMode: 'legacy' } });
    expect(put.status).toBe(200);
    expect(put.data.user.uiDesignMode).toBe('legacy');
  });

  it('rejects an invalid mode (400)', async () => {
    if (!up) return;
    const u = await freshUser('invalid');
    const put = await api('/profile', { method: 'PUT', cookie: u.cookie, body: { uiDesignMode: 'vivid' } });
    expect(put.status).toBe(400);
  });

  it('lets an admin persist "stitch" and round-trips it', async () => {
    if (!up || !adminCookie) return;
    const put = await api('/profile', { method: 'PUT', cookie: adminCookie, body: { uiDesignMode: 'stitch' } });
    expect(put.status).toBe(200);
    expect(put.data.user.uiDesignMode).toBe('stitch');
    const me = await api('/auth/me', { cookie: adminCookie });
    expect(me.data.user.uiDesignMode).toBe('stitch');
    // reset so the admin account is left on legacy for other tests / sessions
    const reset = await api('/profile', { method: 'PUT', cookie: adminCookie, body: { uiDesignMode: 'legacy' } });
    expect(reset.status).toBe(200);
    expect(reset.data.user.uiDesignMode).toBe('legacy');
  });
});
