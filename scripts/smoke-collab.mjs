// Smoke test: membership reads, per-member open-state, chat (polling + sanitize + permission), overview, audit.
const BASE = 'http://localhost:3001/api';
const rnd = Math.random().toString(36).slice(2, 8);
function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function register(email) { const r = await fetch(BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123!', name: email.split('@')[0] }) }); return { cookie: cookieFrom(r) }; }
const results = []; const check = (n, c, e = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  — ' + e : ''}`); };

(async () => {
  const aEmail = `clA_${rnd}@test.local`, bEmail = `clB_${rnd}@test.local`;
  const a = await register(aEmail), b = await register(bEmail);
  const proj = await api('/screening/projects', { method: 'POST', cookie: a.cookie, body: { title: `Collab ${rnd}` } });
  const pid = proj.data.id;
  await api(`/screening/projects/${pid}/members`, { method: 'POST', cookie: a.cookie, body: { email: bEmail, role: 'reviewer' } });

  const rec1 = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Rec One', abstract: 'a', year: '2024' } });
  const rec2 = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: a.cookie, body: { title: 'Rec Two', abstract: 'b', year: '2024' } });
  const r1 = rec1.data.id, r2 = rec2.data.id;

  // Membership read: reviewer can list records
  const bList = await api(`/screening/projects/${pid}/records`, { cookie: b.cookie });
  check('reviewer can list records (membership read)', bList.status === 200 && bList.data.records.length === 2, `status=${bList.status}`);

  // Open-state
  await api(`/screening/projects/${pid}/records/${r1}/open`, { method: 'POST', cookie: a.cookie });
  const openedMe = await api(`/screening/projects/${pid}/records?filter=opened_me`, { cookie: a.cookie });
  const unopenedMe = await api(`/screening/projects/${pid}/records?filter=unopened_me`, { cookie: a.cookie });
  check('open-state filters (opened_me=1, unopened_me=1)', openedMe.data.total === 1 && unopenedMe.data.total === 1 && openedMe.data.records[0].id === r1, `opened=${openedMe.data.total} unopened=${unopenedMe.data.total}`);
  // open-state is per-member: userB sees both unopened
  const bUnopened = await api(`/screening/projects/${pid}/records?filter=unopened_me`, { cookie: b.cookie });
  check('open-state is per-member (userB unopened=2)', bUnopened.data.total === 2, `unopened=${bUnopened.data.total}`);

  // Chat: post + poll
  const post1 = await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: a.cookie, body: { message: 'Hello team' } });
  check('leader posts chat message', post1.status === 201 && post1.data.message.message === 'Hello team');
  const bChat = await api(`/screening/projects/${pid}/chat`, { cookie: b.cookie });
  check('member sees chat message', bChat.status === 200 && bChat.data.messages.some(m => m.message === 'Hello team'));
  const since = bChat.data.serverTime;
  await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: b.cookie, body: { message: 'Hi back' } });
  const poll = await api(`/screening/projects/${pid}/chat?since=${encodeURIComponent(since)}`, { cookie: a.cookie });
  check('polling ?since returns only new messages', poll.data.messages.length === 1 && poll.data.messages[0].message === 'Hi back', `count=${poll.data.messages.length}`);

  // Sanitize HTML
  const xss = await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: a.cookie, body: { message: '<script>alert(1)</script>safe <b>text</b>' } });
  check('chat strips HTML tags', xss.status === 201 && !/<script|<b>/i.test(xss.data.message.message), `stored="${xss.data.message.message}"`);

  // Non-member cannot read chat
  const c = await register(`clC_${rnd}@test.local`);
  const outsiderChat = await api(`/screening/projects/${pid}/chat`, { cookie: c.cookie });
  check('non-member cannot read chat → 404', outsiderChat.status === 404, `status=${outsiderChat.status}`);

  // Chat permission: restrict + revoke canChat for B
  await api(`/screening/projects/${pid}`, { method: 'PUT', cookie: a.cookie, body: { chatRestricted: true } });
  const members = await api(`/screening/projects/${pid}/members`, { cookie: a.cookie });
  const bMember = members.data.members.find(m => m.email === bEmail.toLowerCase());
  await api(`/screening/projects/${pid}/members/${bMember.id}`, { method: 'PATCH', cookie: a.cookie, body: { canChat: false } });
  const bBlocked = await api(`/screening/projects/${pid}/chat`, { method: 'POST', cookie: b.cookie, body: { message: 'should fail' } });
  check('restricted chat blocks member without canChat → 403', bBlocked.status === 403, `status=${bBlocked.status}`);

  // Quorum → overview eligibleSecondReview, then accept → acceptedToExtraction
  await api(`/screening/projects/${pid}/records/${r1}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
  await api(`/screening/projects/${pid}/records/${r1}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'include' } });
  // a disputed record: a include, b exclude on r2
  await api(`/screening/projects/${pid}/records/${r2}/decision`, { method: 'POST', cookie: a.cookie, body: { decision: 'include' } });
  await api(`/screening/projects/${pid}/records/${r2}/decision`, { method: 'POST', cookie: b.cookie, body: { decision: 'exclude' } });

  const ov = await api(`/screening/projects/${pid}/overview`, { cookie: a.cookie });
  check('overview: totals + eligibleSecondReview + disputed', ov.status === 200 && ov.data.dataSummary.totalArticles === 2 && ov.data.dataSummary.eligibleSecondReview === 1 && ov.data.dataSummary.disputedDecisions === 1, `eligible=${ov.data.dataSummary.eligibleSecondReview} disputed=${ov.data.dataSummary.disputedDecisions}`);
  check('overview: member progress for 2 members', ov.data.members.length === 2 && ov.data.members.every(m => typeof m.progress === 'number'), `members=${ov.data.members.length}`);

  await api(`/screening/projects/${pid}/records/${r1}/finalize`, { method: 'POST', cookie: a.cookie, body: { decision: 'accept' } });
  const ov2 = await api(`/screening/projects/${pid}/overview`, { cookie: a.cookie });
  check('overview: acceptedToExtraction reflects finalize', ov2.data.dataSummary.acceptedToExtraction === 1, `accepted=${ov2.data.dataSummary.acceptedToExtraction}`);

  // Audit: leader can view, member cannot
  const audit = await api(`/screening/projects/${pid}/audit`, { cookie: a.cookie });
  check('leader sees audit log with member + accept events', audit.status === 200 && audit.data.entries.some(e => e.action === 'MEMBER_ADDED') && audit.data.entries.some(e => e.action === 'RECORD_ACCEPTED'), `entries=${audit.data.entries?.length}`);
  const auditB = await api(`/screening/projects/${pid}/audit`, { cookie: b.cookie });
  check('member cannot view audit → 403', auditB.status === 403, `status=${auditB.status}`);

  await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: a.cookie });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('SMOKE ERROR', e); process.exit(2); });
