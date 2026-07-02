/**
 * prompt5.test.js — role/permission, linked-project access, versioning, and ops
 * message read-state integration tests (prompt5).
 *   T1/T2 owner vs leader separation + locked owner/leader rows
 *   T3    project created date returned
 *   T4    linked META·LAB member access (shared projects in /api/projects, edit vs
 *         read-only enforcement, cross-module visibility)
 *   T6    META·SIFT list visibility gated by module permission
 *   T7    version endpoint (fingerprint-free public payload; staff build metadata)
 *   T9    GLOBAL ops contact-message read state (prompt49; was per-staff)
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false, adminCookie = '', opsCookie = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id, email }; }
async function login(email) { const r = await api('/auth/login', { method: 'POST', body: { email, password: process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!' } }); return r.status === 200 ? r.cookie : ''; }

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (up) {
    adminCookie = await login('admin@metalab.local');
    opsCookie   = await login('ops@metalab.local');
  }
}, 30000);

describe('META·SIFT prompt5 — roles / linked access / version / ops read (integration)', () => {

  it('T1/T2: owner and leader are distinct; owner & leader rows are locked appropriately', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p5own_${r}@t.local`);   // owner
    const b = await register(`p5led_${r}@t.local`);   // leader
    const c = await register(`p5rev_${r}@t.local`);   // reviewer
    const d = await register(`p5d_${r}@t.local`);
    const e = await register(`p5led2_${r}@t.local`);  // second leader

    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Roles ${r}` } });
    const pid = proj.data.id;

    const m = await api(`/screening/projects/${pid}/members`, { cookie: a.cookie });
    expect(m.data.isOwner).toBe(true);
    expect(m.data.ownerId).toBeTruthy();
    const ownerRow = m.data.members.find(x => x.role === 'owner');
    expect(ownerRow).toBeTruthy();
    expect(ownerRow.isOwner).toBe(true);
    expect(ownerRow.isLeader).toBe(false);   // owner is NOT a leader (Task 1)

    // Owner adds a leader (only the owner can).
    const addB = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: b.email, preset: 'leader' } });
    expect(addB.data.member.role).toBe('leader');
    expect(addB.data.member.isOwner).toBe(false);
    // Owner adds a reviewer.
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: c.email, preset: 'reviewer' } });

    // Leader (b) CANNOT add another leader (ownership-level decision).
    const bAddsLeader = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: b.cookie, body: { email: d.email, preset: 'leader' } });
    expect(bAddsLeader.status).toBe(403);
    // Leader (b) CAN add a reviewer.
    const bAddsReviewer = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: b.cookie, body: { email: d.email, preset: 'reviewer' } });
    expect(bAddsReviewer.status).toBe(201);

    // Leader (b) CANNOT edit the owner row.
    const bEditsOwner = await api(`/screening/projects/${pid}/members/${ownerRow.id}`, { method: 'PATCH', cookie: b.cookie, body: { status: 'inactive' } });
    expect(bEditsOwner.status).toBe(403);

    // Owner adds a SECOND leader; b cannot edit/remove that leader, but owner can.
    const addE = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: e.email, preset: 'leader' } });
    const eId = addE.data.member.id;
    const bEditsLeader = await api(`/screening/projects/${pid}/members/${eId}`, { method: 'PATCH', cookie: b.cookie, body: { canChat: false } });
    expect(bEditsLeader.status).toBe(403);
    const aEditsLeader = await api(`/screening/projects/${pid}/members/${eId}`, { method: 'PATCH', cookie: a.cookie, body: { canChat: false } });
    expect(aEditsLeader.status).toBe(200);
    const bRemovesLeader = await api(`/screening/projects/${pid}/members/${eId}`, { method: 'DELETE', cookie: b.cookie });
    expect(bRemovesLeader.status).toBe(403);
    const aRemovesLeader = await api(`/screening/projects/${pid}/members/${eId}`, { method: 'DELETE', cookie: a.cookie });
    expect(aRemovesLeader.status).toBe(204);

    // Plain reviewer (c) cannot manage members at all.
    const cAdds = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: c.cookie, body: { email: `p5x_${r}@t.local`, preset: 'reviewer' } });
    expect(cAdds.status).toBe(403);
    // Owner cannot be demoted even by themselves.
    const demote = await api(`/screening/projects/${pid}/members/${ownerRow.id}`, { method: 'PATCH', cookie: a.cookie, body: { role: 'reviewer' } });
    expect(demote.status).toBe(400);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('T3: project list returns created date + owner and leaders as separate fields', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p5cd_${r}@t.local`);
    const b = await register(`p5cdl_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Dated ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: b.email, preset: 'leader' } });

    const list = await api('/screening/projects', { cookie: a.cookie });
    const row = list.data.projects.find(p => p.id === pid);
    expect(row).toBeTruthy();
    expect(row.createdAt).toBeTruthy();
    expect(row.updatedAt).toBeTruthy();
    expect(row.myRole).toBe('owner');
    expect(row.owner).toBeTruthy();
    expect(Array.isArray(row.leaders)).toBe(true);
    expect(row.leaders.length).toBe(1);             // owner is NOT counted among leaders
    expect(row.leaders[0].email).toBe(b.email);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('T4/T6: linked META·LAB project is visible + editable to members per permission', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p5wa_${r}@t.local`);     // owner
    const ex = await register(`p5wx_${r}@t.local`);    // data extractor (edits META·LAB)
    const roSift = await register(`p5wrs_${r}@t.local`); // read-only META·SIFT
    const roLab = await register(`p5wrl_${r}@t.local`);  // read-only META·LAB

    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `WS-ML ${r}` } });
    const mlId = ml.data.id;
    const sp = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `WS-Sift ${r}`, linkedMetaLabProjectId: mlId } });
    const pid = sp.data.id;

    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: ex.email,    preset: 'data_extractor' } });
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: roSift.email, preset: 'readonly_metasift' } });
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: roLab.email,  preset: 'readonly_metalab' } });

    // Data extractor SEES the META·LAB project in their /api/projects list, editable.
    const exList = await api('/projects', { cookie: ex.cookie });
    const shared = (exList.data || []).find(p => p.id === mlId);
    expect(shared).toBeTruthy();
    expect(shared._shared).toBe(true);
    expect(shared._canEdit).toBe(true);
    expect(shared._readOnly).toBe(false);
    expect(shared._owner?.email).toBe(a.email);

    // Extractor opens it, then edits it via autosave — change persists for the owner.
    const exGet = await api(`/projects/${mlId}`, { cookie: ex.cookie });
    expect(exGet.data._shared).toBe(true);
    const exSave = await api(`/projects/${mlId}/autosave`, { method: 'PUT', cookie: ex.cookie, body: { name: `WS-ML ${r} EDITED`, studies: [{ id: 's1', title: 'x' }] } });
    expect(exSave.status).toBe(200);
    expect(exSave.data.skipped).toBeUndefined();
    const ownerSees = await api(`/projects/${mlId}`, { cookie: a.cookie });
    expect(ownerSees.data.name).toBe(`WS-ML ${r} EDITED`);

    // Read-only META·SIFT member does NOT see the META·LAB project (no canViewMetaLab).
    const roSiftList = await api('/projects', { cookie: roSift.cookie });
    expect((roSiftList.data || []).find(p => p.id === mlId)).toBeFalsy();
    // …and DOES see the META·SIFT project.
    const roSiftSift = await api('/screening/projects', { cookie: roSift.cookie });
    expect(roSiftSift.data.projects.find(p => p.id === pid)).toBeTruthy();

    // Read-only META·LAB member SEES the project read-only; autosave is a no-op.
    const roLabGet = await api(`/projects/${mlId}`, { cookie: roLab.cookie });
    expect(roLabGet.data._shared).toBe(true);
    expect(roLabGet.data._readOnly).toBe(true);
    const roLabSave = await api(`/projects/${mlId}/autosave`, { method: 'PUT', cookie: roLab.cookie, body: { name: 'HACKED', studies: [] } });
    expect(roLabSave.status).toBe(200);          // never fails the batch
    expect(roLabSave.data.skipped).toBe(true);
    const stillEdited = await api(`/projects/${mlId}`, { cookie: a.cookie });
    expect(stillEdited.data.name).toBe(`WS-ML ${r} EDITED`);   // read-only edit was ignored
    // Read-only META·LAB member does NOT see the META·SIFT project (no canViewMetaSift).
    const roLabSift = await api('/screening/projects', { cookie: roLab.cookie });
    expect(roLabSift.data.projects.find(p => p.id === pid)).toBeFalsy();

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  // 52.md header-fingerprinting hardening (publicVersion): the anonymous payload
  // is name+version ONLY; commit/build dates are build fingerprinting. The build
  // metadata is still available to staff via GET /api/admin/health.
  it('T7: GET /api/version is fingerprint-free publicly; admin health carries build metadata', async () => {
    if (!up) return;
    const r = await fetch(BASE + '/version'); const v = await r.json();
    expect(v.version).toMatch(/\d+\.\d+\.\d+/);
    expect(v.commit).toBeUndefined();
    expect(v.commitDate).toBeUndefined();
    expect(v.full).toBeUndefined();
    if (adminCookie) {
      const a = await api('/admin/health', { cookie: adminCookie });
      expect(a.status).toBe(200);
      expect(a.data.version).toMatch(/\d+\.\d+\.\d+/);
      expect(a.data.commit).toBeTruthy();
      expect(a.data.buildDate).toBeTruthy();
    }
  });

  // prompt49 REPLACED the per-staff read receipts this test originally covered
  // with a GLOBAL shared read state (readAt is identical for every staff member;
  // opening marks it read for EVERYONE). Assertions target the message row via
  // ?search= (the shared dev DB holds hundreds of accumulated messages — the
  // default page must not be assumed to contain the fresh one).
  it('T9: ops contact-message read state is GLOBAL — one staff opening clears it for all staff', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ ops read test skipped (no admin cookie)'); return; }
    const r = rnd();
    const subject = `PingS ${r}`;
    const posted = await api('/contact', { method: 'POST', body: { email: `vis_${r}@t.local`, name: 'Visitor', subject, message: 'hello ops' } });
    if (posted.status === 429) { console.warn('  ↪ ops read test skipped (contact form rate-limited)'); return; }

    const unreadList = await api(`/admin/contact-messages?box=unread&search=${subject.replace(' ', '+')}`, { cookie: adminCookie });
    const msg = (unreadList.data.messages || []).find(m => m.subject === subject);
    expect(msg).toBeTruthy();
    expect(msg.readByMe).toBe(false);

    // admin opens / marks it read → globally read
    const mark = await api(`/admin/contact-messages/${msg.id}/mark-read`, { method: 'POST', cookie: adminCookie, body: {} });
    expect(mark.status).toBe(200);
    const readList = await api(`/admin/contact-messages?box=read&search=${subject.replace(' ', '+')}`, { cookie: adminCookie });
    expect((readList.data.messages || []).find(m => m.id === msg.id)).toBeTruthy();

    // EVERY staff member now sees it read (global shared state, prompt49)
    if (opsCookie) {
      const opsRead = await api(`/admin/contact-messages?box=read&search=${subject.replace(' ', '+')}`, { cookie: opsCookie });
      const opsRow = (opsRead.data.messages || []).find(m => m.id === msg.id);
      expect(opsRow).toBeTruthy();
      expect(opsRow.readByMe).toBe(true);
    }

    // cleanup: delete the test message (admin-only)
    await api(`/admin/contact-messages/${msg.id}`, { method: 'DELETE', cookie: adminCookie });
  });
});

// ── Security hardening (adversarial-review fixes) ────────────────────────────
describe('META·SIFT prompt5 — security hardening (review fixes)', () => {

  it('SEC1: a canManageMembers delegate cannot grant leader-level global flags or edit self', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p5s1a_${r}@t.local`);  // owner
    const b = await register(`p5s1b_${r}@t.local`);  // delegate (canManageMembers)
    const c = await register(`p5s1c_${r}@t.local`);  // ordinary reviewer
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Sec1 ${r}` } });
    const pid = proj.data.id;
    const addB = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: b.email, preset: 'reviewer' } });
    const addC = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: c.email, preset: 'reviewer' } });
    // Owner delegates member-management to B (owner is allowed to grant globals).
    const grant = await api(`/screening/projects/${pid}/members/${addB.data.member.id}`, { method: 'PATCH', cookie: a.cookie, body: { canManageMembers: true } });
    expect(grant.status).toBe(200);
    expect(grant.data.member.canManageMembers).toBe(true);

    // B can manage an ordinary reviewer (legit).
    const bEditsC = await api(`/screening/projects/${pid}/members/${addC.data.member.id}`, { method: 'PATCH', cookie: b.cookie, body: { canChat: false } });
    expect(bEditsC.status).toBe(200);
    // …but B CANNOT mint another manager (grant canManageMembers/canManageSettings).
    const escalateC = await api(`/screening/projects/${pid}/members/${addC.data.member.id}`, { method: 'PATCH', cookie: b.cookie, body: { canManageSettings: true } });
    expect(escalateC.status).toBe(403);
    const escalateC2 = await api(`/screening/projects/${pid}/members/${addC.data.member.id}`, { method: 'PATCH', cookie: b.cookie, body: { canManageMembers: true } });
    expect(escalateC2.status).toBe(403);
    // …and B CANNOT widen their OWN row.
    const escalateSelf = await api(`/screening/projects/${pid}/members/${addB.data.member.id}`, { method: 'PATCH', cookie: b.cookie, body: { canManageSettings: true } });
    expect(escalateSelf.status).toBe(403);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('SEC2: a non-owner leader cannot repoint the link to a stranger’s META·LAB project (no leak)', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p5s2a_${r}@t.local`);   // owner
    const b = await register(`p5s2b_${r}@t.local`);   // leader
    const x = await register(`p5s2x_${r}@t.local`);   // stranger
    const strangerMl = await api('/projects', { method: 'POST', cookie: x.cookie, body: { name: `Secret ${r}` } });
    const mlId = strangerMl.data.id;
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Sec2 ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: b.email, preset: 'leader' } });

    // Leader tries to repoint the link via the generic settings PUT → rejected.
    const repoint = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: b.cookie, body: { linkedMetaLabProjectId: mlId } });
    expect(repoint.status).toBe(400);
    // Even if a link somehow existed, the stranger's project is not readable by B.
    const leak = await api(`/projects/${mlId}`, { cookie: b.cookie });
    expect(leak.status).toBe(404);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: x.cookie });
  });

  it('SEC3: a canManageSettings member CAN change settings; admin-archived linked project is inaccessible to members', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p5s3a_${r}@t.local`);   // owner
    const s = await register(`p5s3s_${r}@t.local`);   // settings manager
    const ex = await register(`p5s3x_${r}@t.local`);  // extractor
    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `Sec3ML ${r}` } });
    const mlId = ml.data.id;
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Sec3 ${r}`, linkedMetaLabProjectId: mlId } });
    const pid = proj.data.id;
    const addS = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: s.email, preset: 'reviewer' } });
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: ex.email, preset: 'data_extractor' } });
    // Owner grants canManageSettings → that member can now change settings (was 403 before the fix).
    await api(`/screening/projects/${pid}/members/${addS.data.member.id}`, { method: 'PATCH', cookie: a.cookie, body: { canManageSettings: true } });
    const setStatus = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: s.cookie, body: { progressStatus: 'in_progress' } });
    expect(setStatus.status).toBe(200);

    // Extractor sees the linked project before archive.
    const before = await api(`/projects/${mlId}`, { cookie: ex.cookie });
    expect(before.data._shared).toBe(true);

    // Admin archives it → it must vanish from member access (read + list).
    if (adminCookie) {
      const arch = await api(`/admin/projects/${mlId}/archive`, { method: 'PATCH', cookie: adminCookie });
      expect(arch.status).toBe(200);
      const afterGet = await api(`/projects/${mlId}`, { cookie: ex.cookie });
      expect(afterGet.status).toBe(404);
      const afterList = await api('/projects', { cookie: ex.cookie });
      expect((afterList.data || []).find(p => p.id === mlId)).toBeFalsy();
      // Restore + clean up.
      await api(`/admin/projects/${mlId}/restore`, { method: 'PATCH', cookie: adminCookie });
    }

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  // prompt49 REPLACED per-staff read receipts with a GLOBAL shared read state, so
  // the unread metric is the same for every staff member and one admin reading a
  // message clears it for all. Count arithmetic is avoided (the shared dev DB
  // receives concurrent writes); the assertion targets the message row itself.
  it('SEC4: the admin Overview unread state is GLOBAL — one admin reading clears it for all staff', async () => {
    if (!up) return;
    if (!adminCookie || !opsCookie) { console.warn('  ↪ SEC4 skipped (need both admin cookies)'); return; }
    const r = rnd();
    const subject = `MetricS ${r}`;
    const posted = await api('/contact', { method: 'POST', body: { email: `m_${r}@t.local`, subject, message: 'metric' } });
    if (posted.status === 429) { console.warn('  ↪ SEC4 skipped (contact form rate-limited)'); return; }

    // both staff see the fresh message as unread
    const q = `search=${subject.replace(' ', '+')}`;
    const adminUnread = await api(`/admin/contact-messages?box=unread&${q}`, { cookie: adminCookie });
    const msg = (adminUnread.data.messages || []).find(m => m.subject === subject);
    expect(msg).toBeTruthy();
    const opsUnread = await api(`/admin/contact-messages?box=unread&${q}`, { cookie: opsCookie });
    expect((opsUnread.data.messages || []).find(m => m.id === msg.id)).toBeTruthy();

    // admin opens the message → read for EVERY staff member (global state)
    await api(`/admin/contact-messages/${msg.id}/mark-read`, { method: 'POST', cookie: adminCookie, body: {} });
    const opsAfter = await api(`/admin/contact-messages?box=unread&${q}`, { cookie: opsCookie });
    expect((opsAfter.data.messages || []).find(m => m.id === msg.id)).toBeUndefined();

    await api(`/admin/contact-messages/${msg.id}`, { method: 'DELETE', cookie: adminCookie });
  });
});
