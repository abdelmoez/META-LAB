// Smoke test: second review + META·LAB Data-Extraction handoff.
// Run from server/ so @prisma/client resolves. Server must be live on :3001.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const BASE = 'http://localhost:3001/api';
const rnd = Math.random().toString(36).slice(2, 8);

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } }); return { cookie: r.cookie, id: r.data?.user?.id }; }

const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

(async () => {
  const aEmail = `srA_${rnd}@test.local`, bEmail = `srB_${rnd}@test.local`;
  const a = await register(aEmail);
  const b = await register(bEmail);

  // Linked META·LAB project owned by userA (Data Extraction target)
  const ml = await prisma.project.create({ data: { userId: a.id, name: `ML ${rnd}`, data: '{}' } });

  // Screening project, linked
  const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `SR ${rnd}` } });
  const pid = proj.data.id;
  const link = await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: a.cookie, body: { linkedMetaLabProjectId: ml.id } });
  check('leader linked META·LAB project', link.status === 200 && link.data.linkedMetaLabProjectId === ml.id);

  await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: bEmail, role: 'reviewer' } });

  // Record → two includes → promoted
  const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Handoff Article', doi: '10.1/abc', pmid: '111', year: '2024', authors: 'Doe J', journal: 'J Test', abstract: 'abs' } });
  const rid = rec.data.id;
  await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
  await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });

  const sr = await api(`/screening/projects/${pid}/second-review`, { cookie: a.cookie });
  check('record appears in second review', sr.status === 200 && sr.data.records.some(r => r.id === rid), `count=${sr.data.records?.length}`);

  // Reviewer cannot finalize
  const finB = await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: b.cookie, body: { decision: 'accept' } });
  check('reviewer cannot finalize → 403', finB.status === 403, `status=${finB.status}`);

  // Leader accepts → handoff
  const finA = await api(`/screening/projects/${pid}/records/${rid}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'accept' } });
  check('leader accept → handed to META·LAB', finA.status === 200 && finA.data.handoff?.handed === true, `handoff=${JSON.stringify(finA.data.handoff)}`);

  // Verify study landed in ML project
  const mlAfter = await prisma.project.findUnique({ where: { id: ml.id } });
  const studies = JSON.parse(mlAfter.data || '{}').studies || [];
  const handed = studies.find(s => s.title === 'Handoff Article');
  check('study appended to ML studies[] flagged siftOrigin', studies.length === 1 && handed?.siftOrigin === true && handed?.doi === '10.1/abc' && handed?.needsReview === true, `studies=${studies.length}`);

  // META·LAB PRISMA summary endpoint reflects the linked screening project
  const summary = await api(`/screening/metalab/${ml.id}/summary`, { cookie: a.cookie });
  check('metalab summary: linked + included counts the accepted record', summary.status === 200 && summary.data.linked === true && summary.data.prisma?.included === 1, `linked=${summary.data.linked} included=${summary.data.prisma?.included}`);

  // Dedupe: second record, same DOI → promote → accept → not handed (duplicate)
  const rec2 = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Dup Article', doi: '10.1/abc', year: '2024' } });
  const rid2 = rec2.data.id;
  await api(`/screening/projects/${pid}/records/${rid2}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
  await api(`/screening/projects/${pid}/records/${rid2}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });
  const fin2 = await api(`/screening/projects/${pid}/records/${rid2}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'accept' } });
  const mlAfter2 = await prisma.project.findUnique({ where: { id: ml.id } });
  const studies2 = JSON.parse(mlAfter2.data || '{}').studies || [];
  check('duplicate DOI not re-added to ML', fin2.data.handoff?.handed === false && fin2.data.handoff?.reason === 'duplicate' && studies2.length === 1, `reason=${fin2.data.handoff?.reason} studies=${studies2.length}`);

  // Reject path
  const rec3 = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Reject Article', year: '2024' } });
  const rid3 = rec3.data.id;
  await api(`/screening/projects/${pid}/records/${rid3}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
  await api(`/screening/projects/${pid}/records/${rid3}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });
  const fin3 = await api(`/screening/projects/${pid}/records/${rid3}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'reject', reason: 'Wrong population' } });
  check('reject keeps record in META·SIFT with reason', fin3.data.record?.finalStatus === 'rejected' && fin3.data.record?.rejectedReason === 'Wrong population');

  // No-link project: accept still works, handoff reports no_link
  const proj2 = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `NoLink ${rnd}` } });
  const pid2 = proj2.data.id;
  await api(`/screening/projects/${pid2}/members`, { method: 'POST', cookie: a.cookie, body: { email: bEmail, role: 'reviewer' } });
  const recN = await api(`/screening/projects/${pid2}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'NoLink Article', year: '2024' } });
  const ridN = recN.data.id;
  await api(`/screening/projects/${pid2}/records/${ridN}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
  await api(`/screening/projects/${pid2}/records/${ridN}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });
  const finN = await api(`/screening/projects/${pid2}/records/${ridN}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'accept' } });
  check('accept without link → accepted + no_link prompt', finN.data.record?.finalStatus === 'accepted' && finN.data.handoff?.reason === 'no_link');

  // cleanup
  await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  await api(`/screening/projects/${pid2}`, { method: 'DELETE', cookie: a.cookie });
  await prisma.project.delete({ where: { id: ml.id } }).catch(() => {});
  await prisma.$disconnect();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('SMOKE ERROR', e); process.exit(2); });
