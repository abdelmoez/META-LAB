/**
 * prompt23-presence.test.js — TWO-SESSION end-to-end test of project presence +
 * field locking (prompt23 Tasks 5/13/14/15) against the running API server.
 *
 * Two real users (A owner, B active member) heartbeat, see each other, and
 * contend for a field lock. This is the automated form of the "open the project
 * as two users" manual QA — more reliable than clicking.
 *
 * Run: server on :3001, then
 *   npx vitest run tests/integration/prompt23-presence.test.js \
 *     --pool=forks --poolOptions.forks.singleFork=true
 * Skips gracefully if the server is down.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';
const TS = Date.now();

async function serverUp() {
  try { return (await fetch(`${API}/health`)).ok; } catch { return false; }
}
async function jreq(method, path, cookie, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data, cookie: res.headers.get('set-cookie') };
}
async function makeUser(tag) {
  const email = `p23-${tag}-${TS}@example.com`;
  const r = await jreq('POST', '/auth/register', null, { email, password: 'PresencePass123!', name: `User ${tag}` });
  return { email, cookie: r.cookie, id: r.data?.user?.id, status: r.status };
}

let up = false;
beforeAll(async () => { up = await serverUp(); });

describe('two-session presence + field locking', () => {
  it('tracks both users, enforces a single lock holder, and frees on release', async () => {
    if (!up) { console.warn('[SKIP] server not up on :3001'); return; }

    // ── Two sessions ────────────────────────────────────────────────────────
    const A = await makeUser('owner');
    const B = await makeUser('member');
    expect(A.cookie && B.cookie).toBeTruthy();
    expect(A.id && B.id).toBeTruthy();

    // A creates a screening project and adds B as an active member.
    const proj = await jreq('POST', '/screening/projects', A.cookie, { title: `QA Presence ${TS}` });
    expect([200, 201]).toContain(proj.status);
    const pid = proj.data?.id || proj.data?.project?.id;
    expect(pid).toBeTruthy();

    const add = await jreq('POST', `/screening/projects/${pid}/members`, A.cookie, { email: B.email, preset: 'reviewer', modules: 'both' });
    expect([200, 201]).toContain(add.status);

    // ── Presence: both users heartbeat with a location ──────────────────────
    await jreq('POST', `/screening/projects/${pid}/presence/heartbeat`, A.cookie, { location: 'Screening · Title & Abstract' });
    await jreq('POST', `/screening/projects/${pid}/presence/heartbeat`, B.cookie, { location: 'PICO' });

    const snap = await jreq('GET', `/screening/projects/${pid}/presence`, A.cookie);
    expect(snap.status).toBe(200);
    const ids = (snap.data.users || []).map(u => u.userId);
    expect(ids).toContain(A.id);
    expect(ids).toContain(B.id);
    const bEntry = snap.data.users.find(u => u.userId === B.id);
    expect(bEntry.location).toBe('PICO'); // location is tracked

    // ── Field lock contention ───────────────────────────────────────────────
    const aLock = await jreq('POST', `/screening/projects/${pid}/locks/acquire`, A.cookie, { field: 'pico.C' });
    expect(aLock.status).toBe(200);
    expect(aLock.data.ok).toBe(true);

    // B cannot take the same field — sees A as the holder.
    const bBlocked = await jreq('POST', `/screening/projects/${pid}/locks/acquire`, B.cookie, { field: 'pico.C' });
    expect(bBlocked.status).toBe(409);
    expect(bBlocked.data.ok).toBe(false);
    expect(bBlocked.data.lock.userId).toBe(A.id);

    // The lock surfaces in the shared snapshot.
    const snap2 = await jreq('GET', `/screening/projects/${pid}/presence`, B.cookie);
    expect((snap2.data.locks || []).some(l => l.field === 'pico.C' && l.userId === A.id)).toBe(true);

    // ── Release → B can now acquire ─────────────────────────────────────────
    const rel = await jreq('POST', `/screening/projects/${pid}/locks/release`, A.cookie, { field: 'pico.C' });
    expect(rel.status).toBe(200);
    const bNow = await jreq('POST', `/screening/projects/${pid}/locks/acquire`, B.cookie, { field: 'pico.C' });
    expect(bNow.status).toBe(200);
    expect(bNow.data.ok).toBe(true);

    // A different field can be held by A at the same time (no false contention).
    const aOther = await jreq('POST', `/screening/projects/${pid}/locks/acquire`, A.cookie, { field: 'pico.P' });
    expect(aOther.data.ok).toBe(true);
  });

  it('denies presence to a non-member (privacy)', async () => {
    if (!up) return;
    const A = await makeUser('owner2');
    const Out = await makeUser('outsider');
    const proj = await jreq('POST', '/screening/projects', A.cookie, { title: `QA Privacy ${TS}` });
    const pid = proj.data?.id || proj.data?.project?.id;
    const res = await jreq('GET', `/screening/projects/${pid}/presence`, Out.cookie);
    expect(res.status).toBe(404); // outsiders can't even learn the project exists
  });
});
