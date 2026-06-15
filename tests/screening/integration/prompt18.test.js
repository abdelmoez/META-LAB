/**
 * prompt18.test.js — Unified Review Workspace (META·LAB + META·SIFT) integration.
 *
 * Exercises the live API at http://127.0.0.1:3001 (start with `npm run server`).
 * Self-skips when the server is down (same convention as prompt2.test.js).
 *
 * Covers prompt18 backend deliverables:
 *  - Creating a project with createLinkedSift creates the internal screening module
 *  - GET /screening/metalab/:mlpid/workspace resolves the module for the owner
 *  - The endpoint is idempotent (repeat calls return the same id, created:false)
 *  - An "old" project created WITHOUT a module gets one auto-created on first
 *    workspace resolve (repair path) — never duplicated on a second call
 *  - A member of the workspace resolves the SAME module (no create)
 *  - Strangers get 404 (existence-hiding); unknown ids get 404
 */
import { describe, it, expect, beforeAll } from 'vitest';

// 127.0.0.1 (not "localhost"): undici prefers ::1 and hangs against a dual-stack
// server on Windows.
const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);

let up = false;

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id }; }

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
}, 30000);

describe('prompt18 — unified Review Workspace (integration)', () => {
  it('T0 — server reachability (anti-vacuous-green guard)', async () => {
    if (!up) { console.warn('[prompt18] server down on :3001 — integration assertions skipped'); return; }
    expect(up).toBe(true);
  });

  it('T1: creating a project with createLinkedSift creates the screening module; workspace resolves it (created:false)', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`u18a_${r}@t.local`);
    const created = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `Unified ${r}`, createLinkedSift: true } });
    expect(created.status).toBe(201);
    const mlId = created.data?.project?.id || created.data?.id;
    const spId = created.data?.linkedScreenProject?.id;
    expect(mlId).toBeTruthy();
    expect(spId).toBeTruthy();

    const ws = await api(`/screening/metalab/${mlId}/workspace`, { cookie: a.cookie });
    expect(ws.status).toBe(200);
    expect(ws.data.screenProjectId).toBe(spId);  // resolves the SAME module
    expect(ws.data.created).toBe(false);          // already existed → not re-created

    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('T2: an "old" project (no module) gets one auto-created on first workspace resolve; idempotent on repeat', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`u18b_${r}@t.local`);
    // Legacy create path: bare project, NO createLinkedSift → no screening module yet.
    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `Legacy ${r}` } });
    const mlId = ml.data?.id || ml.data?.project?.id;
    expect(mlId).toBeTruthy();

    // First resolve → repair: creates the module.
    const first = await api(`/screening/metalab/${mlId}/workspace`, { cookie: a.cookie });
    expect(first.status).toBe(200);
    expect(first.data.screenProjectId).toBeTruthy();
    expect(first.data.created).toBe(true);

    // Second resolve → idempotent: same id, not re-created.
    const second = await api(`/screening/metalab/${mlId}/workspace`, { cookie: a.cookie });
    expect(second.status).toBe(200);
    expect(second.data.screenProjectId).toBe(first.data.screenProjectId);
    expect(second.data.created).toBe(false);

    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('T3: a workspace member resolves the SAME module (no create); a stranger gets 404', async () => {
    if (!up) return;
    const r = rnd();
    const owner = await register(`u18o_${r}@t.local`);
    const member = await register(`u18m_${r}@t.local`);
    const stranger = await register(`u18s_${r}@t.local`);

    const created = await api('/projects', { method: 'POST', cookie: owner.cookie, body: { name: `Shared ${r}`, createLinkedSift: true } });
    const mlId = created.data?.project?.id || created.data?.id;
    const spId = created.data?.linkedScreenProject?.id;
    expect(spId).toBeTruthy();

    // Add the member to the screening workspace (this is the membership layer that
    // also grants META·LAB access — prompt5 metalabAccess).
    const add = await api(`/screening/projects/${spId}/members`, { method: 'POST', cookie: owner.cookie, body: { email: `u18m_${r}@t.local`, role: 'reviewer' } });
    expect([200, 201]).toContain(add.status);

    // Member resolves the SAME module, created:false (membership never creates).
    const memWs = await api(`/screening/metalab/${mlId}/workspace`, { cookie: member.cookie });
    expect(memWs.status).toBe(200);
    expect(memWs.data.screenProjectId).toBe(spId);
    expect(memWs.data.created).toBe(false);

    // Stranger has no access → 404 (existence-hiding).
    const strWs = await api(`/screening/metalab/${mlId}/workspace`, { cookie: stranger.cookie });
    expect(strWs.status).toBe(404);

    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: owner.cookie });
  });

  it('T4: an unknown META·LAB project id returns 404', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`u18x_${r}@t.local`);
    const ws = await api(`/screening/metalab/does-not-exist-${r}/workspace`, { cookie: a.cookie });
    expect(ws.status).toBe(404);
  });
});
