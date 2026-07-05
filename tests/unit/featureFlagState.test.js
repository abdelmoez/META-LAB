/**
 * featureFlagState.test.js — 75.md Phase 7 (client). Truth table for the browser
 * mirror of server featureAccess: 'on' / 'adminOnly' / 'off', the dependency graph,
 * and the admin-only (mods-excluded) awareness. Hermetic: global fetch is stubbed,
 * the short-lived snapshot cache is cleared between cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  featureFlagState, featureFlagEnabled, isFlagOn, isFlagAdmin,
  FEATURE_DEPS, FEATURE_RUNTIME_DEPS, clearFeatureFlagCache,
} from '../../src/frontend/featureAccess/featureFlagState.js';

const ADMIN = { role: 'admin' };
const MOD = { role: 'mod' };
const USER = { role: 'user' };

function stubFlags(featureFlags) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ featureFlags }),
  })));
}

beforeEach(() => { clearFeatureFlagCache(); });
afterEach(() => { vi.unstubAllGlobals(); clearFeatureFlagCache(); });

describe('isFlagAdmin / isFlagOn (pure, shared with server logic)', () => {
  it('isFlagAdmin: admin only, mods excluded', () => {
    expect(isFlagAdmin(ADMIN)).toBe(true);
    expect(isFlagAdmin(MOD)).toBe(false);
    expect(isFlagAdmin(USER)).toBe(false);
    expect(isFlagAdmin(null)).toBe(false);
  });

  it('isFlagOn honours the transitive dependency graph', () => {
    expect(isFlagOn({ pecanSearch: true, searchEngine: false }, 'pecanSearch')).toBe(false);
    expect(isFlagOn({ pecanSearch: true, searchEngine: true }, 'pecanSearch')).toBe(true);
    expect(isFlagOn({ searchStrategyStudio: true, searchEngine: true, pecanSearch: true }, 'searchStrategyStudio')).toBe(true);
    expect(isFlagOn({ searchStrategyStudio: true, searchEngine: false, pecanSearch: true }, 'searchStrategyStudio')).toBe(false);
  });

  it('client dep tables mirror the server (livingReview runtime-only)', () => {
    expect(FEATURE_DEPS.pecanSearch).toEqual(['searchEngine']);
    expect(FEATURE_DEPS.livingReview).toBeUndefined();
    expect(FEATURE_RUNTIME_DEPS.livingReview).toEqual(['pecanSearch']);
  });
});

describe('featureFlagState — on / adminOnly / off', () => {
  it("returns 'on' for everyone when the flag (and deps) are enabled", async () => {
    stubFlags({ searchEngine: true });
    expect(await featureFlagState('searchEngine', USER)).toBe('on');
    expect(await featureFlagState('searchEngine', null)).toBe('on');
    expect(await featureFlagState('searchEngine', ADMIN)).toBe('on');
  });

  it("returns 'adminOnly' for an admin when the flag is off", async () => {
    stubFlags({ searchEngine: false });
    expect(await featureFlagState('searchEngine', ADMIN)).toBe('adminOnly');
  });

  it("returns 'off' for a non-admin (and for a mod) when the flag is off", async () => {
    stubFlags({ searchEngine: false });
    expect(await featureFlagState('searchEngine', USER)).toBe('off');
    expect(await featureFlagState('searchEngine', MOD)).toBe('off');
    expect(await featureFlagState('searchEngine', null)).toBe('off');
  });

  it("dependency unmet reads as off (admin → 'adminOnly', others → 'off')", async () => {
    stubFlags({ pecanSearch: true, searchEngine: false });
    expect(await featureFlagState('pecanSearch', ADMIN)).toBe('adminOnly');
    expect(await featureFlagState('pecanSearch', USER)).toBe('off');
  });

  it('fails closed to off for non-admins when the fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await featureFlagState('searchEngine', USER)).toBe('off');
    expect(await featureFlagState('searchEngine', ADMIN)).toBe('adminOnly');
  });
});

describe('featureFlagEnabled — boolean shim keeps existing helpers working', () => {
  it("strict 'on' for a null user (legacy boolean-flag behaviour)", async () => {
    stubFlags({ searchEngine: false });
    expect(await featureFlagEnabled('searchEngine', null)).toBe(false);
    clearFeatureFlagCache();
    stubFlags({ searchEngine: true });
    expect(await featureFlagEnabled('searchEngine', null)).toBe(true);
  });

  it('an admin gets true while a feature is globally OFF (surface keeps working)', async () => {
    stubFlags({ searchEngine: false });
    expect(await featureFlagEnabled('searchEngine', ADMIN)).toBe(true);
    expect(await featureFlagEnabled('searchEngine', USER)).toBe(false);
  });
});
