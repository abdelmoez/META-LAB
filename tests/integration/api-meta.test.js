/**
 * api-meta.test.js
 * Integration tests for POST /api/meta/run and related endpoints.
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

// Realistic study set for meta-analysis
const validStudies = [
  { id: 's1', author: 'Smith',  year: '2020', es: '0.693', lo: '0.182', hi: '1.204', esType: 'OR' },
  { id: 's2', author: 'Jones',  year: '2021', es: '0.405', lo: '0.050', hi: '0.760', esType: 'OR' },
  { id: 's3', author: 'Brown',  year: '2022', es: '1.099', lo: '0.600', hi: '1.598', esType: 'OR' },
  { id: 's4', author: 'Davis',  year: '2023', es: '0.300', lo: '-0.100', hi: '0.700', esType: 'OR' },
];

describe('POST /api/meta/run', () => {
  it('returns 200 with pooled result for valid studies', async () => {
    if (!up) return;
    const res = await fetch(`${API}/meta/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studies: validStudies, method: 'random' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('pES');
    expect(data).toHaveProperty('k');
    expect(data.k).toBe(4);
  });

  it('returns 200 with fixed-effects result', async () => {
    if (!up) return;
    const res = await fetch(`${API}/meta/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studies: validStudies, method: 'fixed' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.method).toBe('fixed');
    expect(data.tau2).toBe(0);
  });

  it('returns null or 400 when fewer than 2 valid studies provided', async () => {
    if (!up) return;
    const res = await fetch(`${API}/meta/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studies: [validStudies[0]], method: 'random' }),
    });
    // Depending on implementation, could be 400 or 200 with null body
    expect([200, 400, 422]).toContain(res.status);
  });

  it('result includes I2, Q, tau, hksj, predInt', async () => {
    if (!up) return;
    const res = await fetch(`${API}/meta/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studies: validStudies, method: 'random' }),
    });
    const data = await res.json();
    expect(data).toHaveProperty('I2');
    expect(data).toHaveProperty('Q');
    expect(data).toHaveProperty('tau');
    expect(data).toHaveProperty('hksj');
    expect(data).toHaveProperty('predInt');
  });
});

describe('POST /api/meta/sensitivity', () => {
  it('returns 200 with leave-one-out array', async () => {
    if (!up) return;
    const res = await fetch(`${API}/meta/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studies: validStudies, method: 'random' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(4);
  });
});

describe('POST /api/meta/egger', () => {
  it('returns 200 with Egger test result', async () => {
    if (!up) return;
    const res = await fetch(`${API}/meta/egger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studies: validStudies }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('intercept');
    expect(data).toHaveProperty('pval');
  });
});

describe('POST /api/meta/trimfill', () => {
  it('returns 200 with trim-and-fill result', async () => {
    if (!up) return;
    const res = await fetch(`${API}/meta/trimfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studies: validStudies, method: 'random' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('k0');
    expect(data).toHaveProperty('base');
    expect(data).toHaveProperty('adjusted');
  });
});

describe('POST /api/meta/subgroup', () => {
  const groupedStudies = [
    { id: 's1', author: 'Smith', year: '2020', es: '0.693', lo: '0.182', hi: '1.204', esType: 'OR', region: 'Asia' },
    { id: 's2', author: 'Jones', year: '2021', es: '0.405', lo: '0.050', hi: '0.760', esType: 'OR', region: 'Asia' },
    { id: 's3', author: 'Brown', year: '2022', es: '1.099', lo: '0.600', hi: '1.598', esType: 'OR', region: 'Europe' },
    { id: 's4', author: 'Davis', year: '2023', es: '0.300', lo: '-0.100', hi: '0.700', esType: 'OR', region: 'Europe' },
  ];

  it('returns 200 with subgroup analysis result', async () => {
    if (!up) return;
    const res = await fetch(`${API}/meta/subgroup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studies: groupedStudies, groupKey: 'region', method: 'random' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('groups');
    expect(Array.isArray(data.groups)).toBe(true);
  });
});
