/**
 * robSettings.test.js — prompt32 Task 12. The Ops RoB-engine settings coercion is
 * the trust boundary: it must clamp/validate every field to safe values so a bad
 * admin payload can never store junk that the RoB UI/engine then reads.
 */
import { describe, it, expect } from 'vitest';
import { coerceRobSettings, ROB_DEFAULTS } from '../../server/controllers/robAdminController.js';

describe('coerceRobSettings', () => {
  it('returns safe defaults for an empty/garbage payload', () => {
    expect(coerceRobSettings(undefined)).toEqual(ROB_DEFAULTS);
    expect(coerceRobSettings(null)).toEqual(ROB_DEFAULTS);
    expect(coerceRobSettings('nope')).toEqual(ROB_DEFAULTS);
  });
  it('clamps defaultRequiredReviewers to 1..5', () => {
    expect(coerceRobSettings({ defaultRequiredReviewers: 0 }).defaultRequiredReviewers).toBe(1);
    expect(coerceRobSettings({ defaultRequiredReviewers: 99 }).defaultRequiredReviewers).toBe(5);
    expect(coerceRobSettings({ defaultRequiredReviewers: 3 }).defaultRequiredReviewers).toBe(3);
  });
  it('only accepts pdf|article for defaultLeftTab', () => {
    expect(coerceRobSettings({ defaultLeftTab: 'article' }).defaultLeftTab).toBe('article');
    expect(coerceRobSettings({ defaultLeftTab: 'bogus' }).defaultLeftTab).toBe(ROB_DEFAULTS.defaultLeftTab);
  });
  it('keeps boolean toggles only when they are real booleans', () => {
    expect(coerceRobSettings({ showArticleInfoTab: false }).showArticleInfoTab).toBe(false);
    expect(coerceRobSettings({ showArticleInfoTab: 'false' }).showArticleInfoTab).toBe(true); // string ignored → default
  });
  it('merges the tools sub-object against defaults', () => {
    const out = coerceRobSettings({ tools: { robinsI: true, bogus: true } });
    expect(out.tools.robinsI).toBe(true);
    expect(out.tools.rob2).toBe(ROB_DEFAULTS.tools.rob2);
    expect(out.tools.bogus).toBeUndefined();
  });
});
