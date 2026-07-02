/**
 * recallThreshold.test.js — recall-targeted operating point (66.md P4.5).
 *
 * Screening is recall-first: instead of a balanced 0.5 cut, recallTargetedThreshold
 * picks the HIGHEST score threshold whose recall on the supplied (score,label) pairs
 * is >= targetRecall. Every case below is hand-computed and the expected math is
 * spelled out in comments so a methods section can cite it verbatim.
 */
import { describe, it, expect } from 'vitest';
import { recallTargetedThreshold, computeValidation } from '../../../../src/research-engine/screening/ai/validation.js';

describe('recallTargetedThreshold — perfect ranking', () => {
  it('places the threshold at the lowest positive score with achievedRecall 1', () => {
    // 3 positives all above 3 negatives. target 0.95 → needed = ceil(0.95*3) = 3.
    // Scanning descending: 0.9(+1), 0.8(+1), 0.7(+1) → found=3 at score 0.7.
    const scores = [0.9, 0.8, 0.7, 0.3, 0.2, 0.1];
    const labels = [1, 1, 1, 0, 0, 0];
    const op = recallTargetedThreshold(scores, labels, { targetRecall: 0.95, minLabels: 1, minPositives: 1 });
    expect(op.threshold).toBeCloseTo(0.7, 6);       // lowest positive score
    expect(op.achievedRecall).toBeCloseTo(1, 6);
    // confusion at t=0.7: pred=include for scores >= 0.7 → 3 positives, 0 negatives.
    // tp=3, fp=0, tn=3, fn=0. specificity = tn/(tn+fp) = 3/3 = 1.
    expect(op.specificity).toBeCloseTo(1, 6);
    expect(op.precision).toBeCloseTo(1, 6);          // 3/(3+0)
    // screenedFraction = (tp+fp)/n = 3/6 = 0.5
    expect(op.screenedFraction).toBeCloseTo(0.5, 6);
    // workSavedFraction = (tn+fn)/n - (1 - 0.95) = 3/6 - 0.05 = 0.45
    expect(op.workSavedFraction).toBeCloseTo(0.45, 6);
    expect(op.n).toBe(6);
    expect(op.nPos).toBe(3);
  });
});

describe('recallTargetedThreshold — mixed ranking forcing a threshold below some negatives', () => {
  it('computes specificity and workSaved by hand for a 95% target that admits negatives', () => {
    // 10 records, 4 positives. Ranking is imperfect: one positive sits low, so
    // hitting 95% recall (needed = ceil(0.95*4) = 4 → ALL positives) drags the
    // threshold down past two negatives.
    //
    // score:  0.90 0.80 0.70 0.60 0.50 0.40 0.35 0.30 0.20 0.10
    // label:   1    0    1    1    0    0    1    0    0    0
    //
    // Descending scan for needed=4 positives:
    //   0.90(+1)=1, 0.80(+0)=1, 0.70(+1)=2, 0.60(+1)=3, 0.50(+0)=3,
    //   0.40(+0)=3, 0.35(+1)=4 → STOP. threshold = 0.35.
    const scores = [0.90, 0.80, 0.70, 0.60, 0.50, 0.40, 0.35, 0.30, 0.20, 0.10];
    const labels = [1, 0, 1, 1, 0, 0, 1, 0, 0, 0];
    const op = recallTargetedThreshold(scores, labels, { targetRecall: 0.95, minLabels: 1, minPositives: 1 });
    expect(op.threshold).toBeCloseTo(0.35, 6);

    // At t=0.35: predicted include = scores >= 0.35 = the top 7 records
    //   {0.90:1, 0.80:0, 0.70:1, 0.60:1, 0.50:0, 0.40:0, 0.35:1}
    //   tp = 4 (all positives), fp = 3 (the three negatives at 0.80/0.50/0.40)
    //   predicted exclude = {0.30:0, 0.20:0, 0.10:0} → tn = 3, fn = 0
    // achievedRecall = tp/(tp+fn) = 4/4 = 1
    expect(op.achievedRecall).toBeCloseTo(1, 6);
    // specificity = tn/(tn+fp) = 3/(3+3) = 0.5
    expect(op.specificity).toBeCloseTo(0.5, 6);
    // precision = tp/(tp+fp) = 4/7
    expect(op.precision).toBeCloseTo(4 / 7, 6);
    // screenedFraction = (tp+fp)/n = 7/10 = 0.7
    expect(op.screenedFraction).toBeCloseTo(0.7, 6);
    // workSavedFraction = (tn+fn)/n - (1 - 0.95) = 3/10 - 0.05 = 0.25
    expect(op.workSavedFraction).toBeCloseTo(0.25, 6);
    expect(op.n).toBe(10);
    expect(op.nPos).toBe(4);
  });
});

describe('recallTargetedThreshold — tie-block pessimism', () => {
  // A tied score block is consumed as a SINGLE unit: a threshold >= t admits every
  // record at score t, so the scan adds the whole block's positives at once and only
  // then checks whether the target is met.
  //
  // score:  0.90 0.50 0.50 0.50 0.50 0.10
  // label:   1    1    0    1    0    1     → nPos = 4
  // The tie block at 0.50 holds 2 positives; one positive sits BELOW it at 0.10.
  const scores = [0.90, 0.50, 0.50, 0.50, 0.50, 0.10];
  const labels = [1, 1, 0, 1, 0, 1];

  it('falls through the whole block to the min when the block cannot reach the target', () => {
    // needed = ceil(0.95*4) = 4. Descending: 0.90(+1)=1, then the 0.50 block
    // (+1+0+1+0)=+2 → found=3 < 4. The block is NOT split to grab a single positive.
    // Scan continues to 0.10(+1)=4 → threshold = 0.10 (everything admitted).
    const op = recallTargetedThreshold(scores, labels, { targetRecall: 0.95, minLabels: 1, minPositives: 1 });
    expect(op.threshold).toBeCloseTo(0.10, 6);
    expect(op.achievedRecall).toBeCloseTo(1, 6);
    // At t=0.10 every record is admitted: tp=4, fp=2, tn=0, fn=0.
    // specificity = tn/(tn+fp) = 0/(0+2) = 0.
    expect(op.specificity).toBeCloseTo(0, 6);
  });

  it('stops at the block score when the target IS reachable within it', () => {
    // needed = ceil(0.75*4) = 3. After 0.90 found=1; the 0.50 block adds 2 → found=3 = needed.
    const op = recallTargetedThreshold(scores, labels, { targetRecall: 0.75, minLabels: 1, minPositives: 1 });
    expect(op.threshold).toBeCloseTo(0.50, 6);
    // At t=0.50: admits {0.90, all four 0.50 rows} = 5 records; the 0.10 positive is excluded.
    //   tp = 3 (0.90 + two 0.50-positives), fp = 2 (two 0.50-negatives), tn = 0, fn = 1
    // achievedRecall = tp/(tp+fn) = 3/4 = 0.75
    expect(op.achievedRecall).toBeCloseTo(0.75, 6);
    // precision = tp/(tp+fp) = 3/5 = 0.6
    expect(op.precision).toBeCloseTo(0.6, 6);
    // specificity = tn/(tn+fp) = 0/(0+2) = 0
    expect(op.specificity).toBeCloseTo(0, 6);
    // screenedFraction = (tp+fp)/n = 5/6
    expect(op.screenedFraction).toBeCloseTo(5 / 6, 6);
    // workSavedFraction = (tn+fn)/n - (1 - 0.75) = 1/6 - 0.25 = -1/12
    expect(op.workSavedFraction).toBeCloseTo(1 / 6 - 0.25, 6);
  });
});

describe('recallTargetedThreshold — degenerate label sets', () => {
  it('returns null when there are no positives', () => {
    expect(recallTargetedThreshold([0.9, 0.8, 0.1], [0, 0, 0])).toBeNull();
  });
  it('returns null when the input is empty', () => {
    expect(recallTargetedThreshold([], [])).toBeNull();
  });
  it('all-positives: threshold at the min score, recall 1', () => {
    // needed = ceil(0.95*3) = 3 → all three; threshold at the lowest score.
    const op = recallTargetedThreshold([0.9, 0.5, 0.2], [1, 1, 1], { minLabels: 1, minPositives: 1 });
    expect(op.threshold).toBeCloseTo(0.2, 6);
    expect(op.achievedRecall).toBeCloseTo(1, 6);
    // fp = 0, tn = 0 → specificity is null (no true negatives to estimate from).
    expect(op.specificity).toBeNull();
  });
});

describe('recallTargetedThreshold — preliminary flag boundaries', () => {
  // Defaults: minLabels = 30, minPositives = 10.
  function ranked(n, nPos) {
    // Build a clean n-length ranking with nPos positives at the top.
    const scores = [];
    const labels = [];
    for (let i = 0; i < n; i++) {
      scores.push((n - i) / n);          // strictly descending, all distinct
      labels.push(i < nPos ? 1 : 0);
    }
    return { scores, labels };
  }

  it('flags preliminary when n < 30', () => {
    const { scores, labels } = ranked(29, 12);   // enough positives, too few labels
    const op = recallTargetedThreshold(scores, labels);
    expect(op.n).toBe(29);
    expect(op.preliminary).toBe(true);
    expect(op.reliable).toBe(false);
  });

  it('flags preliminary when nPos < 10 even if n >= 30', () => {
    const { scores, labels } = ranked(40, 9);    // enough labels, too few positives
    const op = recallTargetedThreshold(scores, labels);
    expect(op.nPos).toBe(9);
    expect(op.preliminary).toBe(true);
    expect(op.reliable).toBe(false);
  });

  it('is reliable at exactly n=30, nPos=10 (both floors met)', () => {
    const { scores, labels } = ranked(30, 10);
    const op = recallTargetedThreshold(scores, labels);
    expect(op.n).toBe(30);
    expect(op.nPos).toBe(10);
    expect(op.preliminary).toBe(false);
    expect(op.reliable).toBe(true);
  });
});

describe('computeValidation includes the operating point', () => {
  it('exposes operatingPoint alongside the balanced-threshold confusion', () => {
    const scores = [0.9, 0.8, 0.7, 0.3, 0.2, 0.1];
    const labels = [1, 1, 1, 0, 0, 0];
    const v = computeValidation(scores, labels, { ci: false });
    expect(v.operatingPoint).toBeTruthy();
    expect(v.operatingPoint.targetRecall).toBeCloseTo(0.95, 6);
    expect(v.operatingPoint.achievedRecall).toBeCloseTo(1, 6);
    // A tiny sample is flagged preliminary by the default floors.
    expect(v.operatingPoint.preliminary).toBe(true);
  });
});
