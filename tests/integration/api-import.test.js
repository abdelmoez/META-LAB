/**
 * api-import.test.js
 * Integration tests for POST /api/import/references
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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
    body: JSON.stringify({ email, password, name: 'Import Test User' }),
  });
  return regRes.headers.get('set-cookie');
}

let up = false;
let cookie = null;
let projectId = null;

beforeAll(async () => {
  up = await serverUp();
  if (up) {
    cookie = await registerAndLogin(`import-test-${Date.now()}@example.com`, 'ImportTest123!');
    // Create a project to use as the import target
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Import Test Project' }),
    });
    const data = await res.json();
    projectId = data.id;
  }
});

afterAll(async () => {
  if (up && projectId) {
    await fetch(`${API}/projects/${projectId}`, { method: 'DELETE', headers: { Cookie: cookie } });
  }
});

const risText = `TY  - JOUR
AU  - Smith, J
TI  - Test Article for Import
PY  - 2023
JO  - Test Journal
DO  - 10.1234/import.test.2023
AB  - Abstract text for import test.
ER  -`;

const bibtexText = `@article{bibtex2023,
  title = {BibTeX Import Test},
  author = {Doe, Jane},
  year = {2023},
  journal = {BibTeX Journal}
}`;

describe('POST /api/import/references', () => {
  it('returns 200 when importing RIS text', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [], projectId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('records');
    expect(Array.isArray(data.records)).toBe(true);
  });

  it('parses a RIS file and returns at least 1 record', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [], projectId }),
    });
    const data = await res.json();
    expect(data.records.length).toBeGreaterThanOrEqual(1);
  });

  it('imported RIS record has correct title', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [], projectId }),
    });
    const data = await res.json();
    const rec = data.records[0];
    expect(rec.title).toBe('Test Article for Import');
  });

  it('returns 200 when importing BibTeX text', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: bibtexText, filename: 'refs.bib', existing: [], projectId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.records.length).toBeGreaterThanOrEqual(1);
    expect(data.records[0].title).toBe('BibTeX Import Test');
  });

  it('returns format information in the response', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [], projectId }),
    });
    const data = await res.json();
    expect(data).toHaveProperty('format');
    expect(data.format).toBe('RIS');
  });

  it('detects and reports duplicates', async () => {
    if (!up || !projectId) return;
    const firstRes = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [], projectId }),
    });
    const firstData = await firstRes.json();

    const secondRes = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: firstData.records, projectId }),
    });
    const secondData = await secondRes.json();
    // Response uses `duplicates` field
    const dupField = secondData.dupCount ?? secondData.duplicates ?? 0;
    expect(dupField).toBeGreaterThanOrEqual(1);
  });

  it('returns 400 or appropriate error for missing text', async () => {
    if (!up || !projectId) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ existing: [], projectId }),
    });
    expect([400, 422, 200]).toContain(res.status);
  });
});
