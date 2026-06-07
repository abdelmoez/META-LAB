/**
 * api-auth.test.js
 * Integration tests for POST/GET /api/auth/* endpoints and protected route guards
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Attempt login first (handles re-runs where user already exists), fall back to register.
 * Returns { user, cookie } where cookie is the raw set-cookie header value.
 */
async function registerAndLogin(email, password, name = 'Test User') {
  // Try login first in case user already exists from a previous test run
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
  // Register new user
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const setCookie = regRes.headers.get('set-cookie');
  const data = await regRes.json();
  return { user: data.user, cookie: setCookie };
}

let up = false;

beforeAll(async () => {
  up = await serverUp();
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  it('returns 201, user object, and sets a cookie on success', async () => {
    if (!up) return;
    const email = `test-reg-${Date.now()}@example.com`;
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', name: 'QA User' }),
    });
    expect(res.status).toBe(201);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('user');
    expect(data.user.email).toBe(email);
    expect(data.user).toHaveProperty('id');
    expect(data.user).toHaveProperty('createdAt');
    // password must never be returned
    expect(data.user).not.toHaveProperty('password');
  });

  it('returns 409 when email is already registered', async () => {
    if (!up) return;
    const email = `test-dup-${Date.now()}@example.com`;
    // First registration succeeds
    await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    // Second registration with same email should fail
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 when email is missing', async () => {
    if (!up) return;
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password123' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is too short (< 8 chars)', async () => {
    if (!up) return;
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `test-short-${Date.now()}@example.com`, password: 'abc' }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('returns 200, user object, and sets a cookie on valid credentials', async () => {
    if (!up) return;
    const email = `test-login-${Date.now()}@example.com`;
    const password = 'loginpass1';
    // Register first
    await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Login User' }),
    });
    // Then login
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('user');
    expect(data.user.email).toBe(email);
    expect(data.user).not.toHaveProperty('password');
  });

  it('returns 401 when password is wrong', async () => {
    if (!up) return;
    const email = `test-wrongpw-${Date.now()}@example.com`;
    await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'correctpass' }),
    });
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrongpass!' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when email is not registered', async () => {
    if (!up) return;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `nobody-${Date.now()}@example.com`, password: 'somepass1' }),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  it('returns the authenticated user when a valid cookie is present', async () => {
    if (!up) return;
    const email = `test-me-${Date.now()}@example.com`;
    const { cookie } = await registerAndLogin(email, 'mepassword');
    const res = await fetch(`${API}/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('user');
    expect(data.user.email).toBe(email);
    expect(data.user).toHaveProperty('id');
    expect(data.user).toHaveProperty('createdAt');
  });

  it('returns 401 when no cookie is provided', async () => {
    if (!up) return;
    const res = await fetch(`${API}/auth/me`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout', () => {
  it('returns { ok: true } and clears the session when authenticated', async () => {
    if (!up) return;
    const email = `test-logout-${Date.now()}@example.com`;
    const { cookie } = await registerAndLogin(email, 'logoutpass');
    const res = await fetch(`${API}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });
  });

  it('returns 401 when no cookie is provided', async () => {
    if (!up) return;
    const res = await fetch(`${API}/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Protected route guards — existing endpoints must require auth
// ---------------------------------------------------------------------------

describe('Protected route guards', () => {
  it('GET /api/projects returns 401 without a session cookie', async () => {
    if (!up) return;
    const res = await fetch(`${API}/projects`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('POST /api/projects returns 401 without a session cookie', async () => {
    if (!up) return;
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized Project' }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('GET /api/health is still public (no auth required)', async () => {
    if (!up) return;
    const res = await fetch(`${API}/health`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// User isolation — each user sees only their own data
// ---------------------------------------------------------------------------

describe('User isolation', () => {
  it('a project created by user A is not visible to user B', async () => {
    if (!up) return;
    const ts = Date.now();
    const { cookie: cookieA } = await registerAndLogin(`user-a-${ts}@example.com`, 'passwordA1');
    const { cookie: cookieB } = await registerAndLogin(`user-b-${ts}@example.com`, 'passwordB1');

    // User A creates a project
    const createRes = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: `User A Project ${ts}` }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const projectId = created.id;

    // User B lists projects — should not contain user A's project
    const listRes = await fetch(`${API}/projects`, {
      headers: { Cookie: cookieB },
    });
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const found = list.find(p => p.id === projectId);
    expect(found).toBeUndefined();
  });

  it("fetching user A's project id directly as user B returns 404", async () => {
    if (!up) return;
    const ts = Date.now() + 1; // offset to avoid collision with previous test
    const { cookie: cookieA } = await registerAndLogin(`user-a2-${ts}@example.com`, 'passwordA2');
    const { cookie: cookieB } = await registerAndLogin(`user-b2-${ts}@example.com`, 'passwordB2');

    // User A creates a project
    const createRes = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: `Isolation Project ${ts}` }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const projectId = created.id;

    // User B tries to GET the specific project by id
    const getRes = await fetch(`${API}/projects/${projectId}`, {
      headers: { Cookie: cookieB },
    });
    expect(getRes.status).toBe(404);
  });
});
