/**
 * validationMetrics.test.js — extractor-vs-gold scoring (P5).
 * Covers: hand-checked precision/recall/exact/tolerance/missingness math, numeric
 * error fields, false-find and missed-by-ai flags.
 */

import { describe, it, expect } from 'vitest';
import { compareToGold } from '../../../src/research-engine/extraction/validationMetrics.js';

// Helper to build a suggestion / gold entry.
const sug = (elementId, value, extra = {}) => ({ elementId, armKey: '', value, notFound: false, ...extra });
const notFound = (elementId) => ({ elementId, notFound: true });
const gold = (elementId, value) => ({ elementId, armKey: '', value });

describe('compareToGold — basic field flags', () => {
  it('exact match on a scalar number', () => {
    const { fields } = compareToGold([sug('A', { value: 100 })], [gold('A', { value: 100 })]);
    expect(fields[0].exactMatch).toBe(true);
    expect(fields[0].withinTol).toBe(true);
    expect(fields[0].numericAbsError).toBe(0);
  });

  it('within-tolerance but not exact', () => {
    // 100 vs 100.5 → relErr 0.4975% ≤ 1% default tol
    const { fields } = compareToGold([sug('A', { value: 100 })], [gold('A', { value: 100.5 })]);
    expect(fields[0].exactMatch).toBe(false);
    expect(fields[0].withinTol).toBe(true);
    expect(fields[0].numericAbsError).toBeCloseTo(0.5, 10);
    expect(fields[0].numericRelError).toBeCloseTo(0.5 / 100.5, 10);
  });

  it('outside tolerance', () => {
    const { fields } = compareToGold([sug('A', { value: 100 })], [gold('A', { value: 120 })]);
    expect(fields[0].withinTol).toBe(false);
  });

  it('missedByAi when gold present but ai notFound', () => {
    const { fields } = compareToGold([notFound('A')], [gold('A', { value: 5 })]);
    expect(fields[0].missedByAi).toBe(true);
    expect(fields[0].falseFind).toBe(false);
  });

  it('falseFind when ai proposed but gold absent', () => {
    const { fields } = compareToGold([sug('A', { value: 5 })], []);
    expect(fields[0].falseFind).toBe(true);
    expect(fields[0].missedByAi).toBe(false);
  });
});

describe('compareToGold — summary math (hand-checked)', () => {
  // Design a small, fully hand-checkable scenario:
  //  A: exact match          (TP)
  //  B: within tol, not exact(TP)
  //  C: ai wrong (out of tol)(FP + FN)
  //  D: gold present, ai miss (FN)
  //  E: ai proposed, gold absent (FP)
  //  F: both absent           (missingness agreement, not counted in P/R)
  const suggestions = [
    sug('A', { value: 10 }),
    sug('B', { value: 100 }),      // gold 100.5 → within tol
    sug('C', { value: 200 }),      // gold 100 → out of tol
    notFound('D'),
    sug('E', { value: 7 }),        // no gold
    notFound('F'),
  ];
  const golds = [
    gold('A', { value: 10 }),
    gold('B', { value: 100.5 }),
    gold('C', { value: 100 }),
    gold('D', { value: 42 }),
    // E: absent
    // F: absent
  ];

  const { summary } = compareToGold(suggestions, golds);

  it('counts n as the joined field set', () => {
    // A,B,C,D,E,F = 6 keys
    expect(summary.n).toBe(6);
  });

  it('exactMatchRate over both-present fields', () => {
    // both present: A,B,C → exact only A → 1/3
    expect(summary.exactMatchRate).toBeCloseTo(1 / 3, 10);
  });

  it('withinTolRate over both-present fields', () => {
    // both present: A,B,C → within tol A,B → 2/3
    expect(summary.withinTolRate).toBeCloseTo(2 / 3, 10);
  });

  it('fieldPrecision = TP/(TP+FP)', () => {
    // TP = A,B (2). FP = C (proposed, not within tol) + E (gold absent) = 2. → 2/4
    expect(summary.fieldPrecision).toBeCloseTo(2 / 4, 10);
  });

  it('fieldRecall = TP/(TP+FN)', () => {
    // TP = A,B (2). FN = C (present, not within tol) + D (present, ai miss) = 2. → 2/4
    expect(summary.fieldRecall).toBeCloseTo(2 / 4, 10);
  });

  it('missingnessAccuracy counts both-directions agreement', () => {
    // silent+absent OR proposed+present agreement:
    //  A present+proposed ✓, B ✓, C ✓, D present+silent ✗, E absent+proposed ✗, F silent+absent ✓
    //  → 4 / 6
    expect(summary.missingnessAccuracy).toBeCloseTo(4 / 6, 10);
  });
});

describe('compareToGold — object (dichotomous) values', () => {
  it('exact subfield match counts as exact + within tol', () => {
    const { fields, summary } = compareToGold(
      [sug('A', { events: 12, total: 45 })],
      [gold('A', { events: 12, total: 45 })],
    );
    expect(fields[0].exactMatch).toBe(true);
    expect(fields[0].withinTol).toBe(true);
    expect(summary.fieldPrecision).toBe(1);
    expect(summary.fieldRecall).toBe(1);
  });

  it('a differing subfield fails exact and tolerance', () => {
    const { fields } = compareToGold(
      [sug('A', { events: 12, total: 45 })],
      [gold('A', { events: 20, total: 45 })],
    );
    expect(fields[0].exactMatch).toBe(false);
    expect(fields[0].withinTol).toBe(false);
  });
});

describe('compareToGold — empty inputs', () => {
  it('empty everything yields zero rates, not NaN', () => {
    const { summary } = compareToGold([], []);
    expect(summary.n).toBe(0);
    expect(summary.exactMatchRate).toBe(0);
    expect(summary.fieldPrecision).toBe(0);
    expect(summary.fieldRecall).toBe(0);
    expect(summary.missingnessAccuracy).toBe(0);
  });
});
