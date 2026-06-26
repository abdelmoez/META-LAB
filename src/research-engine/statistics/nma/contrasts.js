/**
 * contrasts.js — arm-level → contrast-level derivation for Network Meta-Analysis.
 *
 * This module turns raw extracted arm data (events/n for binary, mean/sd/n for
 * continuous) into the contrast-level effects + within-study covariance that the
 * frequentist GLS engine consumes. It is where the two classic NMA errors are
 * prevented:
 *   1. Multi-arm trials are reduced to (m−1) contrasts against a single study
 *      baseline, with the CORRECT covariance (shared-baseline correlation), so a
 *      3-arm trial is NOT split into 3 independent pairwise contrasts and the shared
 *      arm is not double-counted.
 *   2. Zero-cell binary studies get an explicit, recorded continuity correction
 *      applied ONLY inside the analysis transformation — the raw counts are never
 *      mutated.
 *
 * Supported effect measures (`sm`):
 *   - 'OR'  log odds ratio        arm y = log(e/(n−e)),  v = 1/e + 1/(n−e)
 *   - 'RR'  log risk ratio        arm y = log(e/n),      v = 1/e − 1/n
 *   - 'RD'  risk difference       arm y = e/n,           v = p(1−p)/n
 *   - 'MD'  mean difference       arm y = mean,          v = sd²/n
 *   - 'GENERIC' contrast-level pre-computed effects (e.g. log hazard ratio + SE)
 *
 * Ratio measures ('OR','RR') and 'GENERIC' log-scale effects are carried on the LOG
 * scale internally (matching the pairwise engine), exponentiated only at the display
 * edge. 'RD' and 'MD' are on the natural scale. `isLogScale(sm)` exposes this.
 *
 * Orientation convention (centralized + tested in orientation.js): a contrast
 * "t2 vs t1" is the effect of t2 relative to baseline t1. For arm-based studies the
 * study baseline is the arm whose canonical treatment sorts first, so derivation is
 * order-invariant.
 */

export const RATIO_MEASURES = new Set(['OR', 'RR']);
export function isLogScale(sm) { return RATIO_MEASURES.has(sm) || sm === 'GENERIC'; }
export const ARM_MEASURES = new Set(['OR', 'RR', 'RD', 'MD']);

/** Default continuity correction (added to each cell of every arm in a study that
 *  has at least one zero/full cell), matching the common `incr = 0.5` convention. */
export const DEFAULT_CC = 0.5;

function num(x) { const v = typeof x === 'string' ? parseFloat(x) : x; return Number.isFinite(v) ? v : NaN; }

/** Whether a binary arm needs a continuity correction (zero or full cell). */
function binaryArmDegenerate(e, n) { return e <= 0 || e >= n; }

/**
 * armEffect(sm, arm, cc) → { y, v } the arm-level effect + variance on the analysis
 * scale, or null if the arm is unusable. `cc` is the continuity correction to add to
 * binary cells (0 when none needed).
 */
export function armEffect(sm, arm, cc = 0) {
  if (sm === 'MD') {
    const mean = num(arm.mean), sd = num(arm.sd), n = num(arm.n);
    if (!Number.isFinite(mean) || !(sd >= 0) || !(n > 0)) return null;
    return { y: mean, v: (sd * sd) / n };
  }
  // binary families
  let e = num(arm.events), n = num(arm.n);
  if (!Number.isFinite(e) || !(n > 0) || e < 0 || e > n) return null;
  if (cc > 0) { e += cc; n += 2 * cc; }
  const ne = n - e;
  if (sm === 'OR') return { y: Math.log(e / ne), v: 1 / e + 1 / ne };
  if (sm === 'RR') return { y: Math.log(e / n), v: 1 / e - 1 / n };
  if (sm === 'RD') { const p = e / n; return { y: p, v: (p * (1 - p)) / n }; }
  return null;
}

/**
 * deriveStudyContrasts(study, sm, opts) → per-study contrast block, or
 * { error } if the study cannot contribute.
 *
 * study (arm-based):    { id, label, design, arms: [{ treatment, events?, n?, mean?, sd? }] }
 * study (generic):      { id, label, design, contrasts: [{ t1, t2, te, seTE }] }  // 2-arm only
 *
 * Returns:
 *   {
 *     id, label, design, treatments:[canonical ids in this study],
 *     baseline, arms:[{ treatment, y, v, raw }],
 *     contrasts:[{ t1, t2, y, v }],     // t1 = baseline, (m−1) of them
 *     S: number[][],                    // (m−1)×(m−1) contrast covariance
 *     ccApplied: boolean, cc: number, multiArm: boolean,
 *   }
 */
export function deriveStudyContrasts(study, sm, opts = {}) {
  const cc = opts.cc != null ? opts.cc : DEFAULT_CC;
  const id = study.id;
  const label = study.label || study.id;
  const design = study.design || 'parallel';

  // ── Generic contrast-level studies (pre-computed effect + SE) ──
  if (sm === 'GENERIC' || (Array.isArray(study.contrasts) && study.contrasts.length && !study.arms)) {
    const cs = (study.contrasts || []).map((c) => ({
      t1: c.t1, t2: c.t2, y: num(c.te), v: Math.pow(num(c.seTE), 2),
    })).filter((c) => c.t1 && c.t2 && Number.isFinite(c.y) && c.v > 0);
    if (!cs.length) return { id, label, error: 'No valid contrast (te/seTE) provided' };
    if (cs.length > 1) {
      // Multi-arm generic studies need a supplied covariance; we do not invent one.
      return { id, label, error: 'Multi-arm generic (contrast-level) studies require a supplied covariance and are not yet supported; provide arm-level data.' };
    }
    const c = cs[0];
    const treatments = [c.t1, c.t2].sort();
    const baseline = treatments[0];
    const sign = c.t2 === baseline ? -1 : 1;
    const other = c.t2 === baseline ? c.t1 : c.t2;
    return {
      id, label, design, treatments, baseline,
      arms: [], ccApplied: false, cc: 0, multiArm: false,
      contrasts: [{ t1: baseline, t2: other, y: sign * c.y, v: c.v }],
      S: [[c.v]],
    };
  }

  // ── Arm-based studies ──
  const rawArms = Array.isArray(study.arms) ? study.arms.filter((a) => a && a.treatment != null) : [];
  if (rawArms.length < 2) return { id, label, error: 'Study has fewer than 2 usable arms' };

  // Continuity correction decision: any binary arm with a zero/full cell triggers a
  // study-wide correction (recorded), applied only in the transformation.
  let ccApplied = false;
  if (sm === 'OR' || sm === 'RR' || sm === 'RD') {
    ccApplied = rawArms.some((a) => binaryArmDegenerate(num(a.events), num(a.n)));
    if (sm === 'RD') {
      // RD only needs a correction when a degenerate cell makes the variance 0.
      ccApplied = rawArms.some((a) => { const e = num(a.events), n = num(a.n); return e <= 0 || e >= n; });
    }
  }
  const appliedCc = ccApplied ? cc : 0;

  const arms = [];
  for (const a of rawArms) {
    const eff = armEffect(sm, a, appliedCc);
    if (!eff) return { id, label, error: `Arm "${a.treatment}" has invalid or missing data` };
    arms.push({ treatment: a.treatment, y: eff.y, v: eff.v, raw: a });
  }
  // Detect duplicate treatments within a study (an extraction error).
  const seen = new Set();
  for (const a of arms) { if (seen.has(a.treatment)) return { id, label, error: `Treatment "${a.treatment}" appears in more than one arm` }; seen.add(a.treatment); }

  // Baseline = the canonical treatment that sorts first → order-invariant derivation.
  arms.sort((x, y) => (String(x.treatment) < String(y.treatment) ? -1 : String(x.treatment) > String(y.treatment) ? 1 : 0));
  const baseline = arms[0].treatment;
  const v0 = arms[0].v;
  const others = arms.slice(1);
  const m = others.length; // number of contrasts = (#arms − 1)

  const contrasts = others.map((a) => ({ t1: baseline, t2: a.treatment, y: a.y - arms[0].y, v: a.v + v0 }));
  // Multi-arm covariance: Cov(y_j, y_k) = Var(baseline) for j ≠ k.
  const S = [];
  for (let j = 0; j < m; j++) {
    S.push(new Array(m));
    for (let k = 0; k < m; k++) S[j][k] = j === k ? others[j].v + v0 : v0;
  }

  return {
    id, label, design,
    treatments: arms.map((a) => a.treatment),
    baseline, arms,
    contrasts, S,
    ccApplied, cc: appliedCc, multiArm: m >= 2,
  };
}

/**
 * deriveNetwork(studies, sm, opts) → {
 *   ok, studies:[derived...], errors:[{ id, error }], treatments:[sorted ids],
 *   pairwise:[{ t1, t2, studyId, y, se }],  // per-study direct contrasts (for direct pooling + funnel)
 *   ccCount, multiArmCount,
 * }
 * Pure: never throws on per-study issues — collects them as errors for the readiness UI.
 */
export function deriveNetwork(studies, sm, opts = {}) {
  const derived = [];
  const errors = [];
  const tset = new Set();
  const pairwise = [];
  let ccCount = 0, multiArmCount = 0;

  for (const st of (studies || [])) {
    const d = deriveStudyContrasts(st, sm, opts);
    if (d.error) { errors.push({ id: d.id, label: d.label, error: d.error }); continue; }
    derived.push(d);
    d.treatments.forEach((t) => tset.add(t));
    if (d.ccApplied) ccCount++;
    if (d.multiArm) multiArmCount++;
    // Per-study direct contrasts (each contrast's own variance — for direct pooling
    // and the comparison-adjusted funnel; multi-arm correlation handled in the GLS).
    d.contrasts.forEach((c) => pairwise.push({ t1: c.t1, t2: c.t2, studyId: d.id, label: d.label, y: c.y, se: Math.sqrt(c.v) }));
  }

  return {
    ok: derived.length > 0,
    studies: derived,
    errors,
    treatments: Array.from(tset).sort(),
    pairwise,
    ccCount, multiArmCount,
    sm, isLog: isLogScale(sm),
  };
}
