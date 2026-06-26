/**
 * controller.test.js — /api/nma controller integration (flag gate + validation +
 * run path) against the REAL engine. Only the feature-flag accessor is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let flagValue = true;
vi.mock('../../../server/controllers/settingsController.js', () => ({
  getEffectiveFeatureFlags: vi.fn(async () => ({ networkMetaAnalysis: flagValue })),
}));

const { nmaValidate, nmaRun } = await import('../../../server/controllers/nmaController.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const DATASET = {
  sm: 'OR', smallerBetter: true,
  studies: [
    { id: 's1', arms: [{ treatment: 'Placebo', events: 12, n: 100 }, { treatment: 'A', events: 8, n: 100 }] },
    { id: 's2', arms: [{ treatment: 'Placebo', events: 20, n: 150 }, { treatment: 'B', events: 12, n: 150 }] },
    { id: 's3', arms: [{ treatment: 'A', events: 9, n: 120 }, { treatment: 'B', events: 7, n: 120 }] },
  ],
};

describe('/api/nma controller', () => {
  beforeEach(() => { flagValue = true; });

  it('404s when the feature flag is OFF', async () => {
    flagValue = false;
    const res = mockRes();
    await nmaRun({ body: { dataset: DATASET } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('400s on an unsupported effect measure', async () => {
    const res = mockRes();
    await nmaRun({ body: { dataset: { ...DATASET, sm: 'XYZ' } } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('400s on empty studies', async () => {
    const res = mockRes();
    await nmaRun({ body: { dataset: { sm: 'OR', studies: [] } } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('runs a valid 3-treatment network and returns a full result', async () => {
    const res = mockRes();
    await nmaRun({ body: { dataset: DATASET, model: 'random' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.treatments.sort()).toEqual(['A', 'B', 'Placebo']);
    expect(res.body.league).toBeTruthy();
    expect(res.body.ranking.length).toBe(3);
    expect(res.body.provenance.engineVersion).toBeTruthy();
  });

  it('validate endpoint returns readiness', async () => {
    const res = mockRes();
    await nmaValidate({ body: { dataset: DATASET } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.treatments.length).toBe(3);
  });

  it('422s when the network is a single treatment (not analysable)', async () => {
    const res = mockRes();
    await nmaRun({ body: { dataset: { sm: 'OR', studies: [{ id: 'x', arms: [{ treatment: 'A', events: 5, n: 50 }, { treatment: 'A', events: 6, n: 50 }] }] } } }, res);
    expect([400, 422]).toContain(res.statusCode);
  });
});
