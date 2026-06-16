/**
 * tests/fixtures/meta/canonical.js
 *
 * Canonical meta-analysis datasets with externally-anchored expected values,
 * used by the golden tests in tests/unit/statistics/**.
 *
 * Two kinds of anchor are used (both are "external references" in the sense of
 * roadmap A.3 — neither is read back from the engine under test):
 *
 *   1. HAND-COMPUTED fixtures (HC2, HC3): tiny datasets whose effect sizes and
 *      standard errors are chosen so every pooled quantity (fixed/random ES,
 *      pooled SE, Q, I², τ², z, CI, HKSJ) is computable by hand from the
 *      published formulae. The expected values below are worked out in the
 *      comments — they do not come from running this engine. This is the
 *      strongest check because the arithmetic is fully auditable.
 *
 *   2. metafor-PINNED fixture (D14): the 14-study Cohen's d dataset already
 *      validated against R `metafor` elsewhere in this repo. The pinned values
 *      (DL pooled 0.6137; Egger intercept 1.86 / t 1.01 / p 0.334 from
 *      metafor::regtest(model="lm"); trim-and-fill RE k0=0, FE k0=4 / 0.2422
 *      from metafor::trimfill) are reproduced here so the per-estimator files
 *      can re-pin them independently.
 *
 * Every {es,lo,hi} record is built from {es,se} using the SAME Z975 the engine
 * uses to recover SE from a 95% CI, so the SE round-trips exactly:
 *      lo = es - Z975*se ,  hi = es + Z975*se ,  Z975 = 1.959963984540054
 */

export const Z975 = 1.959963984540054;

/** Build an engine-shaped study {id,es,lo,hi} from {es,se}. */
export function fromSE(es, se, id) {
  return { id, es: String(es), lo: String(es - Z975 * se), hi: String(es + Z975 * se) };
}

/* ──────────────────────────────────────────────────────────────────────────
   HC2 — two studies, equal-to-hand inverse-variance pooling.
   A: es=0.2, se=0.1 → w = 1/0.01 = 100
   B: es=0.4, se=0.2 → w = 1/0.04 = 25
   W = 125
   fixed ES = (100·0.2 + 25·0.4)/125 = (20+10)/125 = 0.24
   fixed SE = sqrt(1/125)            = 0.08944271909999159
   Q = 100·(0.2−0.24)² + 25·(0.4−0.24)² = 0.16 + 0.64 = 0.80
   I² = max(0,(Q−(k−1))/Q)·100 = (0.8−1)/0.8 < 0 → 0
   τ² = max(0,(Q−1)/(W − W²/W)); W²=10625; W−W²/W = 125−85 = 40; (0.8−1)/40<0 → 0
   With τ²=0 the random-effects result collapses to the fixed-effects result.
   ────────────────────────────────────────────────────────────────────────── */
export const HC2 = {
  studies: [fromSE(0.2, 0.1, 'A'), fromSE(0.4, 0.2, 'B')],
  fixedES: 0.24,
  fixedSE: 0.08944271909999159,
  Q: 0.8,
  I2: 0,
  tau2: 0,
};

/* ──────────────────────────────────────────────────────────────────────────
   HC3 — three equal-weight studies spread symmetrically (positive τ²).
   A: es=0.1, se=0.1 → w=100
   B: es=0.5, se=0.1 → w=100
   C: es=0.9, se=0.1 → w=100
   W = 300 ; fixed ES = (0.1+0.5+0.9)/3 = 0.5
   fixed SE = sqrt(1/300) = 0.0577350269189626
   Q = 100·((0.1−0.5)²+(0.5−0.5)²+(0.9−0.5)²) = 100·(0.16+0+0.16) = 32
   k=3 → I² = (32−2)/32·100 = 93.75
   τ²: W²=30000; W−W²/W = 300−100 = 200; τ² = (32−2)/200 = 0.15 ; τ = 0.3872983346207417
   random weights w* = 1/(0.01+0.15) = 6.25 (equal) → random ES = 0.5
   random SE = sqrt(1/(3·6.25)) = sqrt(1/18.75) = 0.23094010767585033
   z(random) = 0.5 / 0.23094010767585033 = 2.1650635094610964
   HKSJ: q_HK = (1/2)·6.25·(0.16+0+0.16) = 1.0 → seHK = sqrt(1)·sqrt(1/18.75) = 0.23094010767585033
         t = 0.5/0.23094... = 2.1650635 ; df = 2
   ────────────────────────────────────────────────────────────────────────── */
export const HC3 = {
  studies: [fromSE(0.1, 0.1, 'A'), fromSE(0.5, 0.1, 'B'), fromSE(0.9, 0.1, 'C')],
  fixedES: 0.5,
  fixedSE: 0.0577350269189626,
  randomES: 0.5,
  randomSE: 0.23094010767585033,
  Q: 32,
  I2: 93.75,
  tau2: 0.15,
  tau: 0.3872983346207417,
  zRandom: 2.1650635094610964,
  hksjSE: 0.23094010767585033,
  hksjT: 2.1650635094610964,
  hksjDf: 2,
};

/* ──────────────────────────────────────────────────────────────────────────
   D14 — 14 Cohen's d studies, pinned to R metafor.
   R reference calls (metafor 4.x):
     dat <- data.frame(yi=c(...), sei=c(...))
     rma(yi, sei=sei, method="DL")          # DL pooled estimate ≈ 0.6137
     regtest(rma(yi, sei=sei, method="FE"), model="lm")  # intercept 1.86, t 1.01, p 0.334
     trimfill(rma(yi, sei=sei, method="DL"))  # k0 = 0 (no shift)
     trimfill(rma(yi, sei=sei, method="FE"))  # k0 = 4, estimate ≈ 0.2422, side "left"
   ────────────────────────────────────────────────────────────────────────── */
const D14_RAW = [
  { es: 1.4623, se: 0.6017 }, { es: 1.3832, se: 0.5950 }, { es: 1.1427, se: 0.3946 },
  { es: -0.1032, se: 0.2377 }, { es: -0.3918, se: 0.2289 }, { es: 2.1994, se: 0.3028 },
  { es: 1.1561, se: 0.6237 }, { es: 0.0732, se: 0.5775 }, { es: 0.7774, se: 0.2968 },
  { es: 0.1620, se: 0.5008 }, { es: 0.1659, se: 0.5009 }, { es: 0.5937, se: 0.2867 },
  { es: 0.6990, se: 0.2540 }, { es: -0.3172, se: 0.3803 },
];

export const D14 = {
  studies: D14_RAW.map((s, i) => fromSE(s.es, s.se, 'd' + i)),
  dlPooled: 0.6137,        // metafor::rma(method="DL")$b
  eggerIntercept: 1.86,    // metafor::regtest(model="lm")$est
  eggerT: 1.01,
  eggerP: 0.334,
  trimfillRE_k0: 0,
  trimfillFE_k0: 4,
  trimfillFE_adjusted: 0.2422,
};
