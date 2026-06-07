/**
 * math-helpers.js
 * Low-level mathematical utilities used by the meta-analysis engine.
 * All formulas are copied verbatim from meta-lab-3-patched.jsx to preserve
 * numerical behaviour exactly.
 */

// ── Exact 97.5th percentile of the standard normal (qnorm(0.975)) ──
export const Z975 = 1.959963984540054;

/**
 * normalCDF(z)
 * Abramowitz & Stegun rational approximation of the standard-normal CDF.
 * Maximum error ≈ 1.5 × 10⁻⁷.
 * @param {number} z
 * @returns {number} P(Z ≤ z)
 */
export function normalCDF(z) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const za = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * za);
  let poly = 0;
  for (let i = 4; i >= 0; i--) poly = a[i] + t * poly;
  return 0.5 * (1 + sign * (1 - poly * t * Math.exp(-za * za)));
}

/**
 * invNorm(p)
 * Inverse normal CDF — Acklam's rational-approximation algorithm.
 * Used by median/IQR → SD conversions and the p-value → SE converter.
 * @param {number} p  probability in (0, 1)
 * @returns {number}  z such that Φ(z) = p, or NaN if p out of range
 */
export function invNorm(p) {
  if (p <= 0 || p >= 1) return NaN;
  const a = [
    -3.969683028665376e+01,  2.209460984245205e+02,
    -2.759285104469687e+02,  1.383577518672690e+02,
    -3.066479806614716e+01,  2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,  1.615858368580409e+02,
    -1.556989798598866e+02,  6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
     4.374664141464968e+00,  2.938163982698783e+00,
  ];
  const d = [
     7.784695709041462e-03,  3.224671290700398e-01,
     2.445134137142996e+00,  3.754408661907416e+00,
  ];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

/**
 * invNormAbs(p)
 * Returns the absolute z-value for a given upper-tail probability
 * (e.g. p=0.975 → 1.96). Used as a normal fallback for tCrit when df is infinite.
 * @param {number} p  e.g. 0.975 for a 95% two-sided interval
 * @returns {number}
 */
export function invNormAbs(p) {
  if (p === 0.975) return 1.959963985;
  if (p === 0.95)  return 1.644853627;
  // generic: invert normalCDF by bisection
  let lo = 0, hi = 10, mid;
  for (let i = 0; i < 100; i++) {
    mid = (lo + hi) / 2;
    if (normalCDF(mid) < p) lo = mid; else hi = mid;
  }
  return mid;
}

/**
 * lgamma(z)
 * Lanczos approximation to ln Γ(z).  Used by ibeta and gammp.
 * @param {number} z  positive real
 * @returns {number}  ln Γ(z)
 */
export function lgamma(z) {
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) { y++; ser += g[j] / y; }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * betacf(x, a, b)
 * Lentz continued-fraction evaluation of the incomplete beta function.
 * Used by ibeta (and therefore tCDF).
 * @returns {number}
 */
export function betacf(x, a, b) {
  const fpmin = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-7) break;
  }
  return h;
}

/**
 * ibeta(x, a, b)
 * Regularised incomplete beta function I_x(a,b).
 * @returns {number} value in [0, 1]
 */
export function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) +
                      a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
  return 1 - bt * betacf(1 - x, b, a) / b;
}

/**
 * gammp(a, x)
 * Regularised lower incomplete gamma P(a, x).
 * Numerical Recipes: series for x < a+1, continued fraction otherwise.
 * Used by chiSquareCDF.
 * @returns {number} value in [0, 1]
 */
export function gammp(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // series expansion
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 1; n <= 300; n++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  } else {
    // continued fraction for Q, return 1 - Q
    const fpmin = 1e-300;
    let b = x + 1 - a, c = 1 / fpmin, d = 1 / b, h = d;
    for (let i = 1; i <= 300; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < fpmin) d = fpmin;
      c = b + an / c; if (Math.abs(c) < fpmin) c = fpmin;
      d = 1 / d;
      const del2 = d * c; h *= del2;
      if (Math.abs(del2 - 1) < 1e-12) break;
    }
    const Q = Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
    return 1 - Q;
  }
}

/**
 * chiSquareCDF(x, df)
 * Chi-square CDF with `df` degrees of freedom evaluated at `x`.
 * @returns {number} P(χ²(df) ≤ x)
 */
export function chiSquareCDF(x, df) {
  if (x <= 0) return 0;
  return gammp(df / 2, x / 2);
}

/**
 * tCDF(t, df)
 * Two-sided Student-t CDF: P(T ≤ t) for df > 0.
 * @returns {number}
 */
export function tCDF(t, df) {
  const x = df / (df + t * t);
  const ib = 0.5 * ibeta(x, df / 2, 0.5);
  return t > 0 ? 1 - ib : ib;
}

/**
 * tCrit(conf, df)
 * Critical value t* such that P(-t* < T < t*) = conf (two-sided).
 * Falls back to normal approximation when df is infinite or ≤ 0.
 * @param {number} conf  e.g. 0.95 for a 95% interval
 * @param {number} df    degrees of freedom
 * @returns {number}
 */
export function tCrit(conf, df) {
  if (!isFinite(df) || df <= 0) return invNormAbs((1 + conf) / 2);
  const target = (1 + conf) / 2;
  let lo = 0, hi = 200, mid;
  for (let i = 0; i < 100; i++) {
    mid = (lo + hi) / 2;
    if (tCDF(mid, df) < target) lo = mid; else hi = mid;
  }
  return mid;
}
