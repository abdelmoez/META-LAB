/**
 * maHandoff.test.js — reconciled values → study blob patch (P5).
 * Covers: string-typed patch fields, OR agreement with a hand-computed value,
 * continuous patch, zero-cell warning, and missing-data warnings (no fabricated es).
 */

import { describe, it, expect } from 'vitest';
import { consensusToStudyPatch } from '../../../src/research-engine/extraction/maHandoff.js';
import { mkElement, valueKey } from '../../../src/research-engine/extraction/model.js';
import { calcES } from '../../../src/research-engine/effect-sizes/calculators.js';

// Two arm-scoped dichotomous elements (the dichotomous_2x2 template shape uses one
// element per arm identified by name). We use a single arm-scoped element carrying
// per-arm values keyed by armKey — the more general path.
const dichEl = mkElement(
  { name: 'Mortality', type: 'dichotomous_outcome', armScope: 'arm', maCompatible: 'dichotomous', outcome: 'Mortality', timepoint: '12 months' },
  () => 'D1',
);

const contEl = mkElement(
  { name: 'Depression score', type: 'continuous_outcome', armScope: 'arm', maCompatible: 'continuous', outcome: 'Depression', timepoint: '8 weeks' },
  () => 'C1',
);

describe('dichotomous handoff', () => {
  // intervention: 10 events / 50 total; comparator: 5 events / 50 total
  const values = {
    [valueKey('D1', 'intervention')]: { events: 10, total: 50 },
    [valueKey('D1', 'comparator')]: { events: 5, total: 50 },
  };

  it('builds a string-typed a/b/c/d patch (no es without esType)', () => {
    const { patch, warnings } = consensusToStudyPatch([dichEl], values);
    expect(patch.a).toBe('10');
    expect(patch.b).toBe('40'); // 50 - 10
    expect(patch.c).toBe('5');
    expect(patch.d).toBe('45'); // 50 - 5
    // every numeric is a string
    ['a', 'b', 'c', 'd'].forEach((k) => expect(typeof patch[k]).toBe('string'));
    // no es/lo/hi unless requested
    expect(patch.es).toBeUndefined();
    expect(patch.lo).toBeUndefined();
    expect(patch.hi).toBeUndefined();
    // carries outcome/timepoint from the element def
    expect(patch.outcome).toBe('Mortality');
    expect(patch.timepoint).toBe('12 months');
    expect(warnings).toEqual([]);
  });

  it('computes OR/lo/hi via calcES that AGREE with a hand-computed value', () => {
    const { patch, esInputs } = consensusToStudyPatch([dichEl], values, { esType: 'OR' });
    // Hand-computed: OR = (10*45)/(40*5) = 2.25 → lnOR = 0.8109302162163288
    const expected = calcES('OR', { a: 10, b: 40, c: 5, d: 45 });
    expect(esInputs).toEqual({ a: 10, b: 40, c: 5, d: 45 });
    expect(Number(patch.es)).toBeCloseTo(0.8109302162163288, 12);
    expect(Number(patch.es)).toBeCloseTo(expected.es, 12);
    expect(Number(patch.lo)).toBeCloseTo(expected.lo, 12);
    expect(Number(patch.hi)).toBeCloseTo(expected.hi, 12);
    expect(patch.esType).toBe('OR');
    expect(patch.source).toBe('calculated');
    // all es fields are strings
    ['es', 'lo', 'hi'].forEach((k) => expect(typeof patch[k]).toBe('string'));
  });

  it('warns on a zero cell (continuity correction handled by calcES)', () => {
    const zeroVals = {
      [valueKey('D1', 'intervention')]: { events: 0, total: 50 },
      [valueKey('D1', 'comparator')]: { events: 5, total: 50 },
    };
    const { patch, warnings } = consensusToStudyPatch([dichEl], zeroVals, { esType: 'OR' });
    expect(patch.a).toBe('0');
    expect(warnings.join(' ')).toMatch(/zero cell/i);
    // calcES still returns a corrected estimate → es present
    expect(patch.es).toBeDefined();
  });

  it('warns and omits es when a denominator is missing', () => {
    const missingVals = {
      [valueKey('D1', 'intervention')]: { events: 10 }, // no total
      [valueKey('D1', 'comparator')]: { events: 5, total: 50 },
    };
    const { patch, warnings } = consensusToStudyPatch([dichEl], missingVals, { esType: 'OR' });
    expect(patch.a).toBeUndefined();
    expect(patch.es).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/denominator|missing/i);
  });
});

describe('continuous handoff', () => {
  const values = {
    [valueKey('C1', 'intervention')]: { mean: 12.3, sd: 4.5, n: 30 },
    [valueKey('C1', 'comparator')]: { mean: 15.1, sd: 5.0, n: 28 },
  };

  it('builds a string-typed continuous patch and computes MD', () => {
    const { patch, esInputs } = consensusToStudyPatch([contEl], values, { esType: 'MD' });
    expect(patch.nExp).toBe('30');
    expect(patch.meanExp).toBe('12.3');
    expect(patch.sdExp).toBe('4.5');
    expect(patch.nCtrl).toBe('28');
    expect(patch.meanCtrl).toBe('15.1');
    expect(patch.sdCtrl).toBe('5');
    expect(esInputs).toEqual({ m1: 12.3, sd1: 4.5, n1: 30, m2: 15.1, sd2: 5.0, n2: 28 });
    const expected = calcES('MD', { m1: 12.3, sd1: 4.5, n1: 30, m2: 15.1, sd2: 5.0, n2: 28 });
    expect(Number(patch.es)).toBeCloseTo(expected.es, 12); // 12.3 - 15.1 = -2.8
    expect(Number(patch.es)).toBeCloseTo(-2.8, 12);
    expect(patch.esType).toBe('MD');
  });

  it('warns on missing SD and does not fabricate es', () => {
    const missingSd = {
      [valueKey('C1', 'intervention')]: { mean: 12.3, n: 30 }, // no sd
      [valueKey('C1', 'comparator')]: { mean: 15.1, sd: 5.0, n: 28 },
    };
    const { patch, warnings } = consensusToStudyPatch([contEl], missingSd, { esType: 'MD' });
    expect(warnings.join(' ')).toMatch(/SD/i);
    expect(patch.es).toBeUndefined();
  });
});

describe('esType guarding', () => {
  const values = {
    [valueKey('D1', 'intervention')]: { events: 10, total: 50 },
    [valueKey('D1', 'comparator')]: { events: 5, total: 50 },
  };

  it('rejects a continuous esType for dichotomous data', () => {
    const { patch, warnings } = consensusToStudyPatch([dichEl], values, { esType: 'SMD' });
    expect(patch.es).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/not valid for dichotomous/i);
  });

  it('never writes es without an esType', () => {
    const { patch } = consensusToStudyPatch([dichEl], values);
    expect(patch.es).toBeUndefined();
    expect(patch.esType).toBeUndefined();
  });
});

describe('no MA-compatible element', () => {
  it('warns when nothing can be handed off', () => {
    const plainEl = mkElement({ name: 'Country', type: 'categorical' }, () => 'X1');
    const { patch, warnings } = consensusToStudyPatch([plainEl], {});
    expect(patch.a).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/no MA-compatible/i);
  });
});
