/**
 * tests/integration/api-permission-invariants.test.js
 *
 * Permission-invariant integration tests (prompt12).
 *
 * EXISTING COVERAGE (do not duplicate):
 *  - Owner cannot be removed from workspace → api-ownership-transfer.test.js L308-330.
 *  - Normal user (role 'user') cannot access admin routes → api-admin.test.js §2.
 *  - Unauthenticated requests to admin endpoints → 401 → api-admin.test.js §1.
 *
 * NEW COVERAGE (this file):
 *
 *  § A  Mod-specific invariants (require env-var ADMIN_EMAIL/ADMIN_PASS from seed)
 *       — skipped automatically when those vars are absent (same pattern as
 *         api-admin.test.js §7).  Invariants tested:
 *         A1. A mod CAN access mod-allowed routes (GET /admin/users → 200).
 *         A2. A mod CANNOT access admin-only routes (GET /admin/metrics → 403,
 *             GET /admin/settings → 403).
 *         A3. A mod CANNOT change role (PATCH /admin/users/:id/role → 403).
 *         A4. A mod CANNOT edit an admin target (PATCH /admin/users/:id → 403
 *             with MOD_TARGET_DENIED — requireTargetEditable).
 *         A5. A mod CANNOT suspend an admin target (PATCH /admin/users/:id/status → 403).
 *         A6. A mod CAN edit an ordinary user target (PATCH /admin/users/:id → 200).
 *
 *  § B  Viewer / read-only workspace permission invariants (no seed admin required).
 *       A viewer member of a screening workspace:
 *         B1. CAN read the workspace (GET /screening/projects/:pid → 200).
 *         B2. CANNOT submit screen decisions (POST /screening/projects/:pid/records
 *             /:rid/screen → 403 or the appropriate rejection status).
 *         B3. CANNOT import records (POST /screening/projects/:pid/import → 403).
 *
 * Tests skip gracefully when the server is not running on port 3001.
 *
 * Run manually:
 *   node server/index.js &
 *   # For § A only (seed admin required):
 *   ADMIN_EMAIL=admin@metalab.dev ADMIN_PASS=<seed_pw> \
 *     npx vitest run tests/integration/api-permission-invariants.test.js
 *   # For § B only (no seed required):
 *   npx vitest run tests/integration/api-permission-invariants.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const API = 'http://127.0.0.1:3001/api';

/* ── Load server/.env for seed admin credentials ─────────────────────────────
   The test runner does not have the server's dotenvx env injected.  We parse
   server/.env ourselves (simple KEY="VALUE" format) so § A mod tests can run
   automatically without the caller needing to set extra env vars. */
function loadServerEnv() {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(__dir, '../../server/.env');
    const raw = readFileSync(envPath, 'utf8');
    const result = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m) result[m[1]] = m[2];
    }
    return result;
  } catch {
    return {};
  }
}

const SERVER_ENV = loadServerEnv();

/* ── Server availability ─────────────────────────────────────────────────── */

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

async function registerAndLogin(email, password, name = 'Perm Test User') {
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

function authedGet(url, cookie) {
  return fetch(url, { headers: { Cookie: cookie } });
}

function authedPatch(url, body, cookie) {
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

function authedPost(url, body, cookie) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

/* ── Module-level state ───────────────────────────────────────────────────── */

let up = false;
const TS = Date.now();

/* ── Admin-route availability guard ─────────────────────────────────────────
   The admin router may not be mounted in all environments (returns 404 vs 401).
   Check before running admin-route assertions (matches api-admin.test.js pattern). */
async function adminRoutesMounted() {
  const res = await fetch(`${API}/admin/metrics`);
  return res.status === 401 || res.status === 403; // 404 = not mounted
}

beforeAll(async () => {
  up = await serverUp();
});

/* ════════════════════════════════════════════════════════════════════════════
   § A  Mod-specific permission invariants
        Skipped when ADMIN_EMAIL / ADMIN_PASS env vars are not set.
        These tests require a seeded admin account so we can:
          1. Log in as admin.
          2. Register a new ordinary user and promote them to 'mod' via
             PATCH /admin/users/:id/role.
          3. Run assertions using the mod's cookie.
   ════════════════════════════════════════════════════════════════════════════ */

// Seeded admin credentials — prefer explicit env vars, then fall back to the
// values parsed from server/.env (ADMIN_EMAIL_1 + ADMIN_SEED_PASSWORD).
// § A runs automatically when the server is started with its normal server/.env
// without needing any additional env vars from the caller.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || SERVER_ENV.ADMIN_EMAIL_1 || '';
const ADMIN_PASS  = process.env.ADMIN_PASS  || SERVER_ENV.ADMIN_SEED_PASSWORD || '';
const runModTests = () => Boolean(ADMIN_EMAIL && ADMIN_PASS);

describe('§ A — Mod permission invariants (requires seeded admin — set ADMIN_EMAIL + ADMIN_PASS)', () => {

  let adminCookie = null;
  let modCookie   = null;
  let modUserId   = null;
  let adminUserId = null; // the seeded admin's own id
  let ordinaryUserId = null; // a plain 'user' target for positive-path tests
  let mounted = false;

  beforeAll(async () => {
    if (!up || !runModTests()) return;

    mounted = await adminRoutesMounted();
    if (!mounted) {
      console.warn('[§A] Admin routes not mounted — § A skipped');
      return;
    }

    // 1. Login as seeded admin.
    const adminRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    if (!adminRes.ok) {
      console.warn('[§A] Admin login failed — § A skipped');
      return;
    }
    adminCookie = adminRes.headers.get('set-cookie');
    const adminData = await adminRes.json();
    adminUserId = adminData.user?.id;

    // 2. Register a fresh user → promote to mod.
    const { user: futureModUser, cookie: futureModCookie } =
      await registerAndLogin(`mod-candidate-${TS}@example.com`, 'ModCandidate1!', 'Mod Candidate');
    modUserId  = futureModUser?.id;
    modCookie  = futureModCookie; // save cookie for later — role in DB changes, JWT is still valid

    if (!modUserId) {
      console.warn('[§A] Could not create mod candidate — § A skipped');
      return;
    }

    const roleRes = await authedPatch(
      `${API}/admin/users/${modUserId}/role`,
      { role: 'mod' },
      adminCookie,
    );
    if (!roleRes.ok) {
      console.warn('[§A] Could not promote user to mod (status', roleRes.status, ') — § A skipped');
      return;
    }
    // Re-login as mod so the JWT reflects the updated role (the old JWT still has role:'user').
    const modLoginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `mod-candidate-${TS}@example.com`, password: 'ModCandidate1!' }),
    });
    if (modLoginRes.ok) {
      modCookie = modLoginRes.headers.get('set-cookie');
    }

    // 3. Register a plain ordinary user as a mutation target.
    const { user: ordUser } =
      await registerAndLogin(`ordinary-target-${TS}@example.com`, 'OrdinaryTarget1!', 'Ordinary Target');
    ordinaryUserId = ordUser?.id;
  });

  const skip = () => !up || !runModTests() || !adminCookie || !modCookie || !mounted;

  /* ── A1. Mod CAN access mod-allowed GET /admin/users ──────────────────── */

  it('A1: mod can GET /admin/users → 200', async () => {
    if (skip()) return;
    const res = await authedGet(`${API}/admin/users`, modCookie);
    expect(res.status).toBe(200);
  });

  /* ── A2. Mod CANNOT access admin-only routes ──────────────────────────── */

  it('A2a: mod cannot GET /admin/metrics → 403', async () => {
    if (skip()) return;
    const res = await authedGet(`${API}/admin/metrics`, modCookie);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('A2b: mod cannot GET /admin/settings → 403', async () => {
    if (skip()) return;
    const res = await authedGet(`${API}/admin/settings`, modCookie);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('A2c: mod cannot GET /admin/audit-log → 403', async () => {
    if (skip()) return;
    const res = await authedGet(`${API}/admin/audit-log`, modCookie);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  /* ── A3. Mod CANNOT change any user's global role ─────────────────────── */

  it('A3: mod cannot PATCH /admin/users/:id/role → 403', async () => {
    if (skip() || !ordinaryUserId) return;
    const res = await authedPatch(
      `${API}/admin/users/${ordinaryUserId}/role`,
      { role: 'user' },
      modCookie,
    );
    // PATCH /users/:id/role is requireAdmin — mod is 403.
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  /* ── A4. Mod CANNOT edit an admin target (requireTargetEditable) ──────── */

  it('A4: mod cannot PATCH /admin/users/:adminId (edit admin target) → 403', async () => {
    if (skip() || !adminUserId) return;
    const res = await authedPatch(
      `${API}/admin/users/${adminUserId}`,
      { name: 'Mod Cannot Change This' },
      modCookie,
    );
    // requireTargetEditable fires because target.role === 'admin' → 403.
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    // The error message documents the invariant.
    expect(body.error).toMatch(/moderator|administrator|admin/i);
  });

  /* ── A5. Mod CANNOT suspend an admin target ───────────────────────────── */

  it('A5: mod cannot PATCH /admin/users/:adminId/status → 403', async () => {
    if (skip() || !adminUserId) return;
    const res = await authedPatch(
      `${API}/admin/users/${adminUserId}/status`,
      { suspended: true },
      modCookie,
    );
    // requireTargetEditable fires because target.role === 'admin' → 403.
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  /* ── A6. Mod CAN edit an ordinary user target (positive-path) ─────────── */

  it('A6: mod CAN PATCH /admin/users/:ordinaryId (edit ordinary user) → 200', async () => {
    if (skip() || !ordinaryUserId) return;
    const res = await authedPatch(
      `${API}/admin/users/${ordinaryUserId}`,
      { name: 'Mod Edited Name' },
      modCookie,
    );
    // requireTargetEditable allows mod on role:'user' targets.
    expect(res.status).toBe(200);
  });

  /* ── A7. Mod CANNOT edit another mod target ───────────────────────────── */

  it('A7: mod cannot PATCH /admin/users/:modId (mod editing another mod) → 403', async () => {
    // Create a second mod to use as the target.
    if (skip()) return;

    // Register a second ordinary user, promote to mod via admin.
    const { user: modTarget } =
      await registerAndLogin(`mod-target-${TS}@example.com`, 'ModTarget1!', 'Mod Target');
    if (!modTarget?.id) return;

    await authedPatch(
      `${API}/admin/users/${modTarget.id}/role`,
      { role: 'mod' },
      adminCookie,
    );

    // Now the first mod tries to edit the second mod → requireTargetEditable should block.
    const res = await authedPatch(
      `${API}/admin/users/${modTarget.id}`,
      { name: 'Cannot Change Another Mod' },
      modCookie,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/moderator|administrator|admin/i);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   § B  Viewer / read-only workspace permission invariants
        No seeded admin required — any registered user can be an owner and
        invite a second user as 'viewer'.
   ════════════════════════════════════════════════════════════════════════════ */

describe('§ B — Viewer/read-only workspace permission invariants', () => {

  let ownerCookie   = null;
  let viewerCookie  = null;
  let viewerUser    = null;
  let workspaceId   = null;
  let sampleRecordId = null;

  beforeAll(async () => {
    if (!up) return;

    // Create owner + viewer users.
    const [ownerSession, viewerSession] = await Promise.all([
      registerAndLogin(`viewer-owner-${TS}@example.com`,  'ViewerOwner1!',  'Viewer Test Owner'),
      registerAndLogin(`viewer-member-${TS}@example.com`, 'ViewerMember1!', 'Viewer Test Member'),
    ]);
    ownerCookie  = ownerSession.cookie;
    viewerUser   = viewerSession.user;
    viewerCookie = viewerSession.cookie;

    if (!ownerCookie || !viewerUser?.id) return;

    // Owner creates a screening workspace.
    const wsRes = await authedPost(
      `${API}/screening/projects`,
      { title: `ViewerPermTest-${TS}` },
      ownerCookie,
    );
    if (!wsRes.ok) {
      console.warn('[§B] Could not create screening workspace:', wsRes.status);
      return;
    }
    const ws = await wsRes.json();
    workspaceId = ws.id;

    // Add viewerUser as a viewer.
    if (viewerUser?.email) {
      const addRes = await authedPost(
        `${API}/screening/projects/${workspaceId}/members`,
        { email: viewerUser.email, role: 'viewer' },
        ownerCookie,
      );
      if (!addRes.ok) {
        console.warn('[§B] Could not add viewer member:', addRes.status, await addRes.text());
        // Continue — B1 read test still works even without viewer membership confirmed.
      }
    }

    // Import one dummy record so there is something to try screening against.
    const importRes = await authedPost(
      `${API}/screening/projects/${workspaceId}/import`,
      {
        source: 'manual',
        records: [{
          title: 'Test record for viewer perm test',
          authors: 'Test Author',
          year: 2024,
          abstract: 'Abstract text.',
        }],
      },
      ownerCookie,
    );
    if (importRes.ok) {
      const importBody = await importRes.json();
      // Endpoint returns { imported, records } or similar — grab first record id.
      const recs = importBody.records ?? importBody.created ?? [];
      sampleRecordId = recs[0]?.id ?? null;
    }
  });

  afterAll(async () => {
    // Best-effort cleanup — workspace persists but won't affect unrelated tests.
  });

  const skip = () => !up || !ownerCookie || !viewerCookie || !workspaceId;

  /* ── B1. Viewer CAN read the workspace ───────────────────────────────── */

  it('B1: viewer can GET /screening/projects/:pid → 200', async () => {
    if (skip()) return;
    const res = await authedGet(`${API}/screening/projects/${workspaceId}`, viewerCookie);
    // Viewer is a member → should see the project.
    expect(res.status).toBe(200);
  });

  /* ── B2. Viewer CANNOT submit a screen decision ──────────────────────── */

  it('B2: viewer cannot POST screen decision → 403', async () => {
    if (skip() || !sampleRecordId) return;
    const res = await authedPost(
      `${API}/screening/projects/${workspaceId}/records/${sampleRecordId}/screen`,
      { decision: 'include', rationale: 'viewer trying to screen' },
      viewerCookie,
    );
    // The canScreen permission is false for viewer — should be 403 (or 404 if
    // the record could not be set up). Either way it must NOT be 200 or 201.
    expect([403, 404]).toContain(res.status);
  });

  /* ── B3. Viewer CANNOT import records ────────────────────────────────── */

  it('B3: viewer cannot POST import records → 403', async () => {
    if (skip()) return;
    const res = await authedPost(
      `${API}/screening/projects/${workspaceId}/import`,
      {
        source: 'manual',
        records: [{ title: 'Viewer import attempt', authors: 'A', year: 2024, abstract: 'x' }],
      },
      viewerCookie,
    );
    // canImportRecords is false for viewer.
    expect(res.status).toBe(403);
  });

  /* ── B4. Unauthenticated user cannot read a private workspace ─────────── */

  it('B4: unauthenticated request to GET /screening/projects/:pid → 401', async () => {
    if (skip()) return;
    const res = await fetch(`${API}/screening/projects/${workspaceId}`);
    expect(res.status).toBe(401);
  });

  /* ── B5. Non-member cannot read the workspace (existence hiding) ─────── */

  it('B5: non-member cannot GET /screening/projects/:pid → 404', async () => {
    if (skip()) return;
    // Register an outsider not added to the workspace.
    const { cookie: outsiderCookie } =
      await registerAndLogin(`viewer-outsider-${TS}@example.com`, 'ViewerOut1!', 'Viewer Outsider');
    const res = await authedGet(`${API}/screening/projects/${workspaceId}`, outsiderCookie);
    // Non-member → 404 (existence hiding — consistent with ownership-transfer tests).
    expect(res.status).toBe(404);
  });
});
