/**
 * api-project-progress.test.js — 75.md Phases 8-9 (Workstream D).
 *
 * GET /api/projects/:id (and the list) now carry a transient `_progress`
 * annotation = the canonical workflow-progress model. This asserts:
 *   - the right shape { pct, steps[{id,label,num,required,status}], requiredDone,
 *     requiredTotal, nextStepId } on the detail GET,
 *   - a brand-new project starts at 0% and points at 'pico',
 *   - the list cards also carry `_progress`,
 *   - `_progress` is NOT persisted: after autosaving the annotated object back, the
 *     raw export (getById blob) has no `_progress` key (store strips `_`-keys).
 *
 * Live API at http://127.0.0.1:3001; self-skips when the server is down.
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

async function serverUp() {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 750));
    try { await fetch(`${API}/health`); return true; } catch { /* retry once */ }
  }
  return false;
}

async function registerAndLogin(email, password, name = 'Progress QA') {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    const data = await loginRes.json();
    return { user: data.user, cookie: loginRes.headers.get('set-cookie') };
  }
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await regRes.json();
  return { user: data.user, cookie: regRes.headers.get('set-cookie') };
}

let up = false;
let cookie = null;
let createdId = null;

beforeAll(async () => {
  up = await serverUp();
  if (!up) return;
  for (let attempt = 0; attempt < 2 && !cookie; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 750));
    try {
      const s = await registerAndLogin('qa-progress@example.com', 'progresspass1');
      cookie = s.cookie;
    } catch { cookie = null; }
  }
  if (!cookie) up = false;
});

afterAll(async () => {
  if (up && createdId && cookie) {
    await fetch(`${API}/projects/${createdId}`, { method: 'DELETE', headers: { Cookie: cookie } });
  }
});

describe('GET /api/projects/:id — _progress annotation', () => {
  it('carries a well-shaped _progress on a brand-new project (0% → pico)', async () => {
    if (!up) return;
    const createRes = await fetch(`${API}/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Progress QA Project' }),
    });
    expect(createRes.status).toBe(201);
    createdId = (await createRes.json()).id;

    const res = await fetch(`${API}/projects/${createdId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data._progress).toBeDefined();
    const pr = data._progress;
    expect(typeof pr.pct).toBe('number');
    expect(pr.pct).toBe(0);                         // nothing done yet
    expect(pr.nextStepId).toBe('pico');             // first step to do
    expect(typeof pr.requiredDone).toBe('number');
    expect(typeof pr.requiredTotal).toBe('number');
    expect(pr.requiredTotal).toBeGreaterThanOrEqual(14); // nma-off denominator
    expect(Array.isArray(pr.steps)).toBe(true);
    const step = pr.steps.find((s) => s.id === 'pico');
    expect(step).toBeDefined();
    expect(step).toHaveProperty('label');
    expect(step).toHaveProperty('num');
    expect(step).toHaveProperty('required');
    expect(['empty', 'partial', 'done']).toContain(step.status);
  });

  it('pct rises as real evidence is saved (PICO complete → higher pct)', async () => {
    if (!up || !createdId) return;
    // Save a complete PICO + a preset timeframe via the full autosave bridge.
    const detail = await (await fetch(`${API}/projects/${createdId}`, { headers: { Cookie: cookie } })).json();
    const body = {
      ...detail,
      pico: { ...(detail.pico || {}), P: 'adults', I: 'drug', C: 'placebo', O: 'mortality', timeframeMode: 'any' },
    };
    const put = await fetch(`${API}/projects/${createdId}/autosave`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
    expect(put.status).toBe(200);

    const after = await (await fetch(`${API}/projects/${createdId}`, { headers: { Cookie: cookie } })).json();
    expect(after._progress.pct).toBeGreaterThan(0);
    expect(after._progress.steps.find((s) => s.id === 'pico').status).toBe('done');
  });

  it('list cards also carry _progress', async () => {
    if (!up || !createdId) return;
    const list = await (await fetch(`${API}/projects`, { headers: { Cookie: cookie } })).json();
    const found = list.find((p) => p.id === createdId);
    expect(found).toBeDefined();
    expect(found._progress).toBeDefined();
    expect(typeof found._progress.pct).toBe('number');
  });

  it('_progress is TRANSIENT — never written into the persisted blob', async () => {
    if (!up || !createdId) return;
    // Round-trip the annotated object (it INCLUDES _progress) back through autosave.
    const annotated = await (await fetch(`${API}/projects/${createdId}`, { headers: { Cookie: cookie } })).json();
    expect(annotated._progress).toBeDefined();
    const put = await fetch(`${API}/projects/${createdId}/autosave`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(annotated),
    });
    expect(put.status).toBe(200);

    // The raw export returns the stored blob (no annotations) — _progress must be gone.
    const exp = await fetch(`${API}/export/project/${createdId}`, { headers: { Cookie: cookie } });
    expect(exp.status).toBe(200);
    const raw = await exp.json();
    expect(raw._progress).toBeUndefined();
    // sanity: it IS the same project, just un-annotated
    expect(raw.id).toBe(createdId);
  });
});
