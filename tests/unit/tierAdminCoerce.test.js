/**
 * tierAdminCoerce.test.js — coerceEntitlementOverrides (67.md, admin edit path).
 *
 * Target: server/controllers/tierAdminController.js#coerceEntitlementOverrides,
 * the whitelist that sanitises an admin-supplied entitlement patch before it is
 * persisted as a tier's stored-override JSON. It must:
 *   - drop keys not in the registry;
 *   - reject a boolean key given a number (and vice versa for limit keys);
 *   - clamp negative limits to 0, but PRESERVE UNLIMITED (-1);
 *   - round fractional limits to an integer.
 *
 * This is a pure function (no DB) so it is unit-tested directly.
 */
import { describe, it, expect } from 'vitest';
import { coerceEntitlementOverrides } from '../../server/controllers/tierAdminController.js';
import { UNLIMITED } from '../../src/shared/entitlements.js';

describe('coerceEntitlementOverrides — key whitelist', () => {
  it('drops keys that are not in the entitlement registry', () => {
    const out = coerceEntitlementOverrides({
      'screening.aiScoring': true,   // valid boolean key
      'totally.bogus': true,         // junk
      'projects.maxActiveProjects': 5, // valid limit key
      '__proto__': { polluted: true }, // junk + prototype-y
    });
    expect(out).toEqual({ 'screening.aiScoring': true, 'projects.maxActiveProjects': 5 });
    expect(out['totally.bogus']).toBeUndefined();
  });

  it('returns an empty object for null / non-object / array input', () => {
    expect(coerceEntitlementOverrides(null)).toEqual({});
    expect(coerceEntitlementOverrides(undefined)).toEqual({});
    expect(coerceEntitlementOverrides('nope')).toEqual({});
    expect(coerceEntitlementOverrides(42)).toEqual({});
  });
});

describe('coerceEntitlementOverrides — type discipline', () => {
  it('a boolean key REJECTS a numeric value', () => {
    const out = coerceEntitlementOverrides({ 'screening.aiScoring': 1 });
    expect(out).toEqual({});
  });

  it('a boolean key accepts true and false', () => {
    expect(coerceEntitlementOverrides({ 'screening.aiScoring': true })).toEqual({ 'screening.aiScoring': true });
    expect(coerceEntitlementOverrides({ 'screening.aiScoring': false })).toEqual({ 'screening.aiScoring': false });
  });

  it('a limit key REJECTS a boolean value', () => {
    const out = coerceEntitlementOverrides({ 'projects.maxActiveProjects': true });
    expect(out).toEqual({});
  });

  it('a limit key REJECTS a non-finite number (NaN / Infinity)', () => {
    expect(coerceEntitlementOverrides({ 'projects.maxActiveProjects': NaN })).toEqual({});
    expect(coerceEntitlementOverrides({ 'projects.maxActiveProjects': Infinity })).toEqual({});
  });

  it('a limit key accepts a normal non-negative integer', () => {
    expect(coerceEntitlementOverrides({ 'projects.maxActiveProjects': 10 })).toEqual({ 'projects.maxActiveProjects': 10 });
    expect(coerceEntitlementOverrides({ 'screening.maxRecordsPerProject': 0 })).toEqual({ 'screening.maxRecordsPerProject': 0 });
  });
});

describe('coerceEntitlementOverrides — clamping + rounding', () => {
  it('clamps a negative limit (other than UNLIMITED) up to 0', () => {
    expect(coerceEntitlementOverrides({ 'projects.maxActiveProjects': -5 })).toEqual({ 'projects.maxActiveProjects': 0 });
  });

  it('PRESERVES UNLIMITED (-1) exactly — it is the sentinel, not a negative to clamp', () => {
    expect(coerceEntitlementOverrides({ 'projects.maxActiveProjects': UNLIMITED }))
      .toEqual({ 'projects.maxActiveProjects': -1 });
    expect(coerceEntitlementOverrides({ 'livingReview.maxSavedSearches': -1 }))
      .toEqual({ 'livingReview.maxSavedSearches': -1 });
  });

  it('rounds a fractional limit to the nearest integer', () => {
    expect(coerceEntitlementOverrides({ 'projects.maxActiveProjects': 3.2 })).toEqual({ 'projects.maxActiveProjects': 3 });
    expect(coerceEntitlementOverrides({ 'projects.maxActiveProjects': 3.7 })).toEqual({ 'projects.maxActiveProjects': 4 });
    expect(coerceEntitlementOverrides({ 'screening.maxRecordsPerProject': 999.5 })).toEqual({ 'screening.maxRecordsPerProject': 1000 });
  });

  it('a fractional negative (not -1) clamps to 0 after rounding', () => {
    // -0.4 rounds to -0, then Math.max(0, …) → 0.
    expect(coerceEntitlementOverrides({ 'projects.maxActiveProjects': -0.4 })).toEqual({ 'projects.maxActiveProjects': 0 });
  });

  it('coerces a whole patch, keeping only the valid, well-typed entries', () => {
    const out = coerceEntitlementOverrides({
      'screening.aiScoring': true,               // keep
      'screening.export': 'yes',                 // wrong type → drop
      'projects.maxActiveProjects': 12.9,        // round → 13
      'projects.maxMembersPerProject': -3,       // clamp → 0
      'livingReview.maxSavedSearches': UNLIMITED,// keep -1
      'metaAnalysis.nma': 1,                     // boolean key, numeric → drop
      'ghost.key': 999,                          // junk → drop
    });
    expect(out).toEqual({
      'screening.aiScoring': true,
      'projects.maxActiveProjects': 13,
      'projects.maxMembersPerProject': 0,
      'livingReview.maxSavedSearches': -1,
    });
  });
});
