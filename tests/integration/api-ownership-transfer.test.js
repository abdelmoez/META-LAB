/**
 * tests/integration/api-ownership-transfer.test.js
 *
 * Integration tests for POST /api/screening/projects/:pid/transfer-owner.
 *
 * Coverage:
 *  1. Auth gating — unauthenticated → 401
 *  2. Owner-only gating — non-owner member → 403
 *  3. Target-not-a-member → 400
 *  4. Successful transfer — flips ownerId; former owner can leave; new owner
 *     cannot be removed from the workspace
 *
 * Tests skip gracefully when the server is not running on port 3001.
 *
 * Run manually:
 *   node server/index.js &
 *   npx vitest run tests/integration/api-ownership-transfer.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

/* ── Server availability ─────────────────────────────────────────────────── */

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

/* ── Auth helper — login first (idempotent), then register ─────────────── */

async function registerAndLogin(email, password, name) {
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

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

function jsonPost(url, body, cookie) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function authedGet(url, cookie) {
  return fetch(url, { headers: { Cookie: cookie } });
}

function authedDelete(url, cookie) {
  return fetch(url, { method: 'DELETE', headers: { Cookie: cookie } });
}

/* ── Module-level state ───────────────────────────────────────────────────── */

const TS = Date.now();
let up = false;

// Sessions
let ownerCookie = null;
let ownerUser   = null;
let memberCookie = null;
let memberUser  = null;
let outsiderCookie = null;
let outsiderUser   = null;

// IDs used across describes
let workspaceId = null;   // ScreenProject created by the owner
let memberRowId = null;   // ScreenProjectMember id of memberUser (after add)

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;

  // Create three users: owner, member (will become new owner), outsider.
  [{ user: ownerUser, cookie: ownerCookie },
   { user: memberUser, cookie: memberCookie },
   { user: outsiderUser, cookie: outsiderCookie }] = await Promise.all([
    registerAndLogin(`xfer-owner-${TS}@example.com`,    'XferOwner1!',    'Xfer Owner'),
    registerAndLogin(`xfer-member-${TS}@example.com`,   'XferMember1!',   'Xfer Member'),
    registerAndLogin(`xfer-outside-${TS}@example.com`,  'XferOutside1!',  'Xfer Outsider'),
  ]);

  // Owner creates a bare screening workspace (no META·LAB link needed for the
  // pure-ownership tests; we still test the ownerId flip via the response).
  const wsRes = await jsonPost(
    `${API}/screening/projects`,
    { title: `XferWorkspace-${TS}` },
    ownerCookie,
  );
  if (!wsRes.ok) {
    console.warn('[transfer-owner] Could not create workspace:', wsRes.status, await wsRes.text());
    return;
  }
  const ws = await wsRes.json();
  workspaceId = ws.id;

  // Add memberUser as an active member via the /members endpoint.
  if (memberUser?.email) {
    const addRes = await jsonPost(
      `${API}/screening/projects/${workspaceId}/members`,
      { email: memberUser.email, role: 'reviewer' },
      ownerCookie,
    );
    if (addRes.ok) {
      // List members to grab the row id (some servers return the row directly)
      const body = await addRes.json();
      memberRowId = body.id ?? body.member?.id ?? null;
    }
  }

  // If memberRowId is not returned by addMember, find it via list.
  if (!memberRowId && memberUser?.id) {
    const listRes = await authedGet(
      `${API}/screening/projects/${workspaceId}/members`,
      ownerCookie,
    );
    if (listRes.ok) {
      const listBody = await listRes.json();
      // Endpoint returns { members: [...] } — normalise to bare array.
      const memberList = Array.isArray(listBody) ? listBody : (listBody.members ?? []);
      const row = memberList.find(m => m.userId === memberUser.id || m.email === memberUser.email);
      memberRowId = row?.id ?? null;
    }
  }
});

afterAll(async () => {
  // Best-effort cleanup — the workspace stays in the DB but won't affect other tests.
});

/* ════════════════════════════════════════════════════════════════════════════
   1. Auth gating
   ════════════════════════════════════════════════════════════════════════════ */

describe('POST /api/screening/projects/:pid/transfer-owner — auth gating', () => {
  it('unauthenticated request → 401', async () => {
    if (!up || !workspaceId) return;
    const res = await fetch(`${API}/screening/projects/${workspaceId}/transfer-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toUserId: 'any' }),
    });
    expect(res.status).toBe(401);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2. Owner-only gating
   ════════════════════════════════════════════════════════════════════════════ */

describe('POST /api/screening/projects/:pid/transfer-owner — owner-only', () => {
  it('non-member (outsider) → 404 (existence hiding)', async () => {
    if (!up || !workspaceId) return;
    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/transfer-owner`,
      { toUserId: ownerUser.id },
      outsiderCookie,
    );
    expect(res.status).toBe(404);
  });

  it('active member who is NOT the owner → 403', async () => {
    if (!up || !workspaceId || !memberUser) return;
    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/transfer-owner`,
      { toUserId: ownerUser.id },
      memberCookie,
    );
    // Non-owner member can see the project but cannot perform the transfer.
    expect(res.status).toBe(403);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3. Validation — bad toUserId values
   ════════════════════════════════════════════════════════════════════════════ */

describe('POST /api/screening/projects/:pid/transfer-owner — validation', () => {
  it('missing toUserId → 400', async () => {
    if (!up || !workspaceId) return;
    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/transfer-owner`,
      {},
      ownerCookie,
    );
    expect(res.status).toBe(400);
  });

  it('toUserId === current owner → 400 ("already the owner")', async () => {
    if (!up || !workspaceId || !ownerUser) return;
    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/transfer-owner`,
      { toUserId: ownerUser.id },
      ownerCookie,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already/i);
  });

  it('toUserId not a member of the workspace → 400 ("active member")', async () => {
    if (!up || !workspaceId || !outsiderUser) return;
    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/transfer-owner`,
      { toUserId: outsiderUser.id },
      ownerCookie,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/active member/i);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4. Successful transfer
   ════════════════════════════════════════════════════════════════════════════ */

describe('POST /api/screening/projects/:pid/transfer-owner — successful transfer', () => {
  /** After transfer we track whether the suite has already run it. */
  let transferred = false;

  it('transfer returns { ok:true, ownerId: newOwnerId }', async () => {
    if (!up || !workspaceId || !memberUser) return;

    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/transfer-owner`,
      { toUserId: memberUser.id },
      ownerCookie,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ownerId).toBe(memberUser.id);
    transferred = true;
  });

  it('workspace ownerId is flipped in the database (reflected by GET /members)', async () => {
    if (!up || !workspaceId || !memberUser || !transferred) return;

    // The new owner should now be listed with role 'owner'.
    const listRes = await authedGet(
      `${API}/screening/projects/${workspaceId}/members`,
      memberCookie,
    );
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    // The endpoint returns { members: [...] } (not a bare array).
    const members = Array.isArray(body) ? body : (body.members ?? []);

    const newOwnerRow = members.find(m => m.userId === memberUser.id || m.email === memberUser.email);
    expect(newOwnerRow).toBeDefined();
    expect(newOwnerRow.role).toBe('owner');

    const oldOwnerRow = members.find(m => m.userId === ownerUser.id || m.email === ownerUser.email);
    expect(oldOwnerRow).toBeDefined();
    // Former owner must be demoted to leader (full access, but not owner).
    expect(oldOwnerRow.role).toBe('leader');
  });

  it('former owner (now leader) can POST /leave → 200 { left:true }', async () => {
    if (!up || !workspaceId || !transferred) return;

    const res = await jsonPost(
      `${API}/screening/projects/${workspaceId}/leave`,
      {},
      ownerCookie,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.left).toBe(true);
  });

  it('after owner leaves, workspace is no longer visible to the former owner', async () => {
    if (!up || !workspaceId || !transferred) return;

    const res = await authedGet(
      `${API}/screening/projects/${workspaceId}`,
      ownerCookie,
    );
    // Non-member → 404 (existence hiding).
    expect(res.status).toBe(404);
  });

  it('new owner cannot be removed from the workspace (→ 400)', async () => {
    if (!up || !workspaceId || !memberUser || !transferred) return;

    // Find the new-owner member row id via the member list.
    const listRes = await authedGet(
      `${API}/screening/projects/${workspaceId}/members`,
      memberCookie,
    );
    if (!listRes.ok) return;
    const body2 = await listRes.json();
    // Normalise { members: [...] } vs bare array.
    const members = Array.isArray(body2) ? body2 : (body2.members ?? []);
    const ownerRow = members.find(m => m.userId === memberUser.id || m.email === memberUser.email);
    if (!ownerRow) return;

    // Attempt to DELETE the owner's member row — controllers should reject this.
    const delRes = await authedDelete(
      `${API}/screening/projects/${workspaceId}/members/${ownerRow.id}`,
      memberCookie,  // even the owner themselves cannot remove the owner row
    );
    // The contract says: new owner cannot be removed → 400.
    expect(delRes.status).toBe(400);
  });
});
