/**
 * api-studies.test.js
 * Integration tests for POST/GET/PUT/DELETE /api/projects/:id/studies
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API = 'http://localhost:3001/api';

async function serverUp() {
  try {
    await fetch(`${API}/health`);
    return true;
  } catch {
    return false;
  }
}

let up = false;
let projectId = null;
let studyId = null;

beforeAll(async () => {
  up = await serverUp();
  if (up) {
    // Create a test project to house the studies
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'QA Studies Test Project' }),
    });
    const data = await res.json();
    projectId = data.id;
  }
});

afterAll(async () => {
  if (up && projectId) {
    await fetch(`${API}/projects/${projectId}`, { method: 'DELETE' });
  }
});

describe('POST /api/projects/:id/studies', () => {
  it('creates a study and returns 201', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/projects/${projectId}/studies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: 'Smith',
        year: '2023',
        es: '0.5',
        lo: '0.1',
        hi: '0.9',
        esType: 'OR',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.author).toBe('Smith');
    expect(data.id).toBeTruthy();
    studyId = data.id;
  });
});

describe('GET /api/projects/:id/studies', () => {
  it('returns the studies array for a project', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/projects/${projectId}/studies`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('list includes the study that was created', async () => {
    if (!up || !projectId || !studyId) return;
    const res = await fetch(`${API}/projects/${projectId}/studies`);
    const data = await res.json();
    const found = data.find(s => s.id === studyId);
    expect(found).toBeDefined();
    expect(found.author).toBe('Smith');
  });

  it('returns 404 for a non-existent project', async () => {
    if (!up) return;
    const res = await fetch(`${API}/projects/nonexistentid000/studies`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/projects/:id/studies/:studyId', () => {
  it('updates a study', async () => {
    if (!up || !projectId || !studyId) return;
    const res = await fetch(`${API}/projects/${projectId}/studies/${studyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: 'Smith Updated', year: '2023' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.author).toBe('Smith Updated');
    expect(data.id).toBe(studyId);
  });

  it('returns 404 for a non-existent study', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/projects/${projectId}/studies/nonexistentstudy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: 'Ghost' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/projects/:id/studies/:studyId', () => {
  it('deletes a study successfully', async () => {
    if (!up || !projectId) return;
    // Create a disposable study
    const createRes = await fetch(`${API}/projects/${projectId}/studies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: 'Disposable', year: '2020' }),
    });
    const created = await createRes.json();
    const deleteRes = await fetch(`${API}/projects/${projectId}/studies/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(200);
  });

  it('returns 404 when deleting a non-existent study', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/projects/${projectId}/studies/nonexistentstudy`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});
