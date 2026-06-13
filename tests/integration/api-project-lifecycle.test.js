/**
 * api-project-lifecycle.test.js
 *
 * Integration tests for project lifecycle endpoints (prompt11):
 *
 *  1. GET /api/projects — excludes archived by default; includes with ?includeArchived=1
 *  2. POST /api/projects/:id/archive — owner-only, sets _archived; unarchive reverses it
 *  3. POST /api/projects/:id/delete — owner-only (typed-name confirm); hides from default list
 *  4. POST /api/screening/projects/:pid/leave — non-owner member can leave; owner → 4xx
 *  5. GET /api/projects — shared-via-workspace project is accessible; inaccessible one is not
 *  6. Returned project ids are stable across subsequent list calls
 *
 * Tests skip gracefully when the server is not running (CI without a live DB
 * can simply skip integration tests).
 *
 * Run the server first:  npm run server   (port 3001)
 * Then:                  npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API = 'http://localhost:3001/api';

/* ── Server availability ─────────────────────────────────────────────── */

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

/* ── Auth helper ─────────────────────────────────────────────────────── */

/**
 * Try login first (idempotent across test re-runs), then fall back to register.
 * Returns { user, cookie } — cookie is the raw Set-Cookie header string.
 */
async function registerAndLogin(email, password, name = 'Lifecycle Test User') {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    const data = await loginRes.json();
    return { user: data.user, cookie: loginRes.headers.get('set-cookie') };
  }
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await regRes.json();
  return { user: data.user, cookie: regRes.headers.get('set-cookie') };
}

/* ── HTTP helpers ────────────────────────────────────────────────────── */

function jsonPost(url, body, cookie) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function authedGet(url, cookie) {
  return fetch(url, { headers: { Cookie: cookie } });
}

/* ── Module-level state ──────────────────────────────────────────────── */

const TS = Date.now();
let up = false;

// Owner session
let ownerCookie = null;
let ownerUser = null;

// Second user (non-owner) session for isolation / leave tests
let otherCookie = null;
let otherUser = null;

// IDs tracked across tests for cleanup
const toCleanupProjects = [];      // META·LAB project ids (owner delete)
const toCleanupWorkspaces = [];    // ScreenProject ids (owner delete)

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;

  const ownerSession = await registerAndLogin(
    `lifecycle-owner-${TS}@example.com`,
    'LifecycleOwner1!',
    'Lifecycle Owner',
  );
  ownerCookie = ownerSession.cookie;
  ownerUser = ownerSession.user;

  const otherSession = await registerAndLogin(
    `lifecycle-other-${TS}@example.com`,
    'LifecycleOther1!',
    'Lifecycle Other',
  );
  otherCookie = otherSession.cookie;
  otherUser = otherSession.user;
});

afterAll(async () => {
  if (!up) return;
  // Best-effort cleanup: use the soft-delete endpoint so the row disappears from
  // future runs.  Errors are silently swallowed.
  for (const id of toCleanupProjects) {
    try {
      const project = await authedGet(`${API}/projects/${id}`, ownerCookie);
      if (!project.ok) continue;
      const p = await project.json();
      const name = p.name;
      if (name) {
        await jsonPost(`${API}/projects/${id}/delete`, { confirmName: name }, ownerCookie);
      }
    } catch { /* best-effort */ }
  }
});

/* ══════════════════════════════════════════════════════════════════════
   Helper: create a minimal META·LAB project as the owner and track it
   ══════════════════════════════════════════════════════════════════════ */

async function createProject(name, cookie = ownerCookie) {
  const res = await jsonPost(`${API}/projects`, { name }, cookie);
  if (!res.ok) throw new Error(`createProject failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  // The response is either a bare project object (no createLinkedSift) or
  // { project, linkedScreenProject }.  Normalise to the bare project shape.
  const project = data.project ?? data;
  toCleanupProjects.push(project.id);
  return project;
}

/* ══════════════════════════════════════════════════════════════════════
   1. Archive filtering on GET /api/projects
   ══════════════════════════════════════════════════════════════════════ */

describe('GET /api/projects — archive filtering', () => {
  let liveId = null;
  let archivedId = null;

  beforeAll(async () => {
    if (!up) return;
    const live = await createProject(`LifecycleLive-${TS}`);
    liveId = live.id;

    const arch = await createProject(`LifecycleArch-${TS}`);
    archivedId = arch.id;
    // Archive it so the default list excludes it.
    await jsonPost(`${API}/projects/${archivedId}/archive`, {}, ownerCookie);
  });

  it('default list excludes archived projects', async () => {
    if (!up || !archivedId) return;
    const res = await authedGet(`${API}/projects`, ownerCookie);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    const ids = list.map(p => p.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(archivedId);
  });

  it('?includeArchived=1 includes the archived project', async () => {
    if (!up || !archivedId) return;
    const res = await authedGet(`${API}/projects?includeArchived=1`, ownerCookie);
    expect(res.status).toBe(200);
    const list = await res.json();
    const ids = list.map(p => p.id);
    expect(ids).toContain(archivedId);
    expect(ids).toContain(liveId);
  });

  it('archived project has _archived:true in the enriched list', async () => {
    if (!up || !archivedId) return;
    const res = await authedGet(`${API}/projects?includeArchived=1`, ownerCookie);
    const list = await res.json();
    const archProject = list.find(p => p.id === archivedId);
    expect(archProject).toBeDefined();
    expect(archProject._archived).toBe(true);
    expect(typeof archProject._archivedAt).toBe('string');
  });

  it('live project has _archived:false', async () => {
    if (!up || !liveId) return;
    const res = await authedGet(`${API}/projects`, ownerCookie);
    const list = await res.json();
    const liveProject = list.find(p => p.id === liveId);
    expect(liveProject).toBeDefined();
    expect(liveProject._archived).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   2. POST /api/projects/:id/archive  and  /unarchive — owner-only gating
   ══════════════════════════════════════════════════════════════════════ */

describe('POST /api/projects/:id/archive + /unarchive', () => {
  let projectId = null;

  beforeAll(async () => {
    if (!up) return;
    const p = await createProject(`LifecycleArchiveGate-${TS}`);
    projectId = p.id;
  });

  it('unauthenticated request → 401', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/projects/${projectId}/archive`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('non-owner (other user) → 404 (existence hiding)', async () => {
    if (!up || !projectId) return;
    const res = await jsonPost(`${API}/projects/${projectId}/archive`, {}, otherCookie);
    // The owner-scoped lookup returns null → controller emits 404.
    expect(res.status).toBe(404);
  });

  it('owner can archive: responds { archived:true, archivedAt }', async () => {
    if (!up || !projectId) return;
    const res = await jsonPost(`${API}/projects/${projectId}/archive`, {}, ownerCookie);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.archived).toBe(true);
    expect(typeof data.archivedAt).toBe('string');
  });

  it('archived project is hidden from default list', async () => {
    if (!up || !projectId) return;
    const res = await authedGet(`${API}/projects`, ownerCookie);
    const list = await res.json();
    expect(list.map(p => p.id)).not.toContain(projectId);
  });

  it('unarchive reverses the flag: responds { archived:false }', async () => {
    if (!up || !projectId) return;
    const res = await jsonPost(`${API}/projects/${projectId}/unarchive`, {}, ownerCookie);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.archived).toBe(false);
  });

  it('after unarchive the project reappears in the default list', async () => {
    if (!up || !projectId) return;
    const res = await authedGet(`${API}/projects`, ownerCookie);
    const list = await res.json();
    expect(list.map(p => p.id)).toContain(projectId);
  });

  it('non-owner cannot unarchive either → 404', async () => {
    if (!up || !projectId) return;
    // First re-archive so unarchive has something to attempt.
    await jsonPost(`${API}/projects/${projectId}/archive`, {}, ownerCookie);
    const res = await jsonPost(`${API}/projects/${projectId}/unarchive`, {}, otherCookie);
    expect(res.status).toBe(404);
    // Restore for subsequent tests.
    await jsonPost(`${API}/projects/${projectId}/unarchive`, {}, ownerCookie);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   3. POST /api/projects/:id/delete — owner-only soft-delete
   ══════════════════════════════════════════════════════════════════════ */

describe('POST /api/projects/:id/delete (typed-name soft-delete)', () => {
  let projectId = null;
  const projectName = `LifecycleDel-${TS}`;

  beforeAll(async () => {
    if (!up) return;
    const p = await createProject(projectName);
    projectId = p.id;
  });

  it('unauthenticated request → 401', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/projects/${projectId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName: projectName }),
    });
    expect(res.status).toBe(401);
  });

  it('non-owner → 404 (existence hiding)', async () => {
    if (!up || !projectId) return;
    const res = await jsonPost(`${API}/projects/${projectId}/delete`, { confirmName: projectName }, otherCookie);
    expect(res.status).toBe(404);
  });

  it('wrong confirmName → 400', async () => {
    if (!up || !projectId) return;
    const res = await jsonPost(`${API}/projects/${projectId}/delete`, { confirmName: 'WRONG' }, ownerCookie);
    expect(res.status).toBe(400);
  });

  it('correct confirmName → 200 { deleted:true }', async () => {
    if (!up || !projectId) return;
    const res = await jsonPost(`${API}/projects/${projectId}/delete`, { confirmName: projectName }, ownerCookie);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);
  });

  it('deleted project is absent from the default list', async () => {
    if (!up || !projectId) return;
    const res = await authedGet(`${API}/projects`, ownerCookie);
    const list = await res.json();
    expect(list.map(p => p.id)).not.toContain(projectId);
  });

  it('deleted project is absent even with ?includeArchived=1', async () => {
    if (!up || !projectId) return;
    const res = await authedGet(`${API}/projects?includeArchived=1`, ownerCookie);
    const list = await res.json();
    expect(list.map(p => p.id)).not.toContain(projectId);
  });

  it('GET by id after delete → 404', async () => {
    if (!up || !projectId) return;
    const res = await authedGet(`${API}/projects/${projectId}`, ownerCookie);
    expect(res.status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   4. POST /api/screening/projects/:pid/leave
   ══════════════════════════════════════════════════════════════════════ */

describe('POST /api/screening/projects/:pid/leave', () => {
  let workspaceId = null;

  beforeAll(async () => {
    if (!up) return;

    // The owner creates a screening workspace directly (no META·LAB link needed).
    const res = await jsonPost(
      `${API}/screening/projects`,
      { title: `LeaveTestWS-${TS}` },
      ownerCookie,
    );
    if (!res.ok) return; // skip if screening module unavailable
    const sp = await res.json();
    workspaceId = sp.id;
    toCleanupWorkspaces.push(workspaceId);

    // Add otherUser as a member so they can attempt leave.
    if (otherUser?.email) {
      await jsonPost(
        `${API}/screening/projects/${workspaceId}/members`,
        { email: otherUser.email, role: 'reviewer' },
        ownerCookie,
      );
    }
  });

  it('unauthenticated leave → 401', async () => {
    if (!up || !workspaceId) return;
    const res = await fetch(`${API}/screening/projects/${workspaceId}/leave`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('owner cannot leave their own workspace → 400', async () => {
    if (!up || !workspaceId) return;
    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/leave`,
      {},
      ownerCookie,
    );
    expect(res.status).toBe(400);
  });

  it('non-member user → 404 (existence hiding)', async () => {
    if (!up || !workspaceId) return;
    // Create a completely unrelated user who is not a member.
    const unrelated = await registerAndLogin(
      `lifecycle-unrelated-${TS}@example.com`,
      'Unrelated1!',
      'Unrelated User',
    );
    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/leave`,
      {},
      unrelated.cookie,
    );
    expect(res.status).toBe(404);
  });

  it('member can leave successfully → 200 { left:true }', async () => {
    if (!up || !workspaceId || !otherUser) return;
    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/leave`,
      {},
      otherCookie,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.left).toBe(true);
  });

  it('after leaving, workspace is no longer accessible to the ex-member', async () => {
    if (!up || !workspaceId) return;
    const res = await authedGet(`${API}/screening/projects/${workspaceId}`, otherCookie);
    // Access denied → 404 (existence hiding) for a non-member.
    expect(res.status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   5. Accessible list includes shared projects; excludes inaccessible ones
   ══════════════════════════════════════════════════════════════════════ */

describe('GET /api/projects — shared-via-workspace visibility', () => {
  let ownerProjectId = null;    // owned by ownerUser, linked to a ScreenProject
  let linkedWorkspaceId = null; // the ScreenProject (linkedMetaLabProjectId = ownerProjectId)
  let unrelatedProjectId = null; // owned by otherUser, not shared with ownerUser

  beforeAll(async () => {
    if (!up) return;

    // 1. Owner creates a META·LAB project with a linked workspace.
    const createRes = await jsonPost(
      `${API}/projects`,
      { name: `SharedViaWS-${TS}`, createLinkedSift: true },
      ownerCookie,
    );
    if (!createRes.ok) return;
    const created = await createRes.json();
    // Shape is { project, linkedScreenProject } when createLinkedSift:true succeeds.
    ownerProjectId = (created.project ?? created).id;
    toCleanupProjects.push(ownerProjectId);
    linkedWorkspaceId = created.linkedScreenProject?.id ?? null;
    if (linkedWorkspaceId) toCleanupWorkspaces.push(linkedWorkspaceId);

    // 2. If linked workspace was created, add otherUser as member so they can
    //    see ownerProjectId in their list.
    if (linkedWorkspaceId && otherUser?.email) {
      await jsonPost(
        `${API}/screening/projects/${linkedWorkspaceId}/members`,
        { email: otherUser.email, role: 'reviewer' },
        ownerCookie,
      );
    }

    // 3. otherUser creates a project that ownerUser has NO access to.
    const unreRes = await jsonPost(
      `${API}/projects`,
      { name: `UnrelatedProject-${TS}` },
      otherCookie,
    );
    if (unreRes.ok) {
      const unre = await unreRes.json();
      unrelatedProjectId = (unre.project ?? unre).id;
      // Track for cleanup under otherUser (best-effort — afterAll uses ownerCookie).
      toCleanupProjects.push(unrelatedProjectId);
    }
  });

  it("shared project appears in the other user's project list", async () => {
    if (!up || !ownerProjectId || !linkedWorkspaceId) return;
    const res = await authedGet(`${API}/projects`, otherCookie);
    expect(res.status).toBe(200);
    const list = await res.json();
    const ids = list.map(p => p.id);
    expect(ids).toContain(ownerProjectId);
  });

  it('shared project is annotated as _shared:true with correct _role', async () => {
    if (!up || !ownerProjectId || !linkedWorkspaceId) return;
    const res = await authedGet(`${API}/projects`, otherCookie);
    const list = await res.json();
    const p = list.find(x => x.id === ownerProjectId);
    expect(p).toBeDefined();
    expect(p._shared).toBe(true);
    expect(p._role).toBeTruthy();
  });

  it("unrelated project does NOT appear in the owner user's list", async () => {
    if (!up || !unrelatedProjectId) return;
    const res = await authedGet(`${API}/projects`, ownerCookie);
    const list = await res.json();
    const ids = list.map(p => p.id);
    expect(ids).not.toContain(unrelatedProjectId);
  });

  it("owner's project does NOT appear in its own shared section (only in owned)", async () => {
    if (!up || !ownerProjectId) return;
    const res = await authedGet(`${API}/projects`, ownerCookie);
    const list = await res.json();
    const p = list.find(x => x.id === ownerProjectId);
    expect(p).toBeDefined();
    // Owner path → _shared is not set (or false).
    expect(p._shared).toBeFalsy();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   6. Project ids are stable (returned id survives subsequent list calls)
   ══════════════════════════════════════════════════════════════════════ */

describe('Project id stability across list calls', () => {
  let stableId = null;
  const stableName = `LifecycleStable-${TS}`;

  beforeAll(async () => {
    if (!up) return;
    const p = await createProject(stableName);
    stableId = p.id;
  });

  it('id returned at creation matches the first list call', async () => {
    if (!up || !stableId) return;
    const res = await authedGet(`${API}/projects`, ownerCookie);
    const list = await res.json();
    const found = list.find(p => p.id === stableId);
    expect(found).toBeDefined();
    expect(found.id).toBe(stableId);
  });

  it('id survives an update (PUT /api/projects/:id)', async () => {
    if (!up || !stableId) return;
    const updateRes = await fetch(`${API}/projects/${stableId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ name: `${stableName}-renamed` }),
    });
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.id).toBe(stableId);

    // Re-list and confirm the same id.
    const listRes = await authedGet(`${API}/projects`, ownerCookie);
    const list = await listRes.json();
    expect(list.map(p => p.id)).toContain(stableId);
  });

  it('GET /api/projects/:id returns the same id', async () => {
    if (!up || !stableId) return;
    const res = await authedGet(`${API}/projects/${stableId}`, ownerCookie);
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p.id).toBe(stableId);
  });
});
