/**
 * api-health.test.js
 * Integration test for GET /api/health
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

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    if (!up) return;
    const res = await fetch(`${API}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('returns a timestamp', async () => {
    if (!up) return;
    const res = await fetch(`${API}/health`);
    const data = await res.json();
    expect(data.timestamp).toBeDefined();
    expect(new Date(data.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('returns version "2.0.0"', async () => {
    if (!up) return;
    const res = await fetch(`${API}/health`);
    const data = await res.json();
    expect(data.version).toBe('2.0.0');
  });

  it('responds with JSON content-type', async () => {
    if (!up) return;
    const res = await fetch(`${API}/health`);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
