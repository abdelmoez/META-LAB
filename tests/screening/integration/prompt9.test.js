/**
 * prompt9.test.js — notifications dismiss-on-click, invite tokens, leave,
 * soft delete + cascade, RIS export, overview link, ops controls (prompt9).
 *
 *   T1  Server reachability guard (hard-fails instead of vacuous self-skip)
 *   T2  POST /api/notifications/:id/opened — read+dismiss+click in one call,
 *       idempotent, 404 foreign, gone from active list, in ?all=1 history,
 *       persists across re-login
 *   T3  Invites: email validation 400, existing-user immediate add,
 *       pending invite token ceremony (link/emailConfigured/expiresAt),
 *       public GET landing info (masked email), bogus 404,
 *       register-with-token auto-join + single-use,
 *       mismatched-email accept, revoke via removeMember
 *   T4  Leave: member 200 {left:true} then 404, owner 400, non-member 404
 *   T5  ML soft delete: typed-name 400/success, cascade to linked workspace,
 *       404 after, autosave resurrection guard (200 {skipped:true}),
 *       legacy DELETE keeps {deleted:true}
 *   T6  SIFT delete is one-way (ML survives), 204 contract
 *   T7  getOverview linkedMetaLab {id,title,missing,canOpen} + null unlinked
 *       + missing:true after ML delete
 *   T8  RIS export (content-type + record fields), csv/json regression
 *   T9  Ops: animationSpeed passthrough to public settings, registrationOpen
 *       gate, maintenanceMode 503/bypass/exempt, new metrics keys,
 *       inviteExpiryDays + UPDATE_SIFT_SETTINGS audit, admin SIFT restore,
 *       plain-user 403 on admin metrics
 *   T10 Pinned regression: outsider 404 existence-hiding
 *
 * Live API at http://127.0.0.1:3001 (npm run server).
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 * Every global setting this file flips is restored in a finally block.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false, adminCookie = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res), headers: res.headers };
}
async function register(email, extra = {}) { const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0], ...extra } }); return { cookie: r.cookie, id: r.data?.user?.id, email, status: r.status }; }
async function loginAs(email, password = 'Password123!') { const r = await api('/auth/login', { method: 'POST', body: { email, password } }); return r.status === 200 ? r.cookie : ''; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeoutMs = 5000, step = 200) {
  const t0 = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - t0 >= timeoutMs) return false; await sleep(step); }
}

/** owner + SIFT project; returns {owner, pid} */
async function makeSift(title) {
  const owner = await register(`p9own${rnd()}@example.com`);
  const r = await api('/screening/projects', { method: 'POST', body: { title }, cookie: owner.cookie });
  return { owner, pid: r.data.id };
}
/** linked ML+SIFT pair under one fresh owner */
async function makePair(name) {
  const owner = await register(`p9own${rnd()}@example.com`);
  const r = await api('/projects', { method: 'POST', body: { name, createLinkedSift: true }, cookie: owner.cookie });
  return { owner, mlId: r.data.project.id, siftId: r.data.linkedScreenProject.id };
}

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (up) {
    const r = await api('/auth/login', { method: 'POST', body: { email: 'admin@metalab.local', password: process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!' } });
    adminCookie = r.status === 200 ? r.cookie : '';
  }
}, 30000);

describe('prompt9 T1 — server reachability (anti-vacuous-green guard)', () => {
  it('the live API on 127.0.0.1:3001 is reachable (if this fails, every self-skipping integration test below is vacuous)', () => {
    expect(up).toBe(true);
    expect(adminCookie).not.toBe('');
  });
});

describe('prompt9 T2 — notification opened (read+dismiss+click in one call)', () => {
  it('opened sets all three stamps, is idempotent, removes from active list, keeps history, survives re-login', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 Notif ${rnd()}`);
    const b = await register(`p9memb${rnd()}@example.com`);
    const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', body: { email: b.email }, cookie: owner.cookie });
    expect(add.status).toBe(201);
    expect(add.data.pending).toBe(false);

    // invite notification is fire-and-forget — poll for it
    let nid = null;
    const got = await until(async () => {
      const l = await api('/notifications', { cookie: b.cookie });
      const n = (l.data?.notifications || []).find(x => x.type === 'PROJECT_INVITE');
      if (n) { nid = n.id; return true; }
      return false;
    });
    expect(got).toBe(true);

    const o1 = await api(`/notifications/${nid}/opened`, { method: 'POST', cookie: b.cookie });
    expect(o1.status).toBe(200);
    expect(o1.data.notification.readAt).toBeTruthy();
    expect(o1.data.notification.dismissedAt).toBeTruthy();
    expect(o1.data.notification.clickedAt).toBeTruthy();

    // idempotent — stamps unchanged on second call
    const o2 = await api(`/notifications/${nid}/opened`, { method: 'POST', cookie: b.cookie });
    expect(o2.status).toBe(200);
    expect(o2.data.notification.readAt).toBe(o1.data.notification.readAt);
    expect(o2.data.notification.dismissedAt).toBe(o1.data.notification.dismissedAt);

    // gone from active list, present in ?all=1 history, unread 0
    const act = await api('/notifications', { cookie: b.cookie });
    expect((act.data.notifications || []).some(x => x.id === nid)).toBe(false);
    const hist = await api('/notifications?all=1', { cookie: b.cookie });
    expect((hist.data.notifications || []).some(x => x.id === nid)).toBe(true);
    const cnt = await api('/notifications/unread-count', { cookie: b.cookie });
    expect(cnt.data.count ?? cnt.data.unreadCount ?? 0).toBe(0);

    // persists across re-login
    const c2 = await loginAs(b.email);
    const act2 = await api('/notifications', { cookie: c2 });
    expect((act2.data.notifications || []).some(x => x.id === nid)).toBe(false);
  }, 30000);

  it('opened on a foreign notification → 404 (existence-hiding)', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 Foreign ${rnd()}`);
    const b = await register(`p9memb${rnd()}@example.com`);
    await api(`/screening/projects/${pid}/members`, { method: 'POST', body: { email: b.email }, cookie: owner.cookie });
    let nid = null;
    await until(async () => {
      const l = await api('/notifications', { cookie: b.cookie });
      const n = (l.data?.notifications || [])[0];
      if (n) { nid = n.id; return true; }
      return false;
    });
    const stranger = await register(`p9str${rnd()}@example.com`);
    const o = await api(`/notifications/${nid}/opened`, { method: 'POST', cookie: stranger.cookie });
    expect(o.status).toBe(404);
  }, 30000);
});

describe('prompt9 T3 — invite architecture (token ceremony on the pending member row)', () => {
  it('invalid email → 400, nothing persisted', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 InvVal ${rnd()}`);
    const before = await api(`/screening/projects/${pid}/members`, { cookie: owner.cookie });
    const bad = await api(`/screening/projects/${pid}/members`, { method: 'POST', body: { email: 'notanemail' }, cookie: owner.cookie });
    expect(bad.status).toBe(400);
    const after = await api(`/screening/projects/${pid}/members`, { cookie: owner.cookie });
    expect((after.data.members || []).length).toBe((before.data.members || []).length);
  });

  it('existing user → immediate active member, no invite ceremony', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 InvExist ${rnd()}`);
    const b = await register(`p9memb${rnd()}@example.com`);
    const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', body: { email: b.email }, cookie: owner.cookie });
    expect(add.status).toBe(201);
    expect(add.data.pending).toBe(false);
    expect(add.data.invite).toBeUndefined();
    expect(add.data.member.status).toBe('active');
  });

  it('unknown email → pending invite with 64-hex link; public GET returns sanitized info; bogus token 404', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 InvTok ${rnd()}`);
    const ghost = `p9ghost${rnd()}@example.com`;
    const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', body: { email: ghost }, cookie: owner.cookie });
    expect(add.status).toBe(201);
    expect(add.data.pending).toBe(true);
    expect(add.data.invite).toBeTruthy();
    expect(add.data.invite.link).toMatch(/\/invite\/[a-f0-9]{64}$/);
    expect(typeof add.data.invite.emailConfigured).toBe('boolean');
    expect(typeof add.data.invite.emailSent).toBe('boolean');
    expect(add.data.invite.expiresAt).toBeTruthy();

    const token = add.data.invite.link.split('/invite/')[1];
    const pub = await api(`/invites/${token}`, {}); // NO cookie — public
    expect(pub.status).toBe(200);
    expect(pub.data.projectName).toContain('P9 InvTok');
    expect(pub.data.inviterName).toBeTruthy();
    expect(pub.data.roleLabel).toBeTruthy();
    expect(pub.data.email).toContain('***');     // masked
    expect(pub.data.email).not.toBe(ghost);      // never the raw address

    const bogus = await api(`/invites/${'0'.repeat(64)}`, {});
    expect(bogus.status).toBe(404);
  });

  it('register with inviteToken → auto-join; token is single-use after claim', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 InvJoin ${rnd()}`);
    const ghost = `p9ghost${rnd()}@example.com`;
    const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', body: { email: ghost }, cookie: owner.cookie });
    const token = add.data.invite.link.split('/invite/')[1];

    const joined = await register(ghost, { inviteToken: token });
    expect(joined.status).toBe(201);
    // claim is fire-and-forget — poll project access
    const ok = await until(async () => (await api(`/screening/projects/${pid}`, { cookie: joined.cookie })).status === 200);
    expect(ok).toBe(true);

    const reuse = await api(`/invites/${token}`, {});
    expect(reuse.status).toBe(404); // single-use
  }, 30000);

  it('accept while logged in under a DIFFERENT email binds the row to the accepting account', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 InvCross ${rnd()}`);
    const ghost = `p9ghost${rnd()}@example.com`;
    const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', body: { email: ghost }, cookie: owner.cookie });
    const token = add.data.invite.link.split('/invite/')[1];

    const other = await register(`p9other${rnd()}@example.com`); // no token, different email
    const acc = await api(`/invites/${token}/accept`, { method: 'POST', cookie: other.cookie });
    expect(acc.status).toBe(200);
    expect(acc.data.projectId).toBe(pid);
    expect(acc.data.projectName).toContain('P9 InvCross');
    const view = await api(`/screening/projects/${pid}`, { cookie: other.cookie });
    expect(view.status).toBe(200);
  });

  it('revoking a pending invite (removeMember) kills the token', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 InvRevoke ${rnd()}`);
    const ghost = `p9ghost${rnd()}@example.com`;
    const add = await api(`/screening/projects/${pid}/members`, { method: 'POST', body: { email: ghost }, cookie: owner.cookie });
    const token = add.data.invite.link.split('/invite/')[1];
    expect((await api(`/invites/${token}`, {})).status).toBe(200);

    const del = await api(`/screening/projects/${pid}/members/${add.data.member.id}`, { method: 'DELETE', cookie: owner.cookie });
    expect([200, 204]).toContain(del.status);
    expect((await api(`/invites/${token}`, {})).status).toBe(404);
  });
});

describe('prompt9 T4 — leave project', () => {
  it('member leaves: 200 {left:true}, access becomes 404, owner unaffected', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 Leave ${rnd()}`);
    const b = await register(`p9memb${rnd()}@example.com`);
    await api(`/screening/projects/${pid}/members`, { method: 'POST', body: { email: b.email }, cookie: owner.cookie });
    expect((await api(`/screening/projects/${pid}`, { cookie: b.cookie })).status).toBe(200);

    const leave = await api(`/screening/projects/${pid}/leave`, { method: 'POST', cookie: b.cookie });
    expect(leave.status).toBe(200);
    expect(leave.data.left).toBe(true);
    expect((await api(`/screening/projects/${pid}`, { cookie: b.cookie })).status).toBe(404);
    expect((await api(`/screening/projects/${pid}`, { cookie: owner.cookie })).status).toBe(200);
  });

  it('owner leave → 400; non-member leave → 404 (existence-hiding)', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 LeaveOwn ${rnd()}`);
    expect((await api(`/screening/projects/${pid}/leave`, { method: 'POST', cookie: owner.cookie })).status).toBe(400);
    const stranger = await register(`p9str${rnd()}@example.com`);
    expect((await api(`/screening/projects/${pid}/leave`, { method: 'POST', cookie: stranger.cookie })).status).toBe(404);
  });
});

describe('prompt9 T5 — META·LAB soft delete (typed name + cascade + resurrection guard)', () => {
  it('wrong name 400; cascade soft-deletes the linked workspace; no resurrection via autosave', async () => {
    if (!up) return;
    const name = `P9 Cascade ${rnd()}`;
    const { owner, mlId, siftId } = await makePair(name);

    const wrong = await api(`/projects/${mlId}/delete`, { method: 'POST', body: { confirmName: 'Wrong Name' }, cookie: owner.cookie });
    expect(wrong.status).toBe(400);
    expect(wrong.data.error).toBe('Project name does not match');

    const del = await api(`/projects/${mlId}/delete`, { method: 'POST', body: { confirmName: name, cascadeLinked: true }, cookie: owner.cookie });
    expect(del.status).toBe(200);
    expect(del.data.deleted).toBe(true);
    expect(del.data.cascaded).toContain(siftId);

    expect((await api(`/projects/${mlId}`, { cookie: owner.cookie })).status).toBe(404);
    const list = await api('/projects', { cookie: owner.cookie });
    expect((list.data.projects || list.data || []).map(p => p.id)).not.toContain(mlId);

    // resurrection guard — pinned: autosave NEVER 4xx, and never revives
    const auto = await api(`/projects/${mlId}/autosave`, { method: 'PUT', body: { name, studies: [] }, cookie: owner.cookie });
    expect(auto.status).toBe(200);
    expect(auto.data.skipped).toBe(true);
    expect((await api(`/projects/${mlId}`, { cookie: owner.cookie })).status).toBe(404);

    // cascaded workspace gone for its members too
    expect((await api(`/screening/projects/${siftId}`, { cookie: owner.cookie })).status).toBe(404);
  });

  it('legacy DELETE /api/projects/:id (autosave sweep path) keeps {deleted:true} and is soft underneath', async () => {
    if (!up) return;
    const owner = await register(`p9own${rnd()}@example.com`);
    const c = await api('/projects', { method: 'POST', body: { name: `P9 Legacy ${rnd()}` }, cookie: owner.cookie });
    const del = await api(`/projects/${c.data.id}`, { method: 'DELETE', cookie: owner.cookie });
    expect(del.status).toBe(200);
    expect(del.data.deleted).toBe(true);
    expect((await api(`/projects/${c.data.id}`, { cookie: owner.cookie })).status).toBe(404);
  });
});

describe('prompt9 T6 — META·SIFT delete is one-way', () => {
  it('SIFT delete keeps 204 and never touches the linked META·LAB project', async () => {
    if (!up) return;
    const { owner, mlId, siftId } = await makePair(`P9 OneWay ${rnd()}`);
    const del = await api(`/screening/projects/${siftId}`, { method: 'DELETE', cookie: owner.cookie });
    expect(del.status).toBe(204);
    expect((await api(`/screening/projects/${siftId}`, { cookie: owner.cookie })).status).toBe(404);
    expect((await api(`/projects/${mlId}`, { cookie: owner.cookie })).status).toBe(200);
  });
});

describe('prompt9 T7 — overview linkedMetaLab card data', () => {
  it('owner of a linked pair gets {id,title,missing:false,canOpen:true}; missing:true after ML delete; null when unlinked', async () => {
    if (!up) return;
    const name = `P9 Overview ${rnd()}`;
    const { owner, mlId, siftId } = await makePair(name);

    const ov = await api(`/screening/projects/${siftId}/overview`, { cookie: owner.cookie });
    expect(ov.status).toBe(200);
    expect(ov.data.linkedMetaLab).toMatchObject({ id: mlId, title: name, missing: false, canOpen: true });

    // delete the ML side WITHOUT cascade → link survives but target is gone
    await api(`/projects/${mlId}/delete`, { method: 'POST', body: { confirmName: name }, cookie: owner.cookie });
    const ov2 = await api(`/screening/projects/${siftId}/overview`, { cookie: owner.cookie });
    expect(ov2.data.linkedMetaLab.missing).toBe(true);
    expect(ov2.data.linkedMetaLab.canOpen).toBe(false);

    const solo = await makeSift(`P9 Unlinked ${rnd()}`);
    const ov3 = await api(`/screening/projects/${solo.pid}/overview`, { cookie: solo.owner.cookie });
    expect(ov3.data.linkedMetaLab).toBeNull();
  });
});

describe('prompt9 T8 — RIS export', () => {
  it('format=ris streams a valid RIS file; csv/json regression-green', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 RIS ${rnd()}`);
    const title = `Aspirin and outcomes ${rnd()}`;
    const ris = `TY  - JOUR\nTI  - ${title}\nAU  - Smith J\nAU  - Doe A\nJO  - Crit Care\nPY  - 2024\nDO  - 10.1000/p9.${rnd()}\nAB  - A test abstract.\nER  - \n`;
    const imp = await api(`/screening/projects/${pid}/import`, { method: 'POST', body: { content: ris, format: 'ris', fileName: 'p9.ris' }, cookie: owner.cookie });
    expect([200, 201]).toContain(imp.status);

    const res = await fetch(`${BASE}/screening/projects/${pid}/export?format=ris`, { headers: { Cookie: owner.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') || '').toContain('application/x-research-info-systems');
    const body = await res.text();
    expect(body).toContain('TY  - JOUR');
    expect(body).toContain(`TI  - ${title}`);
    expect(body).toContain('ER  -');

    expect((await fetch(`${BASE}/screening/projects/${pid}/export?format=csv`, { headers: { Cookie: owner.cookie } })).status).toBe(200);
    expect((await fetch(`${BASE}/screening/projects/${pid}/export?format=json`, { headers: { Cookie: owner.cookie } })).status).toBe(200);
  });
});

describe('prompt9 T9 — ops controls and metrics', () => {
  it('animationSpeed flows landing-content → public settings (and is reset)', async () => {
    if (!up) return;
    const cur = await api('/admin/landing-content', { cookie: adminCookie });
    const content = cur.data.landingContent || cur.data || {};
    try {
      const put = await api('/admin/landing-content', { method: 'PUT', body: { ...content, animationSpeed: 'fast' }, cookie: adminCookie });
      expect(put.status).toBe(200);
      const pub = await api('/settings/public', {});
      const lc = pub.data.landingContent || pub.data;
      expect(lc.animationSpeed).toBe('fast');
    } finally {
      await api('/admin/landing-content', { method: 'PUT', body: { ...content, animationSpeed: content.animationSpeed || 'normal' }, cookie: adminCookie });
    }
  });

  it('registrationOpen=false closes /register with 403 (and is reset)', async () => {
    if (!up) return;
    const cur = await api('/admin/settings', { cookie: adminCookie });
    const appSettings = cur.data.appSettings || {};
    try {
      await api('/admin/settings', { method: 'PUT', body: { appSettings: { ...appSettings, registrationOpen: false } }, cookie: adminCookie });
      const r = await register(`p9closed${rnd()}@example.com`);
      expect(r.status).toBe(403);
    } finally {
      await api('/admin/settings', { method: 'PUT', body: { appSettings: { ...appSettings, registrationOpen: true } }, cookie: adminCookie });
    }
    // gate is open again
    expect((await register(`p9open${rnd()}@example.com`)).status).toBe(201);
  });

  it('maintenanceMode: plain user 503 {maintenance:true}, admin passes, public settings exempt (and is reset)', async () => {
    if (!up) return;
    const u = await register(`p9maint${rnd()}@example.com`);
    const cur = await api('/admin/settings', { cookie: adminCookie });
    const appSettings = cur.data.appSettings || {};
    try {
      await api('/admin/settings', { method: 'PUT', body: { appSettings: { ...appSettings, maintenanceMode: true } }, cookie: adminCookie });
      const blocked = await api('/projects', { cookie: u.cookie });
      expect(blocked.status).toBe(503);
      expect(blocked.data.maintenance).toBe(true);
      expect((await api('/projects', { cookie: adminCookie })).status).toBe(200);
      expect((await api('/settings/public', {})).status).toBe(200);
    } finally {
      await api('/admin/settings', { method: 'PUT', body: { appSettings: { ...appSettings, maintenanceMode: false } }, cookie: adminCookie });
    }
    expect((await api('/projects', { cookie: u.cookie })).status).toBe(200);
  });

  it('admin metrics carry every prompt9 group; screening metrics carry invite counters; plain user stays 403', async () => {
    if (!up) return;
    const m = (await api('/admin/metrics', { cookie: adminCookie })).data;
    for (const k of ['pending', 'accepted', 'expired']) expect(typeof m.invites[k]).toBe('number');
    for (const k of ['sent', 'clicked', 'dismissed']) expect(typeof m.notificationsStats[k]).toBe('number');
    for (const k of ['projectsDeleted', 'siftProjectsDeleted', 'membersLeft']) expect(typeof m.lifecycle[k]).toBe('number');
    expect(typeof m.exportsByFormat).toBe('object');
    for (const k of ['sent', 'failed']) expect(typeof m.emailStats[k]).toBe('number');
    for (const k of ['linkedWorkspaces', 'unlinkedSiftProjects', 'unlinkedMetaLabProjects']) expect(typeof m.linking[k]).toBe('number');

    const s = (await api('/admin/screening/metrics', { cookie: adminCookie })).data;
    for (const k of ['pendingInvites', 'acceptedInvites', 'expiredInvites']) expect(typeof s[k]).toBe('number');

    const plain = await register(`p9plain${rnd()}@example.com`);
    expect((await api('/admin/metrics', { cookie: plain.cookie })).status).toBe(403);
  });

  it('inviteExpiryDays round-trips through SIFT settings and the change is audited (and is reset)', async () => {
    if (!up) return;
    const cur = await api('/admin/screening/settings', { cookie: adminCookie });
    const settings = cur.data.settings || cur.data || {};
    const orig = settings.inviteExpiryDays ?? 14;
    try {
      const put = await api('/admin/screening/settings', { method: 'PUT', body: { ...settings, inviteExpiryDays: 30 }, cookie: adminCookie });
      expect(put.status).toBe(200);
      const after = await api('/admin/screening/settings', { cookie: adminCookie });
      expect((after.data.settings || after.data).inviteExpiryDays).toBe(30);
      const audit = await api('/admin/audit-log?limit=20', { cookie: adminCookie });
      expect(JSON.stringify(audit.data)).toContain('UPDATE_SIFT_SETTINGS');
    } finally {
      await api('/admin/screening/settings', { method: 'PUT', body: { ...settings, inviteExpiryDays: orig }, cookie: adminCookie });
    }
  });

  it('admin can restore an owner-deleted SIFT project', async () => {
    if (!up) return;
    const { owner, pid } = await makeSift(`P9 Restore ${rnd()}`);
    expect((await api(`/screening/projects/${pid}`, { method: 'DELETE', cookie: owner.cookie })).status).toBe(204);
    expect((await api(`/screening/projects/${pid}`, { cookie: owner.cookie })).status).toBe(404);
    const res = await api(`/admin/screening/projects/${pid}/restore`, { method: 'PATCH', cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect((await api(`/screening/projects/${pid}`, { cookie: owner.cookie })).status).toBe(200);
  });
});

describe('prompt9 T10 — pinned regression: existence-hiding', () => {
  it('outsider gets 404 (never 403) on a screening project', async () => {
    if (!up) return;
    const { pid } = await makeSift(`P9 Hide ${rnd()}`);
    const stranger = await register(`p9str${rnd()}@example.com`);
    expect((await api(`/screening/projects/${pid}`, { cookie: stranger.cookie })).status).toBe(404);
  });
});
