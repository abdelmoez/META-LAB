/**
 * calibration.js — probability calibration for the screening-AI ranking score
 * (se2.md §8). Pure functions, no DB, no network, fully deterministic.
 *
 * WHY: the engine's ranking `score` ∈ [0,1] is a fused hybrid signal (and the
 * classifier `proba` is an uncalibrated logistic output). Neither is a trustworthy
 * probability, so a threshold like 0.65 has no defensible probabilistic meaning.
 * Calibration learns a monotone map  score → P(include | score)  so the thresholds,
 * the "calibrated inclusion probability" shown to reviewers, and the stopping-rule
 * recall estimate (§9, which sums calibrated probabilities) all rest on real
 * probabilities.
 *
 * HONESTY: the calibrator MUST be fit on OUT-OF-FOLD predictions (scores produced
 * by models that never saw the record — see crossValidate), never on in-sample
 * scores. Method is chosen by available sample size: too few labels → identity
 * (no calibration, stated as such); small → Platt (2 params, stable); ample →
 * isotonic (non-parametric, can overfit when sparse). Calibration metrics reported
 * here are APPARENT (computed on the same OOF pairs used to fit the low-capacity
 * calibrator) — documented as such; a nested-CV estimate is a later refinement.
 */
import { sigmoid } from './logreg.js';

const EPS = 1e-6;
const clip01 = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const logit = (p) => { const c = clip01(p); return Math.log(c / (1 - c)); };

/**
 * fit1DLogistic — fit P(t=1) = sigmoid(A·x + B) by Newton–Raphson on aligned
 * arrays x[], t[] (targets t may be smoothed, in [0,1]). Tiny ridge on the Hessian
 * keeps it non-singular on degenerate/separable data. Deterministic.
 * @returns {{A:number, B:number, iters:number, converged:boolean}}
 */
export function fit1DLogistic(x, t, opts = {}) {
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-8;
  const ridge = opts.ridge ?? 1e-8;
  const n = x.length;
  let A = 0, B = 0, iters = 0, converged = false;
  for (; iters < maxIter; iters++) {
    let gA = 0, gB = 0, hAA = ridge, hAB = 0, hBB = ridge;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(A * x[i] + B);
      const d = p - t[i];
      const w = p * (1 - p);
      gA += d * x[i]; gB += d;
      hAA += w * x[i] * x[i]; hAB += w * x[i]; hBB += w;
    }
    const det = hAA * hBB - hAB * hAB;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    const dA = (hBB * gA - hAB * gB) / det;
    const dB = (hAA * gB - hAB * gA) / det;
    A -= dA; B -= dB;
    if (Math.abs(dA) < tol && Math.abs(dB) < tol) { converged = true; iters++; break; }
  }
  if (!Number.isFinite(A) || !Number.isFinite(B)) { A = 0; B = 0; }
  return { A, B, iters, converged };
}

/**
 * fitPlatt — Platt scaling with Platt's (1999) target smoothing to avoid
 * overfitting tiny calibration sets: positives → (N+ +1)/(N+ +2), negatives →
 * 1/(N- +2). Maps score → sigmoid(A·score + B).
 * @returns {{method:'platt', A:number, B:number, converged:boolean}}
 */
export function fitPlatt(scores, labels) {
  let nPos = 0, nNeg = 0;
  for (const y of labels) (y ? nPos++ : nNeg++);
  const tPos = (nPos + 1) / (nPos + 2);
  const tNeg = 1 / (nNeg + 2);
  const t = labels.map(y => (y ? tPos : tNeg));
  const { A, B, converged } = fit1DLogistic(scores, t);
  return { method: 'platt', A, B, converged };
}

/** Apply a fitted Platt map: P(include) = sigmoid(A·score + B). */
function applyPlatt(cal, s) { return sigmoid(cal.A * s + cal.B); }

/**
 * fitIsotonic — isotonic regression via Pool-Adjacent-Violators (PAVA), producing
 * a monotone non-decreasing map score → P(include). Returns interpolation nodes
 * (strictly increasing x, with the pooled calibrated y) used for piecewise-linear
 * prediction. Deterministic; ties on score are pooled.
 * @returns {{method:'isotonic', x:number[], y:number[]}}
 */
export function fitIsotonic(scores, labels) {
  const n = scores.length;
  const idx = scores.map((s, i) => i).sort((a, b) => (scores[a] - scores[b]) || (a - b));
  // Blocks of equal score are pre-pooled (PAVA on distinct x with weights).
  const xs = [], ys = [], ws = [];
  for (const i of idx) {
    const s = scores[i], y = labels[i] ? 1 : 0;
    if (xs.length && xs[xs.length - 1] === s) {
      const k = xs.length - 1;
      ys[k] = (ys[k] * ws[k] + y) / (ws[k] + 1);
      ws[k] += 1;
    } else { xs.push(s); ys.push(y); ws.push(1); }
  }
  // PAVA: merge adjacent blocks that violate monotonicity (mean decreasing).
  const vx = [], vy = [], vw = [];
  for (let i = 0; i < xs.length; i++) {
    let cy = ys[i], cw = ws[i], cx = xs[i];
    while (vy.length && vy[vy.length - 1] > cy) {
      const py = vy.pop(), pw = vw.pop(); vx.pop();
      cy = (py * pw + cy * cw) / (pw + cw);
      cw = pw + cw;
    }
    vx.push(cx); vy.push(cy); vw.push(cw);
  }
  // Interpolation nodes: one per distinct score (xs strictly increasing), each
  // carrying the calibrated value of the merged PAVA block it belongs to. We replay
  // the merge by cumulative block weight so every original score maps to its block's
  // pooled (monotone non-decreasing) value.
  const nodesX = [], nodesY = [];
  let mergedPtr = 0, used = 0;
  for (let i = 0; i < xs.length; i++) {
    if (used >= vw[mergedPtr]) { mergedPtr++; used = 0; }
    used += ws[i];
    nodesX.push(xs[i]); nodesY.push(vy[mergedPtr]);
  }
  return { method: 'isotonic', x: nodesX, y: nodesY };
}

/** Apply a fitted isotonic map via clamped piecewise-linear interpolation. */
function applyIsotonic(cal, s) {
  const { x, y } = cal;
  if (!x.length) return s;
  if (s <= x[0]) return y[0];
  if (s >= x[x.length - 1]) return y[y.length - 1];
  // binary search for the interval [x[lo], x[hi]]
  let lo = 0, hi = x.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (x[m] <= s) lo = m; else hi = m; }
  const span = x[hi] - x[lo];
  if (span <= 0) return y[lo];
  const frac = (s - x[lo]) / span;
  return y[lo] + frac * (y[hi] - y[lo]);
}

/**
 * applyCalibrator — map a raw ranking score to a calibrated inclusion probability.
 * method 'none' is the identity (no calibration available). Always clamped to [0,1].
 */
export function applyCalibrator(cal, s) {
  if (s == null || !Number.isFinite(s)) return null;
  if (!cal || cal.method === 'none') return Math.min(1, Math.max(0, s));
  const p = cal.method === 'platt' ? applyPlatt(cal, s)
    : cal.method === 'isotonic' ? applyIsotonic(cal, s)
    : s;
  return Math.min(1, Math.max(0, p));
}

// ── Calibration quality metrics (on OOF predictions) ────────────────────────

/** Brier score = mean squared error of probabilistic predictions (lower better). */
export function brierScore(probs, labels) {
  if (!probs.length) return null;
  let s = 0;
  for (let i = 0; i < probs.length; i++) { const d = probs[i] - (labels[i] ? 1 : 0); s += d * d; }
  return s / probs.length;
}

/** Log loss (binary cross-entropy), clipped to avoid ±∞ (lower better). */
export function logLoss(probs, labels) {
  if (!probs.length) return null;
  let s = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = clip01(probs[i]); const y = labels[i] ? 1 : 0;
    s += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return s / probs.length;
}

/**
 * reliabilityBins — equal-width bins over [0,1]; for each, the mean predicted
 * probability vs the observed inclusion rate (+ count). Empty bins are omitted
 * from gap math but reported with count 0 for the curve.
 */
export function reliabilityBins(probs, labels, nBins = 10) {
  const bins = Array.from({ length: nBins }, (_, b) => ({
    binLo: b / nBins, binHi: (b + 1) / nBins, count: 0, sumPred: 0, sumObs: 0,
  }));
  for (let i = 0; i < probs.length; i++) {
    const p = Math.min(1 - EPS, Math.max(0, probs[i]));
    let b = Math.floor(p * nBins); if (b >= nBins) b = nBins - 1;
    bins[b].count++; bins[b].sumPred += probs[i]; bins[b].sumObs += (labels[i] ? 1 : 0);
  }
  return bins.map(bn => ({
    binLo: bn.binLo, binHi: bn.binHi, count: bn.count,
    meanPredicted: bn.count ? bn.sumPred / bn.count : null,
    observedRate: bn.count ? bn.sumObs / bn.count : null,
  }));
}

/** Expected Calibration Error — count-weighted mean |observed − predicted| over bins. */
export function expectedCalibrationError(probs, labels, nBins = 10) {
  if (!probs.length) return null;
  const bins = reliabilityBins(probs, labels, nBins);
  let ece = 0;
  for (const b of bins) if (b.count) ece += (b.count / probs.length) * Math.abs(b.observedRate - b.meanPredicted);
  return ece;
}

/**
 * calibrationSlopeIntercept — regress the true label on logit(p_cal) via logistic
 * regression. A perfectly-calibrated model gives slope ≈ 1, intercept ≈ 0.
 * slope < 1 → over-confident; intercept ≠ 0 → systematic over/under-prediction.
 */
export function calibrationSlopeIntercept(probs, labels) {
  if (probs.length < 3) return { slope: null, intercept: null };
  const x = probs.map(logit);
  const t = labels.map(y => (y ? 1 : 0));
  const { A, B } = fit1DLogistic(x, t);
  return { slope: A, intercept: B };
}

/**
 * calibrationMetrics — full quality bundle for a set of OOF calibrated probabilities.
 */
export function calibrationMetrics(probs, labels, opts = {}) {
  const nBins = opts.reliabilityBins ?? 10;
  let nPos = 0; for (const y of labels) if (y) nPos++;
  return {
    n: probs.length, nPos, nNeg: probs.length - nPos,
    brier: brierScore(probs, labels),
    logLoss: logLoss(probs, labels),
    ece: expectedCalibrationError(probs, labels, opts.eceBins ?? nBins),
    ...calibrationSlopeIntercept(probs, labels),
    reliability: reliabilityBins(probs, labels, nBins),
  };
}

/**
 * heldOutCalibrationMetrics — HONEST calibration quality via NESTED cross-validation
 * (screeningEngine.md task 4). The metrics returned by fitCalibrator are APPARENT:
 * they score the calibrator on the very out-of-fold pairs it was fit on, so ECE ≈ 0
 * by construction (an isotonic map fit on its own points reproduces their bin means).
 * That optimistic number is what the panel showed.
 *
 * Here we instead partition the OOF (score,label) pairs into k stratified folds; for
 * each fold we fit a calibrator (the SAME method production uses) on the OTHER folds
 * and map the held-out fold's scores through it. Pooling the held-out calibrated
 * probabilities yields an ECE / slope / intercept the calibrator never saw — the
 * number that belongs in the panel (typically ~0.02–0.03, worse on small reviews).
 *
 * The production calibrator itself (fit on ALL OOF pairs) is unchanged — only the
 * MEASUREMENT changes, exactly as the task requires.
 *
 * @param {number[]} oofScores — out-of-fold ranking scores (NOT in-sample)
 * @param {number[]} oofLabels — 1 = include, 0 = exclude
 * @param {object} [cfg] — config.calibration
 * @param {number} [k=5] — nested fold count
 * @returns {{ heldOut:true, method, n, nPos, nNeg, ece, slope, intercept, brier,
 *             logLoss, reliability, reason }}
 */
export function heldOutCalibrationMetrics(oofScores, oofLabels, cfg = {}, k = 5) {
  const scores = (oofScores || []).map(Number);
  const labels = (oofLabels || []).map((y) => (y ? 1 : 0));
  const n = labels.length;
  let nPos = 0; for (const y of labels) if (y) nPos++;
  const nNeg = n - nPos;

  const sel = selectCalibrationMethod(nPos, nNeg, cfg);
  // Need ≥ 2 of each class in every held-out fold for the metric to mean anything.
  if (sel.method === 'none' || nPos < 2 * k || nNeg < 2 * k) {
    return {
      heldOut: true, method: sel.method, n, nPos, nNeg,
      ece: null, slope: null, intercept: null, brier: null, logLoss: null, reliability: null,
      reason: sel.method === 'none'
        ? sel.reason
        : `Not enough labels per class for held-out (nested) calibration (have ${nPos} includes / ${nNeg} excludes; need ≥ ${2 * k} of each). Showing fitted calibration only.`,
    };
  }

  // Deterministic stratified split: within each class, foldOf = positionInClass % k.
  // No RNG needed (the OOF pairs already arrive in a fixed, score-uncorrelated order),
  // so the held-out metric is fully reproducible — same inputs → same ECE.
  const foldOf = new Array(n);
  let pc = 0, nc = 0;
  for (let i = 0; i < n; i++) foldOf[i] = labels[i] === 1 ? (pc++) % k : (nc++) % k;

  const heldProbs = [], heldLabels = [];
  for (let f = 0; f < k; f++) {
    const trS = [], trL = [], teIdx = [];
    for (let i = 0; i < n; i++) {
      if (foldOf[i] === f) teIdx.push(i);
      else { trS.push(scores[i]); trL.push(labels[i]); }
    }
    const cal = sel.method === 'platt' ? fitPlatt(trS, trL) : fitIsotonic(trS, trL);
    for (const i of teIdx) { heldProbs.push(applyCalibrator(cal, scores[i])); heldLabels.push(labels[i]); }
  }

  const m = calibrationMetrics(heldProbs, heldLabels, cfg);
  return {
    heldOut: true, method: sel.method, n, nPos, nNeg,
    ece: m.ece, slope: m.slope, intercept: m.intercept, brier: m.brier, logLoss: m.logLoss,
    reliability: m.reliability,
    reason: `Held-out ${k}-fold nested calibration (${sel.method}).`,
  };
}

/**
 * selectCalibrationMethod — choose a calibration strategy from the available
 * sample size (se2.md §8: Platt is stable on small data; isotonic needs more).
 * @returns {{method:'none'|'platt'|'isotonic', reason:string}}
 */
export function selectCalibrationMethod(nPos, nNeg, cfg = {}) {
  const total = nPos + nNeg;
  const minSamples = cfg.minSamplesToCalibrate ?? 50;
  const isoMin = cfg.isotonicMinSamples ?? 200;
  if (total < minSamples || nPos < 5 || nNeg < 5) {
    return { method: 'none', reason: `Not enough settled decisions to calibrate (have ${nPos} includes / ${nNeg} excludes; need ≥ ${minSamples} total and ≥ 5 per class). Showing the uncalibrated ranking score.` };
  }
  if (total >= isoMin) return { method: 'isotonic', reason: `Isotonic regression (non-parametric) — ${total} labeled examples available.` };
  return { method: 'platt', reason: `Platt scaling (stable on smaller sets) — ${total} labeled examples; isotonic used at ≥ ${isoMin}.` };
}

/**
 * fitCalibrator — top-level: choose a method by sample size, fit it on the supplied
 * OUT-OF-FOLD (score, label) pairs, then map those scores through the fitted
 * calibrator and report apparent calibration metrics. Returns a self-describing,
 * persistable calibration object.
 *
 * @param {number[]} oofScores — out-of-fold ranking scores (NOT in-sample!)
 * @param {number[]} oofLabels — 1 = include, 0 = exclude
 * @param {object} [cfg] — config.calibration
 * @returns {{ method, params, metrics, nPos, nNeg, n, reason, fittedAt:null }}
 */
export function fitCalibrator(oofScores, oofLabels, cfg = {}) {
  const scores = (oofScores || []).map(Number);
  const labels = (oofLabels || []).map(y => (y ? 1 : 0));
  let nPos = 0; for (const y of labels) if (y) nPos++;
  const nNeg = labels.length - nPos;

  const sel = selectCalibrationMethod(nPos, nNeg, cfg);
  if (sel.method === 'none') {
    return { method: 'none', params: null, metrics: null, nPos, nNeg, n: labels.length, reason: sel.reason };
  }
  const cal = sel.method === 'platt' ? fitPlatt(scores, labels) : fitIsotonic(scores, labels);
  const calProbs = scores.map(s => applyCalibrator(cal, s));
  const metrics = calibrationMetrics(calProbs, labels, cfg);
  // Strip the fitted nodes out of `metrics`; keep them in params for application.
  return {
    method: sel.method,
    params: cal,
    metrics,
    nPos, nNeg, n: labels.length,
    reason: sel.reason,
  };
}
