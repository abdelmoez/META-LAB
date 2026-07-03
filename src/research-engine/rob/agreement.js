/**
 * agreement.js — reviewer agreement for ORDINAL risk-of-bias judgements.
 *
 * PURE, framework-free. RoB judgements are ordinal (RoB 2: low < some < high;
 * ROBINS-I: low < moderate < serious < critical). Plain Cohen's κ treats every
 * disagreement equally; for ordinal scales a WEIGHTED κ that penalises
 * "low vs high" more than "low vs some" is the correct statistic. This module
 * provides linear- and quadratic-weighted κ (Cohen 1968) with the Fleiss–Cohen–
 * Everitt (1969) asymptotic standard error, plus a domain-level agreement report
 * for machine-suggested-vs-human (or reviewer-vs-reviewer) appraisals.
 *
 * Ordinal ORDER matters for the weights, so `categories` is ALWAYS taken
 * explicitly (in ascending severity order) — never inferred by sorting labels —
 * and instruments with different level sets must not be mixed in one call.
 *
 * Validated against hand-computed worked examples (see
 * tests/unit/robAgreement.test.js).
 */

import { interpretKappa } from '../screening/agreement.js';

export { interpretKappa };

const Z975 = 1.959963984540054;

/** Disagreement weight d(i,j) for the chosen scheme (0 = identical, up to 1). */
function disagreementWeight(i, j, K, scheme) {
  if (i === j) return 0;
  if (scheme === 'unweighted') return 1;
  if (K <= 1) return 0;
  if (scheme === 'quadratic') return ((i - j) * (i - j)) / ((K - 1) * (K - 1));
  // default: linear
  return Math.abs(i - j) / (K - 1);
}

/**
 * Weighted Cohen's κ for two raters over an ordinal scale.
 *
 * κ_w = (po − pe) / (1 − pe), where po/pe use AGREEMENT weights w = 1 − d:
 *   po = Σ_ij w_ij p_ij            (p_ij = O_ij / n)
 *   pe = Σ_ij w_ij p_i· p_·j       (marginal products)
 * SE is the Fleiss–Cohen–Everitt (1969) large-sample estimate.
 *
 * @param {Array} r1  rater 1's ordinal labels (parallel to r2; blanks skipped)
 * @param {Array} r2  rater 2's ordinal labels
 * @param {{categories:Array<string>, weights?:'linear'|'quadratic'|'unweighted'}} opts
 * @returns {object|null} { kappa, se, ciLo, ciHi, n, weights, po, pe, categories, interpretation }
 */
export function weightedKappa(r1, r2, opts = {}) {
  const scheme = opts.weights || 'linear';
  if (!Array.isArray(r1) || !Array.isArray(r2) || r1.length !== r2.length) return null;

  // Category order (ascending severity). Explicit if given; else first-appearance order.
  let categories = opts.categories ? opts.categories.map(String) : null;
  if (!categories) {
    const seen = [];
    for (let i = 0; i < r1.length; i++) {
      for (const v of [r1[i], r2[i]]) {
        if (v == null || v === '') continue;
        const s = String(v);
        if (!seen.includes(s)) seen.push(s);
      }
    }
    categories = seen;
  }
  const K = categories.length;
  if (K < 1) return null;
  const index = Object.fromEntries(categories.map((c, i) => [c, i]));

  // Observed KxK count matrix from valid pairs.
  const O = Array.from({ length: K }, () => new Array(K).fill(0));
  let n = 0;
  for (let t = 0; t < r1.length; t++) {
    const a = r1[t], b = r2[t];
    if (a == null || a === '' || b == null || b === '') continue;
    const i = index[String(a)], j = index[String(b)];
    if (i == null || j == null) continue; // outside the declared category set → skip
    O[i][j] += 1;
    n += 1;
  }
  if (n < 1) return null;

  const rowT = O.map(row => row.reduce((s, v) => s + v, 0));
  const colT = new Array(K).fill(0);
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) colT[j] += O[i][j];

  // Agreement weights w = 1 - d.
  const w = Array.from({ length: K }, (_, i) =>
    Array.from({ length: K }, (_, j) => 1 - disagreementWeight(i, j, K, scheme)));

  let po = 0, pe = 0;
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      po += w[i][j] * (O[i][j] / n);
      pe += w[i][j] * (rowT[i] / n) * (colT[j] / n);
    }
  }

  let kappa;
  if (1 - pe <= 1e-12) {
    kappa = po >= 1 - 1e-9 ? 1 : 0;
    return {
      kappa, se: 0, ciLo: kappa, ciHi: kappa, n, weights: scheme, po, pe,
      categories, interpretation: interpretKappa(kappa),
    };
  }
  kappa = (po - pe) / (1 - pe);

  // Fleiss–Cohen–Everitt (1969) asymptotic variance.
  const wbarRow = new Array(K).fill(0); // Σ_j p_·j w_ij
  const wbarCol = new Array(K).fill(0); // Σ_i p_i· w_ij
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) wbarRow[i] += (colT[j] / n) * w[i][j];
  for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) wbarCol[j] += (rowT[i] / n) * w[i][j];

  let sum = 0;
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      const pij = O[i][j] / n;
      if (pij === 0) continue;
      const term = w[i][j] * (1 - pe) - (wbarRow[i] + wbarCol[j]) * (1 - po);
      sum += pij * term * term;
    }
  }
  const variance = (sum - Math.pow(po * pe - 2 * pe + po, 2)) / (n * Math.pow(1 - pe, 4));
  const se = Math.sqrt(Math.max(0, variance));

  return {
    kappa,
    se,
    ciLo: kappa - Z975 * se,
    ciHi: kappa + Z975 * se,
    n,
    weights: scheme,
    po,
    pe,
    categories,
    interpretation: interpretKappa(kappa),
  };
}

/**
 * Unweighted Cohen's κ for RoB categories (every disagreement weighted equally).
 * Equivalent to the standard Cohen's κ; provided as a named convenience.
 */
export function cohenKappaRob(r1, r2, opts = {}) {
  return weightedKappa(r1, r2, { ...opts, weights: 'unweighted' });
}

/** Exact-match proportion over paired labels (blanks skipped). */
function percentAgreementOf(a, b) {
  let n = 0, agree = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x == null || x === '' || y == null || y === '') continue;
    n += 1;
    if (String(x) === String(y)) agree += 1;
  }
  return { n, agree, pct: n ? agree / n : 0 };
}

/**
 * Reviewer agreement across per-(study, domain) RoB judgements.
 *
 * @param {Array<{studyId?:string, domainId:string, a:string, b:string}>} pairs
 *        one row per assessed (study, domain); `a` and `b` are the two raters'
 *        judgements (e.g. machine-suggested vs human-final).
 * @param {{categories:Array<string>, weights?:'linear'|'quadratic'|'unweighted'}} opts
 * @returns {{
 *   overall: object|null,
 *   byDomain: Array<{domainId, kappa:number|null, agreementPct:number, n:number}>,
 *   disagreements: Array<{studyId, domainId, a, b}>,
 *   percentAgreement: number,
 *   n: number
 * }}
 */
export function robDomainAgreement(pairs = [], opts = {}) {
  const rows = Array.isArray(pairs) ? pairs.filter(p => p && p.a != null && p.b != null && p.a !== '' && p.b !== '') : [];
  const categories = opts.categories;
  const weights = opts.weights || 'linear';

  const allA = rows.map(p => p.a);
  const allB = rows.map(p => p.b);
  const overall = weightedKappa(allA, allB, { categories, weights });
  const pa = percentAgreementOf(allA, allB);

  // Per-domain.
  const byDomainMap = new Map();
  for (const p of rows) {
    const d = p.domainId || '';
    if (!byDomainMap.has(d)) byDomainMap.set(d, { a: [], b: [] });
    const g = byDomainMap.get(d);
    g.a.push(p.a);
    g.b.push(p.b);
  }
  const byDomain = [...byDomainMap.entries()].map(([domainId, g]) => {
    const k = weightedKappa(g.a, g.b, { categories, weights });
    const dp = percentAgreementOf(g.a, g.b);
    return { domainId, kappa: k ? k.kappa : null, agreementPct: dp.pct, n: dp.n };
  });

  const disagreements = rows
    .filter(p => String(p.a) !== String(p.b))
    .map(p => ({ studyId: p.studyId, domainId: p.domainId, a: p.a, b: p.b }));

  return {
    overall,
    byDomain,
    disagreements,
    percentAgreement: pa.pct,
    n: pa.n,
  };
}

export const ROB_AGREEMENT_VERSION = 'v1';
