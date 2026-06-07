/**
 * api-phase-b.test.js
 *
 * Integration tests for Phase B backend endpoints:
 *   PUT /api/projects/:id/autosave
 *   GET /api/projects?full=true
 *   POST /api/projects/:id/duplicate
 *   GET /api/profile
 *   PUT /api/profile
 *   PUT /api/profile/password
 *   User isolation for autosave
 *
 * Tests are skipped when the server is not running.
 * Run: npm run dev:server (or npm run server) before executing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API = 'http://localhost:3001/api';

/* ── Server health check ─────────────────────────────────────────────── */

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

/* ── Auth helper ─────────────────────────────────────────────────────── */

async function registerAndLogin(email, password, name = 'Test User') {
  // Try login first (handles re-runs where user already exists)
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    const setCookie = loginRes.headers.get('set-cookie');
    const data = await loginRes.json();
    return { user: data.user, cookie: setCookie };
  }
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const setCookie = regRes.headers.get('set-cookie');
  const data = await regRes.json();
  return { user: data.user, cookie: setCookie };
}

/* ── Module-level state ──────────────────────────────────────────────── */

let up = false;
let cookie = null;
const TS = Date.now();
const USER_EMAIL = `qa-phaseb-${TS}@example.com`;
const USER_PASS  = 'phaseb-pass1';

// IDs to clean up in afterAll
const createdProjectIds = [];

beforeAll(async () => {
  up = await serverUp();
  if (up) {
    const session = await registerAndLogin(USER_EMAIL, USER_PASS, 'Phase B QA');
    cookie = session.cookie;
  }
});

afterAll(async () => {
  if (!up || !cookie) return;
  await Promise.all(
    createdProjectIds.map(id =>
      fetch(`${API}/projects/${id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      }),
    ),
  );
});

/* ══════════════════════════════════════════════════════════════════════
   1. PUT /api/projects/:id/autosave — saves full project including studies
   ══════════════════════════════════════════════════════════════════════ */

describe('PUT /api/projects/:id/autosave', () => {
  it('saves a full project payload including studies array', async () => {
    if (!up) return;

    const projectId = `auto-${TS}`;
    const payload = {
      id: projectId,
      name: 'Autosave Project',
      studies: [
        { id: 's1', author: 'Smith', year: 2020, es: 0.5 },
        { id: 's2', author: 'Jones', year: 2021, es: 0.3 },
      ],
      records: [],
    };

    const res = await fetch(`${API}/projects/${projectId}/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(projectId);
    expect(data.name).toBe('Autosave Project');
    expect(Array.isArray(data.studies)).toBe(true);
    expect(data.studies).toHaveLength(2);
    createdProjectIds.push(projectId);
  });

  it('creates a new project when the id does not yet exist (upsert)', async () => {
    if (!up) return;

    const newId = `upsert-${TS}`;
    const payload = { id: newId, name: 'Upserted Project', studies: [], records: [] };

    const res = await fetch(`${API}/projects/${newId}/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(newId);
    expect(data.name).toBe('Upserted Project');
    createdProjectIds.push(newId);

    // Verify it is now retrievable
    const getRes = await fetch(`${API}/projects/${newId}`, {
      headers: { Cookie: cookie },
    });
    expect(getRes.status).toBe(200);
    const got = await getRes.json();
    expect(got.id).toBe(newId);
  });

  it('returns 400 when name is missing from the payload', async () => {
    if (!up) return;

    const res = await fetch(`${API}/projects/bad-payload-id/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ studies: [] }), // no name
    });

    expect(res.status).toBe(400);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   2. GET /api/projects?full=true
   ══════════════════════════════════════════════════════════════════════ */

describe('GET /api/projects?full=true', () => {
  it('returns projects with studies and records included', async () => {
    if (!up) return;

    // First autosave a project with studies so we have data
    const projectId = `full-${TS}`;
    await fetch(`${API}/projects/${projectId}/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        id: projectId,
        name: 'Full Project',
        studies: [{ id: 'sf1', author: 'Doe' }],
        records: [{ id: 'rf1', title: 'Paper 1' }],
      }),
    });
    createdProjectIds.push(projectId);

    const res = await fetch(`${API}/projects?full=true`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);

    const found = list.find(p => p.id === projectId);
    expect(found).toBeDefined();
    // full=true should include studies and records (not stripped)
    expect(found).toHaveProperty('studies');
    expect(found).toHaveProperty('records');
    expect(Array.isArray(found.studies)).toBe(true);
    expect(found.studies.length).toBeGreaterThan(0);
  });

  it('strips studies and records when full param is absent', async () => {
    if (!up) return;

    const res = await fetch(`${API}/projects`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const list = await res.json();

    // At least one project should exist; none should have studies at the top level
    list.forEach(p => {
      expect(p).not.toHaveProperty('studies');
      expect(p).not.toHaveProperty('records');
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   3. POST /api/projects/:id/duplicate
   ══════════════════════════════════════════════════════════════════════ */

describe('POST /api/projects/:id/duplicate', () => {
  it('returns a new project with "(copy)" appended to the name', async () => {
    if (!up) return;

    // Create a source project
    const sourceId = `dup-src-${TS}`;
    await fetch(`${API}/projects/${sourceId}/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: sourceId, name: 'Original Project', studies: [], records: [] }),
    });
    createdProjectIds.push(sourceId);

    const res = await fetch(`${API}/projects/${sourceId}/duplicate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(201);
    const copy = await res.json();
    expect(copy.name).toBe('Original Project (copy)');
    expect(copy.id).not.toBe(sourceId);
    expect(copy.id).toBeTruthy();
    createdProjectIds.push(copy.id);
  });

  it('returns 404 when duplicating a non-existent project', async () => {
    if (!up) return;

    const res = await fetch(`${API}/projects/does-not-exist-000/duplicate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   4. GET /api/profile
   ══════════════════════════════════════════════════════════════════════ */

describe('GET /api/profile', () => {
  it('returns the authenticated user without the password field', async () => {
    if (!up) return;

    const res = await fetch(`${API}/profile`, {
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('user');
    expect(data.user).toHaveProperty('id');
    expect(data.user).toHaveProperty('email');
    expect(data.user.email).toBe(USER_EMAIL);
    // password must never be returned
    expect(data.user).not.toHaveProperty('password');
  });

  it('returns 401 without a session cookie', async () => {
    if (!up) return;

    const res = await fetch(`${API}/profile`);
    expect(res.status).toBe(401);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   5. PUT /api/profile
   ══════════════════════════════════════════════════════════════════════ */

describe('PUT /api/profile', () => {
  it('updates the display name of the authenticated user', async () => {
    if (!up) return;

    const newName = `Updated Name ${TS}`;
    const res = await fetch(`${API}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: newName }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('user');
    expect(data.user.name).toBe(newName);
    expect(data.user).not.toHaveProperty('password');
  });

  it('returns 400 when name is not a string', async () => {
    if (!up) return;

    const res = await fetch(`${API}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 12345 }),
    });

    expect(res.status).toBe(400);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   6. PUT /api/profile/password
   ══════════════════════════════════════════════════════════════════════ */

describe('PUT /api/profile/password', () => {
  it('changes the password so the old password no longer works', async () => {
    if (!up) return;

    const pwEmail    = `qa-pw-${TS}@example.com`;
    const oldPass    = 'OldPass123!';
    const newPass    = 'NewPass456!';

    // Register a dedicated user for this test
    const { cookie: pwCookie } = await registerAndLogin(pwEmail, oldPass, 'PW Test User');

    // Change password
    const changeRes = await fetch(`${API}/profile/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: pwCookie },
      body: JSON.stringify({ currentPassword: oldPass, newPassword: newPass }),
    });
    expect(changeRes.status).toBe(200);
    const changeData = await changeRes.json();
    expect(changeData).toEqual({ ok: true });

    // Old password should now be rejected
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pwEmail, password: oldPass }),
    });
    expect(loginRes.status).toBe(401);

    // New password should be accepted
    const newLoginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pwEmail, password: newPass }),
    });
    expect(newLoginRes.status).toBe(200);
  });

  it('returns 401 when currentPassword is wrong', async () => {
    if (!up) return;

    const res = await fetch(`${API}/profile/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ currentPassword: 'WRONG_PASS', newPassword: 'NewPass789!' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 400 when newPassword is shorter than 8 characters', async () => {
    if (!up) return;

    const res = await fetch(`${API}/profile/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ currentPassword: USER_PASS, newPassword: 'short' }),
    });

    expect(res.status).toBe(400);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   7. User isolation — autosave by user A cannot be accessed by user B
   ══════════════════════════════════════════════════════════════════════ */

describe('User isolation for autosave', () => {
  it('a project autosaved by user A is not retrievable by user B', async () => {
    if (!up) return;

    const ts2 = Date.now() + 1;
    const { cookie: cookieA } = await registerAndLogin(
      `phaseb-a-${ts2}@example.com`,
      'PasswordA1!',
      'User A',
    );
    const { cookie: cookieB } = await registerAndLogin(
      `phaseb-b-${ts2}@example.com`,
      'PasswordB1!',
      'User B',
    );

    // User A autosaves a project with a known ID
    const sharedId = `iso-${ts2}`;
    const res = await fetch(`${API}/projects/${sharedId}/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ id: sharedId, name: 'User A Private', studies: [], records: [] }),
    });
    expect(res.status).toBe(200);

    // User B tries to GET the same project ID
    const getRes = await fetch(`${API}/projects/${sharedId}`, {
      headers: { Cookie: cookieB },
    });
    expect(getRes.status).toBe(404);

    // Cleanup A's project
    await fetch(`${API}/projects/${sharedId}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    });
  });
});
