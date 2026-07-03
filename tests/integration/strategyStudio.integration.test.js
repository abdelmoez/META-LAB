/**
 * strategyStudio.integration.test.js — P11 (Guided Boolean search-strategy Studio)
 * flag + auth gates for the /api/search-builder/projects/:pid/... endpoints.
 *
 * The `searchStrategyStudio` flag (which additionally requires searchEngine +
 * pecanSearch) defaults OFF, so:
 *   - unauthenticated calls are rejected by requireAuth (401/403) BEFORE any flag/route
 *     resolution;
 *   - authenticated calls 404 while the studio is disabled (existence-hiding).
 *
 * Canonical harness pattern: self-skip when the dev server at 127.0.0.1:3001 is down
 * (never `localhost` — Windows ::1 flake). The deterministic generator↔critic loop is
 * covered DB-free in tests/unit/strategyStudio-loop.test.js, so the refinement logic
 * is verified even when this suite self-skips.
 *
 * Run serial (singleFork):
 *   npx vitest run tests/integration/strategyStudio.integration.test.js \
 *     --pool=forks --poolOptions.forks.singleFork=true
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

async function hit(path, opts = {}) {
  try { return await fetch(`${API}${path}`, opts); }
  catch { return fetch(`${API}${path}`, opts); } // one retry
}

let up = false;
let cookie = '';

beforeAll(async () => {
  try { const res = await hit('/health'); up = res.ok; } catch { up = false; }
  if (!up) return;
  const email = `studio-gate-${Date.now()}@example.com`;
  const reg = await hit('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Studio Gate', email, password: 'Str0ng!Passw0rd99' }),
  });
  if (reg.ok || reg.status === 201) {
    cookie = (reg.headers.get('set-cookie') || '').split(';')[0] || '';
  }
}, 30000);

const P = 'some-project';
const J = (extra = {}) => ({ headers: { 'Content-Type': 'application/json', ...extra } });

describe('P11 strategy Studio — auth gate (flag off / requireAuth)', () => {
  it('unauthenticated generate is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/projects/${P}/strategy/generate`, { method: 'POST', ...J(), body: '{}' });
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated optimize is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/projects/${P}/strategy/optimize`, { method: 'POST', ...J(), body: '{}' });
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated iterations is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/projects/${P}/strategy/iterations`);
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated seed-studies list is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/projects/${P}/seed-studies`);
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated seed-studies add is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/projects/${P}/seed-studies`, { method: 'POST', ...J(), body: '{}' });
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated seed-studies delete is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/projects/${P}/seed-studies/some-sid`, { method: 'DELETE' });
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated recall-estimate is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/projects/${P}/recall-estimate`, { method: 'POST', ...J(), body: '{}' });
    expect([401, 403]).toContain(res.status);
  });

  it('unauthenticated prisma-s is rejected (401/403)', async () => {
    if (!up) return;
    const res = await hit(`/search-builder/projects/${P}/strategy/prisma-s`);
    expect([401, 403]).toContain(res.status);
  });
});

describe('P11 strategy Studio — flag-off existence hiding (authenticated → 404)', () => {
  it('generate 404s while the studio flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/projects/${P}/strategy/generate`, { method: 'POST', ...J({ cookie }), body: JSON.stringify({ databases: ['pubmed'] }) });
    expect(res.status).toBe(404);
  });

  it('optimize 404s while the studio flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/projects/${P}/strategy/optimize`, { method: 'POST', ...J({ cookie }), body: '{}' });
    expect(res.status).toBe(404);
  });

  it('iterations 404s while the studio flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/projects/${P}/strategy/iterations`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('seed-studies list 404s while the studio flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/projects/${P}/seed-studies`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('seed-studies add 404s while the studio flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/projects/${P}/seed-studies`, { method: 'POST', ...J({ cookie }), body: JSON.stringify({ seeds: [{ pmid: '123' }] }) });
    expect(res.status).toBe(404);
  });

  it('seed-studies delete 404s while the studio flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/projects/${P}/seed-studies/some-sid`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('recall-estimate 404s while the studio flag is off', async () => {
    if (!up || !cookie) return;
    const res = await hit(`/search-builder/projects/${P}/recall-estimate`, { method: 'POST', ...J({ cookie }), body: JSON.stringify({ source: 'run', runId: 'x' }) });
    expect(res.status).toBe(404);
  });

  it('prisma-s 404s while the studio flag is off (json/csv/html)', async () => {
    if (!up || !cookie) return;
    for (const fmt of ['json', 'csv', 'html']) {
      const res = await hit(`/search-builder/projects/${P}/strategy/prisma-s?format=${fmt}`, { headers: { cookie } });
      expect(res.status).toBe(404);
    }
  });
});
