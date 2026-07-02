/**
 * prompt4.test.js — server-ready upgrade integration tests (prompt4).
 *   T6 version endpoint · T8 creator→owner role · T9 member presets + module
 *   permissions + leader-cannot-edit-owner · T2/T3 admin user edit + Mod role
 *   gating · T7 chat typing indicator.
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false, adminCookie = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id }; }

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (up) { const r = await api('/auth/login', { method: 'POST', body: { email: 'ops@metalab.local', password: process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!' } }); if (r.status === 200) adminCookie = r.cookie; }
}, 30000);

describe('META·SIFT prompt4 server-ready upgrade (integration)', () => {
  // 52.md header-fingerprinting hardening (publicVersion): build metadata
  // (commit hash, commit/build dates) is deliberately NOT public — anonymous
  // callers get the release identifier only.
  it('T6: GET /api/version returns name/version publicly — and NO build fingerprint', async () => {
    if (!up) return;
    const r = await fetch(BASE + '/version'); const v = await r.json();
    expect(r.status).toBe(200);
    expect(v.name).toBeTruthy();
    expect(v.version).toMatch(/\d+\.\d+\.\d+/);
    expect(v.commit).toBeUndefined();
    expect(v.commitDate).toBeUndefined();
    expect(v.buildDate).toBeUndefined();
  });

  it('T8/T9: creator is owner with full perms; presets set module permissions; leader cannot edit owner', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p4a_${r}@t.local`); // owner
    const b = await register(`p4b_${r}@t.local`); // leader
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `WS ${r}` } });
    const pid = proj.data.id;

    const members = await api(`/screening/projects/${pid}/members`, { cookie: a.cookie });
    expect(members.data.isOwner).toBe(true);
    const ownerRow = members.data.members.find(m => m.role === 'owner');
    expect(ownerRow).toBeTruthy();
    expect(ownerRow.canManageMembers).toBe(true);
    expect(ownerRow.canEditMetaLab).toBe(true);

    // add a read-only META·SIFT member via preset
    const addRo = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `p4ro_${r}@t.local`, preset: 'readonly_metasift' } });
    expect(addRo.status).toBe(201);
    expect(addRo.data.member.readOnlyMetaSift).toBe(true);
    expect(addRo.data.member.canScreen).toBe(false);
    expect(addRo.data.member.role).toBe('viewer');

    // add a data extractor via preset
    const addDx = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `p4dx_${r}@t.local`, preset: 'data_extractor' } });
    expect(addDx.data.member.canManageExtraction).toBe(true);
    expect(addDx.data.member.canEditMetaLab).toBe(true);

    // add b as leader
    const addB = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `p4b_${r}@t.local`, preset: 'leader' } });
    expect(addB.data.member.role).toBe('leader');

    // leader (b) CANNOT modify the owner row
    const editOwnerByLeader = await api(`/screening/projects/${pid}/members/${ownerRow.id}`, { method: 'PATCH', cookie: b.cookie, body: { status: 'inactive' } });
    expect(editOwnerByLeader.status).toBe(403);

    // owner cannot be demoted even by themselves
    const demoteOwner = await api(`/screening/projects/${pid}/members/${ownerRow.id}`, { method: 'PATCH', cookie: a.cookie, body: { role: 'reviewer' } });
    expect(demoteOwner.status).toBe(400);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('T2/T3: admin edits user, assigns Mod; Mod can view users but not metrics; user blocked', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ admin tests skipped (no admin cookie)'); return; }
    const r = rnd();
    const x = await register(`p4mod_${r}@t.local`);

    // admin edits name
    const edit = await api(`/admin/users/${x.id}`, { method: 'PATCH', cookie: adminCookie, body: { name: 'Renamed User' } });
    expect(edit.status).toBe(200);

    // normal user is blocked from the console
    const blocked = await api('/admin/users', { cookie: x.cookie });
    expect(blocked.status).toBe(403);

    // admin assigns Mod
    const assign = await api(`/admin/users/${x.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'mod' } });
    expect(assign.status).toBe(200);

    // x (now mod) — role re-read from DB each request, so the existing cookie works:
    const modUsers = await api('/admin/users', { cookie: x.cookie });
    expect(modUsers.status).toBe(200);                 // mod can view users
    const modMetrics = await api('/admin/metrics', { cookie: x.cookie });
    expect(modMetrics.status).toBe(403);               // mod cannot see metrics
    const modConsole = await api('/admin/console', { cookie: x.cookie });
    expect(modConsole.data.role).toBe('mod');

    // mod cannot assign roles (admin-only)
    const modAssign = await api(`/admin/users/${x.id}/role`, { method: 'PATCH', cookie: x.cookie, body: { role: 'admin' } });
    expect(modAssign.status).toBe(403);
  });

  it('T7: chat typing indicator surfaces to other members', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p4ta_${r}@t.local`);
    const b = await register(`p4tb_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `TY ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `p4tb_${r}@t.local`, preset: 'reviewer' } });

    await api(`/screening/projects/${pid}/chat/typing`, { method: 'POST', cookie: b.cookie });
    const chatForA = await api(`/screening/projects/${pid}/chat`, { cookie: a.cookie });
    expect(Array.isArray(chatForA.data.typing)).toBe(true);
    expect(chatForA.data.typing.length).toBeGreaterThanOrEqual(1); // b is typing
    // the typer does not see themselves
    const chatForB = await api(`/screening/projects/${pid}/chat`, { cookie: b.cookie });
    expect(chatForB.data.typing.includes(b.id)).toBe(false);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });
});
