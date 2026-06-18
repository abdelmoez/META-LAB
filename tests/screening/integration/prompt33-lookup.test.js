/**
 * prompt33-lookup.test.js — Screening integration tests for prompt33 Task 2.
 *
 * Project-scoped registered-user lookup powering the Add Member "find existing user
 * first, invite only if not found" flow. Exercises the live API at
 * http://127.0.0.1:3001 (start with `npm run server`). Self-skips when down.
 *
 * Covers:
 *  - unknown email → { found:false }
 *  - registered non-member → { found:true, alreadyMember:false, user:{name,email} }
 *  - after adding them → { found:true, alreadyMember:true, currentRole }
 *  - invalid email → 400 (no lookup)
 *  - a reviewer (no canManageMembers) → 403 (not an open enumeration endpoint)
 *  - returns only minimal safe fields (id, name, email) — never a password hash etc.
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
async function register(email, name) {
  const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: name || email.split('@')[0] } });
  return { cookie: r.cookie, id: r.data?.user?.id };
}
async function newProject(cookie, title) {
  const proj = await api('/screening/projects', { method: 'POST', cookie, body: { title } });
  return proj.data?.id;
}
const lookup = (cookie, pid, email) => api(`/screening/projects/${pid}/members/lookup?email=${encodeURIComponent(email)}`, { cookie });

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
});

describe('prompt33 — Add Member email lookup', () => {
  it('unknown email → { found:false }', async () => {
    if (!up) return;
    const owner = await register(`own_${rnd()}@ex.com`);
    const pid = await newProject(owner.cookie, 'Lookup A');
    const r = await lookup(owner.cookie, pid, `ghost_${rnd()}@nowhere.com`);
    expect(r.status).toBe(200);
    expect(r.data.found).toBe(false);
  });

  it('registered non-member → found with name, alreadyMember:false, minimal safe fields', async () => {
    if (!up) return;
    const owner = await register(`own_${rnd()}@ex.com`);
    const targetEmail = `target_${rnd()}@ex.com`;
    await register(targetEmail, 'Jane Researcher');
    const pid = await newProject(owner.cookie, 'Lookup B');
    const r = await lookup(owner.cookie, pid, targetEmail);
    expect(r.status).toBe(200);
    expect(r.data.found).toBe(true);
    expect(r.data.alreadyMember).toBe(false);
    expect(r.data.user.name).toBe('Jane Researcher');
    expect(r.data.user.email).toBe(targetEmail);
    // minimal safe fields only — never leak credentials/other columns
    expect(Object.keys(r.data.user).sort()).toEqual(['email', 'id', 'name']);
  });

  it('case-insensitive: UPPERCASE email still matches', async () => {
    if (!up) return;
    const owner = await register(`own_${rnd()}@ex.com`);
    const targetEmail = `mix_${rnd()}@ex.com`;
    await register(targetEmail, 'Casey Case');
    const pid = await newProject(owner.cookie, 'Lookup C');
    const r = await lookup(owner.cookie, pid, targetEmail.toUpperCase());
    expect(r.status).toBe(200);
    expect(r.data.found).toBe(true);
  });

  it('after adding the user → alreadyMember:true with currentRole', async () => {
    if (!up) return;
    const owner = await register(`own_${rnd()}@ex.com`);
    const targetEmail = `mem_${rnd()}@ex.com`;
    await register(targetEmail, 'Bob Member');
    const pid = await newProject(owner.cookie, 'Lookup D');
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: targetEmail, preset: 'reviewer' } });
    const r = await lookup(owner.cookie, pid, targetEmail);
    expect(r.status).toBe(200);
    expect(r.data.found).toBe(true);
    expect(r.data.alreadyMember).toBe(true);
    expect(r.data.currentRole).toBe('reviewer');
  });

  it('unregistered email with an outstanding invite → { found:false, pendingInvite:true }', async () => {
    if (!up) return;
    const owner = await register(`own_${rnd()}@ex.com`);
    const inviteEmail = `invitee_${rnd()}@nowhere.com`; // never registered
    const pid = await newProject(owner.cookie, 'Lookup H');
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: inviteEmail, preset: 'reviewer' } });
    const r = await lookup(owner.cookie, pid, inviteEmail);
    expect(r.status).toBe(200);
    expect(r.data.found).toBe(false);
    expect(r.data.pendingInvite).toBe(true);
    expect(r.data.currentRole).toBe('reviewer');
  });

  it('invalid email → 400, no lookup', async () => {
    if (!up) return;
    const owner = await register(`own_${rnd()}@ex.com`);
    const pid = await newProject(owner.cookie, 'Lookup E');
    const r = await lookup(owner.cookie, pid, 'not-an-email');
    expect(r.status).toBe(400);
  });

  it('a reviewer (no manage-members) cannot look up → 403', async () => {
    if (!up) return;
    const owner = await register(`own_${rnd()}@ex.com`);
    const reviewerEmail = `rev_${rnd()}@ex.com`;
    const reviewer = await register(reviewerEmail, 'Rev Iewer');
    const pid = await newProject(owner.cookie, 'Lookup F');
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: owner.cookie, body: { email: reviewerEmail, preset: 'reviewer' } });
    const r = await lookup(reviewer.cookie, pid, `someone_${rnd()}@ex.com`);
    expect(r.status).toBe(403);
  });

  it('a non-member cannot look up → 404 (existence-hiding)', async () => {
    if (!up) return;
    const owner = await register(`own_${rnd()}@ex.com`);
    const stranger = await register(`str_${rnd()}@ex.com`);
    const pid = await newProject(owner.cookie, 'Lookup G');
    const r = await lookup(stranger.cookie, pid, `x_${rnd()}@ex.com`);
    expect(r.status).toBe(404);
  });
});
