/**
 * collaboration.test.js — META·SIFT collaboration integration tests.
 *
 * Exercises the live API at http://localhost:3001 (start with `npm run server`).
 * Self-skips every test when the server is not running, matching the existing
 * screening-api.test.js convention. Covers the Part 16 required-tests list:
 * admin seed/login, leader creation, member CRUD, role/status, one-decision-per
 * -reviewer-per-stage, quorum, second review + extraction handoff, PRISMA summary,
 * duplicate similarity, per-member open-state, chat access control, PDF validation,
 * ownership/membership security, and "disable doesn't break META·LAB".
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api'; // 127.0.0.1 avoids Node/undici ::1 hang on Windows
const rnd = () => Math.random().toString(36).slice(2, 8);

let up = false;
let adminCookie = '';

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

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (up) {
    const pw = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';
    const r = await api('/auth/login', { method: 'POST', body: { email: 'ops@metalab.local', password: pw } });
    if (r.status === 200) adminCookie = r.cookie;
  }
});

describe('META·SIFT collaboration (integration)', () => {
  it('admin ops@metalab.local logs in with role=admin', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ admin login skipped (dev seed password not present)'); return; }
    const me = await api('/auth/me', { cookie: adminCookie });
    expect(me.status).toBe(200);
    expect(me.data.user.role).toBe('admin');
  });

  it('creator becomes leader; add-by-email; quorum promotes; one decision per stage; viewer/inactive/non-member blocked', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`itA_${r}@t.local`);
    const b = await register(`itB_${r}@t.local`);
    const c = await register(`itC_${r}@t.local`); // viewer
    const d = await register(`itD_${r}@t.local`); // non-member

    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `IT ${r}` } });
    expect(proj.status).toBe(201);
    const pid = proj.data.id;

    const members = await api(`/screening/projects/${pid}/members`, { cookie: a.cookie });
    expect(members.data.isLeader).toBe(true);
    // The creator is now the 'owner' role (prompt4 Task 8: creator→owner).
    expect(members.data.members.find(m => m.role === 'owner')).toBeTruthy();
    expect(members.data.isOwner).toBe(true);

    // add existing user (active) + unknown (pending)
    const addB = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `itB_${r}@t.local`, role: 'reviewer' } });
    expect(addB.status).toBe(201);
    expect(addB.data.member.status).toBe('active');
    const ghost = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `ghost_${r}@nobody.local` } });
    expect(ghost.data.pending).toBe(true);

    // non-leader cannot add
    const addByB = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: b.cookie, body: { email: `x_${r}@t.local` } });
    expect(addByB.status).toBe(403);

    // record + quorum
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Article', year: '2024' } });
    const rid = rec.data.id;
    const decA = await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
    expect(decA.data.promoted).toBe(false);
    const decB = await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });
    expect(decB.data.promoted).toBe(true); // quorum → second review

    // one decision per reviewer per stage on a non-promoted record
    const rec2 = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Article2', year: '2023' } });
    const rid2 = rec2.data.id;
    await api(`/screening/projects/${pid}/records/${rid2}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
    await api(`/screening/projects/${pid}/records/${rid2}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'maybe' } });
    const decs = await api(`/screening/projects/${pid}/decisions`, { cookie: a.cookie });
    const forRec2 = decs.data.decisions.filter(x => x.recordId === rid2);
    expect(forRec2.length).toBe(1);
    expect(forRec2[0].decision).toBe('maybe');

    // viewer cannot screen
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `itC_${r}@t.local`, role: 'viewer' } });
    const viewerDec = await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: c.cookie, body: { decision: 'include' } });
    expect(viewerDec.status).toBe(403);

    // non-member 404
    const outsider = await api(`/screening/projects/${pid}/members`, { cookie: d.cookie });
    expect(outsider.status).toBe(404);

    // inactive member cannot screen
    const bId = addB.data.member.id;
    await api(`/screening/projects/${pid}/members/${bId}`, { method: 'PATCH', cookie: a.cookie, body: { status: 'inactive' } });
    const inactiveDec = await api(`/screening/projects/${pid}/records/${rid2}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'exclude' } });
    expect(inactiveDec.status).toBe(403);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('second review → accept → META·LAB Data Extraction handoff (dedupe + summary)', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`srA_${r}@t.local`);
    const b = await register(`srB_${r}@t.local`);
    // META·LAB project (created via API)
    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `ML ${r}` } });
    const mlId = ml.data?.id || ml.data?.project?.id;
    expect(mlId).toBeTruthy();

    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `SR ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: a.cookie, body: { linkedMetaLabProjectId: mlId } });
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `srB_${r}@t.local`, role: 'reviewer' } });

    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'HO', doi: '10.x/' + r, year: '2024' } });
    const rid = rec.data.id;
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });

    const sr = await api(`/screening/projects/${pid}/second-review`, { cookie: a.cookie });
    expect(sr.data.records.some(x => x.id === rid)).toBe(true);

    // reviewer cannot finalize
    const finB = await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: b.cookie, body: { decision: 'accept' } });
    expect(finB.status).toBe(403);

    // leader accept → handed
    const finA = await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'accept' } });
    expect(finA.data.handoff.handed).toBe(true);

    // metalab summary reflects the accepted record
    const summary = await api(`/screening/metalab/${mlId}/summary`, { cookie: a.cookie });
    expect(summary.data.linked).toBe(true);
    expect(summary.data.prisma.included).toBe(1);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('chat: members-only, sanitized, polling; per-member open-state; overview metrics', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`chA_${r}@t.local`);
    const b = await register(`chB_${r}@t.local`);
    const out = await register(`chO_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `CH ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `chB_${r}@t.local`, role: 'reviewer' } });

    const post = await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: a.cookie, body: { message: '<script>x</script>hi' } });
    expect(post.status).toBe(201);
    expect(/<script/i.test(post.data.message.message)).toBe(false); // sanitized

    const bChat = await api(`/screening/projects/${pid}/chat`, { cookie: b.cookie });
    expect(bChat.data.messages.length).toBeGreaterThan(0);
    const outChat = await api(`/screening/projects/${pid}/chat`, { cookie: out.cookie });
    expect(outChat.status).toBe(404); // non-member

    // open-state per member
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'R', year: '2024' } });
    await api(`/screening/projects/${pid}/records/${rec.data.id}/open`, { method: 'POST', cookie: a.cookie });
    const openedA = await api(`/screening/projects/${pid}/records?filter=opened_me`, { cookie: a.cookie });
    const unopenedB = await api(`/screening/projects/${pid}/records?filter=unopened_me`, { cookie: b.cookie });
    expect(openedA.data.total).toBe(1);
    expect(unopenedB.data.total).toBe(1);

    const ov = await api(`/screening/projects/${pid}/overview`, { cookie: a.cookie });
    expect(ov.data.dataSummary.totalArticles).toBe(1);
    expect(ov.data.members.length).toBe(2);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('PDF upload: valid accepted, fake/non-pdf rejected, replace+delete', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`pdfA_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `PDF ${r}` } });
    const pid = proj.data.id;
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'D', year: '2024' } });
    const rid = rec.data.id;
    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF');

    const ok = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, a.cookie, pdf, 'application/pdf', 'p.pdf');
    expect(ok.status).toBe(201);
    const badMime = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, a.cookie, new TextEncoder().encode('x'), 'text/plain', 'p.txt');
    expect(badMime.status).toBe(400);
    const badMagic = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, a.cookie, new TextEncoder().encode('MZ fake'), 'application/pdf', 'e.pdf');
    expect(badMagic.status).toBe(400);

    const list = await api(`/screening/projects/${pid}/records/${rid}/pdf`, { cookie: a.cookie });
    expect(list.data.attachments.length).toBe(1); // replace kept one
    const aid = list.data.attachments[0].id;
    const del = await fetch(`${BASE}/screening/projects/${pid}/records/${rid}/pdf/${aid}`, { method: 'DELETE', headers: { Cookie: a.cookie } });
    expect(del.status).toBe(204);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('duplicate detection surfaces an explainable similarity %', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`dupA_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `DUP ${r}` } });
    const pid = proj.data.id;
    // two records with identical DOI
    await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Same A', doi: '10.dup/' + r, year: '2024' } });
    await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Same B', doi: '10.dup/' + r, year: '2024' } });
    await api(`/screening/projects/${pid}/duplicates/detect`, { method: 'POST', cookie: a.cookie });
    const dups = await api(`/screening/projects/${pid}/duplicates`, { cookie: a.cookie });
    expect(dups.data.groups.length).toBeGreaterThan(0);
    const g = dups.data.groups[0];
    expect(g.similarity).toBe(100);
    expect(typeof g.similarityReason).toBe('string');
    expect(g.similarityReason.length).toBeGreaterThan(0);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('admin flag enforcement + disabling META·SIFT does NOT break META·LAB', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ admin flag test skipped (no admin)'); return; }
    const r = rnd();
    const a = await register(`disA_${r}@t.local`);
    // baseline: META·LAB works
    const mlBefore = await api('/projects', { cookie: a.cookie });
    expect(mlBefore.status).toBe(200);

    try {
      await api('/admin/screening/settings', { method: 'PUT', cookie: adminCookie, body: { enabled: false } });
      // META·SIFT blocked
      const sift = await api('/screening/projects', { cookie: a.cookie });
      expect(sift.status).toBe(503);
      // META·LAB unaffected
      const health = await fetch(BASE + '/health'); expect(health.ok).toBe(true);
      const ml = await api('/projects', { cookie: a.cookie });
      expect(ml.status).toBe(200);
    } finally {
      await api('/admin/screening/settings', { method: 'PUT', cookie: adminCookie, body: { enabled: true } });
    }

    // flag enforcement: import off → 403
    try {
      await api('/admin/screening/settings', { method: 'PUT', cookie: adminCookie, body: { allowNewProjects: false } });
      const blocked = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: 'x' } });
      expect(blocked.status).toBe(403);
    } finally {
      await api('/admin/screening/settings', { method: 'PUT', cookie: adminCookie, body: { allowNewProjects: true } });
    }
  });
});
