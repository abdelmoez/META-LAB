/**
 * hybrid.js — combine the engine's sub-signals into one transparent relevance
 * score. Pure functions, no DB, no network.
 *
 * Only the signals that are actually AVAILABLE contribute; their weights are
 * renormalized so a missing signal (e.g. no trained classifier yet, or no
 * embedding provider) never silently drags the score toward zero. Every
 * sub-score is preserved in the output so the UI can show the breakdown and the
 * explanation layer can be honest about what drove the number.
 */

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/**
 * hybridScore — fuse classifier / cold-start / semantic / keyword signals.
 *
 * @param {object} signals
 * @param {{available:boolean, proba:number}} [signals.classifier]
 * @param {number} [signals.coldStart] — cold-start prior in [0,1]
 * @param {number|null} [signals.semanticIncluded] — cosine sim to included centroid [0,1]
 * @param {number|null} [signals.semanticExcluded] — cosine sim to excluded centroid [0,1]
 * @param {number|null} [signals.keyword] — raw inclusion/exclusion keyword signal [0,1]
 * @param {number|null} [signals.citation] — citation-graph signal [0,1] (66.md P4.3)
 * @param {number|null} [signals.eligibility] — criteria-based eligibility signal [0,1] (P10)
 * @param {object} hybridCfg — config.hybrid
 * @returns {{ score:number, mode:'supervised'|'cold_start', subScores:object,
 *            weights:object }}
 */
export function hybridScore(signals = {}, hybridCfg = {}) {
  const W = hybridCfg.weights || {};
  const semanticEnabled = hybridCfg.semanticEnabled ?? true;

  const components = [];
  const subScores = {};

  // Supervised classifier (only when a model exists).
  if (signals.classifier && signals.classifier.available) {
    const v = clamp01(signals.classifier.proba);
    subScores.classifier = v;
    components.push(['classifier', W.classifier ?? 0.55, v]);
  } else {
    subScores.classifier = null;
  }

  // Cold-start prior (almost always available).
  if (typeof signals.coldStart === 'number') {
    const v = clamp01(signals.coldStart);
    subScores.coldStart = v;
    components.push(['coldStart', W.coldStart ?? 0.20, v]);
  } else {
    subScores.coldStart = null;
  }

  // Semantic similarity to the already-included set (minus the excluded set).
  let semantic = null;
  if (semanticEnabled && (signals.semanticIncluded != null || signals.semanticExcluded != null)) {
    const inc = signals.semanticIncluded != null ? clamp01(signals.semanticIncluded) : 0;
    const exc = signals.semanticExcluded != null ? clamp01(signals.semanticExcluded) : 0;
    semantic = signals.semanticExcluded != null
      ? clamp01(0.5 + 0.5 * (inc - exc))
      : inc;
    subScores.semantic = semantic;
    components.push(['semantic', W.semanticIncluded ?? 0.15, semantic]);
  } else {
    subScores.semantic = null;
  }

  // Raw keyword signal.
  if (signals.keyword != null) {
    const v = clamp01(signals.keyword);
    subScores.keyword = v;
    components.push(['keyword', W.keyword ?? 0.10, v]);
  } else {
    subScores.keyword = null;
  }

  // Citation-graph signal (66.md P4.3) — present only when citation metadata was
  // actually enriched for the project, so its absence leaves scores untouched.
  if (signals.citation != null) {
    const v = clamp01(signals.citation);
    subScores.citation = v;
    components.push(['citation', W.citation ?? 0.10, v]);
  } else {
    subScores.citation = null;
  }

  // Criteria-based eligibility signal (P10) — present only when the record was
  // assessed against project eligibility criteria, so its absence (like citation)
  // leaves the fused score byte-identical to the pre-eligibility engine.
  if (signals.eligibility != null) {
    const v = clamp01(signals.eligibility);
    subScores.eligibility = v;
    components.push(['eligibility', W.eligibility ?? 0.10, v]);
  } else {
    subScores.eligibility = null;
  }

  // Renormalize over active components.
  let wSum = 0;
  for (const [, w] of components) wSum += w;
  const weights = {};
  let score = 0;
  if (wSum > 0) {
    for (const [name, w, v] of components) {
      const nw = w / wSum;
      weights[name] = nw;
      score += nw * v;
    }
  } else {
    score = 0.5; // nothing to go on → neutral
  }

  return {
    score: clamp01(score),
    mode: subScores.classifier != null ? 'supervised' : 'cold_start',
    subScores,
    weights,
  };
}
