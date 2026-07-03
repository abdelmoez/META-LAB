/**
 * robAgreement.test.js — reviewer agreement for ordinal RoB judgements.
 *
 * The weighted-κ point estimates are validated against a HAND-COMPUTED 3×3
 * ordinal confusion matrix:
 *
 *            rater 2
 *            c0  c1  c2      row
 *   c0        8   2   0   →   10
 *   c1        1   6   1   →    8
 *   c2        0   2   5   →    7
 *   col      9  10   6      n=25
 *
 *   Linear    weights: po=0.88, pe=0.5712 → κ = 0.3088/0.4288 = 0.720149
 *   Quadratic weights: po=0.94, pe=0.6872 → κ = 0.2528/0.3128 = 0.808184
 *   Unweighted (Cohen): po=0.76, pe=0.3392 → κ = 0.4208/0.6608 = 0.636804
 */
import { describe, it, expect } from 'vitest';
import {
  weightedKappa,
  cohenKappaRob,
  robDomainAgreement,
  interpretKappa,
} from '../../src/research-engine/rob/index.js';
import { cohenKappa } from '../../src/research-engine/screening/agreement.js';

const CATS = ['low', 'some', 'high'];

/** Expand a KxK count matrix into parallel rater arrays (rows=r1, cols=r2). */
function expand(matrix, cats) {
  const r1 = [], r2 = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      for (let k = 0; k < matrix[i][j]; k++) { r1.push(cats[i]); r2.push(cats[j]); }
    }
  }
  return { r1, r2 };
}

const REF = [
  [8, 2, 0],
  [1, 6, 1],
  [0, 2, 5],
];

describe('weightedKappa — validated against a hand-computed 3×3 table', () => {
  const { r1, r2 } = expand(REF, CATS);

  it('linear weighted κ = 0.720149', () => {
    const k = weightedKappa(r1, r2, { categories: CATS, weights: 'linear' });
    expect(k.n).toBe(25);
    expect(k.po).toBeCloseTo(0.88, 10);
    expect(k.pe).toBeCloseTo(0.5712, 10);
    expect(k.kappa).toBeCloseTo(0.720149, 5);
    expect(k.weights).toBe('linear');
    expect(k.categories).toEqual(CATS);
  });

  it('quadratic weighted κ = 0.808184', () => {
    const k = weightedKappa(r1, r2, { categories: CATS, weights: 'quadratic' });
    expect(k.po).toBeCloseTo(0.94, 10);
    expect(k.pe).toBeCloseTo(0.6872, 10);
    expect(k.kappa).toBeCloseTo(0.808184, 5);
  });

  it('unweighted κ = 0.636804 and equals plain Cohen κ', () => {
    const k = cohenKappaRob(r1, r2, { categories: CATS });
    expect(k.kappa).toBeCloseTo(0.636804, 5);
    // must match the independent screening-engine Cohen κ exactly
    expect(k.kappa).toBeCloseTo(cohenKappa(r1, r2).kappa, 10);
  });

  it('ordinal ordering: quadratic ≥ linear ≥ unweighted for this table', () => {
    const lin = weightedKappa(r1, r2, { categories: CATS, weights: 'linear' }).kappa;
    const quad = weightedKappa(r1, r2, { categories: CATS, weights: 'quadratic' }).kappa;
    const un = cohenKappaRob(r1, r2, { categories: CATS }).kappa;
    expect(quad).toBeGreaterThan(lin);
    expect(lin).toBeGreaterThan(un);
  });

  it('SE is finite and the CI brackets κ', () => {
    const k = weightedKappa(r1, r2, { categories: CATS, weights: 'linear' });
    expect(Number.isFinite(k.se)).toBe(true);
    expect(k.se).toBeGreaterThanOrEqual(0);
    expect(k.ciLo).toBeLessThanOrEqual(k.kappa);
    expect(k.ciHi).toBeGreaterThanOrEqual(k.kappa);
  });
});

describe('weightedKappa — boundary behaviour', () => {
  it('perfect agreement → κ = 1', () => {
    const seq = ['low', 'some', 'high', 'low', 'high', 'some'];
    const k = weightedKappa(seq, seq.slice(), { categories: CATS, weights: 'quadratic' });
    expect(k.kappa).toBeCloseTo(1, 10);
    expect(interpretKappa(k.kappa)).toBe('almost perfect');
  });

  it('chance agreement (O = expected) → κ ≈ 0', () => {
    const { r1, r2 } = expand([[4, 4], [4, 4]], ['low', 'high']);
    expect(weightedKappa(r1, r2, { categories: ['low', 'high'], weights: 'linear' }).kappa).toBeCloseTo(0, 6);
    expect(weightedKappa(r1, r2, { categories: ['low', 'high'], weights: 'quadratic' }).kappa).toBeCloseTo(0, 6);
  });

  it('returns null on mismatched / empty input', () => {
    expect(weightedKappa([1, 2], [1], { categories: CATS })).toBeNull();
    expect(weightedKappa([], [], { categories: CATS })).toBeNull();
  });
});

describe('robDomainAgreement — per-domain report', () => {
  const pairs = [
    { studyId: 's1', domainId: 'D1', a: 'low', b: 'low' },
    { studyId: 's2', domainId: 'D1', a: 'low', b: 'some' }, // disagreement
    { studyId: 's1', domainId: 'D2', a: 'high', b: 'high' },
    { studyId: 's2', domainId: 'D2', a: 'some', b: 'some' },
  ];
  const rep = robDomainAgreement(pairs, { categories: CATS, weights: 'linear' });

  it('computes an overall κ and percent agreement', () => {
    expect(rep.overall).toBeTruthy();
    expect(typeof rep.overall.kappa).toBe('number');
    expect(typeof rep.overall.interpretation).toBe('string');
    expect(rep.percentAgreement).toBeCloseTo(0.75, 10); // 3 of 4 exact matches
    expect(rep.n).toBe(4);
  });

  it('breaks agreement down by domain', () => {
    const byId = Object.fromEntries(rep.byDomain.map(d => [d.domainId, d]));
    expect(rep.byDomain).toHaveLength(2);
    expect(byId.D1.n).toBe(2);
    expect(byId.D1.agreementPct).toBeCloseTo(0.5, 10);
    expect(byId.D2.agreementPct).toBeCloseTo(1.0, 10);
  });

  it('lists the exact disagreements', () => {
    expect(rep.disagreements).toEqual([
      { studyId: 's2', domainId: 'D1', a: 'low', b: 'some' },
    ]);
  });

  it('skips rows missing a rating', () => {
    const rep2 = robDomainAgreement(
      [...pairs, { studyId: 's3', domainId: 'D1', a: 'low', b: '' }],
      { categories: CATS },
    );
    expect(rep2.n).toBe(4); // the blank pair is skipped
  });
});
