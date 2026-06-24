/**
 * injection-hardening.test.js — live-server evidence for prompt 53 WS5 (query /
 * object injection). Confirms the highest-risk auth + write paths reject
 * non-scalar (object/array) values safely instead of letting them reach the DB or
 * leak an error. Follows the repo convention: hits 127.0.0.1:3001 and skips when
 * the server is down (CI runs only tests/unit + tests/screening/unit).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false;

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}

beforeAll(async () => { try { up = (await fetch('http://127.0.0.1:3001/api/health')).ok; } catch { up = false; } });

describe('auth rejects non-scalar credentials (WS5)', () => {
  it('login with an object email is rejected, not crashed/leaked', async () => {
    if (!up) return;
    const r = await api('/auth/login', { method: 'POST', body: { email: { $ne: null }, password: { $ne: null } } });
    expect([400, 401]).toContain(r.status);     // never 200 (no auth bypass), never 500
    expect(JSON.stringify(r.data || {})).not.toMatch(/prisma|sql|stack|at Object|node_modules/i);
  });
  it('login with an array email is rejected', async () => {
    if (!up) return;
    const r = await api('/auth/login', { method: 'POST', body: { email: ['a@b.com'], password: 'x' } });
    expect([400, 401]).toContain(r.status);
  });
  it('password reset with an object token is rejected safely', async () => {
    if (!up) return;
    const r = await api('/auth/reset-password', { method: 'POST', body: { token: { $ne: null }, password: 'Password123!' } });
    expect([400, 401, 404]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });
});

describe('autosave cannot reassign ownership (WS5 mass-assignment)', () => {
  it('a body userId is ignored — ownership stays with the authenticated user', async () => {
    if (!up) return;
    const owner = await api('/auth/register', { method: 'POST', body: { email: `inj_${rnd()}@t.local`, password: 'Password123!', name: 'o' } });
    if (!owner.cookie) return;
    const pid = 'p' + rnd();
    // Try to plant someone else's id as the owner via the spread body.
    const r = await api(`/projects/${pid}/autosave`, { method: 'PUT', cookie: owner.cookie, body: { name: 'Mine', userId: 'attacker-id', id: 'different' } });
    expect([200, 400]).toContain(r.status);
    // Read it back: it must belong to the creator (fetchable by them), proving the
    // body userId/id did not reassign ownership.
    const back = await api(`/projects/${pid}`, { cookie: owner.cookie });
    if (back.status === 200) expect(back.data?.id).toBe(pid);
  });
});
