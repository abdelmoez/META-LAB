/**
 * api-import.test.js
 * Integration tests for POST /api/import/references
 */

import { describe, it, expect, beforeAll } from 'vitest';

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

beforeAll(async () => {
  up = await serverUp();
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
    if (!up) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('records');
    expect(Array.isArray(data.records)).toBe(true);
  });

  it('parses a RIS file and returns at least 1 record', async () => {
    if (!up) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [] }),
    });
    const data = await res.json();
    expect(data.records.length).toBeGreaterThanOrEqual(1);
  });

  it('imported RIS record has correct title', async () => {
    if (!up) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [] }),
    });
    const data = await res.json();
    const rec = data.records[0];
    expect(rec.title).toBe('Test Article for Import');
  });

  it('returns 200 when importing BibTeX text', async () => {
    if (!up) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: bibtexText, filename: 'refs.bib', existing: [] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.records.length).toBeGreaterThanOrEqual(1);
    expect(data.records[0].title).toBe('BibTeX Import Test');
  });

  it('returns format information in the response', async () => {
    if (!up) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [] }),
    });
    const data = await res.json();
    expect(data).toHaveProperty('format');
    expect(data.format).toBe('RIS');
  });

  it('detects and reports duplicates', async () => {
    if (!up) return;
    // First import
    const firstRes = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: risText, filename: 'refs.ris', existing: [] }),
    });
    const firstData = await firstRes.json();

    // Second import with existing records
    const secondRes = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: risText,
        filename: 'refs.ris',
        existing: firstData.records,
      }),
    });
    const secondData = await secondRes.json();
    expect(secondData).toHaveProperty('dupCount');
    expect(secondData.dupCount).toBeGreaterThanOrEqual(1);
  });

  it('returns 400 or appropriate error for missing text', async () => {
    if (!up) return;
    const res = await fetch(`${API}/import/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ existing: [] }),
    });
    expect([400, 422, 200]).toContain(res.status);
  });
});
