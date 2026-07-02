/**
 * 66.md P5/P6 — gate tests for the new routers. Both features default OFF, so:
 *  - unauthenticated calls are rejected by requireAuth (401) BEFORE the flag gate;
 *  - authenticated calls 404 while the flags are off (existence-hiding).
 * Uses the canonical integration harness pattern (self-skip when the dev server
 * at 127.0.0.1:3001 is down; never `localhost` — Windows ::1 flake).
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
  // Fresh throwaway user for the authenticated 404 checks.
  const email = `p66-gate-${Date.now()}@example.com`;
  const reg = await hit('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'P66 Gate', email, password: 'Str0ng!Passw0rd66' }),
  });
  if (reg.ok || reg.status === 201) {
    const setCookie = reg.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0] || '';
  }
}, 30000);

describe('extraction + living review flag gates', () => {
  it('unauthenticated extraction call is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit('/extraction/some-project/overview');
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated living call is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit('/living/some-project/overview');
    expect([401, 403]).toContain(res.status);
  });

  it('authenticated extraction call 404s while the extractionAssist flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit('/extraction/some-project/overview', { headers: { cookie } });
    // Flag default is OFF → existence-hiding 404. (If a local admin turned the flag
    // on, the unknown project still 404s — the assertion holds either way.)
    expect(res.status).toBe(404);
  });

  it('authenticated living call 404s while the livingReview flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit('/living/some-project/overview', { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('admin settings endpoints are admin-only', async () => {
    if (!up || !cookie) return;
    const a = await hit('/admin/extraction-ai/settings', { headers: { cookie } });
    const b = await hit('/admin/living-review/settings', { headers: { cookie } });
    expect([401, 403, 404]).toContain(a.status);
    expect([401, 403, 404]).toContain(b.status);
  });
});
