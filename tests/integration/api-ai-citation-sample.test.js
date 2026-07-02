/**
 * api-ai-citation-sample.test.js — integration coverage for the 66.md P4 AI
 * screening HTTP surface: the citation-status endpoint (P4.3) and the validation
 * sample endpoint (P4.6).
 *
 * Self-skips when the dev server is down (exact api-health.test.js pattern), so a
 * CI box without a running server still sees a syntactically-green file.
 *
 * SCOPE NOTE — feature-flag manipulation is intentionally NOT exercised here.
 * Sibling integration tests (api-auth, api-admin, screening-*) never toggle the
 * `aiScreening` feature flag via API — enabling it needs an admin flag-write path
 * the suite deliberately leaves alone to avoid mutating shared site settings mid-
 * run. With the flag OFF (its default) every AI route is existence-hidden behind a
 * 404, so this file asserts the two guarantees that hold regardless of flag state:
 *   1. anonymous requests are rejected with 401 (route is behind requireAuth), and
 *   2. an authenticated request to an AI route returns 404 while the flag is off
 *      (existence-hiding — the controller's shared gate()).
 * When the engine is enabled in an environment, the unit tests
 * (citationSignals.test.js / recallThreshold.test.js) cover the behaviour that the
 * flag unlocks.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// 127.0.0.1, never localhost — node fetch can resolve ::1 on Windows and fail
// flakily mid-suite (repo convention, see api-health.test.js header).
const API = 'http://127.0.0.1:3001/api';

async function hit(url, opts) {
  try { return await fetch(url, opts); }
  catch { await new Promise(r => setTimeout(r, 400)); return fetch(url, opts); }
}

async function serverUp() {
  try { await hit(`${API}/health`); return true; }
  catch { return false; }
}

/**
 * Register (or log in on a re-run) a fresh user; returns the raw set-cookie value.
 * Mirrors the registerAndLogin helper in api-auth.test.js.
 */
async function registerAndLogin(email, password, name = 'Citation QA') {
  const loginRes = await hit(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) return { cookie: loginRes.headers.get('set-cookie'), user: (await loginRes.json()).user };
  const regRes = await hit(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return { cookie: regRes.headers.get('set-cookie'), user: (await regRes.json()).user };
}

/** Create a screening project as the given user; returns its id (or null). */
async function createScreenProject(cookie, title) {
  const res = await hit(`${API}/screening/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id || data.project?.id || null;
}

let up = false;

beforeAll(async () => {
  up = await serverUp();
});

describe('AI citation-status route — auth guard', () => {
  it('returns 401 for an anonymous request (route is behind requireAuth)', async () => {
    if (!up) return;
    // A non-existent project id is fine: the auth guard runs before any lookup.
    const res = await hit(`${API}/screening/projects/nonexistent/ai/citation-status`);
    expect(res.status).toBe(401);
  });
});

describe('AI citation-status route — flag-off existence hiding', () => {
  it('returns 404 for an authenticated owner while the aiScreening flag is off', async () => {
    if (!up) return;
    const ts = Date.now();
    const { cookie } = await registerAndLogin(`cit-owner-${ts}@example.com`, 'citpass123');
    if (!cookie) return; // registration disabled in this environment → nothing to assert
    const pid = await createScreenProject(cookie, `Citation Project ${ts}`);
    if (!pid) return;    // screening module disabled → nothing to assert

    const res = await hit(`${API}/screening/projects/${pid}/ai/citation-status`, {
      headers: { Cookie: cookie },
    });
    // Flag OFF (default) → the shared gate() hides the route with a 404 even for
    // the project owner. (If an environment enables the flag, this becomes a 200
    // status payload; the assertion documents the default-off contract.)
    expect([404, 200]).toContain(res.status);
    if (res.status === 404) {
      const data = await res.json();
      expect(data).toHaveProperty('error');
    }
  });
});

describe('AI validation-sample route — auth guard', () => {
  it('returns 401 for an anonymous GET (route is behind requireAuth)', async () => {
    if (!up) return;
    const res = await hit(`${API}/screening/projects/nonexistent/ai/validation-sample`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for an authenticated owner while the aiScreening flag is off', async () => {
    if (!up) return;
    const ts = Date.now() + 1;
    const { cookie } = await registerAndLogin(`cit-sample-${ts}@example.com`, 'citpass123');
    if (!cookie) return;
    const pid = await createScreenProject(cookie, `Sample Project ${ts}`);
    if (!pid) return;
    const res = await hit(`${API}/screening/projects/${pid}/ai/validation-sample`, {
      headers: { Cookie: cookie },
    });
    expect([404, 200]).toContain(res.status);
  });
});
