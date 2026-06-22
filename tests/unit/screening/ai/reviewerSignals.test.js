/**
 * reviewerSignals.test.js — the FOUR separate concepts (relevance stays external;
 * quality / confidence / prioritisation derived here), multi-reviewer integrity,
 * and blind-mode suppression (prompt49 item 1).
 */
import { describe, it, expect } from 'vitest';
import { aggregateReviewerSignals, prioritizationScore, normalizeRating } from '../../../../src/research-engine/screening/ai/reviewerSignals.js';

describe('normalizeRating', () => {
  it('maps 1–5 to [0,1] and clamps; null for missing/invalid', () => {
    expect(normalizeRating(1)).toBe(0);
    expect(normalizeRating(5)).toBe(1);
    expect(normalizeRating(3)).toBe(0.5);
    expect(normalizeRating(99)).toBe(1);       // clamp
    expect(normalizeRating(null)).toBeNull();
    expect(normalizeRating('x')).toBeNull();
  });
});

describe('aggregateReviewerSignals — quality (separate axis)', () => {
  it('averages reviewer ratings into methodologicalQuality with provenance', () => {
    const r = aggregateReviewerSignals([
      { reviewerId: 'a', decision: 'include', rating: 5, notes: '' },
      { reviewerId: 'b', decision: 'include', rating: 3, notes: '' },
    ]);
    expect(r.methodologicalQuality).toBeCloseTo(0.75); // mean(1.0, 0.5)
    expect(r.qualityN).toBe(2);
    expect(r.byReviewer).toHaveLength(2);
  });

  it('works when NO ratings exist (quality null) and is still valid', () => {
    const r = aggregateReviewerSignals([{ reviewerId: 'a', decision: 'include', rating: null, notes: 'relevant' }]);
    expect(r.methodologicalQuality).toBeNull();
    expect(r.hasSignals).toBe(true);
  });
});

describe('aggregateReviewerSignals — confidence + conflict', () => {
  it('high agreement → high confidence', () => {
    const r = aggregateReviewerSignals([
      { reviewerId: 'a', decision: 'include' }, { reviewerId: 'b', decision: 'include' },
    ]);
    expect(r.agreement).toBe(1);
    expect(r.conflict).toBe(false);
    expect(r.reviewerConfidence).toBe(1);
  });

  it('disagreement → conflict flag + lower confidence, never flattened', () => {
    const r = aggregateReviewerSignals([
      { reviewerId: 'a', decision: 'include', notes: 'eligible' },
      { reviewerId: 'b', decision: 'exclude', notes: 'wrong outcome' },
    ]);
    expect(r.conflict).toBe(true);
    expect(r.reviewerConfidence).toBeLessThan(1);
    expect(r.factors.some((f) => /disagree/i.test(f.text))).toBe(true);
    expect(r.byReviewer.map((x) => x.decision).sort()).toEqual(['exclude', 'include']);
  });

  it('uncertainty in a note dampens confidence', () => {
    const sure = aggregateReviewerSignals([{ reviewerId: 'a', decision: 'include' }, { reviewerId: 'b', decision: 'include' }]);
    const unsure = aggregateReviewerSignals([{ reviewerId: 'a', decision: 'include', notes: 'not sure, needs full text' }, { reviewerId: 'b', decision: 'include' }]);
    expect(unsure.reviewerConfidence).toBeLessThan(sure.reviewerConfidence);
  });
});

describe('aggregateReviewerSignals — blind-mode suppression', () => {
  it('reveal:false returns a suppressed stub with NO reviewer-derived data', () => {
    const r = aggregateReviewerSignals([{ reviewerId: 'a', decision: 'include', rating: 5, notes: 'eligible' }], { reveal: false });
    expect(r.suppressed).toBe(true);
    expect(r.hasSignals).toBe(false);
    expect(r.methodologicalQuality).toBeNull();
    expect(r.reviewerConfidence).toBeNull();
    expect(r.factors).toEqual([]);
    expect(r.byReviewer).toBeUndefined();
  });
});

describe('prioritizationScore — quality NEVER overwhelms eligibility', () => {
  it('nudges by at most ±0.05 and is clamped to [0,1]', () => {
    const hiQ = aggregateReviewerSignals([{ reviewerId: 'a', rating: 5, decision: 'include' }]);
    const loQ = aggregateReviewerSignals([{ reviewerId: 'a', rating: 1, decision: 'include' }]);
    expect(prioritizationScore(0.5, hiQ)).toBeCloseTo(0.55);
    expect(prioritizationScore(0.5, loQ)).toBeCloseTo(0.45);
    // bounded at the extremes
    expect(prioritizationScore(0.99, hiQ)).toBeLessThanOrEqual(1);
    expect(prioritizationScore(0.01, loQ)).toBeGreaterThanOrEqual(0);
    // a high-quality but low-relevance record cannot be lifted into "include" range
    expect(prioritizationScore(0.1, hiQ)).toBeLessThan(0.2);
  });

  it('returns relevance unchanged when there is no quality signal', () => {
    const noQ = aggregateReviewerSignals([{ reviewerId: 'a', decision: 'include', notes: 'eligible' }]);
    expect(prioritizationScore(0.42, noQ)).toBeCloseTo(0.42);
    expect(prioritizationScore(0.42, null)).toBeCloseTo(0.42);
  });
});
