/**
 * entitlements.test.js — pure-engine tests for the product-tier model (67.md).
 *
 * Target: src/shared/entitlements.js. No network, no DB — this is the shared,
 * deterministic core that both the server (enforcement) and client (locked-state
 * UX) build on, so it earns thorough coverage:
 *   - resolveEntitlements merge order (free baseline ← tier defaults ← overrides)
 *     and junk-key / junk-type rejection;
 *   - every DEFAULT_TIER resolves to a value for EVERY registry key (a missing
 *     key must never silently unlock a feature);
 *   - hasEntitlement / limitOf (UNLIMITED→Infinity; missing→0, fail-closed);
 *   - withinLimit boundary behaviour;
 *   - requiredTierFor upgrade-path answers for the keys the team relies on;
 *   - tierDisplayName fallback + buildTierLimitError shape.
 */
import { describe, it, expect } from 'vitest';
import {
  UNLIMITED,
  ENTITLEMENT_KEYS,
  ENTITLEMENT_KEY_SET,
  entitlementMeta,
  DEFAULT_TIERS,
  DEFAULT_TIER_IDS,
  resolveEntitlements,
  hasEntitlement,
  limitOf,
  withinLimit,
  requiredTierFor,
  tierDisplayName,
  buildTierLimitError,
} from '../../src/shared/entitlements.js';

const FREE = DEFAULT_TIERS.find((t) => t.id === 'free').entitlements;

describe('registry invariants', () => {
  it('exposes UNLIMITED as -1', () => {
    expect(UNLIMITED).toBe(-1);
  });

  it('ENTITLEMENT_KEY_SET matches ENTITLEMENT_KEYS exactly', () => {
    expect(ENTITLEMENT_KEY_SET.size).toBe(ENTITLEMENT_KEYS.length);
    for (const e of ENTITLEMENT_KEYS) expect(ENTITLEMENT_KEY_SET.has(e.key)).toBe(true);
  });

  it('every registry entry declares a boolean|limit kind, a group and a label', () => {
    for (const e of ENTITLEMENT_KEYS) {
      expect(['boolean', 'limit']).toContain(e.kind);
      expect(typeof e.group).toBe('string');
      expect(e.group.length).toBeGreaterThan(0);
      expect(typeof e.label).toBe('string');
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it('entitlementMeta returns the row for a known key and null otherwise', () => {
    expect(entitlementMeta('screening.aiScoring')).toMatchObject({ key: 'screening.aiScoring', kind: 'boolean' });
    expect(entitlementMeta('projects.maxActiveProjects')).toMatchObject({ kind: 'limit' });
    expect(entitlementMeta('does.not.exist')).toBeNull();
  });

  it('DEFAULT_TIER_IDS is the ordered free→plus→pro upgrade path', () => {
    expect(DEFAULT_TIER_IDS).toEqual(['free', 'plus', 'pro']);
  });

  it('the free tier defines a value for EVERY registry key (it is the baseline)', () => {
    for (const { key } of ENTITLEMENT_KEYS) {
      expect(FREE, `free baseline must define ${key}`).toHaveProperty(key);
    }
  });
});

describe('resolveEntitlements — merge order + guarantees', () => {
  it('every DEFAULT_TIER resolves to a value for EVERY registry key', () => {
    for (const tier of DEFAULT_TIERS) {
      const ents = resolveEntitlements(tier.id);
      for (const { key } of ENTITLEMENT_KEYS) {
        expect(ents, `tier ${tier.id} must resolve ${key}`).toHaveProperty(key);
        expect(['boolean', 'number']).toContain(typeof ents[key]);
      }
    }
  });

  it('an unknown tier id still resolves the full free baseline (no undefineds)', () => {
    const ents = resolveEntitlements('no-such-tier');
    for (const { key } of ENTITLEMENT_KEYS) expect(ents).toHaveProperty(key);
    expect(ents).toEqual(FREE);
  });

  it('tier defaults override the free baseline (plus unlocks AI scoring)', () => {
    expect(FREE['screening.aiScoring']).toBe(false);
    expect(resolveEntitlements('plus')['screening.aiScoring']).toBe(true);
  });

  it('keys a tier does NOT override fall through to the free baseline', () => {
    // free defines projects.create=true; plus does not re-declare it → inherited.
    expect(DEFAULT_TIERS.find((t) => t.id === 'plus').entitlements['projects.create']).toBeUndefined();
    expect(resolveEntitlements('plus')['projects.create']).toBe(true);
  });

  it('stored overrides win over both baseline and tier defaults', () => {
    const ents = resolveEntitlements('free', { 'screening.aiScoring': true, 'projects.maxActiveProjects': 7 });
    expect(ents['screening.aiScoring']).toBe(true); // was false in free
    expect(ents['projects.maxActiveProjects']).toBe(7); // was 2 in free
  });

  it('an override may LOWER a higher tier’s grant (admin can tighten)', () => {
    const ents = resolveEntitlements('pro', { 'metaAnalysis.nma': false });
    expect(ents['metaAnalysis.nma']).toBe(false);
  });

  it('junk KEYS in the override map are ignored', () => {
    const ents = resolveEntitlements('free', { 'totally.bogus': true, 'another.fake': 999 });
    expect(ents).not.toHaveProperty('totally.bogus');
    expect(ents).not.toHaveProperty('another.fake');
    expect(ents).toEqual(FREE); // nothing changed
  });

  it('junk VALUE TYPES in the override map are ignored (string / NaN / null / object)', () => {
    const ents = resolveEntitlements('free', {
      'screening.aiScoring': 'yes',          // not a boolean → ignored
      'projects.maxActiveProjects': NaN,      // not finite → ignored
      'projects.maxMembersPerProject': null,  // not a number → ignored
      'screening.export': { on: true },       // object → ignored
    });
    expect(ents['screening.aiScoring']).toBe(false);
    expect(ents['projects.maxActiveProjects']).toBe(2);
    expect(ents['projects.maxMembersPerProject']).toBe(2);
    expect(ents['screening.export']).toBe(true);
  });

  it('a null / non-object overrides argument is a no-op', () => {
    expect(resolveEntitlements('free', null)).toEqual(FREE);
    expect(resolveEntitlements('free', undefined)).toEqual(FREE);
    expect(resolveEntitlements('free', 'nope')).toEqual(FREE);
    expect(resolveEntitlements('free', 42)).toEqual(FREE);
  });

  it('accepts UNLIMITED (-1) as a valid finite override value', () => {
    const ents = resolveEntitlements('free', { 'projects.maxActiveProjects': UNLIMITED });
    expect(ents['projects.maxActiveProjects']).toBe(UNLIMITED);
    expect(limitOf(ents, 'projects.maxActiveProjects')).toBe(Infinity);
  });

  it('does not mutate the shared free baseline object', () => {
    const before = { ...FREE };
    resolveEntitlements('free', { 'projects.maxActiveProjects': 99 });
    expect(FREE).toEqual(before);
  });
});

describe('hasEntitlement', () => {
  it('is true only for an exact boolean true', () => {
    const ents = resolveEntitlements('plus');
    expect(hasEntitlement(ents, 'screening.aiScoring')).toBe(true);
    expect(hasEntitlement(ents, 'metaAnalysis.nma')).toBe(false); // plus lacks NMA
  });

  it('a numeric or truthy-but-not-true value is NOT a grant (fail-closed)', () => {
    expect(hasEntitlement({ k: 1 }, 'k')).toBe(false);
    expect(hasEntitlement({ k: 'true' }, 'k')).toBe(false);
    expect(hasEntitlement({ k: {} }, 'k')).toBe(false);
  });

  it('a missing key or nullish map is false', () => {
    expect(hasEntitlement({}, 'anything')).toBe(false);
    expect(hasEntitlement(null, 'anything')).toBe(false);
    expect(hasEntitlement(undefined, 'anything')).toBe(false);
  });
});

describe('limitOf', () => {
  it('UNLIMITED resolves to Infinity', () => {
    expect(limitOf({ k: UNLIMITED }, 'k')).toBe(Infinity);
    expect(limitOf(resolveEntitlements('pro'), 'projects.maxActiveProjects')).toBe(Infinity);
  });

  it('a finite non-negative number passes through', () => {
    expect(limitOf({ k: 0 }, 'k')).toBe(0);
    expect(limitOf({ k: 25000 }, 'k')).toBe(25000);
  });

  it('missing / negative (non-UNLIMITED) / non-finite → 0 (fail-closed)', () => {
    expect(limitOf({}, 'k')).toBe(0);
    expect(limitOf({ k: -5 }, 'k')).toBe(0);       // negative but not -1
    expect(limitOf({ k: Infinity }, 'k')).toBe(0); // not finite
    expect(limitOf({ k: NaN }, 'k')).toBe(0);
    expect(limitOf(null, 'k')).toBe(0);
    expect(limitOf({ k: 'lots' }, 'k')).toBe(0);   // wrong type
  });
});

describe('withinLimit — boundaries', () => {
  const ents = { cap: 3, unlimited: UNLIMITED, missing_is_zero: undefined };

  it('value below and AT the cap is allowed; above is not', () => {
    expect(withinLimit(ents, 'cap', 2)).toBe(true);
    expect(withinLimit(ents, 'cap', 3)).toBe(true);  // boundary inclusive
    expect(withinLimit(ents, 'cap', 4)).toBe(false);
  });

  it('UNLIMITED admits any value', () => {
    expect(withinLimit(ents, 'unlimited', 1)).toBe(true);
    expect(withinLimit(ents, 'unlimited', 10_000_000)).toBe(true);
  });

  it('a missing limit key means cap 0 — only <= 0 fits', () => {
    expect(withinLimit(ents, 'missing_is_zero', 0)).toBe(true);
    expect(withinLimit(ents, 'missing_is_zero', 1)).toBe(false);
  });

  it('coerces the incoming value with Number()', () => {
    expect(withinLimit(ents, 'cap', '3')).toBe(true);
    expect(withinLimit(ents, 'cap', '4')).toBe(false);
  });
});

describe('requiredTierFor — the lowest default tier that satisfies a requirement', () => {
  it('boolean feature keys resolve to their first-granting tier', () => {
    expect(requiredTierFor('screening.aiScoring')).toBe('plus');
    expect(requiredTierFor('screening.validationMetrics')).toBe('plus');
    expect(requiredTierFor('extraction.aiAssist')).toBe('plus');
    expect(requiredTierFor('metaAnalysis.advanced')).toBe('plus');
    expect(requiredTierFor('manuscript.wordExport')).toBe('plus');
    expect(requiredTierFor('livingReview.enabled')).toBe('plus');
    expect(requiredTierFor('metaAnalysis.nma')).toBe('pro');
    expect(requiredTierFor('screening.benchmarkTools')).toBe('pro');
    expect(requiredTierFor('livingReview.scheduler')).toBe('pro');
  });

  it('a feature every tier already has resolves to free', () => {
    expect(requiredTierFor('projects.create')).toBe('free');
    expect(requiredTierFor('screening.import')).toBe('free');
    expect(requiredTierFor('extraction.manual')).toBe('free');
    expect(requiredTierFor('metaAnalysis.basic')).toBe('free');
    expect(requiredTierFor('manuscript.editor')).toBe('free');
  });

  it('an unknown boolean key satisfies at no tier → null', () => {
    expect(requiredTierFor('nope.not.real')).toBeNull();
  });

  it('a numeric limit resolves to the lowest tier whose cap admits the value', () => {
    // maxRecordsPerProject: free=1000, plus=25000, pro=250000.
    expect(requiredTierFor('screening.maxRecordsPerProject', 500)).toBe('free');
    expect(requiredTierFor('screening.maxRecordsPerProject', 1000)).toBe('free');   // boundary
    expect(requiredTierFor('screening.maxRecordsPerProject', 20000)).toBe('plus');
    expect(requiredTierFor('screening.maxRecordsPerProject', 100000)).toBe('pro');
    expect(requiredTierFor('screening.maxRecordsPerProject', 2000000)).toBeNull();  // beyond pro's cap
  });

  it('maxActiveProjects escalates and pro (UNLIMITED) absorbs huge values', () => {
    // free=2, plus=10, pro=UNLIMITED.
    expect(requiredTierFor('projects.maxActiveProjects', 2)).toBe('free');
    expect(requiredTierFor('projects.maxActiveProjects', 5)).toBe('plus');
    expect(requiredTierFor('projects.maxActiveProjects', 500)).toBe('pro'); // UNLIMITED
  });
});

describe('tierDisplayName', () => {
  it('maps default tier ids to their display names', () => {
    expect(tierDisplayName('free')).toBe('Free');
    expect(tierDisplayName('plus')).toBe('Plus');
    expect(tierDisplayName('pro')).toBe('Pro');
  });

  it('falls back to the id string for unknown / empty ids', () => {
    expect(tierDisplayName('enterprise')).toBe('enterprise');
    expect(tierDisplayName('')).toBe('');
    expect(tierDisplayName(null)).toBe('');
    expect(tierDisplayName(undefined)).toBe('');
  });
});

describe('buildTierLimitError — the structured 403 body contract', () => {
  it('produces the canonical shape with the given fields', () => {
    const body = buildTierLimitError({
      feature: 'metaAnalysis.nma',
      currentTier: 'free',
      requiredTier: 'pro',
      message: 'NMA is a Pro feature.',
    });
    expect(body).toEqual({
      error: 'TIER_LIMIT_EXCEEDED',
      feature: 'metaAnalysis.nma',
      currentTier: 'free',
      requiredTier: 'pro',
      message: 'NMA is a Pro feature.',
    });
  });

  it('nulls missing tier fields and supplies a default message', () => {
    const body = buildTierLimitError({ feature: 'x' });
    expect(body.error).toBe('TIER_LIMIT_EXCEEDED');
    expect(body.feature).toBe('x');
    expect(body.currentTier).toBeNull();
    expect(body.requiredTier).toBeNull();
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  });
});
