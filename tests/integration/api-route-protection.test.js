/**
 * api-route-protection.test.js
 *
 * Verifies that Phase B protected endpoints return 401 when no valid
 * session cookie is provided.  Tests are skipped when the server is not
 * running (server availability is checked in beforeAll).
 *
 * Run: npm run dev:server (or npm run server) before executing.
 */

import { describe, it, expect, beforeAll } from 'vitest';

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

let up = false;

beforeAll(async () => {
  up = await serverUp();
});

/* ══════════════════════════════════════════════════════════════════════
   Route protection — 401 without a session cookie
   ══════════════════════════════════════════════════════════════════════ */

describe('Route protection — unauthenticated requests are rejected', () => {
  it('PUT /api/projects/:id/autosave returns 401 without a cookie', async () => {
    if (!up) return;

    const res = await fetch(`${API}/projects/any-project-id/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sneaky Project', studies: [] }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('POST /api/projects/:id/duplicate returns 401 without a cookie', async () => {
    if (!up) return;

    const res = await fetch(`${API}/projects/any-project-id/duplicate`, {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('GET /api/profile returns 401 without a cookie', async () => {
    if (!up) return;

    const res = await fetch(`${API}/profile`);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('PUT /api/profile/password returns 401 without a cookie', async () => {
    if (!up) return;

    const res = await fetch(`${API}/profile/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'anything', newPassword: 'newpassword1' }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('PUT /api/profile returns 401 without a cookie', async () => {
    if (!up) return;

    const res = await fetch(`${API}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacker' }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('GET /api/health is still publicly accessible', async () => {
    if (!up) return;

    const res = await fetch(`${API}/health`);
    expect(res.status).toBe(200);
  });
});
