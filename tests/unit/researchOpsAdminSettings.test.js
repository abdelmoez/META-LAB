/**
 * 66.md P5/P6 — whitelist coercion for the new Ops settings. Pure functions from
 * researchOpsAdminController: junk keys dropped, numerics clamped, the
 * requireHumanValidation hard rule can never be disabled.
 */
import { describe, it, expect } from 'vitest';
import {
  coerceExtractionAiSettings,
  coerceLivingReviewSettings,
  EXTRACTION_AI_DEFAULTS,
  LIVING_DEFAULTS,
} from '../../server/controllers/researchOpsAdminController.js';

describe('coerceExtractionAiSettings', () => {
  it('accepts whitelisted fields and drops junk', () => {
    const out = coerceExtractionAiSettings(
      { enabled: false, provider: 'external', dualExtractionDefault: true, tableParsingEnabled: false, evil: 'x' },
      { ...EXTRACTION_AI_DEFAULTS },
    );
    expect(out.enabled).toBe(false);
    expect(out.provider).toBe('external');
    expect(out.dualExtractionDefault).toBe(true);
    expect(out.tableParsingEnabled).toBe(false);
    expect(out.evil).toBeUndefined();
  });

  it('rejects unknown providers', () => {
    const out = coerceExtractionAiSettings({ provider: 'skynet' }, { ...EXTRACTION_AI_DEFAULTS });
    expect(out.provider).toBe('heuristic');
  });

  it('requireHumanValidation is locked true — the hard product rule survives any patch', () => {
    const out = coerceExtractionAiSettings({ requireHumanValidation: false }, { ...EXTRACTION_AI_DEFAULTS });
    expect(out.requireHumanValidation).toBe(true);
  });
});

describe('coerceLivingReviewSettings', () => {
  it('clamps numeric quotas and thresholds', () => {
    const out = coerceLivingReviewSettings(
      { maxSavedSearchesPerProject: 9999, snapshotRetention: 1, evidenceShift: { relEffectChange: 99, i2Change: 1, minK: 100 } },
      { ...LIVING_DEFAULTS, evidenceShift: { ...LIVING_DEFAULTS.evidenceShift } },
    );
    expect(out.maxSavedSearchesPerProject).toBe(50);
    expect(out.snapshotRetention).toBe(5);
    expect(out.evidenceShift.relEffectChange).toBe(2);
    expect(out.evidenceShift.i2Change).toBe(5);
    expect(out.evidenceShift.minK).toBe(10);
  });

  it('filters cadences to the legal vocabulary and keeps defaults on an all-junk list', () => {
    const base = { ...LIVING_DEFAULTS, evidenceShift: { ...LIVING_DEFAULTS.evidenceShift } };
    const good = coerceLivingReviewSettings({ allowedCadences: ['daily', 'yearly'] }, base);
    expect(good.allowedCadences).toEqual(['daily']);
    const junk = coerceLivingReviewSettings({ allowedCadences: ['yearly'] }, base);
    expect(junk.allowedCadences).toEqual(LIVING_DEFAULTS.allowedCadences);
  });

  it('never mutates the passed-in current object', () => {
    const current = { ...LIVING_DEFAULTS, evidenceShift: { ...LIVING_DEFAULTS.evidenceShift } };
    coerceLivingReviewSettings({ schedulerEnabled: false, evidenceShift: { i2Change: 40 } }, current);
    expect(current.schedulerEnabled).toBe(true);
    expect(current.evidenceShift.i2Change).toBe(LIVING_DEFAULTS.evidenceShift.i2Change);
  });
});
