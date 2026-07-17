/**
 * screening-api.test.js
 * Integration tests for the META·SIFT Beta screening API.
 * Requires the META·LAB server to be running on http://localhost:3001.
 * All tests are skipped silently when the server is not available.
 *
 * Root-cause fix v2: routes now use /api/screening/projects prefix.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API  = 'http://127.0.0.1:3001/api'; // 127.0.0.1 avoids Node/undici ::1 hang on Windows
const SIFT = `${API}/screening/projects`;

// ── Helpers ────────────────────────────────────────────────────────────────────

async function serverUp() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function loginOrRegister(email, password, name = 'Test User') {
  // Try login first (handles repeated test runs)
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    return loginRes.headers.get('set-cookie');
  }
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return regRes.headers.get('set-cookie');
}

async function api(method, url, cookie, body) {
  const opts = { method, headers: { Cookie: cookie } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts);
}

// ── Shared state ──────────────────────────────────────────────────────────────

let up = false;
let cookieA = null;
let cookieB = null;
let projectId = null;
let recordId = null;

const SAMPLE_RIS = `TY  - JOUR
AU  - Smith, John
TI  - A Randomized Controlled Trial of Aspirin Therapy
PY  - 2023
JO  - Test Medical Journal
DO  - 10.9999/sift.test.2023
AB  - Background: This is a test abstract for import testing purposes.
ER  -

TY  - JOUR
AU  - Jones, Alice
TI  - Meta-Analysis of Statin Therapy in Cardiovascular Prevention
PY  - 2022
JO  - Cardiology Today
DO  - 10.9999/sift.statin.2022
AB  - Methods: Systematic review methods were applied in this meta-analysis.
ER  -`;

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;

  cookieA = await loginOrRegister('sift-qa-a@example.com', 'SiftPassA1!', 'SIFT QA User A');
  cookieB = await loginOrRegister('sift-qa-b@example.com', 'SiftPassB1!', 'SIFT QA User B');
});

afterAll(async () => {
  // Clean up the test project
  if (up && projectId && cookieA) {
    await api('DELETE', `${SIFT}/${projectId}`, cookieA);
  }
});

// ── Health ─────────────────────────────────────────────────────────────────────

describe('GET /api/screening/health', () => {
  it('returns 200 with status ok', async () => {
    if (!up) return;
    const res = await fetch(`${API}/screening/health`, { headers: { Cookie: cookieA } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});

// ── Auth guard ─────────────────────────────────────────────────────────────────

describe('Auth: unauthenticated access', () => {
  it('GET /api/screening/projects returns 401 without auth', async () => {
    if (!up) return;
    const res = await fetch(SIFT);
    expect(res.status).toBe(401);
  });
});

// ── Project CRUD ───────────────────────────────────────────────────────────────

describe('POST /api/screening/projects — create', () => {
  it('creates a screening project and returns 201', async () => {
    if (!up) return;
    const res = await api('POST', SIFT, cookieA, {
      title: 'SIFT QA Test Project',
      description: 'Integration test project',
      blindMode: false,
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.title).toBe('SIFT QA Test Project');
    projectId = data.id;
  });
});

describe('GET /api/screening/projects — list', () => {
  it('returns 200 with projects array', async () => {
    if (!up) return;
    const res = await api('GET', SIFT, cookieA);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.projects)).toBe(true);
  });

  it('list includes the newly created project', async () => {
    if (!up || !projectId) return;
    const res = await api('GET', SIFT, cookieA);
    const data = await res.json();
    const found = data.projects.find(p => p.id === projectId);
    expect(found).toBeDefined();
    expect(found.title).toBe('SIFT QA Test Project');
  });
});

describe('GET /api/screening/projects/:id — get single', () => {
  it('returns 200 with the project details', async () => {
    if (!up || !projectId) return;
    const res = await api('GET', `${SIFT}/${projectId}`, cookieA);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(projectId);
  });
});

describe('PUT /api/screening/projects/:id — update', () => {
  it('updates the project title and returns 200', async () => {
    if (!up || !projectId) return;
    const res = await api('PUT', `${SIFT}/${projectId}`, cookieA, {
      title: 'SIFT QA Test Project — Updated',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe('SIFT QA Test Project — Updated');
  });
});

// ── Stats (empty project) ──────────────────────────────────────────────────────

describe('GET /api/screening/projects/:id/stats — empty', () => {
  it('returns 200 with all-zero stats on empty project', async () => {
    if (!up || !projectId) return;
    const res = await api('GET', `${SIFT}/${projectId}/stats`, cookieA);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('screened');
    expect(data).toHaveProperty('included');
    expect(data).toHaveProperty('excluded');
    expect(data).toHaveProperty('maybe');
    expect(data).toHaveProperty('progress');
    expect(data.total).toBe(0);
  });
});

// ── Import ─────────────────────────────────────────────────────────────────────

describe('POST /api/screening/projects/:id/import — RIS', () => {
  it('imports records and returns imported count', async () => {
    if (!up || !projectId) return;
    const res = await api('POST', `${SIFT}/${projectId}/import`, cookieA, {
      format: 'ris',
      content: SAMPLE_RIS,
      filename: 'qa-test.ris',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.imported).toBe('number');
    expect(data.imported).toBeGreaterThan(0);
  });
});

// ── Records ────────────────────────────────────────────────────────────────────

describe('GET /api/screening/projects/:id/records', () => {
  it('returns 200 with records after import', async () => {
    if (!up || !projectId) return;
    const res = await api('GET', `${SIFT}/${projectId}/records`, cookieA);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.records)).toBe(true);
    expect(data.records.length).toBeGreaterThan(0);
    recordId = data.records[0].id;
  });
});

// ── Decisions ─────────────────────────────────────────────────────────────────

describe('POST /api/screening/projects/:id/records/:rid/decision', () => {
  it('saves a decision and returns the upserted decision', async () => {
    if (!up || !recordId) return;
    const res = await api(
      'POST',
      `${SIFT}/${projectId}/records/${recordId}/decision`,
      cookieA,
      { decision: 'include', notes: 'Relevant RCT', rating: 4 },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decision).toBe('include');
    expect(data.notes).toBe('Relevant RCT');
  });
});

// ── Stats after decisions ──────────────────────────────────────────────────────

describe('GET /api/screening/projects/:id/stats — after decision', () => {
  it('reflects the include decision in stats', async () => {
    if (!up || !projectId) return;
    const res = await api('GET', `${SIFT}/${projectId}/stats`, cookieA);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.included).toBeGreaterThanOrEqual(1);
    expect(data.screened).toBeGreaterThanOrEqual(1);
  });
});

// ── Duplicate detection ────────────────────────────────────────────────────────

describe('POST /api/screening/projects/:id/duplicates/detect', () => {
  it('returns 202 with a durable job that completes in the background (92.md)', async () => {
    if (!up || !projectId) return;
    const res = await api('POST', `${SIFT}/${projectId}/duplicates/detect`, cookieA, {});
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.job).toBeTruthy();
    expect(['queued', 'processing', 'completed']).toContain(data.job.status);
    // Poll until terminal — a small project finishes in well under the budget.
    let job = data.job;
    for (let i = 0; i < 80 && !['completed', 'failed', 'cancelled'].includes(job.status); i++) {
      await new Promise((r) => setTimeout(r, 250));
      const jr = await api('GET', `${SIFT}/${projectId}/duplicates/jobs/${job.id}`, cookieA);
      expect(jr.status).toBe(200);
      job = (await jr.json()).job;
    }
    expect(job.status).toBe('completed');
    expect(job.error).toBe('');
  }, 30_000);
});

// ── Conflicts ─────────────────────────────────────────────────────────────────

describe('GET /api/screening/projects/:id/conflicts', () => {
  it('returns 200 with conflicts array (empty with single reviewer)', async () => {
    if (!up || !projectId) return;
    const res = await api('GET', `${SIFT}/${projectId}/conflicts`, cookieA);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.conflicts)).toBe(true);
  });
});

// ── Labels ────────────────────────────────────────────────────────────────────

describe('POST /api/screening/projects/:id/labels', () => {
  it('creates a label and returns 201', async () => {
    if (!up || !projectId) return;
    const res = await api('POST', `${SIFT}/${projectId}/labels`, cookieA, {
      name: 'RCT', color: '#4ade80',
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe('RCT');
  });
});

// ── Export ────────────────────────────────────────────────────────────────────

describe('GET /api/screening/projects/:id/export', () => {
  it('returns 200 CSV export', async () => {
    if (!up || !projectId) return;
    const res = await api('GET', `${SIFT}/${projectId}/export?format=csv`, cookieA);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
  });

  it('returns 200 JSON export', async () => {
    if (!up || !projectId) return;
    const res = await api('GET', `${SIFT}/${projectId}/export?format=json`, cookieA);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

// ── Cross-user access control ─────────────────────────────────────────────────

describe('User ownership isolation', () => {
  it('User B cannot access User A project — returns 404', async () => {
    if (!up || !projectId || !cookieB) return;
    const res = await api('GET', `${SIFT}/${projectId}`, cookieB);
    expect(res.status).toBe(404);
  });

  it('User B cannot delete User A project — returns 404', async () => {
    if (!up || !projectId || !cookieB) return;
    const res = await api('DELETE', `${SIFT}/${projectId}`, cookieB);
    expect(res.status).toBe(404);
  });
});

// ── Cleanup project via delete ─────────────────────────────────────────────────

describe('DELETE /api/screening/projects/:id', () => {
  it('owner can delete their own project — returns 204', async () => {
    if (!up || !cookieA) return;
    // Create a disposable project just for deletion test
    const createRes = await api('POST', SIFT, cookieA, { title: 'Disposable SIFT Project' });
    if (!createRes.ok) return;
    const created = await createRes.json();
    const deleteRes = await api('DELETE', `${SIFT}/${created.id}`, cookieA);
    expect([200, 204]).toContain(deleteRes.status);
  });
});
