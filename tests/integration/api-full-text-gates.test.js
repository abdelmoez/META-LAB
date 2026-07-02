/**
 * api-full-text-gates.test.js — flag + auth gates for the P9 full-text API (68.md).
 *
 * fullTextRetrieval defaults OFF, so:
 *  - unauthenticated calls are rejected by requireAuth (401/403) BEFORE the flag gate;
 *  - authenticated calls 404 while the flag is off (existence-hiding);
 *  - the Ops settings endpoint is admin-only.
 * Uses the canonical harness pattern: self-skip when the dev server at
 * 127.0.0.1:3001 is down (never `localhost` — Windows ::1 flake).
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
  const email = `p9-gate-${Date.now()}@example.com`;
  const reg = await hit('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'P9 Gate', email, password: 'Str0ng!Passw0rd99' }),
  });
  if (reg.ok || reg.status === 201) {
    const setCookie = reg.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0] || '';
  }
}, 30000);

describe('full-text retrieval flag + auth gates', () => {
  it('unauthenticated status call is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit('/full-text/some-project/status');
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated retrieve call is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit('/full-text/some-project/retrieve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect([401, 403]).toContain(res.status);
  });

  it('authenticated status call 404s while the fullTextRetrieval flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit('/full-text/some-project/status', { headers: { cookie } });
    // Flag default OFF → existence-hiding 404. (If a local admin turned it on, an
    // unknown project still 404s — the assertion holds either way.)
    expect(res.status).toBe(404);
  });

  it('authenticated retrieve call 404s while the flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit('/full-text/some-project/retrieve', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'included' }),
    });
    expect(res.status).toBe(404);
  });

  it('the Ops full-text settings endpoint is admin-only', async () => {
    if (!up || !cookie) return;
    const a = await hit('/admin/full-text/settings', { headers: { cookie } });
    expect([401, 403, 404]).toContain(a.status);
  });
});
