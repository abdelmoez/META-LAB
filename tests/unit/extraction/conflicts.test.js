/**
 * conflicts.test.js — double-extraction reconciliation (P5).
 * Covers: exact/tolerance/missing/mismatch kinds, unit mismatch, object subfields,
 * and the summary map with the `${elementId}::${armKey}` key format.
 */

import { describe, it, expect } from 'vitest';
import { compareValues, summarizeConflicts } from '../../../src/research-engine/extraction/conflicts.js';
import { mkElement, valueKey } from '../../../src/research-engine/extraction/model.js';

const numEl = mkElement({ name: 'N', type: 'numeric' }, () => 'N1');
const textEl = mkElement({ name: 'Design', type: 'text' }, () => 'T1');
const catEl = mkElement({ name: 'Country', type: 'categorical', allowedValues: ['USA', 'UK'] }, () => 'C1');
const unitEl = mkElement({ name: 'Age', type: 'numeric', unit: 'years' }, () => 'U1');
const dichEl = mkElement({ name: 'Events', type: 'dichotomous_outcome', armScope: 'arm' }, () => 'D1');

describe('compareValues — scalar', () => {
  it('both missing → agree/both_missing', () => {
    const r = compareValues(numEl, '', '');
    expect(r.agree).toBe(true);
    expect(r.kind).toBe('both_missing');
  });

  it('exact numeric match', () => {
    const r = compareValues(numEl, '123', '123');
    expect(r.agree).toBe(true);
    expect(r.kind).toBe('exact');
  });

  it('within relative tolerance (0.5% default)', () => {
    // 1000 vs 1004 → relΔ = 0.398% ≤ 0.5%
    const r = compareValues(numEl, '1000', '1004');
    expect(r.agree).toBe(true);
    expect(r.kind).toBe('within_tolerance');
  });

  it('just outside tolerance → numeric_mismatch', () => {
    // 1000 vs 1010 → relΔ = 0.99% > 0.5%
    const r = compareValues(numEl, '1000', '1010');
    expect(r.agree).toBe(false);
    expect(r.kind).toBe('numeric_mismatch');
  });

  it('tolerance boundary is inclusive', () => {
    // 200 vs 201 → relΔ = 0.4975% ≤ 0.5% (agree)
    expect(compareValues(numEl, '200', '201').agree).toBe(true);
    // 100 vs 101 → relΔ = 0.990% (disagree)
    expect(compareValues(numEl, '100', '101').agree).toBe(false);
  });

  it('missing vs present is always a conflict', () => {
    const r = compareValues(numEl, '', '5');
    expect(r.agree).toBe(false);
    expect(r.kind).toBe('missing_vs_present');
  });

  it('text compares normalized (trim/collapse/case)', () => {
    const r = compareValues(textEl, '  Parallel   RCT ', 'parallel rct');
    expect(r.agree).toBe(true);
    expect(r.kind).toBe('exact');
  });

  it('text mismatch', () => {
    const r = compareValues(textEl, 'RCT', 'Cohort');
    expect(r.agree).toBe(false);
    expect(r.kind).toBe('text_mismatch');
  });

  it('categorical mismatch is its own kind', () => {
    const r = compareValues(catEl, 'USA', 'UK');
    expect(r.agree).toBe(false);
    expect(r.kind).toBe('categorical_mismatch');
  });
});

describe('compareValues — units', () => {
  it('same magnitude, different unit → unit_mismatch (no conversion in v1)', () => {
    const r = compareValues(unitEl, { value: 55, unit: 'years' }, { value: 55, unit: 'months' });
    expect(r.agree).toBe(false);
    expect(r.kind).toBe('unit_mismatch');
  });
});

describe('compareValues — object (dichotomous) subfields', () => {
  it('agree when all present subfields agree', () => {
    const r = compareValues(dichEl, { events: 12, total: 45 }, { events: 12, total: 45 });
    expect(r.agree).toBe(true);
    expect(r.kind).toBe('exact');
    expect(r.fields.length).toBe(2);
  });

  it('conflict when a subfield differs numerically', () => {
    const r = compareValues(dichEl, { events: 12, total: 45 }, { events: 13, total: 45 });
    expect(r.agree).toBe(false);
    expect(r.kind).toBe('numeric_mismatch');
    expect(r.detail).toMatch(/events/);
  });

  it('missing-vs-present subfield surfaces as missing_vs_present', () => {
    const r = compareValues(dichEl, { events: 12, total: 45 }, { events: 12 });
    expect(r.agree).toBe(false);
    expect(r.kind).toBe('missing_vs_present');
  });

  it('both fully empty → both_missing', () => {
    const r = compareValues(dichEl, {}, {});
    expect(r.agree).toBe(true);
    expect(r.kind).toBe('both_missing');
  });
});

describe('summarizeConflicts', () => {
  const elements = [numEl, textEl, dichEl];

  it('computes total/agreements/agreementRate and lists conflicts with keys', () => {
    const A = {
      [valueKey('N1')]: '100',
      [valueKey('T1')]: 'RCT',
      [valueKey('D1', 'intervention')]: { events: 10, total: 50 },
      [valueKey('D1', 'comparator')]: { events: 5, total: 50 },
    };
    const B = {
      [valueKey('N1')]: '100',
      [valueKey('T1')]: 'Cohort', // conflict
      [valueKey('D1', 'intervention')]: { events: 10, total: 50 },
      [valueKey('D1', 'comparator')]: { events: 6, total: 50 }, // conflict
    };
    const s = summarizeConflicts(elements, A, B);
    // N (1) + T (1) + D over 2 arms (2) = 4 comparisons
    expect(s.total).toBe(4);
    expect(s.agreements).toBe(2);
    expect(s.conflicts.length).toBe(2);
    expect(s.agreementRate).toBeCloseTo(0.5, 10);
    const keys = s.conflicts.map((c) => `${c.elementId}::${c.armKey}`);
    expect(keys).toContain('T1::');
    expect(keys).toContain('D1::comparator');
  });

  it('agreementRate is 1 when there is nothing to compare', () => {
    const s = summarizeConflicts([], {}, {});
    expect(s.total).toBe(0);
    expect(s.agreementRate).toBe(1);
  });
});
