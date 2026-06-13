/* B2 smoke — soft delete, cascade, RIS export, metrics, maintenance mode. */
const BASE = 'http://127.0.0.1:3001';
let failures = 0;

function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
}

function cookieFrom(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/metalab_session=[^;]+/);
  return m ? m[0] : '';
}

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
}

const stamp = Date.now();
const userEmail = `b2smoke${stamp}@example.com`;

// ── 1. Register user ─────────────────────────────────────────────────────────
let r = await api('/api/auth/register', { method: 'POST', body: { email: userEmail, password: 'Password123!', name: 'B2 Smoke' } });
check('register user', r.status === 201, `status ${r.status}`);
const userCookie = cookieFrom(r.res);
check('session cookie', !!userCookie);

// ── 2. Create ML project ─────────────────────────────────────────────────────
r = await api('/api/projects', { method: 'POST', body: { name: 'B2 Delete Me' }, cookie: userCookie });
check('create ML project', r.status === 201, `status ${r.status}`);
const mlId = r.data.id;

// ── 3. Typed-name delete: wrong name → 400 ───────────────────────────────────
r = await api(`/api/projects/${mlId}/delete`, { method: 'POST', body: { confirmName: 'Wrong Name' }, cookie: userCookie });
check('wrong confirmName → 400', r.status === 400 && r.data.error === 'Project name does not match', `status ${r.status} ${JSON.stringify(r.data)}`);

// ── 4. Right name → {deleted:true} ───────────────────────────────────────────
r = await api(`/api/projects/${mlId}/delete`, { method: 'POST', body: { confirmName: '  B2 Delete Me  ' }, cookie: userCookie });
check('right confirmName → deleted', r.status === 200 && r.data.deleted === true && Array.isArray(r.data.cascaded), `status ${r.status} ${JSON.stringify(r.data)}`);

// ── 5. GET deleted project → 404 ─────────────────────────────────────────────
r = await api(`/api/projects/${mlId}`, { cookie: userCookie });
check('GET deleted project → 404', r.status === 404, `status ${r.status}`);

// ── 6. Autosave resurrection guard → 200 {skipped:true}, still 404 ───────────
r = await api(`/api/projects/${mlId}/autosave`, { method: 'PUT', body: { name: 'B2 Delete Me', studies: [] }, cookie: userCookie });
check('autosave to deleted → 200 skipped', r.status === 200 && r.data.skipped === true, `status ${r.status} ${JSON.stringify(r.data)}`);
r = await api(`/api/projects/${mlId}`, { cookie: userCookie });
check('still 404 after autosave (no resurrection)', r.status === 404, `status ${r.status}`);

// Direct PUT save path → 404
r = await api(`/api/projects/${mlId}`, { method: 'PUT', body: { name: 'Revive attempt' }, cookie: userCookie });
check('direct PUT to deleted → 404', r.status === 404, `status ${r.status}`);

// Legacy DELETE on deleted project → 404 (sweep tolerant)
r = await api(`/api/projects/${mlId}`, { method: 'DELETE', cookie: userCookie });
check('legacy DELETE on deleted → 404', r.status === 404, `status ${r.status}`);

// ── 7. Cascade: linked pair ──────────────────────────────────────────────────
r = await api('/api/projects', { method: 'POST', body: { name: 'B2 Cascade Pair', createLinkedSift: true }, cookie: userCookie });
check('create linked pair', r.status === 201 && r.data.linkedScreenProject?.id, `status ${r.status}`);
const ml2 = r.data.project.id;
const sp2 = r.data.linkedScreenProject.id;

r = await api(`/api/projects/${ml2}/delete`, { method: 'POST', body: { confirmName: 'B2 Cascade Pair', cascadeLinked: true }, cookie: userCookie });
check('cascade delete → cascaded includes workspace', r.status === 200 && r.data.deleted === true && r.data.cascaded.includes(sp2), `status ${r.status} ${JSON.stringify(r.data)}`);

r = await api(`/api/screening/projects/${sp2}`, { cookie: userCookie });
check('cascaded SIFT project → 404', r.status === 404, `status ${r.status}`);
r = await api('/api/screening/projects', { cookie: userCookie });
const listed = (r.data.projects || []).map(p => p.id);
check('cascaded SIFT project absent from list', !listed.includes(sp2));

// ── 8. SIFT-only delete keeps ML intact + 204 contract ───────────────────────
r = await api('/api/projects', { method: 'POST', body: { name: 'B2 Keep ML', createLinkedSift: true }, cookie: userCookie });
const ml3 = r.data.project.id;
const sp3 = r.data.linkedScreenProject.id;
r = await api(`/api/screening/projects/${sp3}`, { method: 'DELETE', cookie: userCookie });
check('SIFT delete → 204', r.status === 204, `status ${r.status}`);
r = await api(`/api/projects/${ml3}`, { cookie: userCookie });
check('linked ML survives SIFT delete', r.status === 200, `status ${r.status}`);
r = await api(`/api/screening/projects/${sp3}`, { cookie: userCookie });
check('deleted SIFT project → 404', r.status === 404, `status ${r.status}`);

// ── 9. RIS export ────────────────────────────────────────────────────────────
r = await api('/api/screening/projects', { method: 'POST', body: { title: 'B2 RIS Project' }, cookie: userCookie });
check('create SIFT project', r.status === 201, `status ${r.status}`);
const spRis = r.data.id;
const risImport = `TY  - JOUR\nTI  - Aspirin and outcomes in sepsis\nAU  - Smith J\nAU  - Doe A\nJO  - Crit Care\nPY  - 2024\nDO  - 10.1000/test.123\nAN  - 12345678\nAB  - A test abstract.\nER  - \n`;
r = await api(`/api/screening/projects/${spRis}/import`, { method: 'POST', body: { content: risImport, format: 'ris', fileName: 'test.ris' }, cookie: userCookie });
check('import 1 RIS record', r.status === 200 || r.status === 201, `status ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);

const risRes = await fetch(`${BASE}/api/screening/projects/${spRis}/export?format=ris`, { headers: { Cookie: userCookie } });
const risBody = await risRes.text();
check('RIS export → 200', risRes.status === 200, `status ${risRes.status}`);
check('RIS content-type', (risRes.headers.get('content-type') || '').includes('application/x-research-info-systems'), risRes.headers.get('content-type'));
check('RIS has TY/TI/AU/ER', risBody.includes('TY  - JOUR') && risBody.includes('TI  - Aspirin') && risBody.includes('AU  - ') && risBody.includes('ER  - '), risBody.slice(0, 200).replace(/\n/g, '|'));

const csvRes = await fetch(`${BASE}/api/screening/projects/${spRis}/export?format=csv`, { headers: { Cookie: userCookie } });
check('CSV export still 200', csvRes.status === 200, `status ${csvRes.status}`);
const jsonRes = await fetch(`${BASE}/api/screening/projects/${spRis}/export?format=json`, { headers: { Cookie: userCookie } });
check('JSON export still 200', jsonRes.status === 200, `status ${jsonRes.status}`);

// ML server-side export (records EXPORT json + exportTools flag default-on)
r = await api(`/api/export/project/${ml3}`, { cookie: userCookie });
check('ML project export → 200 (flag default on)', r.status === 200, `status ${r.status}`);

// ── 10. Admin: metrics keys, restore, maintenance ────────────────────────────
const adminPass = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';
r = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@metalab.local', password: adminPass } });
check('admin login', r.status === 200, `status ${r.status}`);
const adminCookie = cookieFrom(r.res);

r = await api('/api/admin/metrics', { cookie: adminCookie });
const m = r.data || {};
check('metrics 200', r.status === 200, `status ${r.status}`);
check('metrics.invites', m.invites && ['pending', 'accepted', 'expired'].every(k => typeof m.invites[k] === 'number'), JSON.stringify(m.invites));
check('metrics.notificationsStats', m.notificationsStats && ['sent', 'clicked', 'dismissed'].every(k => typeof m.notificationsStats[k] === 'number'), JSON.stringify(m.notificationsStats));
check('metrics.lifecycle', m.lifecycle && ['projectsDeleted', 'siftProjectsDeleted', 'membersLeft'].every(k => typeof m.lifecycle[k] === 'number'), JSON.stringify(m.lifecycle));
check('metrics.exportsByFormat has ris', m.exportsByFormat && typeof m.exportsByFormat === 'object' && (m.exportsByFormat.ris || 0) >= 1, JSON.stringify(m.exportsByFormat));
check('metrics.emailStats', m.emailStats && ['sent', 'failed'].every(k => typeof m.emailStats[k] === 'number'), JSON.stringify(m.emailStats));
check('metrics.linking', m.linking && ['linkedWorkspaces', 'unlinkedSiftProjects', 'unlinkedMetaLabProjects'].every(k => typeof m.linking[k] === 'number'), JSON.stringify(m.linking));
check('metrics.lifecycle counts moved', m.lifecycle && m.lifecycle.projectsDeleted >= 2 && m.lifecycle.siftProjectsDeleted >= 2, JSON.stringify(m.lifecycle));
console.log('METRICS_ADDITIONS ' + JSON.stringify({ invites: m.invites, notificationsStats: m.notificationsStats, lifecycle: m.lifecycle, exportsByFormat: m.exportsByFormat, emailStats: m.emailStats, linking: m.linking }));

r = await api('/api/admin/screening/metrics', { cookie: adminCookie });
check('sift metrics invite keys', r.status === 200 && ['pendingInvites', 'acceptedInvites', 'expiredInvites'].every(k => typeof r.data[k] === 'number'), JSON.stringify({ p: r.data.pendingInvites, a: r.data.acceptedInvites, e: r.data.expiredInvites }));

// Admin sees deleted SIFT rows + restore works
r = await api('/api/admin/screening/projects?limit=50', { cookie: adminCookie });
const adminRow = (r.data.projects || []).find(p => p.id === sp3);
check('admin list shows deleted SIFT row', !!adminRow && adminRow.deleted === true && adminRow.deletedSource === 'owner', JSON.stringify(adminRow && { deleted: adminRow.deleted, src: adminRow.deletedSource }));

r = await api(`/api/admin/screening/projects/${sp3}/restore`, { method: 'PATCH', cookie: adminCookie });
check('admin SIFT restore → ok', r.status === 200 && r.data.ok === true, `status ${r.status}`);
r = await api(`/api/screening/projects/${sp3}`, { cookie: userCookie });
check('restored SIFT project accessible again', r.status === 200, `status ${r.status}`);

// Admin ML restore of owner-deleted project
r = await api(`/api/admin/projects/${mlId}/restore`, { method: 'PATCH', cookie: adminCookie });
check('admin ML restore of owner-deleted → ok', r.status === 200 && r.data.ok === true, `status ${r.status}`);
r = await api(`/api/projects/${mlId}`, { cookie: userCookie });
check('restored ML project visible to owner', r.status === 200, `status ${r.status}`);

// ── 11. registrationOpen gate ────────────────────────────────────────────────
let settings = (await api('/api/admin/settings', { cookie: adminCookie })).data;
const appSettings = settings.appSettings || {};
r = await api('/api/admin/settings', { method: 'PUT', body: { appSettings: { ...appSettings, registrationOpen: false } }, cookie: adminCookie });
check('set registrationOpen=false', r.status === 200, `status ${r.status}`);
r = await api('/api/auth/register', { method: 'POST', body: { email: `b2closed${stamp}@example.com`, password: 'Password123!' } });
check('register while closed → 403', r.status === 403 && r.data.error === 'Registration is currently closed', `status ${r.status} ${JSON.stringify(r.data)}`);
r = await api('/api/admin/settings', { method: 'PUT', body: { appSettings: { ...appSettings, registrationOpen: true } }, cookie: adminCookie });
check('reset registrationOpen=true', r.status === 200, `status ${r.status}`);

// ── 12. maintenanceMode ──────────────────────────────────────────────────────
r = await api('/api/admin/settings', { method: 'PUT', body: { appSettings: { ...appSettings, registrationOpen: true, maintenanceMode: true } }, cookie: adminCookie });
check('enable maintenanceMode', r.status === 200, `status ${r.status}`);
r = await api('/api/projects', { cookie: userCookie });
check('plain user during maintenance → 503', r.status === 503 && r.data.maintenance === true && typeof r.data.error === 'string', `status ${r.status} ${JSON.stringify(r.data)}`);
r = await api('/api/projects', { cookie: adminCookie });
check('admin passes maintenance gate on non-admin route', r.status === 200, `status ${r.status}`);
r = await api('/api/settings/public', {});
check('settings/public exempt during maintenance', r.status === 200 && r.data.defaultTheme, `status ${r.status} theme=${r.data?.defaultTheme}`);
r = await api('/api/admin/metrics', { cookie: adminCookie });
check('admin console reachable during maintenance', r.status === 200, `status ${r.status}`);
// RESET OFF
r = await api('/api/admin/settings', { method: 'PUT', body: { appSettings: { ...appSettings, registrationOpen: true, maintenanceMode: false } }, cookie: adminCookie });
check('disable maintenanceMode (RESET)', r.status === 200, `status ${r.status}`);
r = await api('/api/projects', { cookie: userCookie });
check('plain user normal after reset', r.status === 200, `status ${r.status}`);

// ── 13. public settings additions ────────────────────────────────────────────
r = await api('/api/settings/public', {});
check('public settings: defaultTheme + maintenanceMessage', r.data.defaultTheme === 'night' && typeof r.data.maintenanceMessage === 'string' && r.data.appSettings.projectDeletion === 'soft', JSON.stringify({ t: r.data.defaultTheme, mm: (r.data.maintenanceMessage || '').slice(0, 30), pd: r.data.appSettings?.projectDeletion }));

// ── 14. getOverview linkedMetaLab ────────────────────────────────────────────
r = await api('/api/projects', { method: 'POST', body: { name: 'B2 Overview Pair', createLinkedSift: true }, cookie: userCookie });
const sp4 = r.data.linkedScreenProject.id;
const ml4 = r.data.project.id;
r = await api(`/api/screening/projects/${sp4}/overview`, { cookie: userCookie });
check('overview.linkedMetaLab present + canOpen for owner', r.status === 200 && r.data.linkedMetaLab && r.data.linkedMetaLab.id === ml4 && r.data.linkedMetaLab.missing === false && r.data.linkedMetaLab.canOpen === true && r.data.linkedMetaLab.title === 'B2 Overview Pair', JSON.stringify(r.data.linkedMetaLab));
// delete the ML side (no cascade) → missing:true
r = await api(`/api/projects/${ml4}/delete`, { method: 'POST', body: { confirmName: 'B2 Overview Pair' }, cookie: userCookie });
r = await api(`/api/screening/projects/${sp4}/overview`, { cookie: userCookie });
check('overview.linkedMetaLab missing after ML delete', r.status === 200 && r.data.linkedMetaLab && r.data.linkedMetaLab.missing === true && r.data.linkedMetaLab.canOpen === false && r.data.linkedMetaLab.title === null, JSON.stringify(r.data.linkedMetaLab));

// Unlinked → null
r = await api(`/api/screening/projects/${spRis}/overview`, { cookie: userCookie });
check('overview.linkedMetaLab null when unlinked', r.status === 200 && r.data.linkedMetaLab === null, JSON.stringify(r.data.linkedMetaLab));

console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
