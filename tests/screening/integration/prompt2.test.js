/**
 * prompt2.test.js — META·SIFT integration tests for the prompt2 upgrade.
 *
 * Exercises the live API at http://localhost:3001 (start with `npm run server`).
 * Self-skips when the server is down (same convention as collaboration.test.js).
 *
 * Covers prompt2 backend deliverables:
 *  - Task 8: default include/exclude keywords seeded on project create
 *  - Task 4: META·LAB association (linkable list, link/unlink, handoff rollup)
 *  - Task 2: conflict resolved as INCLUDE promotes the record to Second Review;
 *            EXCLUDE does not promote (stores reason); MAYBE stays disputed
 *  - Task 5: Second Review accept → Data Extraction handoff status
 *            (sent / pending-when-unlinked / already_exists on retry)
 *  - Task 1: PDF served inline (application/pdf + inline disposition) for preview
 *  - Task 3: admin toggles (allowPdfUpload / allowChat / allowSecondReview) enforced
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Use 127.0.0.1 (not "localhost"): Node 18+ undici resolves localhost to ::1
// first, which hangs against a dual-stack server on Windows. curl is unaffected.
const BASE = 'http://127.0.0.1:3001/api';
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
async function setSetting(patch) { return api('/admin/screening/settings', { method: 'PUT', cookie: adminCookie, body: patch }); }

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (up) {
    const pw = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';
    const r = await api('/auth/login', { method: 'POST', body: { email: 'ops@metalab.local', password: pw } });
    if (r.status === 200) adminCookie = r.cookie;
  }
}, 30000);

describe('META·SIFT prompt2 upgrade (integration)', () => {
  it('Task 8: new projects are seeded with editable default include/exclude keywords', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`kwA_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `KW ${r}` } });
    expect(proj.status).toBe(201);
    const inc = JSON.parse(proj.data.inclusionKeywords || '[]');
    const exc = JSON.parse(proj.data.exclusionKeywords || '[]');
    expect(inc).toContain('randomized');
    expect(inc).toContain('placebo');
    expect(exc).toContain('animal');
    expect(exc).toContain('case report');
    await api(`/screening/projects/${proj.data.id}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('Task 4/5: linkable list, link, quorum→second review→accept→handoff sent, retry→already_exists', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`lkA_${r}@t.local`);
    const b = await register(`lkB_${r}@t.local`);
    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `ML ${r}` } });
    const mlId = ml.data?.id || ml.data?.project?.id;
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `LK ${r}` } });
    const pid = proj.data.id;

    // linkable offers the owner's META·LAB project; nothing linked yet
    const link0 = await api(`/screening/projects/${pid}/linkable`, { cookie: a.cookie });
    expect(link0.data.linked).toBeNull();
    expect(link0.data.available.some(p => p.id === mlId)).toBe(true);

    // link it
    const linked = await api(`/screening/projects/${pid}/link`, { method: 'POST', cookie: a.cookie, body: { metaLabProjectId: mlId } });
    expect(linked.data.linked.id).toBe(mlId);

    // member + quorum include
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `lkB_${r}@t.local`, role: 'reviewer' } });
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Linked HO', doi: '10.lk/' + r, year: '2024' } });
    const rid = rec.data.id;
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
    const promo = await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });
    expect(promo.data.promoted).toBe(true);

    // accept → handoff sent
    const fin = await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'accept' } });
    expect(fin.data.handoff.handed).toBe(true);
    expect(fin.data.record.handoffStatus).toBe('sent');

    // handoff rollup reflects it
    const roll = await api(`/screening/projects/${pid}/linkable`, { cookie: a.cookie });
    expect(roll.data.handoff.sent).toBeGreaterThanOrEqual(1);
    expect(roll.data.handoff.accepted).toBeGreaterThanOrEqual(1);

    // retry is idempotent → already_exists (deduped by DOI)
    const retry = await api(`/screening/projects/${pid}/records/${rid}/handoff/retry`, { method: 'POST', cookie: a.cookie });
    expect(retry.data.record.handoffStatus).toBe('already_exists');

    // the study actually landed in the META·LAB project's studies[] (getProject
    // parses data JSON and exposes studies as a top-level array).
    const mlGet = await api(`/projects/${mlId}`, { cookie: a.cookie });
    const studies = mlGet.data?.studies || [];
    expect(studies.some(s => s.siftOrigin && (s.doi === '10.lk/' + r || s.title === 'Linked HO'))).toBe(true);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('Task 2: conflict resolved INCLUDE promotes to Second Review; EXCLUDE/MAYBE do not', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`cfA_${r}@t.local`); // leader
    const b = await register(`cfB_${r}@t.local`); // reviewer
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `CF ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `cfB_${r}@t.local`, role: 'reviewer' } });

    // helper: create a disputed record (a include / b exclude)
    async function disputed(title) {
      const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title, year: '2024' } });
      const rid = rec.data.id;
      await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
      await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'exclude' } });
      return rid;
    }
    const ridInc = await disputed('Dispute INC');
    const ridExc = await disputed('Dispute EXC');

    // not promoted while disputed
    const sr0 = await api(`/screening/projects/${pid}/second-review`, { cookie: a.cookie });
    expect(sr0.data.records.some(x => x.id === ridInc)).toBe(false);

    // leader sees conflicts; reviewer (non-resolver) is blocked
    const confList = await api(`/screening/projects/${pid}/conflicts`, { cookie: a.cookie });
    expect(confList.data.conflicts.length).toBeGreaterThanOrEqual(2);
    const confB = await api(`/screening/projects/${pid}/conflicts`, { cookie: b.cookie });
    expect(confB.status).toBe(403);

    const cInc = confList.data.conflicts.find(c => c.recordId === ridInc);
    const cExc = confList.data.conflicts.find(c => c.recordId === ridExc);

    // resolve INCLUDE → promoted to second review
    const resInc = await api(`/screening/projects/${pid}/conflicts/${cInc.id}/resolve`, { method: 'POST', cookie: a.cookie, body: { finalDecision: 'include', notes: 'leader call' } });
    expect(resInc.data.promoted).toBe(true);
    // resolve EXCLUDE → not promoted, reason stored
    const resExc = await api(`/screening/projects/${pid}/conflicts/${cExc.id}/resolve`, { method: 'POST', cookie: a.cookie, body: { finalDecision: 'exclude', notes: 'wrong population' } });
    expect(resExc.data.promoted).toBe(false);

    const sr1 = await api(`/screening/projects/${pid}/second-review`, { cookie: a.cookie });
    expect(sr1.data.records.some(x => x.id === ridInc)).toBe(true);
    expect(sr1.data.records.some(x => x.id === ridExc)).toBe(false);
    const promotedRec = sr1.data.records.find(x => x.id === ridInc);
    expect(promotedRec.promotedVia).toBe('conflict_resolution');

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('Task 5: accepting with no linked project → handoff pending; linking + retry → sent', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`pdA_${r}@t.local`);
    const b = await register(`pdB_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `PD ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `pdB_${r}@t.local`, role: 'reviewer' } });
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Pending HO', doi: '10.pd/' + r, year: '2024' } });
    const rid = rec.data.id;
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });

    // accept with NO link → pending
    const fin = await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'accept' } });
    expect(fin.data.handoff.handed).toBe(false);
    expect(fin.data.record.handoffStatus).toBe('pending');

    // link a project then retry → sent
    const ml = await api('/projects', { method: 'POST', cookie: a.cookie, body: { name: `MLP ${r}` } });
    const mlId = ml.data?.id || ml.data?.project?.id;
    await api(`/screening/projects/${pid}/link`, { method: 'POST', cookie: a.cookie, body: { metaLabProjectId: mlId } });
    const retry = await api(`/screening/projects/${pid}/records/${rid}/handoff/retry`, { method: 'POST', cookie: a.cookie });
    expect(retry.data.record.handoffStatus).toBe('sent');

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
    await api(`/projects/${mlId}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('Task 1: uploaded PDF is served inline (application/pdf) for in-browser preview', async () => {
    if (!up) return;
    const r = rnd();
    const a = await register(`pvA_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `PV ${r}` } });
    const pid = proj.data.id;
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Doc', year: '2024' } });
    const rid = rec.data.id;
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
    const ok = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, a.cookie, pdf, 'application/pdf', 'doc.pdf');
    expect(ok.status).toBe(201);
    const aid = ok.data.attachment.id;

    // member fetch → inline pdf
    const res = await fetch(`${BASE}/screening/projects/${pid}/records/${rid}/pdf/${aid}/download`, { headers: { Cookie: a.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/pdf/);
    expect((res.headers.get('content-disposition') || '')).toMatch(/inline/);

    // unauthenticated fetch → 401 (no public URL)
    const noauth = await fetch(`${BASE}/screening/projects/${pid}/records/${rid}/pdf/${aid}/download`);
    expect(noauth.status).toBe(401);

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });

  it('Task 3: admin toggles enforce allowPdfUpload / allowChat / allowSecondReview', async () => {
    if (!up) return;
    if (!adminCookie) { console.warn('  ↪ admin toggle test skipped (no admin)'); return; }
    const r = rnd();
    const a = await register(`tgA_${r}@t.local`);
    const b = await register(`tgB_${r}@t.local`);
    const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `TG ${r}` } });
    const pid = proj.data.id;
    await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: `tgB_${r}@t.local`, role: 'reviewer' } });
    const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'T', year: '2024' } });
    const rid = rec.data.id;

    // PDF upload off → 403
    try {
      await setSetting({ allowPdfUpload: false });
      const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF');
      const blocked = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, a.cookie, pdf, 'application/pdf', 'p.pdf');
      expect(blocked.status).toBe(403);
    } finally { await setSetting({ allowPdfUpload: true }); }

    // chat off → post 403
    try {
      await setSetting({ allowChat: false });
      const chat = await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: a.cookie, body: { message: 'hi' } });
      expect(chat.status).toBe(403);
    } finally { await setSetting({ allowChat: true }); }

    // second review off → finalize 403 (promote first)
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
    await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });
    try {
      await setSetting({ allowSecondReview: false });
      const fin = await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'accept' } });
      expect(fin.status).toBe(403);
    } finally { await setSetting({ allowSecondReview: true }); }

    await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  });
});
