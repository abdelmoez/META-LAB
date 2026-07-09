/**
 * projectExportEntitlement.test.js — 79.md §3 project-export tier gate (pure parts).
 *
 * Covers the DETERMINISTIC pieces that do not need a DB:
 *   - the new `projects.export` entitlement key exists and resolves per tier
 *     (Free = false — the fixed requirement; Plus/Pro = true);
 *   - the monthly allowance key `exports.maxPerMonth` still resolves per tier;
 *   - projectExportGuard.currentPeriod() formats the UTC month correctly;
 *   - EXPORT_TYPES is the stable set the ledger uses;
 *   - coerceTierMeta whitelists/clamps the 79.md §2 business-metadata fields.
 */
import { describe, it, expect } from 'vitest';
import {
  ENTITLEMENT_KEY_SET, resolveEntitlements, hasEntitlement, limitOf, UNLIMITED,
} from '../../src/shared/entitlements.js';
import { currentPeriod, EXPORT_TYPES } from '../../server/services/projectExportGuard.js';
import { coerceTierMeta } from '../../server/controllers/tierAdminController.js';

describe('projects.export entitlement (79.md §3)', () => {
  it('is a registered entitlement key', () => {
    expect(ENTITLEMENT_KEY_SET.has('projects.export')).toBe(true);
  });

  it('FREE tier cannot export projects (the fixed requirement)', () => {
    const free = resolveEntitlements('free');
    expect(hasEntitlement(free, 'projects.export')).toBe(false);
  });

  it('PLUS and PRO tiers can export projects', () => {
    expect(hasEntitlement(resolveEntitlements('plus'), 'projects.export')).toBe(true);
    expect(hasEntitlement(resolveEntitlements('pro'), 'projects.export')).toBe(true);
  });

  it('the monthly export allowance resolves per tier (Pro unlimited)', () => {
    expect(limitOf(resolveEntitlements('free'), 'exports.maxPerMonth')).toBe(5);
    expect(limitOf(resolveEntitlements('plus'), 'exports.maxPerMonth')).toBe(50);
    expect(limitOf(resolveEntitlements('pro'), 'exports.maxPerMonth')).toBe(Infinity);
  });

  it('an admin override can grant a Free-derived tier project export', () => {
    const resolved = resolveEntitlements('free', { 'projects.export': true });
    expect(hasEntitlement(resolved, 'projects.export')).toBe(true);
  });
});

describe('projectExportGuard.currentPeriod', () => {
  it('formats a UTC YYYY-MM window', () => {
    expect(currentPeriod(new Date('2026-07-08T23:30:00Z'))).toBe('2026-07');
    expect(currentPeriod(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
    expect(currentPeriod(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });
  it('pads single-digit months', () => {
    expect(currentPeriod(new Date('2026-03-15T12:00:00Z'))).toBe('2026-03');
  });
});

describe('EXPORT_TYPES ledger vocabulary', () => {
  it('carries every project-export choke-point type', () => {
    expect(Object.values(EXPORT_TYPES).sort()).toEqual(
      ['journal_zip', 'pecan_report', 'project_json', 'rob_assessment', 'screening_records'],
    );
  });
});

describe('coerceTierMeta (79.md §2 plan/billing)', () => {
  it('keeps only present, well-typed fields', () => {
    const out = coerceTierMeta({
      isPaid: true, publiclyAvailable: false, manualAssignAllowed: true,
      priceMonthlyCents: 1999, priceAnnualCents: 19990, currency: 'EUR',
      trialDays: 14, gracePeriodDays: 7, junk: 'nope',
    });
    expect(out).toEqual({
      isPaid: true, publiclyAvailable: false, manualAssignAllowed: true,
      priceMonthlyCents: 1999, priceAnnualCents: 19990, currency: 'eur',
      trialDays: 14, gracePeriodDays: 7,
    });
    expect(out).not.toHaveProperty('junk');
  });

  it('clamps negatives, rounds, and clears a null price', () => {
    const out = coerceTierMeta({ priceMonthlyCents: -50, priceAnnualCents: null, trialDays: 4000.6, gracePeriodDays: -3 });
    expect(out.priceMonthlyCents).toBe(0);
    expect(out.priceAnnualCents).toBe(null);
    expect(out.trialDays).toBe(3650); // capped at 10 years
    expect(out.gracePeriodDays).toBe(0);
  });

  it('ignores wrong-typed booleans and returns {} for junk', () => {
    expect(coerceTierMeta({ isPaid: 'yes' })).toEqual({});
    expect(coerceTierMeta(null)).toEqual({});
    expect(coerceTierMeta(undefined)).toEqual({});
  });
});
