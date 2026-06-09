// Smoke test: PDF upload/validation/download/delete + admin flag enforcement + extended metrics.
const BASE = 'http://localhost:3001/api';
const rnd = Math.random().toString(36).slice(2, 8);
function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function upload(path, cookie, bytes, type, filename) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), filename);
  const res = await fetch(BASE + path, { method: 'POST', headers: { Cookie: cookie }, body: fd });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function register(email) { const r = await fetch(BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123!', name: email.split('@')[0] }) }); return cookieFrom(r); }
const results = []; const check = (n, c, e = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  — ' + e : ''}`); };

(async () => {
  const aCookie = await register(`pdfA_${rnd}@test.local`);
  const proj = await api('/screening/projects', { method: 'POST', cookie: aCookie, body: { title: `PDF ${rnd}` } });
  const pid = proj.data.id;
  const rec = await api(`/screening/projects/${pid}/records`, { method: 'POST', cookie: aCookie, body: { title: 'Doc', year: '2024' } });
  const rid = rec.data.id;

  // Valid PDF
  const pdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const up = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, aCookie, pdfBytes, 'application/pdf', 'paper.pdf');
  check('valid PDF uploads', up.status === 201 && up.data.attachment?.fileName === 'paper.pdf', `status=${up.status}`);

  const list = await api(`/screening/projects/${pid}/records/${rid}/pdf`, { cookie: aCookie });
  const aid = list.data.attachments?.[0]?.id;
  check('attachment listed', list.data.attachments?.length === 1 && aid);

  // Download
  const dl = await fetch(`${BASE}/screening/projects/${pid}/records/${rid}/pdf/${aid}/download`, { headers: { Cookie: aCookie } });
  const dlBody = await dl.text();
  check('download streams PDF', dl.status === 200 && dl.headers.get('content-type') === 'application/pdf' && dlBody.startsWith('%PDF'), `status=${dl.status} ct=${dl.headers.get('content-type')}`);

  // Reject wrong mime
  const badMime = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, aCookie, new TextEncoder().encode('hello'), 'text/plain', 'doc.txt');
  check('non-PDF mime rejected → 400', badMime.status === 400, `status=${badMime.status}`);

  // Reject .pdf with wrong magic bytes (executable disguised)
  const badMagic = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, aCookie, new TextEncoder().encode('MZ\x90\x00 fake exe'), 'application/pdf', 'evil.pdf');
  check('fake PDF (bad magic) rejected → 400', badMagic.status === 400, `status=${badMagic.status} msg=${badMagic.data?.error}`);

  // Replace: upload again → still 1 attachment
  const up2 = await upload(`/screening/projects/${pid}/records/${rid}/pdf`, aCookie, pdfBytes, 'application/pdf', 'paper2.pdf');
  const list2 = await api(`/screening/projects/${pid}/records/${rid}/pdf`, { cookie: aCookie });
  check('replace keeps one attachment', up2.status === 201 && list2.data.attachments.length === 1 && list2.data.attachments[0].fileName === 'paper2.pdf');

  // Delete
  const aid2 = list2.data.attachments[0].id;
  const del = await fetch(`${BASE}/screening/projects/${pid}/records/${rid}/pdf/${aid2}`, { method: 'DELETE', headers: { Cookie: aCookie } });
  const list3 = await api(`/screening/projects/${pid}/records/${rid}/pdf`, { cookie: aCookie });
  check('delete removes attachment', del.status === 204 && list3.data.attachments.length === 0);

  // ── Admin: login, metrics, flag enforcement ──
  const adminLogin = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ops@metalab.local', password: 'MetaLabAdmin2026!' }) });
  const adminCookie = cookieFrom(adminLogin);
  check('admin login (startup seed) works', adminLogin.status === 200 && adminCookie);

  const metrics = await api('/admin/screening/metrics', { cookie: adminCookie });
  check('extended admin metrics present', metrics.status === 200 && ['eligibleSecondReview', 'acceptedToExtraction', 'totalMembers', 'resolvedDuplicateGroups'].every(k => k in metrics.data), `keys=${Object.keys(metrics.data || {}).join(',')}`);

  // Flag enforcement: disable import, expect 403 on import; restore
  await api('/admin/screening/settings', { method: 'PUT', cookie: adminCookie, body: { allowImport: false } });
  const blockedImport = await api(`/screening/projects/${pid}/import`, { method: 'POST', cookie: aCookie, body: { format: 'ris', content: 'TY  - JOUR\nTI  - X\nER  -\n' } });
  check('admin allowImport=false blocks import → 403', blockedImport.status === 403, `status=${blockedImport.status}`);
  await api('/admin/screening/settings', { method: 'PUT', cookie: adminCookie, body: { allowImport: true } });

  // allowNewProjects=false blocks create; restore
  await api('/admin/screening/settings', { method: 'PUT', cookie: adminCookie, body: { allowNewProjects: false } });
  const blockedCreate = await api('/screening/projects', { method: 'POST', cookie: aCookie, body: { title: 'nope' } });
  check('admin allowNewProjects=false blocks create → 403', blockedCreate.status === 403, `status=${blockedCreate.status}`);
  await api('/admin/screening/settings', { method: 'PUT', cookie: adminCookie, body: { allowNewProjects: true } });

  // cleanup
  await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: aCookie });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('SMOKE ERROR', e); process.exit(2); });
