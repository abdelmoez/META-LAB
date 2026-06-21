/**
 * ranking.js — uncertainty math + active-learning queue ordering.
 *
 * Pure functions, no DB, no network. These decide WHICH record a reviewer sees
 * next under each queue mode. Crucially, ranking never changes a decision — it
 * only reorders the worklist. "Most uncertain" implements margin sampling, the
 * classic active-learning acquisition function: surface the records the model is
 * least sure about, because a human label there is the most informative.
 */

/** Margin-based uncertainty: 1 at p=0.5 (max ambiguity), 0 at the extremes. */
export function uncertainty(proba) {
  if (typeof proba !== 'number') return 0;
  return 1 - Math.abs(proba - 0.5) * 2;
}

/** Confidence = 1 − uncertainty. */
export function confidence(proba) {
  return 1 - uncertainty(proba);
}

/**
 * predictionLabel — discretize a relevance score into an assistive label.
 * Deliberately conservative: a wide middle band is reported as 'uncertain'
 * rather than forced into include/exclude.
 */
export function predictionLabel(score, opts = {}) {
  const hi = opts.includeThreshold ?? 0.65;
  const lo = opts.excludeThreshold ?? 0.35;
  if (score >= hi) return 'include';
  if (score <= lo) return 'exclude';
  return 'uncertain';
}

export const QUEUE_MODES = Object.freeze([
  { key: 'default', label: 'Manual order', help: 'Import order (no AI reordering).' },
  { key: 'ai_relevance', label: 'Most likely include', help: 'Highest AI relevance first.' },
  { key: 'ai_uncertain', label: 'Most informative', help: 'Most uncertain records first (active learning).' },
  { key: 'exclusion_triage', label: 'Exclusion triage', help: 'Likely excludes grouped for fast review.' },
  { key: 'conflicts_first', label: 'Conflicts first', help: 'Reviewer disagreements first.' },
  { key: 'duplicates_first', label: 'Duplicates first', help: 'Likely duplicates first.' },
  { key: 'pico_gap', label: 'PICO gaps', help: 'Weakest PICO match first — hardest calls.' },
  { key: 'missing_abstract', label: 'Missing abstract', help: 'Records the AI cannot read well.' },
]);

const COMPARATORS = {
  default: () => 0,
  ai_relevance: (a, b) => (b.score ?? 0) - (a.score ?? 0),
  ai_uncertain: (a, b) => (b.uncertainty ?? 0) - (a.uncertainty ?? 0),
  exclusion_triage: (a, b) => (a.score ?? 1) - (b.score ?? 1),
  conflicts_first: (a, b) => (Number(!!b.hasConflict) - Number(!!a.hasConflict)) || ((b.uncertainty ?? 0) - (a.uncertainty ?? 0)),
  duplicates_first: (a, b) => (Number(!!b.isDuplicate) - Number(!!a.isDuplicate)) || ((b.score ?? 0) - (a.score ?? 0)),
  pico_gap: (a, b) => (a.picoMean ?? 1) - (b.picoMean ?? 1),
  missing_abstract: (a, b) => (Number(!!b.missingAbstract) - Number(!!a.missingAbstract)) || ((b.uncertainty ?? 0) - (a.uncertainty ?? 0)),
};

/**
 * rankItems — stable-sort scored items for a queue mode. Items are
 * `{ recordId, score, uncertainty, hasConflict, isDuplicate, picoMean,
 *    missingAbstract, order }`. `order` (original index) is the stable tiebreak.
 *
 * @param {object[]} items
 * @param {string} mode
 * @returns {object[]} reordered items (new array; inputs untouched)
 */
export function rankItems(items, mode = 'default') {
  const cmp = COMPARATORS[mode] || COMPARATORS.default;
  const withOrder = items.map((it, i) => ({ it, i }));
  withOrder.sort((A, B) => cmp(A.it, B.it) || (A.i - B.i));
  return withOrder.map(w => w.it);
}

/** Score-band bucketing for the UI filters. */
export function scoreBand(score) {
  if (score == null) return 'unscored';
  if (score >= 0.8) return 'very_high';
  if (score >= 0.6) return 'high';
  if (score >= 0.4) return 'medium';
  if (score >= 0.2) return 'low';
  return 'very_low';
}
