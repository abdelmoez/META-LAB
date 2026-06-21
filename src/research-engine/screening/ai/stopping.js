/**
 * stopping.js — statistically-grounded stopping-rule estimation (se2.md §9).
 * Pure functions, no DB, no network, fully deterministic.
 *
 * GOAL: estimate whether screening has likely identified a target proportion (e.g.
 * 95%) of the eligible records, and communicate that estimate WITH its uncertainty —
 * never as a guarantee. This is decision SUPPORT for a human; it is never actionable
 * on its own and never finalises or skips a record.
 *
 * METHOD ("calibrated probability mass"): with calibrated inclusion probabilities
 * (see calibration.js §8) for the not-yet-screened records, the expected number of
 * remaining eligible records is Σ p_i. Estimated total eligible = (eligible already
 * found) + Σ p_i, so estimated recall = found / total. The remaining count is a sum
 * of independent Bernoullis (Poisson-binomial); its variance Σ p_i(1−p_i) yields a
 * normal-approximation interval, which we propagate to a recall interval and judge
 * the target against the CONSERVATIVE lower bound.
 *
 * HARD RULE (§9): calibration must be adequate for this estimate to mean anything —
 * it sums calibrated probabilities. If calibration is 'none'/poor, or too few
 * includes/decisions exist, or recent screening is still yielding includes at a high
 * rate, NO recommendation is produced; the preconditions explain why.
 */
import { wssAtRecall, stageMetrics } from './validation.js';

const Z95 = 1.959963984540054; // 1.96 — two-sided 95%

/**
 * Cautious wording mandated by §9. The engine NEVER says "safe to stop" or "all
 * relevant studies have been found".
 */
export const STOPPING_LANGUAGE = Object.freeze({
  reachedTarget: 'Estimated recall has reached the project target.',
  belowTarget: 'Estimated recall has not yet reached the project target.',
  caveat: 'This estimate is subject to statistical uncertainty and reviewer judgment; it is not a guarantee that all eligible records have been found.',
  notAvailable: 'A reliable stopping estimate is not available yet.',
});

/**
 * recentInclusionYield — fraction of includes among the most recent `window`
 * settled decisions (chronological order, oldest→newest). A high recent yield means
 * eligible records are still appearing, so stopping would be premature.
 * @param {Array<0|1>} chronoLabels — settled labels in screening order
 * @returns {{ yield:number|null, window:number, includes:number }}
 */
export function recentInclusionYield(chronoLabels, window = 50) {
  const arr = Array.isArray(chronoLabels) ? chronoLabels : [];
  const w = Math.min(window, arr.length);
  if (w === 0) return { yield: null, window: 0, includes: 0 };
  let inc = 0;
  for (let i = arr.length - w; i < arr.length; i++) if (arr[i]) inc++;
  return { yield: inc / w, window: w, includes: inc };
}

/**
 * estimateRecall — the calibrated-mass recall estimate with a 95% interval.
 *
 * LIMITATION: the interval uses only the Poisson-binomial SAMPLING variance
 * Σ pᵢ(1−pᵢ), treating each calibrated pᵢ as the true probability. It does NOT
 * propagate the calibrator's own estimation uncertainty, so on small calibration
 * sets the interval is somewhat too narrow and the lower bound mildly optimistic.
 * The ECE precondition and the "apparent calibration" caveat partly guard this; full
 * uncertainty propagation (e.g. nested-CV / bootstrap over the calibrator) is a later
 * refinement. Callers must treat the bound as an estimate, not a guarantee.
 *
 * @param {object} args
 * @param {number} args.foundPositives — eligible records already identified (human)
 * @param {number[]} args.unscreenedProbs — calibrated P(include) per unscreened record
 * @param {number} [args.targetRecall] default 0.95
 * @returns {object}
 */
export function estimateRecall({ foundPositives = 0, unscreenedProbs = [], targetRecall = 0.95 } = {}) {
  const F = Math.max(0, foundPositives);
  const probs = (unscreenedProbs || []).filter(p => Number.isFinite(p)).map(p => Math.min(1, Math.max(0, p)));
  const nRemaining = probs.length;

  let R = 0, varR = 0;
  for (const p of probs) { R += p; varR += p * (1 - p); }
  const sd = Math.sqrt(varR);
  const Rlo = Math.max(0, R - Z95 * sd);
  const Rhi = R + Z95 * sd;

  // recall = F / (F + R). Decreasing in R, so swap bounds.
  const recallAt = (rem) => (F + rem > 0 ? F / (F + rem) : (nRemaining === 0 ? 1 : null));
  const estimatedRecall = recallAt(R);
  const recallLo = recallAt(Rhi);
  const recallHi = recallAt(Rlo);

  return {
    method: 'calibrated_mass',
    targetRecall,
    foundPositives: F,
    estimatedRemainingPositives: R,
    remainingLo: Rlo,
    remainingHi: Rhi,
    estimatedTotalPositives: F + R,
    nRemaining,
    estimatedRecall,
    recallLo,
    recallHi,
    // CONSERVATIVE: judge the target against the lower confidence bound.
    meetsTarget: recallLo != null && recallLo >= targetRecall,
  };
}

/**
 * stoppingPreconditions — gate that decides whether a recommendation may be shown
 * at all (§9). Returns every violated precondition so the UI can be honest about
 * why no recommendation is available.
 *
 * @param {object} args
 * @param {number} args.nIncludes — eligible records found so far
 * @param {number} args.nDecisions — total settled decisions
 * @param {number} args.nRemaining — unscreened records with a calibrated probability
 * @param {number} [args.unscoredUnscreened] — unscreened records that were NOT scored
 *   this run (e.g. dropped by the per-run cap); their eligible mass is unaccounted for,
 *   so any recall estimate is optimistic and the recommendation MUST be suppressed.
 * @param {{method:string, metrics?:{ece?:number}}|null} args.calibration
 * @param {{yield:number|null}} [args.recentYield]
 * @param {boolean} [args.modelUnstable]
 * @param {number} [args.unresolvedConflicts]
 * @param {object} [cfg] — config.stopping
 * @returns {{ ok:boolean, reasons:string[] }}
 */
export function stoppingPreconditions(args, cfg = {}) {
  const minIncludes = cfg.minIncludes ?? 8;
  const minDecisions = cfg.minDecisions ?? 50;
  const maxEce = cfg.maxEce ?? 0.15;
  const maxRecentYield = cfg.maxRecentYield ?? 0.10;
  const reasons = [];

  const { nIncludes = 0, nDecisions = 0, nRemaining = 0, unscoredUnscreened = 0, calibration = null,
    recentYield = { yield: null }, modelUnstable = false, unresolvedConflicts = 0 } = args || {};

  if (nIncludes < minIncludes) reasons.push(`Too few eligible records found (${nIncludes}; need ≥ ${minIncludes}) to estimate prevalence.`);
  if (nDecisions < minDecisions) reasons.push(`Too few screening decisions (${nDecisions}; need ≥ ${minDecisions}).`);
  if (!calibration || calibration.method === 'none') reasons.push('Probability calibration is not yet available — the recall estimate sums calibrated probabilities, so it cannot be trusted without it.');
  else if (calibration.metrics && Number.isFinite(calibration.metrics.ece) && calibration.metrics.ece > maxEce) reasons.push(`Calibration is poor (ECE ${calibration.metrics.ece.toFixed(2)} > ${maxEce}); the recall estimate is unreliable.`);
  if (recentYield && recentYield.yield != null && recentYield.yield > maxRecentYield) reasons.push(`Recent screening is still finding includes at a high rate (${(recentYield.yield * 100).toFixed(0)}% of the last ${recentYield.window}); stopping would likely miss eligible records.`);
  if (modelUnstable) reasons.push('The model has been unstable across recent runs; rankings are not settled.');
  if (unresolvedConflicts > 0) reasons.push(`${unresolvedConflicts} unresolved reviewer conflict(s) materially affect the estimate.`);
  // Partial coverage: unscreened records were left unscored (per-run cap). Their eligible
  // mass is missing from R = Σ p_i, which would INFLATE estimated recall and its lower
  // bound — exactly the bound the target is judged against. Suppress the recommendation.
  if (unscoredUnscreened > 0) reasons.push(`${unscoredUnscreened} unscreened record(s) were not scored this run (project exceeds the per-run cap), so the remaining-eligible estimate is incomplete.`);
  if (nRemaining === 0 && unscoredUnscreened === 0) reasons.push('All records have already been screened — no stopping decision is needed.');

  return { ok: reasons.length === 0, reasons };
}

/**
 * evaluateStopping — the top-level stopping assessment. Computes the recall estimate
 * and the precondition gate, and only emits an actionable recommendation when the
 * gate passes AND the conservative recall lower bound meets the target. Always
 * returns the estimate (for transparency) plus cautious, spec-compliant wording.
 *
 * @returns {object}
 */
export function evaluateStopping(args = {}) {
  const cfg = args.config || {};
  const targetRecall = args.targetRecall ?? cfg.targetRecall ?? 0.95;
  const estimate = estimateRecall({
    foundPositives: args.foundPositives,
    unscreenedProbs: args.unscreenedProbs,
    targetRecall,
  });
  const recentYield = recentInclusionYield(args.chronoLabels, cfg.recentWindow ?? 50);
  const pre = stoppingPreconditions({
    nIncludes: args.foundPositives ?? 0,
    nDecisions: args.nDecisions ?? 0,
    nRemaining: estimate.nRemaining,
    unscoredUnscreened: args.unscoredUnscreened ?? 0,
    calibration: args.calibration ?? null,
    recentYield,
    modelUnstable: args.modelUnstable,
    unresolvedConflicts: args.unresolvedConflicts,
  }, cfg);

  const available = pre.ok;
  const recommendStop = available && estimate.meetsTarget;

  let headline;
  if (!available) headline = STOPPING_LANGUAGE.notAvailable;
  else if (recommendStop) headline = STOPPING_LANGUAGE.reachedTarget;
  else headline = STOPPING_LANGUAGE.belowTarget;

  return {
    method: estimate.method,
    available,
    recommendStop,
    headline,
    caveat: STOPPING_LANGUAGE.caveat,
    targetRecall,
    estimate,
    recentYield,
    prevalenceObserved: (args.nDecisions ?? 0) > 0 ? (args.foundPositives ?? 0) / args.nDecisions : null,
    preconditions: pre,
    nScreened: args.nDecisions ?? 0,
  };
}

/**
 * retrospectiveStopping — after a review is (near-)complete, what WOULD have happened
 * had screening stopped earlier? Reports the work that ranking would have saved at the
 * target recall (Cohen WSS) and a stage-by-stage recall curve. Needs the settled
 * (score, label) pairs. Pure wrapper over the validation metrics. (se2.md §9 + §13.)
 *
 * @param {number[]} scores
 * @param {number[]} labels
 * @param {number} [targetRecall] default 0.95
 */
export function retrospectiveStopping(scores, labels, targetRecall = 0.95) {
  const wssTarget = wssAtRecall(scores, labels, targetRecall);
  const wss100 = wssAtRecall(scores, labels, 1.0);
  return {
    targetRecall,
    wssAtTarget: wssTarget ? wssTarget.wss : null,
    docsToTargetRecall: wssTarget ? wssTarget.docsRead : null,
    wss100: wss100 ? wss100.wss : null,
    docsToFullRecall: wss100 ? wss100.docsRead : null,
    n: wssTarget ? wssTarget.n : (scores ? scores.length : 0),
    stages: stageMetrics(scores, labels),
  };
}
