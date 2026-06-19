/**
 * api-theme.test.js — global brand theme endpoints (prompt37).
 *
 * Skips entirely when the dev server is not running (same pattern as the other
 * integration suites). Admin-mutation coverage that needs seeded admin
 * credentials is documented in describe.skip; the public + authorization-shape
 * checks run against any running server.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';
const HEX6 = /^#[0-9a-f]{6}$/;

async function serverUp() {
  try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
}

let up = false;
beforeAll(async () => { up = await serverUp(); });

describe('GET /api/settings/theme (public)', () => {
  it('returns a complete theme record without auth', async () => {
    if (!up) return;
    const r = await fetch(`${API}/settings/theme`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(HEX6.test(d.brandColor)).toBe(true);
    expect(typeof d.preset).toBe('string');
    // palette is either null (default) or a {day,night} object
    expect(d.palette === null || typeof d.palette === 'object').toBe(true);
  });
});

describe('GET /api/settings/public', () => {
  it('includes a themeSettings block', async () => {
    if (!up) return;
    const r = await fetch(`${API}/settings/public`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d.themeSettings).toBeTruthy();
    expect(HEX6.test(d.themeSettings.brandColor)).toBe(true);
  });
});

describe('PATCH /api/admin/settings/theme authorization', () => {
  it('rejects an unauthenticated request (401)', async () => {
    if (!up) return;
    const r = await fetch(`${API}/admin/settings/theme`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandColor: '#2563eb' }),
    });
    expect([401, 403]).toContain(r.status);
  });

  it('rejects a non-admin user (403)', async () => {
    if (!up) return;
    // Register/login an ordinary user (always role:user) and attempt the PATCH.
    const email = `theme_user_${Date.now()}@example.com`;
    const reg = await fetch(`${API}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Passw0rd!23', name: 'Theme User' }),
    });
    const cookie = reg.headers.get('set-cookie');
    if (!cookie) return; // registration disabled on this server → skip
    const r = await fetch(`${API}/admin/settings/theme`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ brandColor: '#2563eb' }),
    });
    expect(r.status).toBe(403);
  });
});

// Admin mutation coverage (validation 422, audit APP_THEME_UPDATED, persistence)
// requires seeded admin credentials — see tests/integration/api-admin.test.js for
// the seed/env convention. Documented here as the expected behavior:
//   PATCH { brandColor:'#2563eb' }            → 200, stored + audited
//   PATCH { brandColor:'not-a-color' }        → 422
//   PATCH { palette:{ day:{ acc:'x;}' } } }   → 422 (injection guard)
//   PATCH { reset:true }                      → 200, brandColor back to #4f46e5
describe.skip('PATCH /api/admin/settings/theme (needs seeded admin)', () => {
  it('documented above', () => {});
});
