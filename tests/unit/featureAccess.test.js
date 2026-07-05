/**
 * featureAccess.test.js — 75.md Phase 7. Truth table for the central feature-flag
 * enforcement seam: on / adminOnly / off, the hard dependency graph, the admin-only
 * bypass (mods excluded), and the no-user (scheduler/worker) path.
 *
 * The pure decision is tested via the `flagsSnapshot` argument (no DB); the
 * express helpers (gateFeature / requireFeature) are tested with the flag reader
 * mocked so no server is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the canonical merged reader so gateFeature/requireFeature (which read it
// internally) are hermetic. The pure featureAccess() tests pass a snapshot and
// never hit this.
let MOCK_FLAGS = {};
vi.mock('../../server/controllers/settingsController.js', () => ({
  getEffectiveFeatureFlags: vi.fn(async () => MOCK_FLAGS),
}));

const {
  featureAccess, isFlagOn, isFlagAdmin, gateFeature, requireFeature,
  FEATURE_DEPS, FEATURE_RUNTIME_DEPS,
} = await import('../../server/services/featureAccess.js');

const ADMIN = { role: 'admin' };
const MOD = { role: 'mod' };
const USER = { role: 'user' };

beforeEach(() => { MOCK_FLAGS = {}; });

describe('isFlagAdmin — admin-only bypass (mods excluded)', () => {
  it('true only for role admin', () => {
    expect(isFlagAdmin(ADMIN)).toBe(true);
    expect(isFlagAdmin(MOD)).toBe(false);
    expect(isFlagAdmin(USER)).toBe(false);
    expect(isFlagAdmin(null)).toBe(false);
    expect(isFlagAdmin(undefined)).toBe(false);
    expect(isFlagAdmin({})).toBe(false);
  });
});

describe('isFlagOn — flag AND all (transitive) hard deps', () => {
  it('a dependency-free flag is on iff its own value is true', () => {
    expect(isFlagOn({ searchEngine: true }, 'searchEngine')).toBe(true);
    expect(isFlagOn({ searchEngine: false }, 'searchEngine')).toBe(false);
    expect(isFlagOn({}, 'searchEngine')).toBe(false);
  });

  it('pecanSearch requires searchEngine', () => {
    expect(isFlagOn({ pecanSearch: true, searchEngine: false }, 'pecanSearch')).toBe(false);
    expect(isFlagOn({ pecanSearch: true, searchEngine: true }, 'pecanSearch')).toBe(true);
    expect(isFlagOn({ pecanSearch: false, searchEngine: true }, 'pecanSearch')).toBe(false);
  });

  it('searchStrategyStudio requires searchEngine + pecanSearch (transitively)', () => {
    expect(isFlagOn({ searchStrategyStudio: true, searchEngine: true, pecanSearch: false }, 'searchStrategyStudio')).toBe(false);
    expect(isFlagOn({ searchStrategyStudio: true, searchEngine: false, pecanSearch: true }, 'searchStrategyStudio')).toBe(false);
    expect(isFlagOn({ searchStrategyStudio: true, searchEngine: true, pecanSearch: true }, 'searchStrategyStudio')).toBe(true);
  });

  it('guidedRobAppraisal requires rob_engine_v2; searchWorkspaceV2 requires searchEngine', () => {
    expect(isFlagOn({ guidedRobAppraisal: true, rob_engine_v2: false }, 'guidedRobAppraisal')).toBe(false);
    expect(isFlagOn({ guidedRobAppraisal: true, rob_engine_v2: true }, 'guidedRobAppraisal')).toBe(true);
    expect(isFlagOn({ searchWorkspaceV2: true, searchEngine: false }, 'searchWorkspaceV2')).toBe(false);
    expect(isFlagOn({ searchWorkspaceV2: true, searchEngine: true }, 'searchWorkspaceV2')).toBe(true);
  });

  it('livingReview is NOT hard-dependent on pecanSearch (runtime dep only)', () => {
    // 75.md — the Living Review existence gate stays livingReview-only; pecan is a
    // RUNTIME co-dependency, deliberately absent from FEATURE_DEPS.
    expect(FEATURE_DEPS.livingReview).toBeUndefined();
    expect(FEATURE_RUNTIME_DEPS.livingReview).toEqual(['pecanSearch']);
    expect(isFlagOn({ livingReview: true, pecanSearch: false }, 'livingReview')).toBe(true);
  });

  it('null/absent flags object is off, never throws', () => {
    expect(isFlagOn(null, 'searchEngine')).toBe(false);
    expect(isFlagOn(undefined, 'searchEngine')).toBe(false);
  });
});

describe('featureAccess — on / adminOnly / off (via flagsSnapshot, no DB)', () => {
  it('flag (and deps) ON → { allowed:true, reason:"on" } for everyone', async () => {
    const snap = { pecanSearch: true, searchEngine: true };
    expect(await featureAccess('pecanSearch', USER, snap)).toEqual({ allowed: true, reason: 'on' });
    expect(await featureAccess('pecanSearch', null, snap)).toEqual({ allowed: true, reason: 'on' });
    expect(await featureAccess('pecanSearch', ADMIN, snap)).toEqual({ allowed: true, reason: 'on' });
  });

  it('flag OFF + admin → { allowed:true, reason:"adminOnly" }', async () => {
    expect(await featureAccess('searchEngine', ADMIN, { searchEngine: false }))
      .toEqual({ allowed: true, reason: 'adminOnly' });
  });

  it('flag OFF + non-admin (user) → { allowed:false, reason:"off" }', async () => {
    expect(await featureAccess('searchEngine', USER, { searchEngine: false }))
      .toEqual({ allowed: false, reason: 'off' });
  });

  it('flag OFF + MOD → off (mods do NOT get the flag override)', async () => {
    expect(await featureAccess('searchEngine', MOD, { searchEngine: false }))
      .toEqual({ allowed: false, reason: 'off' });
  });

  it('flag OFF + no user (scheduler/worker) → off (no admin path)', async () => {
    expect(await featureAccess('searchEngine', null, { searchEngine: false }))
      .toEqual({ allowed: false, reason: 'off' });
  });

  it('dependency UNMET behaves like OFF: admin→adminOnly, non-admin→off', async () => {
    const snap = { pecanSearch: true, searchEngine: false }; // dep unmet
    expect(await featureAccess('pecanSearch', ADMIN, snap)).toEqual({ allowed: true, reason: 'adminOnly' });
    expect(await featureAccess('pecanSearch', USER, snap)).toEqual({ allowed: false, reason: 'off' });
    expect(await featureAccess('pecanSearch', null, snap)).toEqual({ allowed: false, reason: 'off' });
  });

  it('reads getEffectiveFeatureFlags when no snapshot is passed', async () => {
    MOCK_FLAGS = { searchEngine: true };
    expect(await featureAccess('searchEngine', USER)).toEqual({ allowed: true, reason: 'on' });
    MOCK_FLAGS = { searchEngine: false };
    expect(await featureAccess('searchEngine', USER)).toEqual({ allowed: false, reason: 'off' });
    expect(await featureAccess('searchEngine', ADMIN)).toEqual({ allowed: true, reason: 'adminOnly' });
  });
});

function mockRes() {
  return {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('gateFeature — express gate idiom (404 for non-admin OFF, admin passes)', () => {
  it('returns true when the flag is ON', async () => {
    MOCK_FLAGS = { searchEngine: true };
    const res = mockRes();
    expect(await gateFeature({ user: USER }, res, 'searchEngine')).toBe(true);
    expect(res.statusCode).toBe(0); // nothing sent
  });

  it('sends 404 and returns false for a non-admin when OFF', async () => {
    MOCK_FLAGS = { searchEngine: false };
    const res = mockRes();
    expect(await gateFeature({ user: USER }, res, 'searchEngine')).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('returns true (no 404) for an admin when OFF', async () => {
    MOCK_FLAGS = { searchEngine: false };
    const res = mockRes();
    expect(await gateFeature({ user: ADMIN }, res, 'searchEngine')).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it('treats a missing req.user as a no-user (non-admin) context → 404 when OFF', async () => {
    MOCK_FLAGS = { searchEngine: false };
    const res = mockRes();
    expect(await gateFeature({}, res, 'searchEngine')).toBe(false);
    expect(res.statusCode).toBe(404);
  });
});

describe('requireFeature — express middleware', () => {
  it('calls next() when ON', async () => {
    MOCK_FLAGS = { searchEngine: true };
    const res = mockRes();
    let called = false;
    await requireFeature('searchEngine')({ user: USER }, res, () => { called = true; });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it('404s (no next) for non-admin when OFF; admin calls next()', async () => {
    MOCK_FLAGS = { searchEngine: false };
    const res1 = mockRes();
    let called1 = false;
    await requireFeature('searchEngine')({ user: USER }, res1, () => { called1 = true; });
    expect(called1).toBe(false);
    expect(res1.statusCode).toBe(404);

    const res2 = mockRes();
    let called2 = false;
    await requireFeature('searchEngine')({ user: ADMIN }, res2, () => { called2 = true; });
    expect(called2).toBe(true);
    expect(res2.statusCode).toBe(0);
  });
});
