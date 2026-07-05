/**
 * tests/integration/api-project-creation-membership.test.js  (75.md Phase 6)
 *
 * Creator auto-membership + backfill. Two layers:
 *
 *  A. DB-direct (imports the server modules + the shared dev-SQLite prisma, like
 *     citationMining.service.test.js). These exercise the NEW atomic code path
 *     directly, so they verify the change WITHOUT needing the live server to be
 *     restarted. They create + clean up their own rows.
 *       - createLinkedScreenProject seeds the owner member row atomically.
 *       - ensureLeaderMember is idempotent (no duplicate owner row).
 *       - ensureLeaderMember adopts a pending [projectId,email] clash (P2002)
 *         instead of throwing — so the create transaction never spuriously fails.
 *       - a failure mid-transaction rolls back the ScreenProject (no orphan).
 *       - the backfill scans + heals a missing owner row, and is idempotent.
 *
 *  B. HTTP contract (against the live server on 127.0.0.1:3001; self-skips when
 *     down). Verifies the wired create endpoints leave the creator as an active
 *     'owner' member. NOTE: server code changes need a RESTART to be reflected
 *     here — these assert the end-to-end contract (which the new code preserves).
 *
 * Run (serial; writes the shared dev DB):
 *   npx vitest run tests/integration/api-project-creation-membership.test.js \
 *     --pool=forks --poolOptions.forks.singleFork=true
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { createLinkedScreenProject } from '../../server/screening/createScreenProject.js';
import { ensureLeaderMember } from '../../server/screening/access.js';
import { scanCreatorMembership, applyCreatorMembership } from '../../server/scripts/backfill-creator-membership.js';

const API = 'http://127.0.0.1:3001/api';
const TS = Date.now();

// Track created rows for cleanup.
const created = { userIds: [], screenProjectIds: [], mlProjectIds: [] };
let dbUp = false;
let dbUser = null;

async function mkUser(tag) {
  const u = await prisma.user.create({
    data: { email: `pcm-${tag}-${TS}@example.com`, password: 'x', name: `PCM ${tag}` },
  });
  created.userIds.push(u.id);
  return u;
}

async function mkBareScreenProject(ownerId, title) {
  // Deliberately NOT via createLinkedScreenProject → NO owner member row seeded,
  // i.e. the exact "missing owner member" shape the backfill repairs.
  const sp = await prisma.screenProject.create({ data: { ownerId, title } });
  created.screenProjectIds.push(sp.id);
  return sp;
}

async function activeOwnerRows(projectId, ownerId) {
  return prisma.screenProjectMember.findMany({
    where: { projectId, userId: ownerId, role: 'owner', status: 'active' },
  });
}

beforeAll(async () => {
  try {
    dbUser = await mkUser('owner');
    dbUp = true;
  } catch (e) {
    console.warn('[pcm] DB not reachable — DB-direct tests skipped:', e.message);
    dbUp = false;
  }
});

afterAll(async () => {
  // Children cascade from ScreenProject/User, but delete explicitly + tolerantly.
  try {
    for (const id of created.screenProjectIds) {
      await prisma.screenProjectMember.deleteMany({ where: { projectId: id } }).catch(() => {});
      await prisma.screenExclusionReason.deleteMany({ where: { projectId: id } }).catch(() => {});
      await prisma.screenProject.delete({ where: { id } }).catch(() => {});
    }
    for (const id of created.mlProjectIds) {
      await prisma.project.delete({ where: { id } }).catch(() => {});
    }
    for (const id of created.userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  } catch { /* best-effort cleanup */ }
});

/* ══════════════════════════════════════════════════════════════════════════
   A. DB-direct — the new atomic code path (no server restart required)
   ══════════════════════════════════════════════════════════════════════════ */

describe('createLinkedScreenProject — atomic owner membership', () => {
  it('seeds exactly one active "owner" member row for the creator', async () => {
    if (!dbUp) return;
    const sp = await createLinkedScreenProject({
      ownerId: dbUser.id,
      title: `pcm-linked-${TS}`,
      linkedMetaLabProjectId: null,
      mlData: { name: `pcm-linked-${TS}` },
    });
    created.screenProjectIds.push(sp.id);

    const owners = await activeOwnerRows(sp.id, dbUser.id);
    expect(owners.length).toBe(1);
    expect(owners[0].role).toBe('owner');
    expect(owners[0].status).toBe('active');
    expect(owners[0].email).toBe(dbUser.email);

    // The seeded exclusion reasons + owner row committed together.
    const reasons = await prisma.screenExclusionReason.count({ where: { projectId: sp.id } });
    expect(reasons).toBe(7);
  });
});

describe('ensureLeaderMember — idempotent + P2002-safe', () => {
  it('a second call creates no duplicate owner row', async () => {
    if (!dbUp) return;
    const sp = await mkBareScreenProject(dbUser.id, `pcm-idem-${TS}`);
    await ensureLeaderMember(sp);
    await ensureLeaderMember(sp);
    const owners = await activeOwnerRows(sp.id, dbUser.id);
    expect(owners.length).toBe(1);
    // And there is exactly one member row for this project+owner-email overall.
    const all = await prisma.screenProjectMember.count({ where: { projectId: sp.id, email: dbUser.email } });
    expect(all).toBe(1);
  });

  it('adopts a pending [projectId,email] row (unique clash) instead of throwing', async () => {
    if (!dbUp) return;
    const sp = await mkBareScreenProject(dbUser.id, `pcm-p2002-${TS}`);
    // Pre-seed a pending invite carrying the owner's email but no userId link —
    // this is the row that collides on @@unique([projectId, email]).
    const pending = await prisma.screenProjectMember.create({
      data: { projectId: sp.id, userId: null, email: dbUser.email, name: '', role: 'reviewer', status: 'pending' },
    });

    // Must not throw — the P2002 branch adopts + heals the pending row.
    const row = await ensureLeaderMember(sp);
    expect(row).toBeTruthy();
    expect(row.id).toBe(pending.id);       // same row adopted, not a new one
    expect(row.userId).toBe(dbUser.id);
    expect(row.role).toBe('owner');
    expect(row.status).toBe('active');

    // Exactly one row for this project+email — no duplicate.
    const count = await prisma.screenProjectMember.count({ where: { projectId: sp.id, email: dbUser.email } });
    expect(count).toBe(1);
  });
});

describe('atomic creation — no orphaned owner-less ScreenProject', () => {
  it('a failure after screenProject.create inside $transaction rolls the project back', async () => {
    if (!dbUp) return;
    let spId = null;
    await expect(
      prisma.$transaction(async (tx) => {
        const sp = await tx.screenProject.create({ data: { ownerId: dbUser.id, title: `pcm-rollback-${TS}` } });
        spId = sp.id;
        // Simulate ensureLeaderMember (or reason-seed) failing mid-create.
        throw new Error('simulated member-create failure');
      }),
    ).rejects.toThrow('simulated');

    expect(spId).toBeTruthy();
    const found = await prisma.screenProject.findUnique({ where: { id: spId } });
    expect(found).toBeNull(); // rolled back — no orphan workspace survives
  });
});

describe('backfill-creator-membership — scan + apply idempotency', () => {
  it('scan flags a bare project as missing; apply adds exactly one; re-run adds zero', async () => {
    if (!dbUp) return;
    const sp = await mkBareScreenProject(dbUser.id, `pcm-backfill-${TS}`);

    // Before: no owner member row.
    expect((await activeOwnerRows(sp.id, dbUser.id)).length).toBe(0);

    const scan1 = await scanCreatorMembership();
    const flagged = scan1.items.find(i => i.id === sp.id);
    expect(flagged).toBeDefined();
    expect(flagged.state).toBe('missing');

    // Apply (global, idempotent) → our project gains exactly one owner row.
    const res1 = await applyCreatorMembership();
    expect(res1.created).toBeGreaterThanOrEqual(1);
    expect((await activeOwnerRows(sp.id, dbUser.id)).length).toBe(1);

    // Re-run → our project is no longer in the needing set, still exactly one row.
    const scan2 = await scanCreatorMembership();
    expect(scan2.items.find(i => i.id === sp.id)).toBeUndefined();
    const res2 = await applyCreatorMembership();
    expect((await activeOwnerRows(sp.id, dbUser.id)).length).toBe(1);
    // res2 heals nothing that was already healed by res1 for our project.
    expect(res2.errors.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B. HTTP contract — wired create endpoints (self-skips when server down)
   ══════════════════════════════════════════════════════════════════════════ */

async function serverUp() {
  try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
}
async function registerAndLogin(email, password, name) {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (login.ok) { const d = await login.json(); return { user: d.user, cookie: login.headers.get('set-cookie') }; }
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const d = await reg.json();
  return { user: d.user, cookie: reg.headers.get('set-cookie') };
}
function jsonPost(url, body, cookie) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}
async function ownerMemberRow(pid, cookie, user) {
  const r = await fetch(`${API}/screening/projects/${pid}/members`, { headers: { Cookie: cookie } });
  if (!r.ok) return null;
  const body = await r.json();
  const members = Array.isArray(body) ? body : (body.members ?? []);
  return members.find(m => m.userId === user.id || m.email === user.email) || null;
}

let httpUp = false;
let httpCookie = null;
let httpUser = null;

beforeAll(async () => {
  httpUp = await serverUp();
  if (!httpUp) return;
  const s = await registerAndLogin(`pcm-http-${TS}@example.com`, 'PcmHttp1!', 'PCM Http');
  httpCookie = s.cookie; httpUser = s.user;
  if (!httpCookie || !httpUser) httpUp = false;
});

describe('POST /api/screening/projects — creator is an active owner member', () => {
  it('SIFT-create: creator has an active "owner" member row immediately', async () => {
    if (!httpUp) return;
    const res = await jsonPost(`${API}/screening/projects`, { title: `pcm-sift-${TS}` }, httpCookie);
    expect(res.status).toBe(201);
    const sp = await res.json();
    created.screenProjectIds.push(sp.id);

    const row = await ownerMemberRow(sp.id, httpCookie, httpUser);
    expect(row).toBeTruthy();
    expect(row.role).toBe('owner');
    expect(row.status).toBe('active');
  });

  it('repeat member list shows no duplicate owner row (idempotent)', async () => {
    if (!httpUp) return;
    const res = await jsonPost(`${API}/screening/projects`, { title: `pcm-sift2-${TS}` }, httpCookie);
    const sp = await res.json();
    created.screenProjectIds.push(sp.id);
    // list twice → still exactly one owner row for the creator.
    for (let i = 0; i < 2; i++) {
      const listRes = await fetch(`${API}/screening/projects/${sp.id}/members`, { headers: { Cookie: httpCookie } });
      const body = await listRes.json();
      const members = Array.isArray(body) ? body : (body.members ?? []);
      const owners = members.filter(m => (m.userId === httpUser.id || m.email === httpUser.email) && m.role === 'owner');
      expect(owners.length).toBe(1);
    }
  });

  it('alsoCreateMetaLab: creator is an owner member + linked ML project is created', async () => {
    if (!httpUp) return;
    const res = await jsonPost(`${API}/screening/projects`, { title: `pcm-alsoml-${TS}`, alsoCreateMetaLab: true }, httpCookie);
    expect(res.status).toBe(201);
    const sp = await res.json();
    created.screenProjectIds.push(sp.id);
    if (sp.linkedMetaLabProjectId) created.mlProjectIds.push(sp.linkedMetaLabProjectId);

    const row = await ownerMemberRow(sp.id, httpCookie, httpUser);
    expect(row).toBeTruthy();
    expect(row.role).toBe('owner');
  });
});

describe('POST /api/projects (createLinkedSift) — creator is an owner member of the linked workspace', () => {
  it('returns a linkedScreenProject whose creator is an active owner member', async () => {
    if (!httpUp) return;
    const res = await jsonPost(`${API}/projects`, { name: `pcm-mllink-${TS}`, createLinkedSift: true }, httpCookie);
    expect(res.status).toBe(201);
    const body = await res.json();
    // Shape: { project, linkedScreenProject } when createLinkedSift succeeds.
    const linked = body.linkedScreenProject;
    expect(linked).toBeTruthy();
    created.screenProjectIds.push(linked.id);
    if (body.project?.id) created.mlProjectIds.push(body.project.id);

    const row = await ownerMemberRow(linked.id, httpCookie, httpUser);
    expect(row).toBeTruthy();
    expect(row.role).toBe('owner');
    expect(row.status).toBe('active');
  });
});
