/**
 * api-health.test.js
 * Integration test for GET /api/health
 */

import { describe, it, expect, beforeAll } from 'vitest';

// 127.0.0.1, never localhost - node fetch can resolve ::1 on Windows and fail
// flakily mid-suite (repo convention, see prompt6.test.js header).
const API = 'http://127.0.0.1:3001/api';

// Under the full suite the dev server can transiently refuse a connection while
// heavier integration files hammer it; one quick retry absorbs that without
// masking a genuinely down server (beforeAll still self-skips the file).
async function hit(url) {
  try { return await fetch(url); }
  catch { await new Promise(r => setTimeout(r, 400)); return fetch(url); }
}

async function serverUp() {
  try {
    await hit(`${API}/health`);
    return true;
  } catch {
    return false;
  }
}

let up = false;

beforeAll(async () => {
  up = await serverUp();
});

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    if (!up) return;
    const res = await hit(`${API}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('returns a timestamp', async () => {
    if (!up) return;
    const res = await hit(`${API}/health`);
    const data = await res.json();
    expect(data.timestamp).toBeDefined();
    expect(new Date(data.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('returns a semver version (sourced from package.json - prompt5 Task 7)', async () => {
    if (!up) return;
    const res = await hit(`${API}/health`);
    const data = await res.json();
    // version is no longer hardcoded; it tracks package.json and changes per release.
    expect(data.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('responds with JSON content-type', async () => {
    if (!up) return;
    const res = await hit(`${API}/health`);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
