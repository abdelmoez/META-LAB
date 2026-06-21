/**
 * drift.js — model drift tracking across scoring runs (se2.md §11). Pure functions,
 * no DB, no network, deterministic.
 *
 * Each scoring run is a model version. drift compares a new run against the previously
 * active one and raises explicit WARNINGS when quality deteriorates or the model's
 * behaviour shifts in a way a human should review before trusting the new scores:
 * AUC/Brier/calibration worsening, prevalence or score-distribution shift, or the model
 * collapsing toward a single output. Drift is informational — it never blocks a run or
 * changes a decision.
 */

/**
 * scoreHistogram — fractional histogram of scores over [0,1] in `bins` equal buckets,
 * plus mean and n. Deterministic. Used both to summarise a run and to measure shift.
 * @returns {{ bins:number, n:number, mean:number, hist:number[] }}
 */
export function scoreHistogram(scores, bins = 10) {
  const arr = (scores || []).filter(s => Number.isFinite(s));
  const hist = new Array(bins).fill(0);
  let sum = 0;
  for (const s of arr) {
    const v = Math.min(1, Math.max(0, s));
    let b = Math.floor(v * bins); if (b >= bins) b = bins - 1;
    hist[b]++; sum += v;
  }
  const n = arr.length;
  return { bins, n, mean: n ? sum / n : 0, hist: hist.map(c => (n ? c / n : 0)) };
}

/**
 * populationStabilityIndex — PSI between two fractional histograms (same bin count).
 * PSI < 0.1 ≈ no shift, 0.1–0.25 ≈ moderate, > 0.25 ≈ large shift. A small epsilon
 * avoids log(0). Returns null if the histograms are incomparable.
 */
export function populationStabilityIndex(prevHist, currHist) {
  if (!Array.isArray(prevHist) || !Array.isArray(currHist) || prevHist.length !== currHist.length || !prevHist.length) return null;
  const eps = 1e-4;
  let psi = 0;
  for (let i = 0; i < prevHist.length; i++) {
    const p = Math.max(eps, prevHist[i]);
    const c = Math.max(eps, currHist[i]);
    psi += (c - p) * Math.log(c / p);
  }
  return psi;
}

/**
 * detectClassCollapse — true when the run's scores pile into a single histogram bucket
 * (the model is no longer discriminating — e.g. everything ~0 or ~1). `maxFraction` is
 * the share in one bin above which we flag collapse.
 */
export function detectClassCollapse(hist, maxFraction = 0.9) {
  if (!Array.isArray(hist) || !hist.length) return false;
  return Math.max(...hist) >= maxFraction;
}

/**
 * runDriftSnapshot — extract the comparable signals from a run's metrics + score
 * histogram into a compact, persistable snapshot.
 * @param {object} metrics — the run's computeValidation()+calibration+stopping bundle
 * @param {{hist:number[], mean:number, n:number}} dist — scoreHistogram of the run
 */
export function runDriftSnapshot(metrics = {}, dist = null) {
  const cv = metrics.crossVal && metrics.crossVal.heldOut ? metrics.crossVal : metrics;
  return {
    auc: num(cv.auc),
    wss95: num(cv.wss95),
    brier: num(metrics.calibration?.metrics?.brier),
    ece: num(metrics.calibration?.metrics?.ece),
    sensitivity: num(cv.sensitivity),
    prevalence: num(metrics.stopping?.prevalenceObserved),
    dist: dist || null,
  };
}
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export const DRIFT_DEFAULTS = Object.freeze({
  aucDrop: 0.05,        // AUC fell by at least this → warn
  wssFall: 0.05,        // WSS@95 fell by at least this → warn (independent of AUC)
  brierRise: 0.03,      // Brier worsened (rose) by at least this → warn
  eceRise: 0.05,        // calibration error rose by at least this → warn
  prevalenceShift: 0.1, // observed prevalence moved by at least this → warn
  psiLarge: 0.25,       // score-distribution PSI above this → large shift
  collapseFraction: 0.9,
});

/**
 * computeDrift — compare a new run's snapshot against the previous active run's snapshot.
 * Returns explicit, human-readable warnings + the raw deltas. With no previous run it
 * reports `baseline:true` and no warnings.
 *
 * @returns {{ baseline?:boolean, warnings:string[], deltas:object, psi:number|null, collapse:boolean }}
 */
export function computeDrift(prev, curr, cfg = {}) {
  const t = { ...DRIFT_DEFAULTS, ...cfg };
  const collapse = detectClassCollapse(curr?.dist?.hist, t.collapseFraction);
  if (!prev) {
    return { baseline: true, warnings: collapse ? ['The model is not discriminating — scores collapse into one band.'] : [], deltas: {}, psi: null, collapse };
  }
  const warnings = [];
  const deltas = {};
  const d = (k) => { const a = prev[k], b = curr[k]; if (a == null || b == null) return null; const v = b - a; deltas[k] = v; return v; };

  const dAuc = d('auc');
  if (dAuc != null && dAuc <= -t.aucDrop) warnings.push(`AUC dropped ${(Math.abs(dAuc)).toFixed(2)} vs the previous model (${prev.auc.toFixed(2)} → ${curr.auc.toFixed(2)}).`);
  const dBrier = d('brier');
  if (dBrier != null && dBrier >= t.brierRise) warnings.push(`Calibration worsened — Brier score rose ${dBrier.toFixed(2)}.`);
  const dEce = d('ece');
  if (dEce != null && dEce >= t.eceRise) warnings.push(`Calibration error (ECE) rose ${dEce.toFixed(2)}.`);
  const dWss = d('wss95');
  if (dWss != null && dWss <= -t.wssFall) warnings.push(`Work-saved (WSS@95) fell ${Math.abs(dWss).toFixed(2)}.`);
  const dPrev = d('prevalence');
  if (dPrev != null && Math.abs(dPrev) >= t.prevalenceShift) warnings.push(`Observed inclusion prevalence shifted ${dPrev > 0 ? '+' : ''}${(dPrev * 100).toFixed(0)}%.`);

  const psi = (prev.dist?.hist && curr.dist?.hist) ? populationStabilityIndex(prev.dist.hist, curr.dist.hist) : null;
  if (psi != null && psi >= t.psiLarge) warnings.push(`Score distribution shifted substantially (PSI ${psi.toFixed(2)}) — rankings may have moved a lot.`);
  if (collapse) warnings.push('The model is not discriminating — scores collapse into one band.');

  return { warnings, deltas, psi, collapse };
}
