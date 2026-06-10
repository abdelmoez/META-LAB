/**
 * prompt3.test.js — META·SIFT targeted bug-fix integration tests (prompt3).
 *
 * Live API at http://127.0.0.1:3001 (npm run server); self-skips when down.
 *   BUG 1 — default include + exclude keywords returned (+ counts)
 *   BUG 2 — chat unread count per user/project + mark-read persistence
 *   BUG 3 — PDF endpoint supports Range (206 + Content-Range + Accept-Ranges)
 *   BUG 4 — project list returns linked title + leader + currentUserRole
 *   BUG 5 — metalab summary exposes acceptedStudies for Data Extraction pull-merge
 *   BUG 6 — member progress visibility (non-leader sees only self; leader sees all)
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
async function upload(path, cookie, bytes, type, filename) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), filename);
  const res = await fetch(BASE + path, { method: 'POST', headers: { Cookie: cookie }, body: fd });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id }; }

beforeAll(async () => { try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; } }, 30000);

describe('META·SIFT prompt3 bug fixes (integration)', () => {
  it('BUG 1: keyword-stats returns default include + exclude keywords with article counts', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p3kw_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `KW3 ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'A randomized controlled trial', abstract: 'double blind placebo randomized', year: '2024' } });
    await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'An animal cohort study', abstract: 'rat cohort observational', year: '2023' } });

    const stats = await api(`/screening/projects/${pid}/keyword-stats`, { cookie: a.cookie });
    expect(stats.status).toBe(200);
    const incKeys = Object.keys(stats.data.include || {});
    const excKeys = Object.keys(stats.data.exclude || {});
    expect(incKeys).toContain('randomized');     // default include present
    expect(incKeys).toContain('placebo');
    expect(excKeys).toContain('animal');          // default exclude present
    expect(excKeys).toContain('cohort');
    expect(stats.data.include['randomized']).toBe(1);  // counts ARTICLES
    expect(stats.data.exclude['cohort']).toBe(1);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('BUG 2: unread count is per-user; mark-read clears it and persists across "logins"', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p3ca_${r}@t.local`); // leader/sender
    const b = await register(`p3cb_${r}@t.local`); // reader
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `CHAT3 ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `p3cb_${r}@t.local`, role: 'reviewer' } });

    // A sends two messages
    await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: a.cookie, body: { message: 'hello team' } });
    await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: a.cookie, body: { message: 'second message' } });

    // B has 2 unread; A (the sender) has 0 (own messages don't count)
    const bUnread = await api(`/screening/projects/${pid}/chat/unread-count`, { cookie: b.cookie });
    expect(bUnread.data.unread).toBe(2);
    const aUnread = await api(`/screening/projects/${pid}/chat/unread-count`, { cookie: a.cookie });
    expect(aUnread.data.unread).toBe(0);

    // B opens chat → mark-read
    await api(`/screening/projects/${pid}/chat/mark-read`, { method: 'POST', cookie: b.cookie });
    const bAfter = await api(`/screening/projects/${pid}/chat/unread-count`, { cookie: b.cookie });
    expect(bAfter.data.unread).toBe(0);

    // Simulate B logging in again (fresh login cookie) — badge must NOT reappear
    const b2 = await api('/auth/login', { method: 'POST', body: { email: `p3cb_${r}@t.local`, password: 'Password123!' } });
    const bRelogin = await api(`/screening/projects/${pid}/chat/unread-count`, { cookie: b2.cookie });
    expect(bRelogin.data.unread).toBe(0);

    // A sends a new message → B sees 1 unread again
    await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: a.cookie, body: { message: 'a new one' } });
    const bNew = await api(`/screening/projects/${pid}/chat/unread-count`, { cookie: b2.cookie });
    expect(bNew.data.unread).toBe(1);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('BUG 3: PDF download supports Range → 206 Partial Content + Content-Range', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p3pdf_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `PDF3 ${r}` } });
    const pid = proj.data.id;
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Doc', year: '2024' } });
    const rid = rec.data.id;
    const pdf = new TextEncoder().encode('%PDF-1.4\n' + 'x'.repeat(2000) + '\n%%EOF');
    const ok = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, a.cookie, pdf, 'application/pdf', 'doc.pdf');
    expect(ok.status).toBe(201);
    const aid = ok.data.attachment.id;
    const url = `${BASE}/screening/projects/${pid}/records/${rid}/pdf/${aid}/download`;

    // Full request advertises Accept-Ranges + Content-Length
    const full = await fetch(url, { headers: { Cookie: a.cookie } });
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(Number(full.headers.get('content-length'))).toBeGreaterThan(0);

    // Range request → 206 with Content-Range
    const part = await fetch(url, { headers: { Cookie: a.cookie, Range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toMatch(/^bytes 0-99\//);
    expect(part.headers.get('content-type')).toMatch(/application\/pdf/);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('BUG 4: project list returns linkedMetaLabProjectTitle + leaderName + currentUserRole', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p3pl_${r}@t.local`);
    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `MLcard ${r}` } });
    const mlId = ml.data?.id || ml.data?.project?.id;
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `CARD ${r}`, linkedMetaLabProjectId: mlId } });
    const pid = proj.data.id;

    const list = await api('/screening/projects', { cookie: a.cookie });
    const row = list.data.projects.find(p => p.id === pid);
    expect(row).toBeTruthy();
    expect(row.linkedMetaLabProjectTitle).toBe(`MLcard ${r}`);
    expect(row.leaderName).toBeTruthy();
    // prompt5 Task 1: the owner's own role is now 'owner' (no longer conflated with 'leader').
    expect(row.currentUserRole).toBe('owner');
    expect(row.totalArticles).toBe(0);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('BUG 5: metalab summary exposes acceptedStudies (with provenance) for pull-merge', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p3ho_${r}@t.local`);
    const b = await register(`p3hb_${r}@t.local`);
    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `MLho ${r}` } });
    const mlId = ml.data?.id || ml.data?.project?.id;
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `HO3 ${r}`, linkedMetaLabProjectId: mlId } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `p3hb_${r}@t.local`, role: 'reviewer' } });
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Accepted study', doi: '10.ho3/' + r, year: '2024' } });
    const rid = rec.data.id;
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });
    await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'accept' } });

    const summary = await api(`/screening/metalab/${mlId}/summary`, { cookie: a.cookie });
    expect(summary.data.linked).toBe(true);
    expect(Array.isArray(summary.data.acceptedStudies)).toBe(true);
    const study = summary.data.acceptedStudies.find(s => s.doi === '10.ho3/' + r);
    expect(study).toBeTruthy();
    expect(study.siftOrigin).toBe(true);
    expect(study.screeningRecordId).toBe(rid);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('BUG 6: non-leader overview shows only own progress; leader sees all + whole-project', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`p3la_${r}@t.local`); // leader
    const b = await register(`p3lb_${r}@t.local`); // member
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `VIS ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `p3lb_${r}@t.local`, role: 'reviewer' } });
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Rec', year: '2024' } });
    await api(`/screening/projects/${pid}/records/${rec.data.id}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });

    // Leader: sees all members + whole-project progress
    const ovLeader = await api(`/screening/projects/${pid}/overview`, { cookie: a.cookie });
    expect(ovLeader.data.isLeader).toBe(true);
    expect(ovLeader.data.members.length).toBe(2);
    expect(ovLeader.data.projectProgress).not.toBeNull();

    // Member: sees ONLY their own member row, and no whole-project progress
    const ovMember = await api(`/screening/projects/${pid}/overview`, { cookie: b.cookie });
    expect(ovMember.data.isLeader).toBe(false);
    expect(ovMember.data.members.length).toBe(1);
    expect(ovMember.data.members[0].userId).toBe(b.id);
    expect(ovMember.data.projectProgress).toBeNull();

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });
});
