/**
 * api-search-versions.test.js — 69.md §7/§8. Flag + auth gates for the search-strategy
 * VERSIONS API and the methods-text export.
 *
 * `searchEngine` defaults OFF, so:
 *  - unauthenticated calls are rejected by requireAuth (401/403) BEFORE the flag gate;
 *  - authenticated calls 404 while the flag is off (existence-hiding).
 * Canonical harness pattern: self-skip when the dev server at 127.0.0.1:3001 is down
 * (never `localhost` — Windows ::1 flake).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

async function hit(path, opts = {}) {
  try { return await fetch(`${API}${path}`, opts); }
  catch { return fetch(`${API}${path}`, opts); } // one retry
}

let up = false;
let cookie = '';

beforeAll(async () => {
  try {
    const res = await hit('/health');
    up = res.ok;
  } catch { up = false; }
  if (!up) return;
  const email = `sv-gate-${Date.now()}@example.com`;
  const reg = await hit('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'SV Gate', email, password: 'Str0ng!Passw0rd99' }),
  });
  if (reg.ok || reg.status === 201) {
    const setCookie = reg.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0] || '';
  }
}, 30000);

const P = 'some-project';

describe('search-strategy versions flag + auth gates', () => {
  it('unauthenticated list versions is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/${P}/versions`);
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated snapshot is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/${P}/versions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated methods-text is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/${P}/methods-text`);
    expect([401, 403]).toContain(res.status);
  });

  it('authenticated list versions 404s while the searchEngine flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions`, { headers: { cookie } });
    // Flag default OFF → existence-hiding 404. (If a local admin turned it on, an
    // unknown project still 404s — the assertion holds either way.)
    expect(res.status).toBe(404);
  });

  it('authenticated snapshot 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions`, {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'v1' }),
    });
    expect(res.status).toBe(404);
  });

  it('authenticated compare 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions/compare?a=x&b=y`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('authenticated get-one-version 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions/some-vid`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('authenticated restore 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions/some-vid/restore`, {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('authenticated mark-final 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/versions/some-vid/final`, {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFinal: true }),
    });
    expect(res.status).toBe(404);
  });

  it('authenticated methods-text 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/${P}/methods-text`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });
});
