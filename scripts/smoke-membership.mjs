// Smoke test: membership, leader auto-seed, add-by-email, decision per-stage, quorum promotion, viewer/non-member guards.
const BASE = 'http://localhost:3001/api';
const rnd = Math.random().toString(36).slice(2, 8);

function cookieFrom(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/metalab_session=[^;]+/);
  return m ? m[0] : '';
}
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) {
  const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } });
  return r.cookie;
}
async function login(email, password) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { cookie: r.cookie, status: r.status, data: r.data };
}

const results = [];
const check = (name, cond, extra='') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

(async () => {
  // 0. Admin login now works (the env/JWT fix)
  const adminLogin = await login('ops@metalab.local', 'MetaLabAdmin2026!');
  check('ops@metalab.local admin login works', adminLogin.status === 200 && adminLogin.data?.user?.role === 'admin', `status=${adminLogin.status} role=${adminLogin.data?.user?.role}`);

  // 1. Two reviewer users
  const aEmail = `revA_${rnd}@test.local`, bEmail = `revB_${rnd}@test.local`, cEmail = `revC_${rnd}@test.local`, dEmail = `revD_${rnd}@test.local`;
  const aCookie = await register(aEmail);
  const bCookie = await register(bEmail);
  const cCookie = await register(cEmail);
  const dCookie = await register(dEmail);
  check('registered 4 reviewer users', aCookie && bCookie && cCookie && dCookie);

  // 2. userA creates a project
  const proj = await api('/screening/projects', { method: 'POST', cookie: aCookie, body: { title: `Quorum Test ${rnd}`, reviewQuestion: 'Does it work?' } });
  const pid = proj.data?.id;
  check('userA created project', proj.status === 201 && pid, `status=${proj.status}`);

  // 3. Leader member auto-seeded
  const mem1 = await api(`/screening/projects/${pid}/members`, { cookie: aCookie });
  const leader = mem1.data?.members?.find(m => m.email === aEmail.toLowerCase());
  check('owner auto-seeded as leader', mem1.status === 200 && leader?.role === 'leader' && mem1.data?.isLeader === true, `members=${mem1.data?.members?.length}`);

  // 4. userA adds userB (existing user) as reviewer
  const addB = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: aCookie, body: { email: bEmail, role: 'reviewer' } });
  check('leader added reviewer (active)', addB.status === 201 && addB.data?.member?.status === 'active' && addB.data?.pending === false, `status=${addB.status}`);

  // 4b. Adding unknown email → pending invite
  const addGhost = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: aCookie, body: { email: `ghost_${rnd}@nobody.local`, role: 'reviewer' } });
  check('unknown email → pending invite', addGhost.status === 201 && addGhost.data?.pending === true && addGhost.data?.member?.status === 'pending');

  // 4c. Non-leader cannot add members
  const addByB = await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: bCookie, body: { email: cEmail, role: 'reviewer' } });
  check('non-leader add member → 403', addByB.status === 403, `status=${addByB.status}`);

  // 5. userA adds a record
  const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: aCookie, body: { title: 'Test Article', abstract: 'An abstract', authors: 'Smith J', year: '2024' } });
  const rid = rec.data?.id;
  check('created record', rec.status === 201 && rid);

  // 6. userA includes → not yet quorum
  const decA = await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: aCookie, body: { decision: 'include' } });
  check('userA include saved, not promoted', decA.status === 200 && decA.data?.promoted === false && decA.data?.stage === 'title_abstract', `promoted=${decA.data?.promoted}`);

  // 7. userB includes → quorum reached, promoted to full_text
  const decB = await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: bCookie, body: { decision: 'include' } });
  check('userB include → QUORUM promotes to second review', decB.status === 200 && decB.data?.promoted === true, `promoted=${decB.data?.promoted}`);

  // 7b. One decision per reviewer per stage (on a non-promoted record): change updates, not duplicates.
  const rec2 = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: aCookie, body: { title: 'Second Article', abstract: 'Another abstract', year: '2023' } });
  const rid2 = rec2.data?.id;
  await api(`/screening/projects/${pid}/records/${rid2}/decision`, { method: 'POST', cookie: aCookie, body: { decision: 'include' } });
  const decA2 = await api(`/screening/projects/${pid}/records/${rid2}/decision`, { method: 'POST', cookie: aCookie, body: { decision: 'maybe' } });
  const decsList = await api(`/screening/projects/${pid}/decisions`, { cookie: aCookie });
  const aDecsForRec2 = (decsList.data?.decisions || []).filter(d => d.recordId === rid2);
  check('one decision per reviewer per stage (update not duplicate)', decA2.status === 200 && aDecsForRec2.length === 1 && aDecsForRec2[0].decision === 'maybe', `count=${aDecsForRec2.length}`);

  // 7c. Per-stage independence: userA's promoted record has exactly one decision per stage.
  const decsAll = await api(`/screening/projects/${pid}/decisions`, { cookie: aCookie });
  const aDecsForRec1 = (decsAll.data?.decisions || []).filter(d => d.recordId === rid);
  const stages = aDecsForRec1.map(d => d.stage).sort();
  check('promoted record: one decision per stage for reviewer', aDecsForRec1.length === 1 && stages[0] === 'title_abstract', `stages=${JSON.stringify(stages)}`);

  // 8. Viewer cannot screen
  await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: aCookie, body: { email: cEmail, role: 'viewer' } });
  const viewerDecision = await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: cCookie, body: { decision: 'include' } });
  check('viewer cannot record a decision → 403', viewerDecision.status === 403, `status=${viewerDecision.status}`);

  // 9. Non-member cannot access members
  const outsider = await api(`/screening/projects/${pid}/members`, { cookie: dCookie });
  check('non-member access → 404', outsider.status === 404, `status=${outsider.status}`);

  // 10. Inactive member cannot screen
  const bMemberId = addB.data?.member?.id;
  await api(`/screening/projects/${pid}/members/${bMemberId}`, { method: 'PATCH', cookie: aCookie, body: { status: 'inactive' } });
  const inactiveDecision = await api(`/screening/projects/${pid}/records/${rid}/decision`, { method: 'POST', cookie: bCookie, body: { decision: 'exclude' } });
  check('inactive member cannot screen → 403', inactiveDecision.status === 403, `status=${inactiveDecision.status}`);

  // cleanup project
  await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: aCookie });

  const passed = results.filter(r => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('SMOKE ERROR', e); process.exit(2); });
