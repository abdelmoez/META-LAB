/**
 * analysisEligibility.test.js — 116.md §47/§50 (explain why analysis is unavailable).
 *
 * WHAT IS PINNED:
 *  1. Per-row classification: missing total / missing events / events > total /
 *     total = 0 / negative counts / effect-without-CI / nothing entered / excluded —
 *     most specific reason first, one reason per row.
 *  2. Eligibility is judged through the SAME poolable view runMeta uses: a raw-data
 *     PROP row with valid events/total is ELIGIBLE (116.md §41), not a reason.
 *  3. The exact §50 wording, singular and plural ("3 studies are missing total sample
 *     size.", "1 study has events greater than total.", "At least 2 eligible studies
 *     are required for pooling.").
 *  4. blocked-by-category-mix lines derive from the compatibility check's counts.
 */
import { describe, it, expect } from 'vitest';
import {
  pairEligibility, rowIneligibilityReason, eligibilityMessage,
  blockedByCompatibilityReasons, ELIGIBILITY_REASONS,
} from '../../../src/research-engine/statistics/analysisEligibility.js';
import { checkProportionCompatibility } from '../../../src/research-engine/statistics/proportionCompatibility.js';

const prop = (over = {}) => ({
  id: 'x', author: 'Smith', year: '2024', outcome: 'Yield', timepoint: '', esType: 'PROP',
  events: '18', total: '100', es: '', lo: '', hi: '',
  denominatorPopulation: '', denominatorCustom: '', actionStatus: '', ...over,
});

describe('rowIneligibilityReason — one specific reason per row', () => {
  it('a valid raw PROP row is eligible (null) — the §41 repair', () => {
    expect(rowIneligibilityReason(prop())).toBeNull();
    expect(rowIneligibilityReason(prop({ events: '0' }))).toBeNull();     // zero events is data
    expect(rowIneligibilityReason(prop({ events: '100' }))).toBeNull();   // all events is data
  });
  it('a stored es/lo/hi row is eligible regardless of raw cells', () => {
    expect(rowIneligibilityReason(prop({ es: '-0.4', lo: '-1', hi: '0.2', events: '', total: '' }))).toBeNull();
  });
  it('classifies the §47 invalid shapes', () => {
    expect(rowIneligibilityReason(prop({ total: '' }))).toBe('missingTotal');
    expect(rowIneligibilityReason(prop({ events: '' }))).toBe('missingEvents');
    expect(rowIneligibilityReason(prop({ events: '120' }))).toBe('eventsExceedTotal');
    expect(rowIneligibilityReason(prop({ total: '0' }))).toBe('zeroTotal');
    expect(rowIneligibilityReason(prop({ events: '-2' }))).toBe('negativeCounts');
    expect(rowIneligibilityReason(prop({ events: '', total: '' }))).toBe('noEffect');
    expect(rowIneligibilityReason(prop({ events: '', total: '', es: '0.18' }))).toBe('missingCI');
  });
  it('handles non-PROP rows and reviewer exclusions', () => {
    expect(rowIneligibilityReason({ esType: 'OR', es: '', lo: '', hi: '' })).toBe('noEffect');
    expect(rowIneligibilityReason({ esType: 'OR', es: '0.4', lo: '', hi: '' })).toBe('missingCI');
    expect(rowIneligibilityReason(prop({ extractionMeta: { includedInAnalysis: false } }))).toBe('excluded');
  });
});

describe('pairEligibility — counted, itemized reasons (§50)', () => {
  it('a poolable pair has no reasons and ok=true', () => {
    const v = pairEligibility([prop({ id: '1' }), prop({ id: '2', events: '25', total: '90' })]);
    expect(v.ok).toBe(true);
    expect(v.eligible).toBe(2);
    expect(v.reasons).toEqual([]);
  });

  it('itemizes each problem with its count, then the k<2 line', () => {
    const v = pairEligibility([
      prop({ id: '1', total: '' }), prop({ id: '2', total: '' }), prop({ id: '3', total: '' }),
      prop({ id: '4', events: '120' }),
      prop({ id: '5' }),                      // the single eligible study
    ]);
    expect(v.ok).toBe(false);
    expect(v.eligible).toBe(1);
    expect(v.reasons.map((r) => [r.code, r.count])).toEqual([
      ['eventsExceedTotal', 1],
      ['missingTotal', 3],
      ['needAtLeastTwo', 1],
    ]);
    expect(v.reasons.map((r) => r.message)).toEqual([
      '1 study has events greater than total.',
      '3 studies are missing total sample size.',
      'At least 2 eligible studies are required for pooling.',
    ]);
  });

  it('reason order is the pinned ELIGIBILITY_REASONS order', () => {
    expect(ELIGIBILITY_REASONS[ELIGIBILITY_REASONS.length - 1]).toBe('needAtLeastTwo');
    const v = pairEligibility([prop({ id: 'a', events: '' }), prop({ id: 'b', events: '120' })]);
    expect(v.reasons.map((r) => r.code)).toEqual(['eventsExceedTotal', 'missingEvents', 'needAtLeastTwo']);
  });

  it('exact singular/plural wording (§50 examples)', () => {
    expect(eligibilityMessage('missingTotal', 3)).toBe('3 studies are missing total sample size.');
    expect(eligibilityMessage('missingTotal', 1)).toBe('1 study is missing total sample size.');
    expect(eligibilityMessage('eventsExceedTotal', 1)).toBe('1 study has events greater than total.');
    expect(eligibilityMessage('zeroTotal', 2)).toBe('2 studies have a total sample size of 0.');
    expect(eligibilityMessage('missingCI', 1)).toBe('1 study has an effect size but no usable 95% confidence interval.');
    expect(eligibilityMessage('needAtLeastTwo', 0)).toBe('At least 2 eligible studies are required for pooling.');
  });
});

describe('blockedByCompatibilityReasons — the §50 line for a blocked pair', () => {
  it('names the incompatible field with the affected count', () => {
    const check = checkProportionCompatibility([
      prop({ id: '1', es: '-0.4', lo: '-1', hi: '0.2', denominatorPopulation: 'all_patients_tested' }),
      prop({ id: '2', es: '0.1', lo: '-0.5', hi: '0.7', denominatorPopulation: 'plp_molecular_diagnoses' }),
    ]);
    expect(check.blocking).toBe(true);
    const reasons = blockedByCompatibilityReasons(check);
    expect(reasons).toHaveLength(1);
    expect(reasons[0].message).toBe('2 studies use an incompatible denominator population.');
  });
  it('is empty when nothing blocks (warnings are not blocks)', () => {
    const check = checkProportionCompatibility([
      prop({ id: '1', denominatorPopulation: 'all_patients_tested' }),
      prop({ id: '2', events: '25', total: '90' }),
    ]);
    expect(check.blocking).toBe(false);
    expect(blockedByCompatibilityReasons(check)).toEqual([]);
    expect(blockedByCompatibilityReasons(null)).toEqual([]);
  });
});
