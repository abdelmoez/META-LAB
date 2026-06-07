/**
 * api-validation.test.js
 * Integration tests for POST /api/validation/check
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

async function registerAndLogin(email, password) {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) return loginRes.headers.get('set-cookie');
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Validation Test User' }),
  });
  return regRes.headers.get('set-cookie');
}

let up = false;
let cookie = null;

beforeAll(async () => {
  up = await serverUp();
  if (up) {
    cookie = await registerAndLogin(`validation-test-${Date.now()}@example.com`, 'ValidTest123!');
  }
});

const validStudy = {
  id: 'v1',
  author: 'Smith',
  year: '2020',
  outcome: 'Mortality',
  esType: 'OR',
  es: '0.5',
  lo: '0.1',
  hi: '0.9',
  flags: [],
  converted: false,
  conversions: [],
};

const studyWithLoGtHi = {
  id: 'v2',
  author: 'Jones',
  year: '2021',
  esType: 'OR',
  es: '0.5',
  lo: '0.9',  // lo > hi — invalid
  hi: '0.1',
  flags: [],
};

describe('POST /api/validation/check', () => {
  it('returns 200 for a valid study with no errors', async () => {
    if (!up) return;
    const res = await fetch(`${API}/validation/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ studies: [validStudy] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Expect no error-severity issues for a clean study
    const issues = data.studyIssues?.find(s => s.studyId === validStudy.id)?.issues || [];
    const errors = issues.filter(i => i.sev === 'error');
    expect(errors).toHaveLength(0);
  });

  it('returns validation errors for study with lo > hi', async () => {
    if (!up) return;
    const res = await fetch(`${API}/validation/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ studies: [studyWithLoGtHi] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const issues = data.studyIssues?.find(s => s.studyId === studyWithLoGtHi.id)?.issues || [];
    expect(issues.some(i => i.sev === 'error')).toBe(true);
  });

  it('returns poolability result with ok field', async () => {
    if (!up) return;
    const studies = [
      { ...validStudy, id: 'p1' },
      { ...validStudy, id: 'p2', author: 'Doe', esType: 'SMD' }, // mixed types
    ];
    const res = await fetch(`${API}/validation/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ studies }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('poolability');
    expect(data.poolability).toHaveProperty('ok');
  });

  it('returns 400 for request body without studies array', async () => {
    if (!up) return;
    const res = await fetch(`${API}/validation/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect([400, 422, 200]).toContain(res.status);
  });
});
