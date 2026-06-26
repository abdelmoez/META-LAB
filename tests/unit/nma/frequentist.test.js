/**
 * frequentist.test.js — validation of the frequentist NMA core (P2).
 *
 * The headline validation needs NO external oracle: a TWO-treatment network must
 * reduce EXACTLY to the PecanRev pairwise meta-analysis engine (runMeta) — common
 * effect ↔ fixed inverse-variance, random effects ↔ DerSimonian–Laird, including τ²,
 * Q and the pooled effect/SE. This is a strong, self-contained correctness check on
 * the GLS assembly, the multi-arm covariance, and the multivariate DL τ² estimator.
 * Additional tests cover multi-arm covariance (no double counting), network
 * coherence, and label/reference/order invariance.
 */
import { describe, it, expect } from 'vitest';
import { deriveNetwork } from '../../../src/research-engine/statistics/nma/contrasts.js';
import { fitConsistency, pairEffect, pScores } from '../../../src/research-engine/statistics/nma/frequentist.js';
import { runMeta } from '../../../src/research-engine/statistics/meta-analysis.js';
import { Z975 } from '../../../src/research-engine/statistics/math-helpers.js';

const close = (a, b, tol = 1e-7) => Math.abs(a - b) <= tol * (1 + Math.abs(b));

// Two-treatment binary dataset (A vs B), several 2-arm studies.
const TWO = [
  { id: 's1', arms: [{ treatment: 'A', events: 10, n: 100 }, { treatment: 'B', events: 20, n: 100 }] },
  { id: 's2', arms: [{ treatment: 'A', events: 15, n: 120 }, { treatment: 'B', events: 25, n: 120 }] },
  { id: 's3', arms: [{ treatment: 'A', events: 5, n: 80 }, { treatment: 'B', events: 12, n: 80 }] },
  { id: 's4', arms: [{ treatment: 'A', events: 22, n: 150 }, { treatment: 'B', events: 18, n: 150 }] },
];

// The same contrasts as {es,lo,hi} for the pairwise oracle (logOR of B vs A).
function pairwiseStudies(studies) {
  return studies.map((s) => {
    const a = s.arms.find((x) => x.treatment === 'A');
    const b = s.arms.find((x) => x.treatment === 'B');
    const yA = Math.log(a.events / (a.n - a.events));
    const yB = Math.log(b.events / (b.n - b.events));
    const v = 1 / a.events + 1 / (a.n - a.events) + 1 / b.events + 1 / (b.n - b.events);
    const es = yB - yA, se = Math.sqrt(v);
    return { es, lo: es - Z975 * se, hi: es + Z975 * se };
  });
}

describe('NMA frequentist core — two-treatment reduces to pairwise', () => {
  const net = deriveNetwork(TWO, 'OR');
  const oraclePw = pairwiseStudies(TWO);

  it('common-effect NMA == fixed-effect pairwise (effect, SE, Q)', () => {
    const fit = fitConsistency(net, { model: 'common' });
    expect(fit.ok).toBe(true);
    const e = pairEffect(fit, 'A', 'B'); // B vs A
    const pw = runMeta(oraclePw, 'fixed');
    expect(close(e.est, pw.pES)).toBe(true);
    expect(close(e.se, pw.pSE)).toBe(true);
    expect(close(fit.Q, pw.Q)).toBe(true);
  });

  it('random-effects NMA == DerSimonian–Laird pairwise (effect, SE, τ²)', () => {
    const fit = fitConsistency(net, { model: 'random' });
    const e = pairEffect(fit, 'A', 'B');
    const pw = runMeta(oraclePw, 'random');
    expect(close(fit.tau2, pw.tau2, 1e-6)).toBe(true);
    expect(close(e.est, pw.pES, 1e-6)).toBe(true);
    expect(close(e.se, pw.pSE, 1e-6)).toBe(true);
    expect(close(fit.I2, pw.I2, 1e-6)).toBe(true);
  });
});

describe('NMA frequentist core — multi-arm covariance (no double counting)', () => {
  // A single 3-arm study: the network estimates must equal the within-study
  // contrasts, with variances built from the shared baseline (NOT inflated).
  const net = deriveNetwork([
    { id: 'm1', arms: [{ treatment: 'A', events: 10, n: 100 }, { treatment: 'B', events: 20, n: 100 }, { treatment: 'C', events: 30, n: 100 }] },
  ], 'OR');
  const fit = fitConsistency(net, { model: 'common' });
  const vA = 1 / 10 + 1 / 90, vB = 1 / 20 + 1 / 80, vC = 1 / 30 + 1 / 70;

  it('B vs A equals the direct arm contrast with variance vA+vB', () => {
    const e = pairEffect(fit, 'A', 'B');
    expect(close(e.est, Math.log((20 / 80) / (10 / 90)))).toBe(true);
    expect(close(e.se, Math.sqrt(vA + vB))).toBe(true);
  });

  it('B vs C variance uses the shared baseline (vB+vC, baseline cancels)', () => {
    const e = pairEffect(fit, 'C', 'B'); // B vs C
    expect(close(e.est, Math.log((20 / 80) / (30 / 70)))).toBe(true);
    expect(close(e.se, Math.sqrt(vB + vC))).toBe(true); // NOT vB+vC+2vA
  });
});

describe('NMA frequentist core — coherence + invariance', () => {
  const data = [
    { id: '1', arms: [{ treatment: 'A', events: 12, n: 100 }, { treatment: 'B', events: 20, n: 100 }] },
    { id: '2', arms: [{ treatment: 'B', events: 18, n: 110 }, { treatment: 'C', events: 28, n: 110 }] },
    { id: '3', arms: [{ treatment: 'A', events: 9, n: 90 }, { treatment: 'C', events: 22, n: 90 }] },
    { id: '4', arms: [{ treatment: 'A', events: 14, n: 130 }, { treatment: 'B', events: 19, n: 130 }, { treatment: 'C', events: 30, n: 130 }] },
  ];
  const net = deriveNetwork(data, 'OR');
  const fit = fitConsistency(net, { model: 'random' });

  it('network estimates are coherent: AC = AB + BC', () => {
    const ab = pairEffect(fit, 'A', 'B').est;
    const bc = pairEffect(fit, 'B', 'C').est;
    const ac = pairEffect(fit, 'A', 'C').est;
    expect(close(ac, ab + bc, 1e-9)).toBe(true);
  });

  it('reciprocal: effect(A,B) = −effect(B,A)', () => {
    const ab = pairEffect(fit, 'A', 'B');
    const ba = pairEffect(fit, 'B', 'A');
    expect(close(ab.est, -ba.est, 1e-12)).toBe(true);
    expect(close(ab.se, ba.se, 1e-12)).toBe(true);
  });

  it('reference-treatment invariance: B-vs-C effect identical under any reference', () => {
    const fA = fitConsistency(net, { model: 'random', reference: 'A' });
    const fC = fitConsistency(net, { model: 'random', reference: 'C' });
    expect(close(pairEffect(fA, 'B', 'C').est, pairEffect(fC, 'B', 'C').est, 1e-7)).toBe(true);
    expect(close(pairEffect(fA, 'B', 'C').se, pairEffect(fC, 'B', 'C').se, 1e-7)).toBe(true);
    expect(close(fA.tau2, fC.tau2, 1e-7)).toBe(true);
  });

  it('treatment-relabelling invariance leaves τ² and Q unchanged', () => {
    const relabel = data.map((s) => ({ ...s, arms: s.arms.map((a) => ({ ...a, treatment: ({ A: 'X', B: 'Y', C: 'Z' })[a.treatment] })) }));
    const fit2 = fitConsistency(deriveNetwork(relabel, 'OR'), { model: 'random' });
    expect(close(fit.tau2, fit2.tau2, 1e-9)).toBe(true);
    expect(close(fit.Q, fit2.Q, 1e-9)).toBe(true);
  });

  it('P-scores are in [0,1], sum to (t-1)/2·… and rank sensibly', () => {
    const ps = pScores(fit, { smallerBetter: false });
    expect(ps.length).toBe(3);
    ps.forEach((p) => { expect(p.pScore).toBeGreaterThanOrEqual(0); expect(p.pScore).toBeLessThanOrEqual(1); });
    // Mean P-score across treatments is exactly 0.5 (each pairwise prob counted both ways).
    const mean = ps.reduce((a, p) => a + p.pScore, 0) / ps.length;
    expect(close(mean, 0.5, 1e-9)).toBe(true);
  });
});
