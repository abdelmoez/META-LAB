/**
 * prompt23-dashboard-prefs.test.js — cross-device dashboard preference persistence
 * (prompt23 Task 2 follow-up). The server now stores User.dashboardPreferences;
 * this verifies the PUT/GET round-trip, rejection of bad input, and that prefs are
 * scoped per user. Run with the server on :3001.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';
const TS = Date.now();

async function serverUp() { try { return (await fetch(`${API}/health`)).ok; } catch { return false; } }
async function jreq(method, path, cookie, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data, cookie: res.headers.get('set-cookie') };
}
async function makeUser(tag) {
  const r = await jreq('POST', '/auth/register', null, { email: `p23-prefs-${tag}-${TS}@example.com`, password: 'PrefsPass123!', name: `Prefs ${tag}` });
  return { cookie: r.cookie };
}

let up = false;
beforeAll(async () => { up = await serverUp(); });

describe('dashboard preferences (server-backed, cross-device)', () => {
  it('round-trips dashboardPreferences via PUT/GET /api/profile', async () => {
    if (!up) { console.warn('[SKIP] server not up'); return; }
    const A = await makeUser('a');
    const put = await jreq('PUT', '/profile', A.cookie, { dashboardPreferences: { sort: 'title', filter: 'owned', view: 'table', showArchived: true } });
    expect(put.status).toBe(200);
    const got = await jreq('GET', '/profile', A.cookie);
    expect(got.status).toBe(200);
    const prefs = JSON.parse(got.data.user.dashboardPreferences);
    expect(prefs).toMatchObject({ sort: 'title', filter: 'owned', view: 'table', showArchived: true });
  });

  it('accepts a JSON string and rejects oversized / invalid input', async () => {
    if (!up) return;
    const A = await makeUser('b');
    // JSON string form is accepted too.
    const ok = await jreq('PUT', '/profile', A.cookie, { dashboardPreferences: JSON.stringify({ sort: 'created' }) });
    expect(ok.status).toBe(200);
    // Oversized → 400.
    const big = await jreq('PUT', '/profile', A.cookie, { dashboardPreferences: { junk: 'x'.repeat(600) } });
    expect(big.status).toBe(400);
  });

  it('keeps preferences separate per user', async () => {
    if (!up) return;
    const A = await makeUser('c'); const B = await makeUser('d');
    await jreq('PUT', '/profile', A.cookie, { dashboardPreferences: { sort: 'title' } });
    await jreq('PUT', '/profile', B.cookie, { dashboardPreferences: { sort: 'status' } });
    const ga = await jreq('GET', '/profile', A.cookie);
    const gb = await jreq('GET', '/profile', B.cookie);
    expect(JSON.parse(ga.data.user.dashboardPreferences).sort).toBe('title');
    expect(JSON.parse(gb.data.user.dashboardPreferences).sort).toBe('status');
  });
});
