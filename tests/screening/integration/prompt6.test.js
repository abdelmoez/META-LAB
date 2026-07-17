/**
 * prompt6.test.js — workspace upgrade integration tests (prompt6, 19 tasks).
 *
 *   T1   Notifications: invite rows, per-user isolation, read/dismiss/mark-all,
 *        cross-login persistence, pending-invite claim-on-register, ROLE_CHANGED
 *   T2   Linked creation: POST /api/projects {createLinkedSift} pair shape,
 *        legacy bare shape, SIFT-side alsoCreateMetaLab, PICO snapshot, link validation
 *   T3/8 Linked display: membership-aware metalab summary, linkedMetaLabProjectTitle,
 *        member sees the linked project without any relink action
 *   T5   Viewer read-only matrix + THE PINNED CONTRACT (autosave 200 + skipped, never 4xx)
 *   T6   addMember modules mapping, invalid modules 400, leader/owner preset guards
 *   T7   SSE /api/events: handshake, member pokes, scope-leak, thin payloads, heartbeat
 *   T17  Import 403-vs-404 three-way matrix + instant viewer→leader upgrade
 *   T19  Import fingerprint: 409 contract, force override, per-project scope, CRLF
 *   T9/10/12 Ops metrics: unique logins (distinct + monotonic), lastActive recency,
 *        doneToday distinct, progressStatus validation
 *   T11  Ops linked + expanded progress block
 *   T14  Mod RBAC allowed/denied matrix
 *   T18  Rename sync-if-in-sync (both directions), diverged titles don't sync, viewer 403
 *
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false, adminCookie = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res), headers: res.headers };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id, email }; }
async function loginAs(email, password = 'Password123!') { const r = await api('/auth/login', { method: 'POST', body: { email, password } }); return r.status === 200 ? r.cookie : ''; }

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Poll an async predicate until truthy (fire-and-forget server writes need this). */
async function until(fn, timeoutMs = 5000, step = 200) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 >= timeoutMs) return false;
    await sleep(step);
  }
}

/** Build unique-RIS content (LF line endings) for fingerprint/import tests. */
function risFor(entries) {
  return entries.map(e =>
    `TY  - JOUR\nAU  - ${e.au || 'Doe, Jane'}\nTI  - ${e.ti}\nPY  - ${e.py || '2024'}\nJO  - Journal of Testing\nDO  - ${e.doi}\nAB  - Abstract body for integration testing purposes.\nER  -\n`,
  ).join('\n');
}

/** Open the SSE stream with a raw fetch reader; collect comment + data frames. */
async function openStream(cookie) {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/events`, { headers: { Cookie: cookie }, signal: ac.signal });
  const comments = []; const events = [];
  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  if (status === 200 && res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, i); buf = buf.slice(i + 2);
            for (const line of frame.split('\n')) {
              if (line.startsWith(':')) comments.push(line);
              else if (line.startsWith('data: ')) { try { events.push(JSON.parse(line.slice(6))); } catch {} }
            }
          }
        }
      } catch { /* aborted */ }
    })();
  }
  return { ac, status, contentType, comments, events };
}

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (up) {
    const r = await api('/auth/login', { method: 'POST', body: { email: 'admin@metalab.local', password: process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!' } });
    adminCookie = r.status === 200 ? r.cookie : '';
  }
}, 30000);

// ── Task 1 — Notifications ────────────────────────────────────────────────────
describe('prompt6 T1 — notifications (invite, isolation, persistence, claim-on-register)', () => {

  it('invite creates a PROJECT_INVITE; isolation, read, dismiss, mark-all-read; read state survives a fresh login', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6n_a${r}@t.local`);
    const b = await register(`p6n_b${r}@t.local`);
    const c = await register(`p6n_c${r}@t.local`);

    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Notif ${r}` } });
    const pid = proj.data.id;
    const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: b.email, preset: 'reviewer' } });
    expect(add.status).toBe(201);

    // Notification creation is fire-and-forget — poll for it.
    expect(await until(async () => (await api('/notifications/unread-count', { cookie: b.cookie })).data?.count === 1)).toBe(true);

    const list = await api('/notifications', { cookie: b.cookie });
    expect(list.status).toBe(200);
    expect(list.data.unreadCount).toBe(1);
    const n = list.data.notifications.find(x => x.type === 'PROJECT_INVITE');
    expect(n).toBeTruthy();
    expect(n.relatedScreenProjectId).toBe(pid);
    expect(n.relatedWorkspaceId).toBe(pid);            // workspace = ScreenProject alias
    expect(n.relatedMetaSiftProjectId).toBe(pid);
    expect(n.relatedMetaLabProjectId).toBeNull();      // unlinked project
    expect(n.app).toBe('metasift');
    expect(n.role).toBe('reviewer');
    expect(n.actorEmail).toBe(a.email);
    expect(n.readAt).toBeNull();

    // ISOLATION: another user cannot mark B's notification read (404), and B's count is untouched.
    const cross = await api(`/notifications/${n.id}/read`, { method: 'POST', cookie: c.cookie });
    expect(cross.status).toBe(404);
    expect((await api('/notifications/unread-count', { cookie: c.cookie })).data.count).toBe(0);
    expect((await api('/notifications/unread-count', { cookie: b.cookie })).data.count).toBe(1);

    // B marks read → no longer unread.
    const read = await api(`/notifications/${n.id}/read`, { method: 'POST', cookie: b.cookie });
    expect(read.status).toBe(200);
    expect(read.data.notification.readAt).toBeTruthy();
    expect((await api('/notifications/unread-count', { cookie: b.cookie })).data.count).toBe(0);

    // PERSISTENCE acceptance test: logout → fresh login → read state survived.
    const fresh = await loginAs(b.email);
    expect(fresh).toBeTruthy();
    expect((await api('/notifications/unread-count', { cookie: fresh })).data.count).toBe(0);
    const list2 = await api('/notifications', { cookie: fresh });
    const n2 = list2.data.notifications.find(x => x.id === n.id);
    expect(n2).toBeTruthy();
    expect(n2.readAt).toBeTruthy();

    // ROLE_CHANGED on a real preset change.
    const members = await api(`/screening/projects/${pid}/members`, { cookie: a.cookie });
    const bRow = members.data.members.find(m => m.email === b.email);
    const patch = await api(`/screening/projects/${pid}/members/${bRow.id}`, { method: 'PATCH', cookie: a.cookie, body: { preset: 'data_extractor' } });
    expect(patch.status).toBe(200);
    expect(await until(async () => {
      const l = await api('/notifications', { cookie: fresh });
      return l.data.notifications.some(x => x.type === 'ROLE_CHANGED' && x.role === 'data_extractor');
    })).toBe(true);
    const list3 = await api('/notifications', { cookie: fresh });
    const rc = list3.data.notifications.find(x => x.type === 'ROLE_CHANGED');
    expect(rc.relatedScreenProjectId).toBe(pid);

    // Dismiss hides it from the default list (still visible with ?all=1).
    const dis = await api(`/notifications/${rc.id}/dismiss`, { method: 'POST', cookie: fresh });
    expect(dis.status).toBe(200);
    const afterDismiss = await api('/notifications', { cookie: fresh });
    expect(afterDismiss.data.notifications.find(x => x.id === rc.id)).toBeFalsy();
    const withAll = await api('/notifications?all=1', { cookie: fresh });
    expect(withAll.data.notifications.find(x => x.id === rc.id)).toBeTruthy();

    // mark-all-read clears a new unread batch.
    await api(`/screening/projects/${pid}/members/${bRow.id}`, { method: 'PATCH', cookie: a.cookie, body: { preset: 'viewer' } });
    expect(await until(async () => (await api('/notifications/unread-count', { cookie: fresh })).data.count >= 1)).toBe(true);
    const mar = await api('/notifications/mark-all-read', { method: 'POST', cookie: fresh });
    expect(mar.status).toBe(200);
    expect(mar.data.updated).toBeGreaterThanOrEqual(1);
    expect((await api('/notifications/unread-count', { cookie: fresh })).data.count).toBe(0);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('linked-workspace invite carries both ids, app="workspace", and the granted preset', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6nw_a${r}@t.local`);
    const d = await register(`p6nw_d${r}@t.local`);
    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `NotifML ${r}` } });
    const mlId = ml.data.id;
    const sp = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `NotifWS ${r}`, linkedMetaLabProjectId: mlId } });
    const pid = sp.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: d.email, preset: 'data_extractor' } });

    expect(await until(async () => (await api('/notifications/unread-count', { cookie: d.cookie })).data?.count === 1)).toBe(true);
    const n = (await api('/notifications', { cookie: d.cookie })).data.notifications.find(x => x.type === 'PROJECT_INVITE');
    expect(n.app).toBe('workspace');
    expect(n.relatedMetaLabProjectId).toBe(mlId);
    expect(n.relatedScreenProjectId).toBe(pid);
    expect(n.relatedWorkspaceId).toBe(pid);
    expect(n.role).toBe('data_extractor');

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('pending invite (unregistered email): no row until registration; claim-on-register activates membership + creates the PROJECT_INVITE', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6np_a${r}@t.local`);
    const ghostEmail = `p6np_ghost${r}@t.local`;
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Pending ${r}` } });
    const pid = proj.data.id;

    const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: ghostEmail, preset: 'reviewer' } });
    expect(add.status).toBe(201);
    expect(add.data.pending).toBe(true);
    expect(add.data.member.userId).toBeNull();         // no account → no notification target yet

    // Now the invitee registers → claim hook fires (fire-and-forget): membership
    // becomes active and the PROJECT_INVITE notification appears.
    const ghost = await register(ghostEmail);
    expect(ghost.cookie).toBeTruthy();
    expect(await until(async () => {
      const l = await api('/notifications', { cookie: ghost.cookie });
      return (l.data?.notifications || []).some(x => x.type === 'PROJECT_INVITE' && x.relatedScreenProjectId === pid);
    })).toBe(true);

    // Membership is active and the project is immediately accessible.
    const myList = await api('/screening/projects', { cookie: ghost.cookie });
    expect(myList.data.projects.find(p => p.id === pid)).toBeTruthy();
    expect((await api(`/screening/projects/${pid}`, { cookie: ghost.cookie })).status).toBe(200);
    const members = await api(`/screening/projects/${pid}/members`, { cookie: a.cookie });
    const row = members.data.members.find(m => m.email === ghostEmail);
    expect(row.status).toBe('active');
    expect(row.userId).toBe(ghost.id);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });
});

// ── Task 2 — Linked creation ──────────────────────────────────────────────────
describe('prompt6 T2 — linked pair creation (both directions, opt-in only)', () => {

  it('POST /api/projects {createLinkedSift:true} → {project, linkedScreenProject} with same owner/title + annotations', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6c_a${r}@t.local`);
    const res = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `Pair ${r}`, createLinkedSift: true } });
    expect(res.status).toBe(201);
    expect(res.data.project).toBeTruthy();
    expect(res.data.linkedScreenProject).toBeTruthy();
    const { project, linkedScreenProject: lsp } = res.data;
    expect(project.name).toBe(`Pair ${r}`);
    expect(lsp.title).toBe(`Pair ${r}`);               // same title
    expect(lsp.ownerId).toBe(a.id);                    // same owner
    expect(lsp.linkedMetaLabProjectId).toBe(project.id);
    // _linkedMetaSift carries the prompt11 landing-card fields too
    // (progressStatus/recordCount/memberCount); assert the identity subset.
    expect(project._linkedMetaSift).toMatchObject({ id: lsp.id, title: lsp.title });
    expect(project._permissions.isOwner).toBe(true);
    expect(project._permissions.canEdit).toBe(true);
    // PICO snapshot captured at create (mkProject always carries a pico block).
    const snap = JSON.parse(lsp.picoSnapshot || '{}');
    expect(snap).toHaveProperty('P');

    // The SIFT side really exists, is owned, and is seeded.
    const sift = await api(`/screening/projects/${lsp.id}`, { cookie: a.cookie });
    expect(sift.status).toBe(200);
    expect(sift.data.isOwner).toBe(true);
    expect(sift.data.linkedMetaLabProjectTitle).toBe(`Pair ${r}`);

    await api(`/screening/projects/${lsp.id}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${project.id}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('legacy POST /api/projects (no flag) keeps the bare shape and creates NO screening project', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6c_b${r}@t.local`);
    const res = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `Legacy ${r}` } });
    expect(res.status).toBe(201);
    expect(res.data.id).toBeTruthy();                  // bare project at top level
    expect(res.data.name).toBe(`Legacy ${r}`);
    expect(res.data.project).toBeUndefined();          // no {project, linkedScreenProject} wrapper
    expect(res.data.linkedScreenProject).toBeUndefined();
    const sifts = await api('/screening/projects', { cookie: a.cookie });
    expect(sifts.data.projects.find(p => p.linkedMetaLabProjectId === res.data.id)).toBeFalsy();
    await api(`/projects/${res.data.id}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('SIFT-side create: default does NOT create a META·LAB project; alsoCreateMetaLab:true does (and links)', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6c_c${r}@t.local`);

    const plain = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `SiftOnly ${r}` } });
    expect(plain.status).toBe(201);
    expect(plain.data.linkedMetaLabProjectId).toBeNull();

    const both = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `SiftBoth ${r}`, alsoCreateMetaLab: true } });
    expect(both.status).toBe(201);
    expect(both.data.linkedMetaLabProjectId).toBeTruthy();
    expect(both.data.linkedMetaLabProjectTitle).toBe(`SiftBoth ${r}`);
    const ml = await api(`/projects/${both.data.linkedMetaLabProjectId}`, { cookie: a.cookie });
    expect(ml.status).toBe(200);                       // ML project really exists, owned by caller
    expect(ml.data.name).toBe(`SiftBoth ${r}`);
    expect(ml.data._linkedMetaSift?.id).toBe(both.data.id);

    await api(`/screening/projects/${plain.data.id}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/screening/projects/${both.data.id}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${both.data.linkedMetaLabProjectId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('SIFT-side create with explicit link: PICO snapshotted from the ML project; foreign/dead target → 400', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6c_d${r}@t.local`);
    const x = await register(`p6c_x${r}@t.local`);

    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `PicoML ${r}` } });
    const mlId = ml.data.id;
    // Fill PICO via the normal autosave path.
    const auto = await api(`/projects/${mlId}/autosave`, { method: 'PUT', cookie: a.cookie, body: { ...ml.data, pico: { ...ml.data.pico, P: 'Adults with T2DM', I: 'Metformin' } } });
    expect(auto.status).toBe(200);

    const sp = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `PicoSift ${r}`, linkedMetaLabProjectId: mlId } });
    expect(sp.status).toBe(201);
    const snap = JSON.parse(sp.data.picoSnapshot || '{}');
    expect(snap.P).toBe('Adults with T2DM');           // non-empty when the ML side has PICO
    expect(snap.I).toBe('Metformin');

    // Link validation (was: silently stored): a foreign owner's project → 400.
    const strangerMl = await api('/projects', { method: 'POST', cookie: x.cookie, body: { name: `Foreign ${r}` } });
    const bad = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Bad ${r}`, linkedMetaLabProjectId: strangerMl.data.id } });
    expect(bad.status).toBe(400);
    const dead = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Dead ${r}`, linkedMetaLabProjectId: 'nonexistent000' } });
    expect(dead.status).toBe(400);

    await api(`/screening/projects/${sp.data.id}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${strangerMl.data.id}`, { method: 'DELETE', cookie: x.cookie });
  });
});

// ── Tasks 3/8 — Linked display & navigation backend ───────────────────────────
describe('prompt6 T3/T8 — members see the link (summary, title, list) without relinking', () => {

  it('a MEMBER gets linked:true + screeningProjectId from the metalab summary; project carries linkedMetaLabProjectTitle; list shows _linkedMetaSift', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6l_a${r}@t.local`);
    const m = await register(`p6l_m${r}@t.local`);
    const pair = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `Link ${r}`, createLinkedSift: true } });
    const mlId = pair.data.project.id;
    const spid = pair.data.linkedScreenProject.id;
    await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: a.cookie, body: { email: m.email, preset: 'reviewer' } });

    // Member summary (was owner-only → members saw linked:false).
    const sum = await api(`/screening/metalab/${mlId}/summary`, { cookie: m.cookie });
    expect(sum.status).toBe(200);
    expect(sum.data.linked).toBe(true);
    expect(sum.data.screeningProjectId).toBe(spid);
    expect(sum.data.title).toBe(`Link ${r}`);

    // Owner summary unchanged.
    const ownerSum = await api(`/screening/metalab/${mlId}/summary`, { cookie: a.cookie });
    expect(ownerSum.data.linked).toBe(true);
    expect(ownerSum.data.screeningProjectId).toBe(spid);

    // SIFT project carries the linked ML title for every member.
    const sp = await api(`/screening/projects/${spid}`, { cookie: m.cookie });
    expect(sp.status).toBe(200);
    expect(sp.data.linkedMetaLabProjectTitle).toBe(`Link ${r}`);

    // The member's META·LAB list shows the shared project with the link annotation —
    // no relink action needed (reviewer preset grants canViewMetaLab).
    const list = await api('/projects', { cookie: m.cookie });
    const shared = (list.data || []).find(p => p.id === mlId);
    expect(shared).toBeTruthy();
    expect(shared._shared).toBe(true);
    expect(shared._linkedMetaSift?.id).toBe(spid);
    expect(shared._permissions?.canView).toBe(true);

    await api(`/screening/projects/${spid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });
});

// ── Task 5 — Viewer read-only enforcement ─────────────────────────────────────
describe('prompt6 T5 — viewer read-only matrix (and the pinned autosave contract)', () => {

  it('viewer: PUT 403, export 403, import 403; autosave stays 200+skipped (NEVER 4xx); canEdit member + owner unaffected', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6v_a${r}@t.local`);
    const v = await register(`p6v_v${r}@t.local`);   // viewer (readOnly both)
    const e = await register(`p6v_e${r}@t.local`);   // data_extractor (canEditMetaLab + canExport)
    const pair = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `RO ${r}`, createLinkedSift: true } });
    const mlId = pair.data.project.id;
    const spid = pair.data.linkedScreenProject.id;
    await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: a.cookie, body: { email: v.email, preset: 'viewer' } });
    await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: a.cookie, body: { email: e.email, preset: 'data_extractor' } });

    const risText = risFor([{ ti: `Imported via references ${r}`, doi: `10.7777/ml.${r}` }]);

    // ── Viewer (read-only) ──
    const vPut = await api(`/projects/${mlId}`, { method: 'PUT', cookie: v.cookie, body: { name: 'HACKED' } });
    expect(vPut.status).toBe(403);
    const vExp = await api(`/export/project/${mlId}`, { cookie: v.cookie });
    expect(vExp.status).toBe(403);
    const vImp = await api('/import/references', { method: 'POST', cookie: v.cookie, body: { projectId: mlId, text: risText } });
    expect(vImp.status).toBe(403);

    // THE PINNED CONTRACT: viewer autosave is a silent no-op — 200 + skipped:true.
    // The autosave bridge PUTs ALL projects in one batch; a 4xx here would lose
    // the user's OWN edits. This test exists so nobody "fixes" read-only by
    // 403-ing autosave. DO NOT change this assertion to expect a 4xx.
    const vAuto = await api(`/projects/${mlId}/autosave`, { method: 'PUT', cookie: v.cookie, body: { name: 'HACKED-AUTOSAVE', studies: [] } });
    expect(vAuto.status).toBe(200);
    expect(vAuto.data.skipped).toBe(true);
    expect(vAuto.data.readOnly).toBe(true);

    // Verify-by-read: none of the viewer writes landed.
    const after = await api(`/projects/${mlId}`, { cookie: a.cookie });
    expect(after.data.name).toBe(`RO ${r}`);

    // ── canEdit member (data_extractor) ──
    const ePut = await api(`/projects/${mlId}`, { method: 'PUT', cookie: e.cookie, body: { robMethod: 'ROBINS-I' } });
    expect(ePut.status).toBe(200);
    expect(ePut.data.robMethod).toBe('ROBINS-I');
    const eExp = await api(`/export/project/${mlId}`, { cookie: e.cookie });
    expect(eExp.status).toBe(200);
    expect(eExp.headers.get('content-disposition') || '').toContain('attachment');
    const eImp = await api('/import/references', { method: 'POST', cookie: e.cookie, body: { projectId: mlId, text: risText } });
    expect(eImp.status).toBe(200);
    expect(eImp.data.imported).toBeGreaterThanOrEqual(1);

    // ── Owner unaffected ──
    const oPut = await api(`/projects/${mlId}`, { method: 'PUT', cookie: a.cookie, body: { robMethod: 'RoB2' } });
    expect(oPut.status).toBe(200);
    const oExp = await api(`/export/project/${mlId}`, { cookie: a.cookie });
    expect(oExp.status).toBe(200);

    // Outsider stays 404 everywhere (existence-hiding).
    const out = await register(`p6v_o${r}@t.local`);
    expect((await api(`/projects/${mlId}`, { method: 'PUT', cookie: out.cookie, body: { name: 'X' } })).status).toBe(404);
    expect((await api(`/export/project/${mlId}`, { cookie: out.cookie })).status).toBe(404);
    expect((await api('/import/references', { method: 'POST', cookie: out.cookie, body: { projectId: mlId, text: risText } })).status).toBe(404);

    await api(`/screening/projects/${spid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });
});

// ── Task 6 — Roles / module participation ─────────────────────────────────────
describe('prompt6 T6 — addMember modules mapping + preset guards', () => {

  it("modules 'metalab'/'metasift'/'both' map the canView* flags (metasift also clears canEditMetaLab); invalid → 400", async () => {
    if (!up) return;
    const r = rnd();
    const o = await register(`p6m_o${r}@t.local`);
    const u1 = await register(`p6m_1${r}@t.local`);
    const u2 = await register(`p6m_2${r}@t.local`);
    const u3 = await register(`p6m_3${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: o.cookie, body: { title: `Mods ${r}` } });
    const pid = proj.data.id;

    const m1 = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: o.cookie, body: { email: u1.email, preset: 'reviewer', modules: 'metalab' } });
    expect(m1.status).toBe(201);
    expect(m1.data.member.canViewMetaLab).toBe(true);
    expect(m1.data.member.canViewMetaSift).toBe(false);

    // data_extractor ships canEditMetaLab:true — 'metasift' must clear it too
    // (canEditMetaLab alone would re-grant META·LAB visibility via metalabAccess).
    const m2 = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: o.cookie, body: { email: u2.email, preset: 'data_extractor', modules: 'metasift' } });
    expect(m2.status).toBe(201);
    expect(m2.data.member.canViewMetaSift).toBe(true);
    expect(m2.data.member.canViewMetaLab).toBe(false);
    expect(m2.data.member.canEditMetaLab).toBe(false);

    const m3 = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: o.cookie, body: { email: u3.email, preset: 'reviewer', modules: 'both' } });
    expect(m3.status).toBe(201);
    expect(m3.data.member.canViewMetaLab).toBe(true);
    expect(m3.data.member.canViewMetaSift).toBe(true);

    const bad = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: o.cookie, body: { email: `p6m_x${r}@t.local`, preset: 'reviewer', modules: 'all' } });
    expect(bad.status).toBe(400);
    expect(String(bad.data.error)).toMatch(/modules/i);

    // Visibility consequence: a metalab-only member does NOT see the SIFT project;
    // a both-modules member does.
    const u1List = await api('/screening/projects', { cookie: u1.cookie });
    expect(u1List.data.projects.find(p => p.id === pid)).toBeFalsy();
    const u3List = await api('/screening/projects', { cookie: u3.cookie });
    expect(u3List.data.projects.find(p => p.id === pid)).toBeTruthy();

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: o.cookie });
  });

  it('leader cannot assign the leader preset (owner can); leader cannot touch the owner row', async () => {
    if (!up) return;
    const r = rnd();
    const o = await register(`p6g_o${r}@t.local`);
    const l = await register(`p6g_l${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: o.cookie, body: { title: `Guards ${r}` } });
    const pid = proj.data.id;
    const addL = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: o.cookie, body: { email: l.email, preset: 'leader' } });
    expect(addL.status).toBe(201);

    const byLeader = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: l.cookie, body: { email: `p6g_x${r}@t.local`, preset: 'leader' } });
    expect(byLeader.status).toBe(403);
    const byOwner = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: o.cookie, body: { email: `p6g_y${r}@t.local`, preset: 'leader' } });
    expect(byOwner.status).toBe(201);

    const members = await api(`/screening/projects/${pid}/members`, { cookie: o.cookie });
    const ownerRow = members.data.members.find(m => m.role === 'owner');
    const touchOwner = await api(`/screening/projects/${pid}/members/${ownerRow.id}`, { method: 'PATCH', cookie: l.cookie, body: { canChat: false } });
    expect(touchOwner.status).toBe(403);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: o.cookie });
  });
});

// ── Task 7 — SSE realtime ─────────────────────────────────────────────────────
describe('prompt6 T7 — SSE /api/events (handshake, pokes, scope-leak, thin payloads)', () => {

  it('requires auth: no cookie → 401', async () => {
    if (!up) return;
    const res = await fetch(`${BASE}/events`);
    expect(res.status).toBe(401);
    try { await res.text(); } catch {}
  });

  it('member stream gets members.changed/chat.message pokes; outsider stream gets ZERO data frames; payloads are thin', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6s_a${r}@t.local`);
    const b = await register(`p6s_b${r}@t.local`);
    const c = await register(`p6s_c${r}@t.local`);  // outsider
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `SSE ${r}` } });
    const pid = proj.data.id;

    let sB = null, sC = null;
    try {
      sB = await openStream(b.cookie);
      sC = await openStream(c.cookie);
      expect(sB.status).toBe(200);
      expect(sB.contentType).toContain('text/event-stream');
      expect(sC.status).toBe(200);

      // First comment frame (:connected) arrives immediately — no 25s wait here.
      expect(await until(() => sB.comments.some(x => x.includes('connected')), 4000, 100)).toBe(true);
      expect(await until(() => sC.comments.some(x => x.includes('connected')), 4000, 100)).toBe(true);

      // A adds B → B receives notification.created + members.changed.
      const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: b.email, preset: 'reviewer' } });
      expect(add.status).toBe(201);
      expect(await until(() => sB.events.some(e => e.type === 'notification.created'), 6000)).toBe(true);
      expect(await until(() => sB.events.some(e => e.type === 'members.changed' && e.projectId === pid), 6000)).toBe(true);

      // A posts chat → B receives a chat.message poke (content NEVER rides the event).
      const chat = await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: a.cookie, body: { message: `secret realtime ${r}` } });
      expect(chat.status).toBe(201);
      expect(await until(() => sB.events.some(e => e.type === 'chat.message' && e.projectId === pid), 6000)).toBe(true);

      // Thin-payload contract: no content/actor/decision keys on ANY frame.
      const badKeys = ['message', 'title', 'actorName', 'actorEmail', 'reviewerId', 'decision', 'email', 'name'];
      for (const e of sB.events) {
        for (const k of badKeys) expect(e).not.toHaveProperty(k);
      }

      // SCOPE-LEAK: the outsider stream received ZERO data frames while members
      // generated invite/member/chat events (grace period to let any leak land).
      await sleep(500);
      expect(sC.events.length).toBe(0);
    } finally {
      if (sB) sB.ac.abort();
      if (sC) sC.ac.abort();
    }

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('heartbeat comment (:hb) arrives within ~30s on an idle stream', async () => {
    if (!up) return;
    const r = rnd();
    const u = await register(`p6s_h${r}@t.local`);
    let s = null;
    try {
      s = await openStream(u.cookie);
      expect(s.status).toBe(200);
      // Server heartbeat interval is 25s — allow 32s.
      expect(await until(() => s.comments.some(x => x.includes('hb')), 32000, 500)).toBe(true);
    } finally {
      if (s) s.ac.abort();
    }
  }, 40000);
});

// ── Task 17 — Import permissions: 403 vs 404 ──────────────────────────────────
describe('prompt6 T17 — import access matrix (outsider 404 / member w/o perm 403 / allowed 200)', () => {

  it('three-way matrix + viewer upgraded to leader imports successfully IMMEDIATELY', async () => {
    if (!up) return;
    const r = rnd();
    const o = await register(`p6i_o${r}@t.local`);
    const x = await register(`p6i_x${r}@t.local`);   // outsider
    const v = await register(`p6i_v${r}@t.local`);   // viewer (no canImportRecords)
    const l = await register(`p6i_l${r}@t.local`);   // leader
    const m = await register(`p6i_m${r}@t.local`);   // reviewer, later granted the flag
    const proj = await api('/screening/projects', { method: 'POST', cookie: o.cookie, body: { title: `Imp ${r}` } });
    const pid = proj.data.id;
    const addV = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: o.cookie, body: { email: v.email, preset: 'viewer' } });
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: o.cookie, body: { email: l.email, preset: 'leader' } });
    const addM = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: o.cookie, body: { email: m.email, preset: 'reviewer' } });

    const imp = (cookie, tag) => api(`/screening/projects/${pid}/import`, {
      method: 'POST', cookie,
      body: { format: 'ris', content: risFor([{ ti: `Import matrix ${tag} ${r}`, doi: `10.5555/${tag}.${r}` }]), filename: `${tag}.ris` },
    });

    // Outsider → 404 (existence-hiding preserved).
    expect((await imp(x.cookie, 'out')).status).toBe(404);
    // Nonexistent project → 404.
    const ghost = await api('/screening/projects/nonexistent000/import', { method: 'POST', cookie: o.cookie, body: { format: 'ris', content: risFor([{ ti: 'g', doi: '10.1/g' }]) } });
    expect(ghost.status).toBe(404);
    // Active member WITHOUT canImportRecords → 403 (distinct from 404).
    const vRes = await imp(v.cookie, 'viewer');
    expect(vRes.status).toBe(403);
    expect(String(vRes.data.error)).toMatch(/permission/i);
    // Reviewer preset has no canImportRecords either → 403.
    expect((await imp(m.cookie, 'rev')).status).toBe(403);
    // Leader → 200. Owner → 200.
    expect((await imp(l.cookie, 'lead')).status).toBe(200);
    expect((await imp(o.cookie, 'own')).status).toBe(200);
    // Member granted the raw flag → 200.
    const grant = await api(`/screening/projects/${pid}/members/${addM.data.member.id}`, { method: 'PATCH', cookie: o.cookie, body: { canImportRecords: true } });
    expect(grant.status).toBe(200);
    expect((await imp(m.cookie, 'flag')).status).toBe(200);

    // Upgrade flow: viewer → leader takes effect IMMEDIATELY (no server-side
    // permission cache — access is resolved per request from the DB).
    const up1 = await api(`/screening/projects/${pid}/members/${addV.data.member.id}`, { method: 'PATCH', cookie: o.cookie, body: { preset: 'leader' } });
    expect(up1.status).toBe(200);
    expect((await imp(v.cookie, 'upgraded')).status).toBe(200);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: o.cookie });
  });
});

// ── Task 19 — Import fingerprint ──────────────────────────────────────────────
describe('prompt6 T19 — import fingerprint (409 contract, force, per-project scope, CRLF)', () => {

  it('re-importing the same file → 409 {duplicate_import, batch}; force keeps record-dedupe; other project unaffected; CRLF normalized', async () => {
    if (!up) return;
    const r = rnd();
    const o = await register(`p6f_o${r}@t.local`);
    const p1 = (await api('/screening/projects', { method: 'POST', cookie: o.cookie, body: { title: `FP1 ${r}` } })).data.id;
    const p2 = (await api('/screening/projects', { method: 'POST', cookie: o.cookie, body: { title: `FP2 ${r}` } })).data.id;

    const content = risFor([
      { ti: `Fingerprint study one ${r}`, doi: `10.4444/fp1.${r}` },
      { ti: `Fingerprint study two ${r}`, doi: `10.4444/fp2.${r}` },
    ]);
    const imp = (pid, body) => api(`/screening/projects/${pid}/import`, { method: 'POST', cookie: o.cookie, body: { format: 'ris', filename: 'pubmed_export.ris', content, ...body } });

    // First import → full contract shape.
    const first = await imp(p1, {});
    expect(first.status).toBe(200);
    expect(first.data.imported).toBe(2);
    expect(first.data.skippedDuplicates).toBe(0);
    expect(first.data.total).toBe(2);                  // total = parsed count (imported + skipped)
    expect(first.data.batchId).toBeTruthy();

    // Identical content again → 409 with the provenance the UI warning shows.
    const dup = await imp(p1, {});
    expect(dup.status).toBe(409);
    expect(dup.data.error).toBe('duplicate_import');
    expect(dup.data.batch.filename).toBe('pubmed_export.ris');
    expect(dup.data.batch.importedAt).toBeTruthy();
    expect(typeof dup.data.batch.importedByName).toBe('string');
    expect(dup.data.batch.recordCount).toBe(2);

    // force:true overrides the fingerprint — but record-level dedupe still applies.
    const forced = await imp(p1, { force: true });
    expect(forced.status).toBe(200);
    expect(forced.data.imported).toBe(0);
    expect(forced.data.skippedDuplicates).toBe(2);
    expect(forced.data.total).toBe(2);
    expect(forced.data.batchId).toBeTruthy();

    // Same file into a DIFFERENT project → no 409 (fingerprint is per-project).
    const other = await imp(p2, {});
    expect(other.status).toBe(200);
    expect(other.data.imported).toBe(2);

    // CRLF vs LF: same content with Windows line endings → still 409 (normalization).
    const crlf = await api(`/screening/projects/${p1}/import`, {
      method: 'POST', cookie: o.cookie,
      body: { format: 'ris', filename: 'pubmed_export_win.ris', content: content.replace(/\n/g, '\r\n') },
    });
    expect(crlf.status).toBe(409);
    expect(crlf.data.error).toBe('duplicate_import');

    await api(`/screening/projects/${p1}`, { method: 'DELETE', cookie: o.cookie });
    await api(`/screening/projects/${p2}`, { method: 'DELETE', cookie: o.cookie });
  });
});

// ── Tasks 9/10/12 — Ops metrics ───────────────────────────────────────────────
describe('prompt6 T9/T10/T12 — ops metrics (unique logins, lastActive, done-today)', () => {

  it('logins block: all numbers, monotonic day≤week≤month≤quarter≤year; repeated logins by ONE user bump day by exactly 1', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ metrics test skipped (no admin cookie)'); return; }
    const m0 = await api('/admin/metrics', { cookie: adminCookie });
    expect(m0.status).toBe(200);
    const L0 = m0.data.logins;
    for (const k of ['day', 'week', 'month', 'quarter', 'year']) expect(typeof L0[k]).toBe('number');
    expect(L0.day).toBeLessThanOrEqual(L0.week);
    expect(L0.week).toBeLessThanOrEqual(L0.month);
    expect(L0.month).toBeLessThanOrEqual(L0.quarter);
    expect(L0.quarter).toBeLessThanOrEqual(L0.year);

    // A fresh user logs in THREE times — distinctness means day grows by exactly 1.
    const r = rnd();
    const u = await register(`p6q_u${r}@t.local`);     // register alone records no login
    expect(await loginAs(u.email)).toBeTruthy();
    expect(await loginAs(u.email)).toBeTruthy();
    expect(await loginAs(u.email)).toBeTruthy();
    // LoginEvent writes are fire-and-forget — poll until the metric reflects them.
    expect(await until(async () => (await api('/admin/metrics', { cookie: adminCookie })).data.logins.day === L0.day + 1, 5000)).toBe(true);
    const L1 = (await api('/admin/metrics', { cookie: adminCookie })).data.logins;
    expect(L1.day).toBe(L0.day + 1);                   // 3 logins, 1 distinct user
    expect(L1.day).toBeLessThanOrEqual(L1.week);
    expect(L1.week).toBeLessThanOrEqual(L1.month);
  });

  it('lastActive updates within the last minute after a user action (recency window, never equality)', async () => {
    if (!up) return;
    if (!adminCookie) return;
    const r = rnd();
    const u = await register(`p6q_la${r}@t.local`);
    // Any authenticated request flows through requireAuth → throttled lastActive touch.
    await api('/projects', { cookie: u.cookie });
    const seen = await until(async () => {
      const res = await api(`/admin/users?search=${encodeURIComponent(u.email)}`, { cookie: adminCookie });
      const row = (res.data?.users || []).find(x => x.email === u.email);
      if (!row || !row.lastActive) return false;
      return Date.now() - new Date(row.lastActive).getTime() < 60_000;
    }, 5000);
    expect(seen).toBe(true);
  });

  it('doneToday counts a project toggled done→in_progress→done as ONE; invalid progressStatus → 400; 400 message lists progressStatus', async () => {
    if (!up) return;
    if (!adminCookie) return;
    const r = rnd();
    const o = await register(`p6q_d${r}@t.local`);
    const pid = (await api('/screening/projects', { method: 'POST', cookie: o.cookie, body: { title: `Done ${r}` } })).data.id;

    const s0 = (await api('/admin/screening/metrics', { cookie: adminCookie })).data;
    expect(typeof s0.doneToday).toBe('number');

    // Toggle done twice in one day via the member-facing endpoint.
    expect((await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: o.cookie, body: { progressStatus: 'done' } })).status).toBe(200);
    expect((await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: o.cookie, body: { progressStatus: 'in_progress' } })).status).toBe(200);
    expect((await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: o.cookie, body: { progressStatus: 'done' } })).status).toBe(200);

    const s1 = (await api('/admin/screening/metrics', { cookie: adminCookie })).data;
    expect(s1.doneToday).toBe(s0.doneToday + 1);       // distinct by project, not by event
    expect(s1.doneToday).toBeLessThanOrEqual(s1.doneThisWeek);
    // week ⊆ month does NOT hold on the 1st-6th of a month: the calendar week
    // (Sunday start) can begin in the PREVIOUS month, while the month bucket
    // resets on the 1st — so only assert it when the week started this month.
    const nowD = new Date();
    const weekStart = new Date(nowD); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0, 0, 0, 0);
    if (weekStart.getMonth() === nowD.getMonth()) {
      expect(s1.doneThisWeek).toBeLessThanOrEqual(s1.doneThisMonth);
    }
    expect(s1.doneToday).toBeLessThanOrEqual(s1.doneThisMonth); // day ⊆ month always

    // Admin status PATCH validation (Task 12 admin side).
    const bad = await api(`/admin/screening/projects/${pid}/status`, { method: 'PATCH', cookie: adminCookie, body: { progressStatus: 'bogus' } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe('invalid progressStatus');
    const empty = await api(`/admin/screening/projects/${pid}/status`, { method: 'PATCH', cookie: adminCookie, body: {} });
    expect(empty.status).toBe(400);
    expect(empty.data.error).toBe('Provide stage, disabled/archived, or progressStatus');

    // Admin setting the SAME value writes no event → metric unchanged.
    const same = await api(`/admin/screening/projects/${pid}/status`, { method: 'PATCH', cookie: adminCookie, body: { progressStatus: 'done' } });
    expect(same.status).toBe(200);
    const s2 = (await api('/admin/screening/metrics', { cookie: adminCookie })).data;
    expect(s2.doneToday).toBe(s1.doneToday);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: o.cookie });
  });
});

// ── Task 11 — Ops linked + expanded progress ──────────────────────────────────
describe('prompt6 T11 — ops console linked columns + SIFT progress drill-in', () => {

  it('admin META·LAB rows carry linkedMetaSift + workspaceId; SIFT detail carries the 10-field progress block + memberProgress', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ ops linked test skipped (no admin cookie)'); return; }
    const r = rnd();
    const a = await register(`p6o_a${r}@t.local`);
    const pair = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `Ops ${r}`, createLinkedSift: true } });
    const mlId = pair.data.project.id;
    const spid = pair.data.linkedScreenProject.id;

    // Two records + one decision so the progress block is non-trivial.
    const impRes = await api(`/screening/projects/${spid}/import`, {
      method: 'POST', cookie: a.cookie,
      body: { format: 'ris', content: risFor([
        { ti: `Ops record one ${r}`, doi: `10.3333/ops1.${r}` },
        { ti: `Ops record two ${r}`, doi: `10.3333/ops2.${r}` },
      ]) },
    });
    expect(impRes.status).toBe(200);
    const recs = (await api(`/screening/projects/${spid}/records`, { cookie: a.cookie })).data.records;
    const dec = await api(`/screening/projects/${spid}/records/${recs[0].id}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
    expect(dec.status).toBe(200);

    // META·LAB admin list row.
    const mlRows = await api(`/admin/projects?search=${encodeURIComponent(`Ops ${r}`)}`, { cookie: adminCookie });
    const row = (mlRows.data.projects || []).find(p => p.id === mlId);
    expect(row).toBeTruthy();
    // prompt50 WS1 enriched linkedMetaSift with progressStatus + stage — assert
    // the identity fields and the presence of the additive ops fields.
    expect(row.linkedMetaSift).toMatchObject({ id: spid, title: `Ops ${r}` });
    expect('progressStatus' in row.linkedMetaSift).toBe(true);
    expect('stage' in row.linkedMetaSift).toBe(true);
    expect(row.workspaceId).toBe(spid);
    expect(row.owner?.email).toBe(a.email);
    expect(row.status).toBe('active');

    // SIFT admin detail: expanded progress block (all 10 fields) + memberProgress.
    const detail = await api(`/admin/screening/projects/${spid}`, { cookie: adminCookie });
    expect(detail.status).toBe(200);
    expect(detail.data.workspaceId).toBe(spid);
    expect(detail.data.linkedMetaLab).toEqual({ id: mlId, title: `Ops ${r}` });
    const prog = detail.data.progress;
    for (const k of ['total', 'screened', 'unscreened', 'included', 'excluded', 'maybe', 'conflicts', 'duplicates', 'secondReview', 'sentToExtraction']) {
      expect(typeof prog[k], `progress.${k}`).toBe('number');
    }
    expect(prog.total).toBe(2);
    expect(prog.screened).toBe(1);
    expect(prog.unscreened).toBe(1);
    expect(prog.included).toBe(1);
    expect(Array.isArray(detail.data.memberProgress)).toBe(true);
    const mine = detail.data.memberProgress.find(m => m.email === a.email);
    expect(mine).toBeTruthy();
    expect(mine.screened).toBe(1);
    expect(mine.included).toBe(1);

    await api(`/screening/projects/${spid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });
});

// ── Task 14 — Mod RBAC ────────────────────────────────────────────────────────
describe('prompt6 T14 — mod console RBAC matrix (lean)', () => {

  it('mod: console/users/messages allowed; metrics/settings/screening/role-assign denied; plain user denied everywhere', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ mod RBAC test skipped (no admin cookie)'); return; }
    const r = rnd();
    const modU = await register(`p6r_mod${r}@t.local`);
    const plain = await register(`p6r_usr${r}@t.local`);
    const promote = await api(`/admin/users/${modU.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'mod' } });
    expect(promote.status).toBe(200);
    // audit-86 (v3.89.0) revokes the target's sessions on role change (sessionEpoch
    // bump) — the pre-promotion registration cookie is dead; log in again.
    modU.cookie = await loginAs(modU.email);
    expect(modU.cookie).toBeTruthy();

    // A contact message to exercise the replies route.
    const subject = `ModRBAC ${r}`;
    await api('/contact', { method: 'POST', body: { email: `vis_${r}@t.local`, name: 'Visitor', subject, message: 'rbac probe' } });

    // ── ALLOWED for mod ──
    const con = await api('/admin/console', { cookie: modU.cookie });
    expect(con.status).toBe(200);
    expect(con.data.role).toBe('mod');
    expect(con.data.sections).toEqual(['users', 'messages']);
    expect((await api('/admin/users', { cookie: modU.cookie })).status).toBe(200);
    const msgs = await api('/admin/contact-messages', { cookie: modU.cookie });
    expect(msgs.status).toBe(200);
    const msg = msgs.data.messages.find(m => m.subject === subject);
    expect(msg).toBeTruthy();
    expect((await api(`/admin/contact-messages/${msg.id}/replies`, { cookie: modU.cookie })).status).toBe(200);
    expect((await api('/admin/contact-messages/unread-count', { cookie: modU.cookie })).status).toBe(200);

    // ── DENIED for mod (admin-only) ──
    const denied = [
      ['GET', '/admin/metrics'],
      ['GET', '/admin/settings'],
      ['GET', '/admin/feature-flags'],
      ['GET', '/admin/audit-log'],
      ['GET', '/admin/security-events'],
      ['GET', '/admin/projects'],
      ['GET', '/admin/screening/metrics'],
      ['GET', '/admin/screening/settings'],
      ['GET', '/admin/screening/projects'],
      ['GET', '/admin/screening/audit'],
    ];
    for (const [method, path] of denied) {
      const res = await api(path, { method, cookie: modU.cookie });
      expect(res.status, `mod ${method} ${path}`).toBe(403);
    }
    // Role assignment + message delete are admin-only.
    expect((await api(`/admin/users/${plain.id}/role`, { method: 'PATCH', cookie: modU.cookie, body: { role: 'mod' } })).status).toBe(403);
    expect((await api(`/admin/contact-messages/${msg.id}`, { method: 'DELETE', cookie: modU.cookie })).status).toBe(403);

    // ── Plain user: 403 everywhere on /api/admin/* ──
    for (const path of ['/admin/console', '/admin/users', '/admin/metrics', '/admin/contact-messages']) {
      expect((await api(path, { cookie: plain.cookie })).status, `user GET ${path}`).toBe(403);
    }

    // Cleanup (admin).
    await api(`/admin/contact-messages/${msg.id}`, { method: 'DELETE', cookie: adminCookie });
    await api(`/admin/users/${modU.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'user' } });
  });
});

// ── Task 18 — Rename sync-if-in-sync ──────────────────────────────────────────
describe('prompt6 T18 — rename propagation (sync-if-in-sync, both directions)', () => {

  it('ML rename syncs the linked SIFT title when titles were equal; SIFT rename syncs back', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6t_a${r}@t.local`);
    const pair = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `Sync ${r}`, createLinkedSift: true } });
    const mlId = pair.data.project.id;
    const spid = pair.data.linkedScreenProject.id;

    // ML → SIFT (titles equal at creation).
    const ren1 = await api(`/projects/${mlId}`, { method: 'PUT', cookie: a.cookie, body: { name: `Sync ${r} v2` } });
    expect(ren1.status).toBe(200);
    expect(ren1.data.name).toBe(`Sync ${r} v2`);
    const sp1 = await api(`/screening/projects/${spid}`, { cookie: a.cookie });
    expect(sp1.data.title).toBe(`Sync ${r} v2`);       // followed

    // SIFT → ML (still in sync after the first rename).
    const ren2 = await api(`/screening/projects/${spid}`, { method: 'PUT', cookie: a.cookie, body: { title: `Sync ${r} v3` } });
    expect(ren2.status).toBe(200);
    const ml2 = await api(`/projects/${mlId}`, { cookie: a.cookie });
    expect(ml2.data.name).toBe(`Sync ${r} v3`);        // synced back

    await api(`/screening/projects/${spid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('pre-diverged titles do NOT sync (either direction); viewer cannot rename (403)', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p6t_b${r}@t.local`);
    const v = await register(`p6t_v${r}@t.local`);
    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `DivML ${r}` } });
    const mlId = ml.data.id;
    // Linked with a DIFFERENT title from the start → never in sync.
    const sp = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `DivSift ${r}`, linkedMetaLabProjectId: mlId } });
    const spid = sp.data.id;
    await api(`/screening/projects/${spid}/members`, { method: 'POST', cookie: a.cookie, body: { email: v.email, preset: 'viewer' } });

    // ML rename → SIFT untouched.
    await api(`/projects/${mlId}`, { method: 'PUT', cookie: a.cookie, body: { name: `DivML ${r} v2` } });
    expect((await api(`/screening/projects/${spid}`, { cookie: a.cookie })).data.title).toBe(`DivSift ${r}`);

    // SIFT rename → ML untouched.
    await api(`/screening/projects/${spid}`, { method: 'PUT', cookie: a.cookie, body: { title: `DivSift ${r} v2` } });
    expect((await api(`/projects/${mlId}`, { cookie: a.cookie })).data.name).toBe(`DivML ${r} v2`);

    // Viewer cannot rename either side.
    expect((await api(`/projects/${mlId}`, { method: 'PUT', cookie: v.cookie, body: { name: 'NOPE' } })).status).toBe(403);
    expect((await api(`/screening/projects/${spid}`, { method: 'PUT', cookie: v.cookie, body: { title: 'NOPE' } })).status).toBe(403);

    await api(`/screening/projects/${spid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });
});
