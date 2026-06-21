/**
 * validation.js — screening-AI validation metrics.
 *
 * Pure functions, no DB, no network. These metrics make the engine
 * scientifically defensible: they compare the AI's relevance ranking against the
 * human FINAL decisions and quantify how much screening work the AI would have
 * saved at a guaranteed recall. Definitions follow the systematic-review IR
 * literature (Cohen et al. 2006 for WSS) and are documented inline so a methods
 * section can cite them verbatim.
 *
 * Inputs are aligned arrays: `scores[i]` ∈ [0,1] is the AI relevance score for a
 * record whose human label `labels[i]` ∈ {0,1} (1 = include). The caller passes
 * ONLY records with a settled human decision.
 */

/**
 * Labels sorted by score descending, with ties broken PESSIMISTICALLY: within an
 * equal-score block, excludes (0) are ranked ABOVE includes (1), then input index.
 * For a recall-oriented screening tool this reports the worst case within ties —
 * a conservative lower bound for WSS/recall@k/stageMetrics — instead of letting
 * the (arbitrary) input order optimistically inflate the work-saved estimate.
 * (rocAuc is unaffected: it uses its own average-rank tie handling.)
 */
function rankedLabels(scores, labels) {
  const idx = scores.map((s, i) => i);
  idx.sort((a, b) =>
    (scores[b] - scores[a]) ||
    ((labels[a] ? 1 : 0) - (labels[b] ? 1 : 0)) ||
    (a - b));
  return idx.map(i => labels[i] ? 1 : 0);
}

/**
 * rocAuc — area under the ROC curve via the rank-sum (Mann–Whitney U) identity,
 * with proper average-rank handling for tied scores. Returns 0.5 when degenerate.
 * @param {number[]} scores
 * @param {number[]} labels
 * @returns {number} in [0,1]
 */
export function rocAuc(scores, labels) {
  const n = scores.length;
  let nPos = 0, nNeg = 0;
  for (const l of labels) (l ? nPos++ : nNeg++);
  if (nPos === 0 || nNeg === 0) return 0.5;

  // Average ranks (ascending) with tie handling.
  const order = scores.map((s, i) => i).sort((a, b) => (scores[a] - scores[b]) || (a - b));
  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores[order[j + 1]] === scores[order[i]]) j++;
    const avg = (i + j) / 2 + 1; // ranks are 1-based
    for (let k = i; k <= j; k++) ranks[order[k]] = avg;
    i = j + 1;
  }
  let sumPos = 0;
  for (let k = 0; k < n; k++) if (labels[k]) sumPos += ranks[k];
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

/**
 * confusionAt — confusion counts predicting include when score ≥ threshold.
 * @returns {{tp:number,fp:number,tn:number,fn:number}}
 */
export function confusionAt(scores, labels, threshold = 0.5) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < scores.length; i++) {
    const pred = scores[i] >= threshold ? 1 : 0;
    const y = labels[i] ? 1 : 0;
    if (pred && y) tp++;
    else if (pred && !y) fp++;
    else if (!pred && y) fn++;
    else tn++;
  }
  return { tp, fp, tn, fn };
}

/** Classification metrics derived from a confusion object. */
export function metricsFromConfusion({ tp, fp, tn, fn }) {
  const sens = tp + fn ? tp / (tp + fn) : null;             // recall / sensitivity
  const spec = tn + fp ? tn / (tn + fp) : null;             // specificity
  const ppv = tp + fp ? tp / (tp + fp) : null;              // precision / PPV
  const npv = tn + fn ? tn / (tn + fn) : null;
  const f1 = (ppv != null && sens != null && ppv + sens > 0) ? (2 * ppv * sens) / (ppv + sens) : null;
  const acc = (tp + tn + fp + fn) ? (tp + tn) / (tp + tn + fp + fn) : null;
  return { sensitivity: sens, specificity: spec, precision: ppv, npv, f1, accuracy: acc };
}

/**
 * recallAtK — fraction of all positives captured in the top-k ranked records.
 * @returns {number|null}
 */
export function recallAtK(scores, labels, k) {
  const ranked = rankedLabels(scores, labels);
  const totalPos = ranked.reduce((a, b) => a + b, 0);
  if (totalPos === 0) return null;
  let found = 0;
  const lim = Math.min(k, ranked.length);
  for (let i = 0; i < lim; i++) found += ranked[i];
  return found / totalPos;
}

/**
 * wssAtRecall — Work Saved over Sampling at a target recall r (Cohen 2006):
 *   WSS@r = (TN + FN)/N − (1 − r), evaluated at the rank where recall first ≥ r.
 * Operationally: rank by score desc, read from the top until ceil(r·P) positives
 * are found; the unread remainder is the work saved. Random ranking → ≈ 0.
 *
 * @returns {{ wss:number, recallTarget:number, docsRead:number, n:number,
 *            rankFraction:number }|null}
 */
export function wssAtRecall(scores, labels, recallTarget = 0.95) {
  const ranked = rankedLabels(scores, labels);
  const n = ranked.length;
  const totalPos = ranked.reduce((a, b) => a + b, 0);
  if (totalPos === 0 || n === 0) return null;
  const needed = Math.ceil(recallTarget * totalPos);
  let found = 0, docsRead = 0;
  for (let i = 0; i < n; i++) {
    docsRead = i + 1;
    found += ranked[i];
    if (found >= needed) break;
  }
  const wss = (n - docsRead) / n - (1 - recallTarget);
  return { wss, recallTarget, docsRead, n, rankFraction: docsRead / n };
}

/**
 * stageMetrics — quality after screening the top f·N records by AI score, for
 * each fraction f. Answers "after 5%, 10%, 20%, 40%, 60%, 80% screened…".
 * @returns {Array<{fraction,screened,includesFound,totalIncludes,recall,precision,missedRisk}>}
 */
export function stageMetrics(scores, labels, fractions = [0.05, 0.1, 0.2, 0.4, 0.6, 0.8]) {
  const ranked = rankedLabels(scores, labels);
  const n = ranked.length;
  const totalPos = ranked.reduce((a, b) => a + b, 0);
  return fractions.map(f => {
    const screened = Math.max(1, Math.round(f * n));
    let found = 0;
    for (let i = 0; i < Math.min(screened, n); i++) found += ranked[i];
    const recall = totalPos ? found / totalPos : null;
    const precision = screened ? found / Math.min(screened, n) : null;
    return {
      fraction: f,
      screened: Math.min(screened, n),
      includesFound: found,
      totalIncludes: totalPos,
      recall,
      precision,
      missedRisk: totalPos ? (totalPos - found) / totalPos : null,
    };
  });
}

/**
 * smallSampleWarning — honest caveat when the validation set is too small for
 * the metrics to be trustworthy.
 * @returns {{warn:boolean, reason:string}}
 */
export function smallSampleWarning(nPos, nNeg) {
  const total = nPos + nNeg;
  if (total < 30) return { warn: true, reason: `Only ${total} settled decisions — metrics are unstable below ~30.` };
  if (nPos < 10) return { warn: true, reason: `Only ${nPos} includes — recall/AUC estimates are high-variance.` };
  if (nNeg < 10) return { warn: true, reason: `Only ${nNeg} excludes — specificity estimates are high-variance.` };
  return { warn: false, reason: '' };
}

/**
 * computeValidation — the full validation bundle comparing AI scores to human
 * final decisions.
 *
 * @param {number[]} scores
 * @param {number[]} labels — 1 = include (human final), 0 = exclude
 * @param {object} [opts]
 * @param {number} [opts.threshold] default 0.5
 * @returns {object}
 */
export function computeValidation(scores, labels, opts = {}) {
  const threshold = opts.threshold ?? 0.5;
  const n = scores.length;
  let nPos = 0;
  for (const l of labels) if (l) nPos++;
  const nNeg = n - nPos;

  const confusion = confusionAt(scores, labels, threshold);
  const metrics = metricsFromConfusion(confusion);
  const auc = rocAuc(scores, labels);
  const wss95 = wssAtRecall(scores, labels, 0.95);
  const wss100 = wssAtRecall(scores, labels, 1.0);

  return {
    n, nPos, nNeg, threshold,
    auc,
    confusion,
    ...metrics,
    recallAt10: recallAtK(scores, labels, 10),
    recallAt25: recallAtK(scores, labels, 25),
    recallAt50: recallAtK(scores, labels, 50),
    wss95: wss95 ? wss95.wss : null,     // raw WSS@95 (Cohen 2006); ~0 for random ranking, can be slightly <0
    wss95Detail: wss95,
    wss100: wss100 ? wss100.wss : null,
    wss100Detail: wss100,
    stages: stageMetrics(scores, labels),
    sampleWarning: smallSampleWarning(nPos, nNeg),
  };
}
