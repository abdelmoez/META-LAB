/**
 * agreement.test.js — golden tests for inter-rater agreement (roadmap 1.3).
 *
 * Cohen's κ and Fleiss' κ are validated against fully HAND-COMPUTED worked
 * examples (the arithmetic is in statistical-validation.md §12). Tolerances:
 * 1e-4 absolute on κ and SE.
 */
import { describe, it, expect } from 'vitest';
import {
  cohenKappa, fleissKappa, toFleissMatrix, interpretKappa,
} from '../../../src/research-engine/screening/agreement.js';

/* ── Cohen's κ ───────────────────────────────────────────────────────────────
   2×2 confusion: both-yes=20, both-no=15, r1yes/r2no=5, r1no/r2yes=10 (n=50).
   po = 35/50 = 0.70 ; r1 yes=0.5, r2 yes=0.6 ;
   pe = 0.5·0.6 + 0.5·0.4 = 0.50 ; κ = 0.20/0.50 = 0.40 ;
   SE = √(0.7·0.3 / (50·0.25)) = √0.0168 = 0.129615.
   ──────────────────────────────────────────────────────────────────────────── */
function cohenFixture() {
  const r1 = [], r2 = [];
  const push = (a, b, k) => { for (let i = 0; i < k; i++) { r1.push(a); r2.push(b); } };
  push('inc', 'inc', 20);
  push('exc', 'exc', 15);
  push('inc', 'exc', 5);
  push('exc', 'inc', 10);
  return { r1, r2 };
}

describe("Cohen's κ (golden, hand-computed)", () => {
  it('κ = 0.40, po = 0.70, pe = 0.50 on the 2×2 fixture', () => {
    const { r1, r2 } = cohenFixture();
    const res = cohenKappa(r1, r2);
    expect(res.n).toBe(50);
    expect(res.po).toBeCloseTo(0.70, 9);
    expect(res.pe).toBeCloseTo(0.50, 9);
    expect(res.kappa).toBeCloseTo(0.40, 9);
  });

  it('normal-approx SE = 0.129615 and a 95% CI around κ', () => {
    const { r1, r2 } = cohenFixture();
    const res = cohenKappa(r1, r2);
    expect(res.se).toBeCloseTo(0.129615, 5);
    expect(res.lo).toBeCloseTo(0.40 - 1.959963984540054 * 0.129615, 5);
    expect(res.hi).toBeCloseTo(0.40 + 1.959963984540054 * 0.129615, 5);
    expect(res.interpretation).toBe('fair'); // κ=0.40 sits at the top of the 0.21–0.40 "fair" band
  });

  it('perfect agreement → κ = 1', () => {
    const res = cohenKappa(['a', 'b', 'a', 'b'], ['a', 'b', 'a', 'b']);
    expect(res.kappa).toBeCloseTo(1, 9);
    expect(res.se).toBe(0);
    expect(res.interpretation).toBe('almost perfect');
  });

  it('skips items missing either rater; null for empty/mismatched input', () => {
    const res = cohenKappa(['a', '', 'b'], ['a', 'b', 'b']);
    expect(res.n).toBe(2); // middle pair dropped (r1 empty)
    expect(cohenKappa(['a'], ['a', 'b'])).toBeNull(); // length mismatch
    expect(cohenKappa([], [])).toBeNull();
  });
});

/* ── Fleiss' κ ───────────────────────────────────────────────────────────────
   3 subjects, 3 raters, 2 categories: [[3,0],[0,3],[2,1]].
   P1=P2=1, P3=(4+1−3)/6=0.33333 ; Pbar=2.33333/3=0.777778 ;
   p_A=5/9, p_B=4/9 ; Pe=0.506173 ; κ=(0.777778−0.506173)/(1−0.506173)=0.550003.
   SE under H0: A=Σp(1−p)=0.493827, B=0 → SE=√(2·A²)/(A·√(N·m·(m−1)))
              = √0.487732 / (0.493827·√18) = 0.333348.
   ──────────────────────────────────────────────────────────────────────────── */
describe("Fleiss' κ (golden, hand-computed)", () => {
  const matrix = [[3, 0], [0, 3], [2, 1]];

  it('κ = 0.5500, Pbar = 0.77778, Pe = 0.50617', () => {
    const res = fleissKappa(matrix);
    expect(res.N).toBe(3);
    expect(res.raters).toBe(3);
    expect(res.Pbar).toBeCloseTo(0.777778, 5);
    expect(res.Pe).toBeCloseTo(0.506173, 5);
    expect(res.kappa).toBeCloseTo(0.550003, 4);
    expect(res.interpretation).toBe('moderate');
  });

  it('asymptotic SE under H0 = 0.333348', () => {
    const res = fleissKappa(matrix);
    expect(res.se).toBeCloseTo(0.333348, 4);
  });

  it('perfect agreement → κ = 1', () => {
    const res = fleissKappa([[3, 0], [0, 3], [3, 0]]);
    expect(res.kappa).toBeCloseTo(1, 9);
  });

  it('rejects a non-constant rater count', () => {
    expect(fleissKappa([[3, 0], [0, 2]])).toBeNull(); // row sums 3 vs 2
  });

  it('toFleissMatrix builds the count matrix from per-subject labels', () => {
    const { matrix: m, categories } = toFleissMatrix(
      [['A', 'A', 'A'], ['B', 'B', 'B'], ['A', 'A', 'B']],
      ['A', 'B'],
    );
    expect(categories).toEqual(['A', 'B']);
    expect(m).toEqual([[3, 0], [0, 3], [2, 1]]);
    expect(fleissKappa(m).kappa).toBeCloseTo(0.550003, 4);
  });
});

describe('interpretKappa bands (Landis & Koch)', () => {
  it('maps κ to the right band', () => {
    expect(interpretKappa(-0.1)).toBe('poor');
    expect(interpretKappa(0.1)).toBe('slight');
    expect(interpretKappa(0.3)).toBe('fair');
    expect(interpretKappa(0.5)).toBe('moderate');
    expect(interpretKappa(0.7)).toBe('substantial');
    expect(interpretKappa(0.9)).toBe('almost perfect');
  });
});
