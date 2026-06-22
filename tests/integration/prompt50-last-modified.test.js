/**
 * prompt50-last-modified.test.js — WS5: authoritative "Last Modified" sorting.
 *
 * Verifies that GET /api/projects orders by the meaningful-activity timestamp
 * (Project.lastActivityAt), that a meaningful edit moves a project to the top,
 * that the order is stable across refreshes, and that cross-module activity (a
 * screening decision on a LINKED project) bumps the project too.
 *
 * Requires the API on :3001 (skips gracefully when it is down).
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
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id }; }
const listIds = async (cookie) => (await api('/projects', { cookie })).data.map(p => p.id);
const newProject = async (cookie, name) => (await api('/projects', { method: 'POST', cookie, body: { name } })).data.id;

beforeAll(async () => { try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; } });

describe('prompt50 WS5 — Last Modified project ordering', () => {
  it('orders by lastActivityAt; a meaningful edit jumps to the top and is stable across refresh', async () => {
    if (!up) return;
    const u = await register(`p50lm_${rnd()}@t.local`);
    const p1 = await newProject(u.cookie, 'LM one');
    const p2 = await newProject(u.cookie, 'LM two');
    const p3 = await newProject(u.cookie, 'LM three');

    // The list exposes the authoritative timestamp and is newest-activity-first.
    const list0 = await api('/projects', { cookie: u.cookie });
    const mine0 = list0.data.filter(p => [p1, p2, p3].includes(p.id));
    expect(mine0.every(p => !!p.lastActivityAt)).toBe(true);
    // p3 was created last → it is ahead of p1 in the initial order.
    const order0 = mine0.map(p => p.id);
    expect(order0.indexOf(p3)).toBeLessThan(order0.indexOf(p1));

    // Meaningfully edit the OLDEST project (rename) → it must jump to the top.
    const edit = await api(`/projects/${p1}`, { method: 'PUT', cookie: u.cookie, body: { name: 'LM one (edited)' } });
    expect(edit.status).toBe(200);
    expect(new Date(edit.data.lastActivityAt).getTime()).toBeGreaterThanOrEqual(new Date(edit.data.createdAt).getTime());

    const idsAfter = await listIds(u.cookie);
    const mineAfter = idsAfter.filter(id => [p1, p2, p3].includes(id));
    expect(mineAfter[0]).toBe(p1);

    // Refresh → identical order (deterministic; no flicker).
    const idsRefresh = (await listIds(u.cookie)).filter(id => [p1, p2, p3].includes(id));
    expect(idsRefresh).toEqual(mineAfter);
  });

  it('cross-workstream: a screening decision on a LINKED project bumps its Last Modified', async () => {
    if (!up) return;
    const owner = await register(`p50lm_o_${rnd()}@t.local`);

    // A linked META·LAB + screening project, then a control project created AFTER it.
    const created = await api('/projects', { method: 'POST', cookie: owner.cookie, body: { name: `Linked ${rnd()}`, createLinkedSift: true } });
    expect(created.status).toBe(201);
    const linkedId = created.data.project.id;
    const spid = created.data.linkedScreenProject.id;
    const control = await newProject(owner.cookie, 'Control after linked');

    // Control is newer → currently ahead of the linked project.
    let order = (await listIds(owner.cookie)).filter(id => [linkedId, control].includes(id));
    expect(order.indexOf(control)).toBeLessThan(order.indexOf(linkedId));

    // Screening activity on the linked project: the owner records a decision.
    const rec = await api(`/screening/projects/${spid}/records`, { method: 'POST', cookie: owner.cookie, body: { title: 'Decided', year: '2024' } });
    const decision = await api(`/screening/projects/${spid}/records/${rec.data.id}/decision`, { method: 'POST', cookie: owner.cookie, body: { decision: 'include' } });
    expect(decision.status).toBe(200);

    // The linked project now has the most recent meaningful activity → top.
    order = (await listIds(owner.cookie)).filter(id => [linkedId, control].includes(id));
    expect(order.indexOf(linkedId)).toBeLessThan(order.indexOf(control));
  });
});
