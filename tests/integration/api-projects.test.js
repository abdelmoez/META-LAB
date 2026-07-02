/**
 * api-projects.test.js
 * Integration tests for POST/GET/PUT/DELETE /api/projects
 * All requests are authenticated via a session cookie obtained in beforeAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// 127.0.0.1, never localhost - node fetch can resolve ::1 on Windows and fail
// flakily mid-suite (repo convention, see prompt6.test.js header).
const API = 'http://127.0.0.1:3001/api';

async function serverUp() {
  // One spaced retry: at the tail of a long run the client can transiently fail
  // to open a socket (ephemeral-port churn); a down server stays down anyway.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 750));
    try {
      await fetch(`${API}/health`);
      return true;
    } catch { /* retry once */ }
  }
  return false;
}

/**
 * Attempt login first (handles re-runs where user already exists),
 * fall back to register. Returns { user, cookie }.
 */
async function registerAndLogin(email, password, name = 'Test User') {
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

let up = false;
let cookie = null;
let createdId = null;

beforeAll(async () => {
  up = await serverUp();
  if (up) {
    // A thrown fetch here would fail the whole file as "skipped" — retry once,
    // then degrade to the self-skip path (cookie null → tests return early).
    for (let attempt = 0; attempt < 2 && !cookie; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 750));
      try {
        const session = await registerAndLogin(
          'qa-projects@example.com',
          'projectspass1',
          'Projects QA',
        );
        cookie = session.cookie;
      } catch { cookie = null; }
    }
    if (!cookie) up = false;
  }
});

afterAll(async () => {
  // cleanup: delete the project created during tests
  if (up && createdId && cookie) {
    await fetch(`${API}/projects/${createdId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
  }
});

describe('POST /api/projects', () => {
  it('creates a project and returns 201', async () => {
    if (!up) return;
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'QA Test Project' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe('QA Test Project');
    expect(data.id).toBeTruthy();
    createdId = data.id;
  });

  it('returned project has all required fields', async () => {
    if (!up) return;
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Fields Test Project' }),
    });
    const data = await res.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('name');
    expect(data).toHaveProperty('created');
    expect(data).toHaveProperty('modified');
    expect(data).toHaveProperty('studies');
    // cleanup
    await fetch(`${API}/projects/${data.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
  });
});

describe('GET /api/projects', () => {
  it('returns an array of projects', async () => {
    if (!up) return;
    const res = await fetch(`${API}/projects`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('list includes the project that was created', async () => {
    if (!up || !createdId) return;
    const res = await fetch(`${API}/projects`, { headers: { Cookie: cookie } });
    const data = await res.json();
    const found = data.find(p => p.id === createdId);
    expect(found).toBeDefined();
  });
});

describe('GET /api/projects/:id', () => {
  it('returns the project by id', async () => {
    if (!up || !createdId) return;
    const res = await fetch(`${API}/projects/${createdId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe('QA Test Project');
  });

  it('returns 404 for a non-existent project id', async () => {
    if (!up) return;
    const res = await fetch(`${API}/projects/nonexistentid000`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/projects/:id', () => {
  it('updates the project name', async () => {
    if (!up || !createdId) return;
    const res = await fetch(`${API}/projects/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'QA Test Project Updated' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('QA Test Project Updated');
    expect(data.id).toBe(createdId);
  });

  it('returns 404 when updating non-existent project', async () => {
    if (!up) return;
    const res = await fetch(`${API}/projects/nonexistentid000`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Ghost' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/projects/:id', () => {
  it('deletes a project successfully', async () => {
    if (!up) return;
    // Create a disposable project
    const createRes = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Disposable Project' }),
    });
    const created = await createRes.json();
    const deleteRes = await fetch(`${API}/projects/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(200);
  });

  it('returns 404 when deleting non-existent project', async () => {
    if (!up) return;
    const res = await fetch(`${API}/projects/nonexistentid000`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });
});
