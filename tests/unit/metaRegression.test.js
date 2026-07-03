/**
 * metaRegression.test.js — validation of the P13 meta-regression engine.
 *
 * No faked numbers. Two independent references are used:
 *
 *  1. HAND-COMPUTED balanced fixture (v_i = 1 for all studies). With EQUAL
 *     within-study variances the moment (DL) denominator collapses to c = k − p,
 *     so every quantity is derivable by hand from the published formulae AND the
 *     method-of-moments τ² equals the REML τ² (equal-variance regression → REML
 *     σ² = RSS/(k−p)). This is the strongest check — the arithmetic below is
 *     fully auditable and does not read anything back from the engine.
 *
 *         x  = [1, 2, 3, 4]     y = [1, 3, 2, 4-ish]  (y = [1,3,2,5]) , v = 1
 *         OLS: x̄=2.5, ȳ=2.75, Sxx=5, Sxy=5.5 → slope=1.1, intercept=0
 *         fitted = [1.1, 2.2, 3.3, 4.4] ; resid = [-0.1, 0.8, -1.3, 0.6]
 *         Q_E = 0.01+0.64+1.69+0.36 = 2.70  (df = k−p = 2)
 *         τ²  = (2.70 − 2)/2 = 0.35     (c = k−p = 2 for equal weights)
 *         REML τ² = RSS/(k−p) − v = 2.70/2 − 1 = 0.35   (identical here)
 *         RE weights all = 1/1.35 → RE β = OLS β = (0, 1.1)
 *         Cov(β) = (X'W*X)⁻¹ = 1.35·[[1.5,−0.5],[−0.5,0.2]]
 *                = [[2.025,−0.675],[−0.675,0.27]]
 *         se(intercept)=√2.025=1.4230249…  se(slope)=√0.27=0.5196152…
 *         Intercept-only τ² (total): Q=Σ(y−ȳ)²=8.75, denom=W−W²/W=3
 *                τ²₀ = (8.75−3)/3 = 1.91666…
 *         R² = (τ²₀−τ²)/τ²₀ = (1.91666−0.35)/1.91666 = 0.8173913…
 *         residual I² = 100·τ²/(τ²+s²), s²=(k−p)/c=1 → 100·0.35/1.35 = 25.9259…
 *         Q_E p = 1 − χ²CDF(2.70,2) = e^(−1.35) = 0.2592403…
 *         omnibus Q_M = β₁²/Cov₁₁ = 1.21/0.27 = 4.4814814…  (df=1)
 *
 *  2. INDEPENDENT closed-form recompute (refUniMM / refREML below) for an
 *     UNEQUAL-variance fixture — a separate 2×2-inverse WLS + DL-moment / REML
 *     Fisher-scoring implementation that never touches the engine. The engine
 *     must match it to ~1e-9 (MM) / ~1e-6 (REML), confirming the Cholesky-based
 *     linear algebra reproduces the closed form. (Same style as the repo's
 *     canonical.js hand-derivations + subgroup.test.js independent recompute.)
 */
import { describe, it, expect } from 'vitest';
import { metaRegression } from '../../src/research-engine/statistics/metaRegression.js';
import { normalCDF, chiSquareCDF } from '../../src/research-engine/statistics/math-helpers.js';

// ── hand-computed balanced fixture ──────────────────────────────────────────
const balanced = [
  { id: 'b1', es: 1, se: 1, x: 1, author: 'A', year: 2001 },
  { id: 'b2', es: 3, se: 1, x: 2, author: 'B', year: 2002 },
  { id: 'b3', es: 2, se: 1, x: 3, author: 'C', year: 2003 },
  { id: 'b4', es: 5, se: 1, x: 4, author: 'D', year: 2004 },
];
const SE_SLOPE = Math.sqrt(0.27);      // 0.5196152422706632
const SE_INT = Math.sqrt(2.025);       // 1.4230249470757708

// ── independent references (2×2 closed form; NOT the engine) ────────────────
function refUniMM(xs, ys, vs) {
  const k = xs.length, p = 2;
  const w = vs.map((v) => 1 / v);
  let Sw = 0, Swx = 0, Swxx = 0, Swy = 0, Swxy = 0, Sww = 0, Swwx = 0, Swwxx = 0;
  for (let i = 0; i < k; i++) {
    const wi = w[i], x = xs[i], y = ys[i];
    Sw += wi; Swx += wi * x; Swxx += wi * x * x; Swy += wi * y; Swxy += wi * x * y;
    Sww += wi * wi; Swwx += wi * wi * x; Swwxx += wi * wi * x * x;
  }
  const det = Sw * Swxx - Swx * Swx;
  const inv = [[Swxx / det, -Swx / det], [-Swx / det, Sw / det]];
  const b0 = inv[0][0] * Swy + inv[0][1] * Swxy;
  const b1 = inv[1][0] * Swy + inv[1][1] * Swxy;
  let QE = 0;
  for (let i = 0; i < k; i++) { const e = ys[i] - b0 - b1 * xs[i]; QE += w[i] * e * e; }
  const A = [[Sww, Swwx], [Swwx, Swwxx]];
  const trMinvA = inv[0][0] * A[0][0] + inv[0][1] * A[1][0] + inv[1][0] * A[0][1] + inv[1][1] * A[1][1];
  const c = Sw - trMinvA;
  const tau2 = Math.max(0, (QE - (k - p)) / c);
  const wr = vs.map((v) => 1 / (v + tau2));
  let Rw = 0, Rwx = 0, Rwxx = 0, Rwy = 0, Rwxy = 0;
  for (let i = 0; i < k; i++) { const wi = wr[i], x = xs[i], y = ys[i]; Rw += wi; Rwx += wi * x; Rwxx += wi * x * x; Rwy += wi * y; Rwxy += wi * x * y; }
  const rdet = Rw * Rwxx - Rwx * Rwx;
  const rinv = [[Rwxx / rdet, -Rwx / rdet], [-Rwx / rdet, Rw / rdet]];
  return {
    tau2, QE, c,
    intercept: rinv[0][0] * Rwy + rinv[0][1] * Rwxy,
    slope: rinv[1][0] * Rwy + rinv[1][1] * Rwxy,
    seInt: Math.sqrt(rinv[0][0]),
    seSlope: Math.sqrt(rinv[1][1]),
  };
}

function refREML(xs, ys, vs, init) {
  const k = xs.length;
  let t2 = Math.max(0, init);
  for (let it = 0; it < 500; it++) {
    const w = vs.map((v) => 1 / (v + t2));
    let Sw = 0, Swx = 0, Swxx = 0;
    for (let i = 0; i < k; i++) { const wi = w[i]; Sw += wi; Swx += wi * xs[i]; Swxx += wi * xs[i] * xs[i]; }
    const det = Sw * Swxx - Swx * Swx;
    const inv = [[Swxx / det, -Swx / det], [-Swx / det, Sw / det]];
    const WX = xs.map((x, i) => [w[i], w[i] * x]);
    const P = [];
    for (let i = 0; i < k; i++) {
      P.push([]);
      for (let j = 0; j < k; j++) {
        let s = 0;
        for (let a = 0; a < 2; a++) { let t = 0; for (let b = 0; b < 2; b++) t += inv[a][b] * WX[j][b]; s += WX[i][a] * t; }
        P[i][j] = (i === j ? w[i] : 0) - s;
      }
    }
    const Py = ys.map((_, i) => { let s = 0; for (let j = 0; j < k; j++) s += P[i][j] * ys[j]; return s; });
    let trP = 0, trPP = 0, PyPy = 0;
    for (let i = 0; i < k; i++) { trP += P[i][i]; PyPy += Py[i] * Py[i]; for (let j = 0; j < k; j++) trPP += P[i][j] * P[i][j]; }
    let t2n = t2 + (PyPy - trP) / trPP;
    if (t2n < 0) t2n = 0;
    if (Math.abs(t2n - t2) < 1e-12 * (1 + t2)) { t2 = t2n; break; }
    t2 = t2n;
  }
  return t2;
}

describe('metaRegression — hand-computed balanced fixture (external anchor)', () => {
  const mm = metaRegression(balanced, { covariate: 'x', type: 'continuous', method: 'MM' });

  it('is analysable with k=4, one moderator, no drops', () => {
    expect(mm.ok).toBe(true);
    expect(mm.k).toBe(4);
    expect(mm.kDropped).toBe(0);
    expect(mm.moderators).toHaveLength(1);
    expect(mm.moderators[0].name).toBe('x');
    expect(mm.method).toBe('MM');
    expect(mm.model).toBe('random');
  });

  it('WLS coefficients match the hand-derived slope/intercept', () => {
    expect(mm.intercept.coef).toBeCloseTo(0, 10);
    expect(mm.moderators[0].coef).toBeCloseTo(1.1, 12);
  });

  it('coefficient SEs match Cov(β)=(X\'W*X)⁻¹', () => {
    expect(mm.intercept.se).toBeCloseTo(SE_INT, 12);
    expect(mm.moderators[0].se).toBeCloseTo(SE_SLOPE, 12);
  });

  it('z and p for the slope match a normal Wald test', () => {
    const z = 1.1 / SE_SLOPE;
    expect(mm.moderators[0].z).toBeCloseTo(z, 10);
    expect(mm.moderators[0].pval).toBeCloseTo(2 * (1 - normalCDF(Math.abs(z))), 12);
    expect(mm.moderators[0].pval).toBeLessThan(0.05);
  });

  it('τ², τ²Before and reduction match the DL formulae', () => {
    expect(mm.tau2).toBeCloseTo(0.35, 12);
    expect(mm.tau2Before).toBeCloseTo(1.9166666666666667, 12);
    expect(mm.tau2Reduction).toBeCloseTo(1.5666666666666667, 12);
  });

  it('residual Q_E, df and p match', () => {
    expect(mm.residual.QE).toBeCloseTo(2.7, 12);
    expect(mm.residual.df).toBe(2);
    expect(mm.residual.QEp).toBeCloseTo(1 - chiSquareCDF(2.7, 2), 12);
    expect(mm.residual.QEp).toBeCloseTo(Math.exp(-1.35), 6);
  });

  it('R² and residual I² match the hand-derived values', () => {
    expect(mm.R2).toBeCloseTo(0.8173913043478261, 12);
    expect(mm.I2resid).toBeCloseTo(25.925925925925927, 10);
  });

  it('omnibus Q_M = z² for a single moderator', () => {
    expect(mm.omnibus.df).toBe(1);
    expect(mm.omnibus.QM).toBeCloseTo(1.21 / 0.27, 10);
  });

  it('REML gives the SAME τ² and coefficients on the equal-variance fixture', () => {
    const reml = metaRegression(balanced, { covariate: 'x', type: 'continuous', method: 'REML' });
    expect(reml.ok).toBe(true);
    expect(reml.method).toBe('REML');
    expect(reml.tau2).toBeCloseTo(0.35, 8);
    expect(reml.moderators[0].coef).toBeCloseTo(1.1, 8);
    expect(reml.intercept.coef).toBeCloseTo(0, 8);
  });
});

// ── unequal-variance, HETEROGENEOUS fixture (effects off any linear trend so
//    both MM and REML estimate a clearly positive τ²), independent recompute ──
const unbalanced = [
  { id: 'u1', es: 0.2, se: Math.sqrt(0.05), x: 0 },
  { id: 'u2', es: 1.5, se: Math.sqrt(0.08), x: 1 },
  { id: 'u3', es: 0.3, se: Math.sqrt(0.06), x: 2 },
  { id: 'u4', es: 2.0, se: Math.sqrt(0.05), x: 3 },
  { id: 'u5', es: 0.5, se: Math.sqrt(0.07), x: 4 },
  { id: 'u6', es: 1.8, se: Math.sqrt(0.06), x: 5 },
];
const uxs = unbalanced.map((s) => s.x);
const uys = unbalanced.map((s) => s.es);
const uvs = unbalanced.map((s) => s.se * s.se);

describe('metaRegression — unequal variances vs independent closed form', () => {
  it('MM matches refUniMM to ~1e-9 (τ², QE, β, SE)', () => {
    const ref = refUniMM(uxs, uys, uvs);
    const res = metaRegression(unbalanced, { covariate: 'x', type: 'continuous', method: 'MM' });
    expect(res.ok).toBe(true);
    expect(res.tau2).toBeCloseTo(ref.tau2, 9);
    expect(res.residual.QE).toBeCloseTo(ref.QE, 9);
    expect(res.intercept.coef).toBeCloseTo(ref.intercept, 9);
    expect(res.moderators[0].coef).toBeCloseTo(ref.slope, 9);
    expect(res.intercept.se).toBeCloseTo(ref.seInt, 9);
    expect(res.moderators[0].se).toBeCloseTo(ref.seSlope, 9);
  });

  it('REML matches an independent Fisher-scoring iteration and is self-consistent', () => {
    const init = refUniMM(uxs, uys, uvs).tau2;
    const refT2 = refREML(uxs, uys, uvs, init);
    const res = metaRegression(unbalanced, { covariate: 'x', type: 'continuous', method: 'REML' });
    expect(res.ok).toBe(true);
    expect(refT2).toBeGreaterThan(0);          // heterogeneous fixture → positive τ²
    expect(res.tau2).toBeCloseTo(refT2, 6);
    expect(res.tau2).toBeGreaterThan(0);
  });
});

// ── categorical (2-level) direction ─────────────────────────────────────────
describe('metaRegression — categorical covariate matches subgroup direction', () => {
  const cat = [
    { id: 'c1', es: 0.20, se: 0.2, g: 'Low' },
    { id: 'c2', es: 0.30, se: 0.2, g: 'Low' },
    { id: 'c3', es: 0.25, se: 0.2, g: 'Low' },
    { id: 'c4', es: 0.80, se: 0.2, g: 'High' },
    { id: 'c5', es: 0.90, se: 0.2, g: 'High' },
    { id: 'c6', es: 0.85, se: 0.2, g: 'High' },
  ];
  const res = metaRegression(cat, { covariate: 'g', type: 'categorical', method: 'MM' });

  it('dummy-codes with the sorted-first level (High) as reference', () => {
    expect(res.ok).toBe(true);
    expect(res.moderators).toHaveLength(1);
    expect(res.moderators[0].level).toBe('Low');
    expect(res.moderators[0].reference).toBe('High');
  });

  it('intercept ≈ reference (High) mean; moderator = Low − High is negative & significant', () => {
    expect(res.intercept.coef).toBeCloseTo(0.85, 1);          // High pooled ≈ 0.85
    expect(res.moderators[0].coef).toBeLessThan(0);           // Low < High
    expect(res.intercept.coef + res.moderators[0].coef).toBeCloseTo(0.25, 1); // Low pooled ≈ 0.25
    expect(res.moderators[0].pval).toBeLessThan(0.05);
    expect(res.bubble.line).toBeNull();                        // categorical → no line/band
    expect(res.bubble.band).toBeNull();
  });
});

// ── bubble-plot geometry ────────────────────────────────────────────────────
describe('metaRegression — bubble geometry', () => {
  const res = metaRegression(balanced, { covariate: 'x', type: 'continuous' });

  it('emits one weighted point per study with x/y/weight/label/studyId', () => {
    expect(res.bubble.points).toHaveLength(4);
    const p0 = res.bubble.points[0];
    expect(p0.x).toBe(1);
    expect(p0.y).toBe(1);
    expect(p0.studyId).toBe('b1');
    expect(p0.weight).toBeGreaterThan(0);
    expect(p0.label).toContain('A');
  });

  it('regression line uses the fitted slope/intercept over [min,max] x', () => {
    expect(res.bubble.line.slope).toBeCloseTo(1.1, 10);
    expect(res.bubble.line.intercept).toBeCloseTo(0, 10);
    expect(res.bubble.line.x0).toBe(1);
    expect(res.bubble.line.x1).toBe(4);
  });

  it('95% CI band is centred on the fitted line and widens correctly', () => {
    expect(res.bubble.band).toHaveLength(31);
    expect(res.bubble.band[0].x).toBe(1);
    expect(res.bubble.band[30].x).toBe(4);
    for (const b of res.bubble.band) {
      expect(b.hi).toBeGreaterThan(b.lo);
      expect((b.lo + b.hi) / 2).toBeCloseTo(0 + 1.1 * b.x, 10); // centre = ŷ
    }
    // At x=1: Var(ŷ)=Cov00+2·Cov01+Cov11 = 2.025−1.35+0.27 = 0.945
    const half = 1.959963984540054 * Math.sqrt(0.945);
    expect(res.bubble.band[0].hi - res.bubble.band[0].lo).toBeCloseTo(2 * half, 10);
  });

  it('a single binary covariate draws a line but no band', () => {
    const bin = [
      { id: 'x1', es: 0.1, se: 0.2, d: 0 }, { id: 'x2', es: 0.2, se: 0.2, d: 0 },
      { id: 'x3', es: 0.7, se: 0.2, d: 1 }, { id: 'x4', es: 0.8, se: 0.2, d: 1 },
    ];
    const r = metaRegression(bin, { covariate: 'd', type: 'binary' });
    expect(r.ok).toBe(true);
    expect(r.moderators[0].kind).toBe('binary');
    expect(r.moderators[0].reference).toBe(0);
    expect(r.bubble.line).not.toBeNull();
    expect(r.bubble.band).toBeNull();
  });
});

// ── guardrails ──────────────────────────────────────────────────────────────
describe('metaRegression — guardrails', () => {
  const types = (r) => r.warnings.map((w) => w.type);

  it('k<3 → ok:false with TOO_FEW_STUDIES (never throws)', () => {
    const r = metaRegression(
      [{ id: 'a', es: 0.2, se: 0.2, x: 1 }, { id: 'b', es: 0.5, se: 0.2, x: 2 }],
      { covariate: 'x', type: 'continuous' });
    expect(r.ok).toBe(false);
    expect(types(r)).toContain('TOO_FEW_STUDIES');
  });

  it('constant covariate (no variation) → ok:false, DEGENERATE', () => {
    const r = metaRegression(
      [{ id: 'a', es: 0.2, se: 0.2, x: 2 }, { id: 'b', es: 0.5, se: 0.2, x: 2 },
       { id: 'c', es: 0.1, se: 0.2, x: 2 }, { id: 'd', es: 0.9, se: 0.2, x: 2 }],
      { covariate: 'x', type: 'continuous' });
    expect(r.ok).toBe(false);
    expect(types(r)).toContain('DEGENERATE');
  });

  it('missing covariate values are dropped and reported (MISSING_COVARIATE_DATA)', () => {
    const r = metaRegression(
      [{ id: 'a', es: 0.2, se: 0.2, x: 1 }, { id: 'b', es: 0.5, se: 0.2, x: 2 },
       { id: 'c', es: 0.1, se: 0.2, x: 3 }, { id: 'd', es: 0.9, se: 0.2, x: '' },
       { id: 'e', es: 0.4, se: 0.2 }],
      { covariate: 'x', type: 'continuous' });
    expect(r.ok).toBe(true);
    expect(r.k).toBe(3);
    expect(r.kDropped).toBe(2);
    expect(types(r)).toContain('MISSING_COVARIATE_DATA');
  });

  it('always attaches ecological + observational caveats for a study-level covariate', () => {
    const r = metaRegression(balanced, { covariate: 'x', type: 'continuous' });
    expect(types(r)).toContain('ECOLOGICAL_BIAS');
    expect(types(r)).toContain('OBSERVATIONAL_COVARIATE');
  });

  it('too many covariates for the data → TOO_MANY_COVARIATES + MULTIPLE_TESTING', () => {
    const mv = [
      { id: 's1', es: 0.1, se: 0.3, x1: 1, x2: 5 },
      { id: 's2', es: 0.4, se: 0.3, x1: 2, x2: 2 },
      { id: 's3', es: 0.2, se: 0.3, x1: 3, x2: 8 },
      { id: 's4', es: 0.7, se: 0.3, x1: 4, x2: 1 },
      { id: 's5', es: 0.5, se: 0.3, x1: 5, x2: 6 },
      { id: 's6', es: 0.3, se: 0.3, x1: 6, x2: 3 },
      { id: 's7', es: 0.8, se: 0.3, x1: 7, x2: 9 },
      { id: 's8', es: 0.6, se: 0.3, x1: 8, x2: 4 },
    ];
    const r = metaRegression(mv, {
      covariates: [{ name: 'x1', type: 'continuous' }, { name: 'x2', type: 'continuous' }],
      method: 'MM',
    });
    expect(r.ok).toBe(true);
    expect(r.moderators).toHaveLength(2);
    expect(types(r)).toContain('TOO_MANY_COVARIATES');
    expect(types(r)).toContain('MULTIPLE_TESTING');
    expect(r.bubble.line).toBeNull(); // multivariable → no single-axis line
  });

  it('k < moderators + 2 → ok:false', () => {
    const r = metaRegression(
      [{ id: 'a', es: 0.2, se: 0.2, x1: 1, x2: 2 },
       { id: 'b', es: 0.5, se: 0.2, x1: 2, x2: 1 },
       { id: 'c', es: 0.1, se: 0.2, x1: 3, x2: 4 }],
      { covariates: [{ name: 'x1', type: 'continuous' }, { name: 'x2', type: 'continuous' }] });
    expect(r.ok).toBe(false);           // k=3, nMod=2 → need k≥4
    expect(types(r)).toContain('TOO_FEW_STUDIES');
  });

  it('no covariate specified → ok:false', () => {
    const r = metaRegression(balanced, {});
    expect(r.ok).toBe(false);
  });
});

// ── input normalisation / provenance ────────────────────────────────────────
describe('metaRegression — inputs & provenance', () => {
  it('accepts variance / lo-hi study forms as well as se', () => {
    const viForm = [
      { id: 'a', es: 1, variance: 1, x: 1 }, { id: 'b', es: 3, variance: 1, x: 2 },
      { id: 'c', es: 2, variance: 1, x: 3 }, { id: 'd', es: 5, variance: 1, x: 4 },
    ];
    const r = metaRegression(viForm, { covariate: 'x', type: 'continuous', method: 'MM' });
    expect(r.moderators[0].coef).toBeCloseTo(1.1, 12);
    expect(r.tau2).toBeCloseTo(0.35, 12);
  });

  it('records engine version, method, covariate and n in provenance', () => {
    const r = metaRegression(balanced, { covariate: 'x', type: 'continuous', method: 'REML', measure: 'SMD' });
    expect(r.provenance.engineVersion).toMatch(/metaRegression/);
    expect(r.provenance.method).toBe('REML');
    expect(r.provenance.covariate).toBe('x');
    expect(r.provenance.measure).toBe('SMD');
    expect(r.provenance.n).toBe(4);
  });
});
