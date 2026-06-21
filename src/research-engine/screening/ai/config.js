/**
 * config.js — PecanRev Screening Intelligence Engine: default configuration.
 *
 * Pure data + a defensive deep-merge. NO database, NO network, NO side effects.
 *
 * This is the single source of truth for every tunable in the AI screening
 * engine. The engine is deliberately deterministic: the same records + the same
 * decisions + the same config always produce the same scores. That property is
 * what makes the validation metrics (AUC / WSS@95 / recall@k) reproducible and
 * scientifically defensible, and it is why the lexical active-learning model —
 * not an opaque LLM call — is the CORE of the engine. Embeddings/LLMs are an
 * OPTIONAL pluggable provider layer that can only ADD signal, never replace the
 * deterministic baseline.
 */

/** @typedef {'assist'|'prioritize'|'auto_after_human'} AiPolicy */

export const DEFAULT_AI_CONFIG = Object.freeze({
  // ── Vectorizer (TF-IDF) ─────────────────────────────────────────────
  vectorizer: {
    ngramRange: [1, 2],      // unigrams + bigrams
    minDf: 2,                // a term must appear in ≥ minDf docs to enter vocab
    maxFeatures: 20000,      // hard cap on vocabulary size (memory safety)
    sublinearTf: true,       // 1 + log(tf) damping (standard for text)
    useKeywordFeatures: true,// fold record.keywords / MeSH as `kw:` features
    minTokenLen: 2,
    dropStopwords: true,
    fieldWeights: { title: 3, abstract: 1, keywords: 2, journal: 1 },
  },

  // ── Classifier (class-weighted logistic regression) ─────────────────
  classifier: {
    l2: 1e-4,                // L2 regularization strength
    learningRate: 0.5,
    epochs: 200,
    classWeight: 'balanced', // 'balanced' | 'none' — cost-sensitive for rare includes
    tolerance: 1e-5,         // early-stop when avg |gradient·lr| < tolerance
    seed: 1337,              // deterministic shuffle of training order
  },

  // ── Active learning ─────────────────────────────────────────────────
  activeLearning: {
    minLabelsToTrain: 10,        // below this → cold-start only (don't fake a model)
    minPositivesToTrain: 3,      // need at least this many includes to learn signal
    minNegativesToTrain: 3,
    maybeAsPositive: false,      // treat 'maybe' decisions as weak positives?
  },

  // ── Hybrid scoring weights (only ACTIVE signals are renormalized) ────
  hybrid: {
    weights: {
      classifier: 0.55,      // supervised model probability
      coldStart: 0.20,       // PICO/criteria/keyword prior
      semanticIncluded: 0.15,// similarity to already-included records
      keyword: 0.10,         // raw inclusion/exclusion keyword signal
    },
    semanticEnabled: true,   // use embedding/lexical neighbour similarity if available
  },

  // ── Probability calibration (se2.md §8) ─────────────────────────────
  // Calibrates the ranking score → P(include) using OUT-OF-FOLD predictions.
  // Method is chosen by sample size; below the minimum, no calibration is applied
  // (the UI shows the uncalibrated score, labelled as such).
  calibration: {
    enabled: true,
    minSamplesToCalibrate: 50,   // total labels below this → method 'none'
    isotonicMinSamples: 200,     // below this → Platt (stable on small data); at/above → isotonic
    reliabilityBins: 10,
    eceBins: 10,
  },

  // ── Stopping-rule estimation (se2.md §9) ────────────────────────────
  // Estimates achieved recall from calibrated probabilities; gated by preconditions
  // and judged against the conservative lower confidence bound. Decision SUPPORT only.
  stopping: {
    enabled: true,
    targetRecall: 0.95,
    minIncludes: 8,              // need this many found includes to estimate prevalence
    minDecisions: 50,
    maxEce: 0.15,                // calibration worse than this suppresses the estimate
    maxRecentYield: 0.10,        // recent include rate above this → "keep screening"
    recentWindow: 50,
  },

  // ── Provider abstraction (resolved server-side; pure layer only knows the shape) ─
  provider: {
    embedding: 'lexical',    // 'lexical' (default, in-process) | 'hashing' | 'hosted'
    hashingDims: 512,        // dims for the dependency-free hashing embedder
  },

  // ── Governance / safety defaults (mirrored by server settings) ──────
  governance: {
    policy: /** @type {AiPolicy} */ ('assist'),  // assistive by default
    requireHumanFinalDecision: true,             // AI never finalises a decision
    maxRecordsPerRun: 5000,
  },
});

/** Recursively merge plain objects; arrays and scalars are replaced wholesale. */
function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const key of Object.keys(override)) {
    const b = out[key];
    const o = override[key];
    if (o && typeof o === 'object' && !Array.isArray(o) && b && typeof b === 'object' && !Array.isArray(b)) {
      out[key] = deepMerge(b, o);
    } else {
      out[key] = o;
    }
  }
  return out;
}

/**
 * resolveConfig — merge a partial override on top of DEFAULT_AI_CONFIG.
 * Always returns a fresh, fully-populated config object.
 * @param {object} [override]
 * @returns {typeof DEFAULT_AI_CONFIG}
 */
export function resolveConfig(override = {}) {
  return deepMerge(DEFAULT_AI_CONFIG, override || {});
}
