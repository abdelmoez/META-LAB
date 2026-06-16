/**
 * agreement.js — inter-rater agreement for screening calibration (roadmap 1.3).
 *
 * Pure, framework-free. Computes:
 *   - Cohen's κ        (exactly 2 raters)            with a normal-approximation CI
 *   - Fleiss' κ        (≥ 2 raters, constant count)  with the asymptotic SE under H0
 *   - Landis & Koch interpretation bands
 *
 * Validated against hand-computed worked examples (see
 * tests/unit/screening/agreement.test.js and statistical-validation.md §12).
 */

const Z975 = 1.959963984540054;

/**
 * Landis & Koch (1977) agreement bands.
 * @param {number} k  kappa value
 * @returns {string}
 */
export function interpretKappa(k) {
  if (k == null || Number.isNaN(k)) return 'undefined';
  if (k < 0) return 'poor';
  if (k <= 0.20) return 'slight';       // Landis & Koch table boundaries are inclusive
  if (k <= 0.40) return 'fair';         // 0.21–0.40
  if (k <= 0.60) return 'moderate';     // 0.41–0.60
  if (k <= 0.80) return 'substantial';  // 0.61–0.80
  return 'almost perfect';              // 0.81–1.00
}

/**
 * Cohen's κ for two raters over paired categorical decisions.
 *
 * po = observed agreement; pe = chance agreement = Σ_k p1k·p2k.
 * κ  = (po − pe) / (1 − pe).
 * SE = √( po(1−po) / (n(1−pe)²) )  (the common normal approximation).
 *
 * @param {Array} r1  rater 1's decisions (any labels; "" / null skipped pairwise)
 * @param {Array} r2  rater 2's decisions (parallel array, same length)
 * @returns {object|null} { kappa, po, pe, se, lo, hi, n, categories, raters, interpretation }
 */
export function cohenKappa(r1, r2) {
  if (!Array.isArray(r1) || !Array.isArray(r2) || r1.length !== r2.length) return null;
  const pairs = [];
  for (let i = 0; i < r1.length; i++) {
    const a = r1[i], b = r2[i];
    if (a == null || a === '' || b == null || b === '') continue; // need both
    pairs.push([String(a), String(b)]);
  }
  const n = pairs.length;
  if (n < 1) return null;

  const cats = [...new Set(pairs.flatMap(p => p))];
  const m1 = Object.fromEntries(cats.map(c => [c, 0]));
  const m2 = Object.fromEntries(cats.map(c => [c, 0]));
  let agree = 0;
  for (const [a, b] of pairs) {
    if (a === b) agree++;
    m1[a]++; m2[b]++;
  }
  const po = agree / n;
  let pe = 0;
  for (const c of cats) pe += (m1[c] / n) * (m2[c] / n);

  const kappa = pe >= 1 ? 1 : (po - pe) / (1 - pe);
  const se = pe >= 1 ? 0 : Math.sqrt((po * (1 - po)) / (n * (1 - pe) * (1 - pe)));
  return {
    kappa, po, pe, se,
    lo: kappa - Z975 * se,
    hi: kappa + Z975 * se,
    n, categories: cats.length, raters: 2,
    interpretation: interpretKappa(kappa),
  };
}

/**
 * Build a Fleiss count matrix from per-subject rater labels.
 * @param {Array<Array>} perSubject  rows of rater labels for each subject (constant length)
 * @param {Array<string>} [categories]  fixed category order; inferred if omitted
 * @returns {{ matrix: number[][], categories: string[] }}
 */
export function toFleissMatrix(perSubject, categories) {
  const cats = categories
    ? categories.map(String)
    : [...new Set(perSubject.flat().map(String))];
  const index = Object.fromEntries(cats.map((c, i) => [c, i]));
  const matrix = perSubject.map(row => {
    const counts = new Array(cats.length).fill(0);
    row.forEach(label => { const j = index[String(label)]; if (j != null) counts[j]++; });
    return counts;
  });
  return { matrix, categories: cats };
}

/**
 * Fleiss' κ for m raters (m ≥ 2, constant across subjects) over N subjects.
 *
 * P_i  = (Σ_j n_ij² − m) / (m(m−1))     per-subject agreement
 * Pbar = mean_i P_i
 * p_j  = column proportion of all assignments
 * Pe   = Σ_j p_j²
 * κ    = (Pbar − Pe) / (1 − Pe)
 * SE under H0 (Fleiss, Levin & Paik 2003):
 *   A = Σ p_j(1−p_j) ; B = Σ p_j(1−p_j)(1−2p_j)
 *   SE = √(2(A² − B)) / (A·√(N·m·(m−1)))
 *
 * @param {number[][]} matrix  N×C non-negative integer counts; each row sums to m
 * @returns {object|null} { kappa, Pbar, Pe, se, lo, hi, N, raters, categories, pj, interpretation }
 */
export function fleissKappa(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 1) return null;
  const rows = matrix.filter(r => Array.isArray(r) && r.length);
  const N = rows.length;
  if (N < 1) return null;
  const C = rows[0].length;
  const m = rows[0].reduce((a, b) => a + b, 0);
  if (m < 2) return null;
  // Require a constant number of ratings per subject (Fleiss' assumption).
  if (rows.some(r => r.length !== C || r.reduce((a, b) => a + b, 0) !== m)) return null;

  const colTotals = new Array(C).fill(0);
  for (const r of rows) for (let j = 0; j < C; j++) colTotals[j] += r[j];
  const pj = colTotals.map(t => t / (N * m));
  const Pe = pj.reduce((a, p) => a + p * p, 0);

  const Pi = rows.map(r => (r.reduce((a, v) => a + v * v, 0) - m) / (m * (m - 1)));
  const Pbar = Pi.reduce((a, b) => a + b, 0) / N;

  const kappa = Pe >= 1 ? 1 : (Pbar - Pe) / (1 - Pe);

  // Asymptotic SE under H0: κ = 0.
  const A = pj.reduce((a, p) => a + p * (1 - p), 0);
  const B = pj.reduce((a, p) => a + p * (1 - p) * (1 - 2 * p), 0);
  const se = A > 0 ? Math.sqrt(2 * (A * A - B)) / (A * Math.sqrt(N * m * (m - 1))) : 0;

  return {
    kappa, Pbar, Pe, se,
    lo: kappa - Z975 * se,
    hi: kappa + Z975 * se,
    N, raters: m, categories: C, pj,
    interpretation: interpretKappa(kappa),
  };
}
