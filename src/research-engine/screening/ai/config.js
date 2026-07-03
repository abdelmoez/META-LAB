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
      // Citation-graph signal (66.md P4.3). ONLY active when citation metadata has
      // actually been fetched for the project (renormalization drops it otherwise),
      // so runs without enrichment score byte-identically to the pre-citation engine.
      citation: 0.10,
      // Criteria-based eligibility signal (P10). ONLY active when the project has
      // eligibility criteria AND the record was assessed against them; absent, the
      // renormalization drops it so runs without eligibility data score byte-identically.
      eligibility: 0.10,
    },
    semanticEnabled: true,   // use embedding/lexical neighbour similarity if available
  },

  // ── Citation-graph features (66.md P4.3) ────────────────────────────
  // Direct citation links + bibliographic coupling against the labelled sets.
  // Additional signal only — never required for screening; APIs failing simply
  // leaves the signal absent.
  citation: {
    enabled: true,
    minLabeledWithMetadata: 3, // need ≥ this many labelled records with metadata
    saturationRefs: 8,         // reference-overlap saturation scale
  },

  // ── Recall-targeted operating point (66.md P4.5) ─────────────────────
  // Screening is a recall-first task: the default decision threshold is chosen on
  // held-out (cross-validated) predictions to achieve the target recall, NOT a
  // balanced 0.5. Below minLabels the estimate is flagged preliminary.
  operatingPoint: {
    targetRecall: 0.95,
    minLabels: 30,           // below this the threshold is 'preliminary'
    minPositives: 10,
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

  // ── Model drift tracking (se2.md §11) ───────────────────────────────
  // Each run is a model version; drift compares a new run vs the previous active one
  // and warns when quality/behaviour shifts enough that a human should review.
  drift: {
    aucDrop: 0.05,
    wssFall: 0.05,
    brierRise: 0.03,
    eceRise: 0.05,
    prevalenceShift: 0.1,
    psiLarge: 0.25,
    collapseFraction: 0.9,
  },

  // ── Criteria-based eligibility screening (P10) ──────────────────────
  // Deterministic, zero-training assessment of a record against explicit inclusion/
  // exclusion criteria (see ai/eligibility.js). Decision SUPPORT only — never
  // finalises a screening decision. Tunables document the confidence/decision mapping.
  eligibility: {
    includeConfidence: 0.65,     // an include criterion counts as satisfied only at/above this
    excludeConfidence: 0.65,     // an exclude criterion triggers exclusion only at/above this
    unclearBand: [0.15, 0.6],    // match strength ≤ lo → absent, ≥ hi → present, between → unclear
    minConfidence: 0.5,          // confidence floor at a band edge
    maxConfidence: 0.98,         // confidence ceiling at full concept coverage
    absenceConfidenceCap: 0.75,  // absence-of-evidence can never be as certain as presence
    titleOnlyFactor: 0.85,       // discount an 'absent' verdict read from the title alone
    minCriteria: 1,              // below this many criteria → 'unclear' (nothing to decide on)
    autoApply: { enabled: false, minDecisionConfidence: 0.9, requireNoBlockers: true },
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

// ── Named engine config versions (screeningEngine.md task 3) ──────────────────
// A run's model "version" already lives in ScreenAiRun (active/parent/rollback
// lineage). This registry adds the ENGINE-CONFIG dimension to that: a named, frozen
// set of tunables a run is scored under, recorded on the run so it is reproducible
// and rollback-able. v1 is the original deployed engine, kept BYTE-FOR-BYTE so a
// rollback restores the exact prior behaviour; v2 is the tuned lexical config.
//
// Each entry's `config` is a partial override deep-merged over DEFAULT_AI_CONFIG.
export const ENGINE_CONFIG_DEFAULT_VERSION = 'v2-lexical-tuned';

export const ENGINE_CONFIG_VERSIONS = Object.freeze({
  // v1 — the original deployed engine. EMPTY override == DEFAULT_AI_CONFIG, so this
  // is a faithful, untouched baseline available for rollback at any time.
  'v1-hybrid-legacy': Object.freeze({
    label: 'Hybrid v1 (legacy)',
    summary: 'Original deployed engine: title×3 + abstract + keywords/MeSH + journal features; '
      + 'relevance fuses classifier 0.55 / cold-start 0.20 / semantic 0.15 / keyword 0.10.',
    config: Object.freeze({}),
  }),

  // v2 — tuned config (screeningEngine.md). The ONE change from v1 is the optimiser:
  // the deployed full-batch GD under-fit the TF-IDF objective, leaving the classifier
  // short of the regularised optimum a solver like liblinear reaches. v2 adds heavy-ball
  // momentum (deterministic) so it CONVERGES, plus sklearn-style inverse regularisation
  // (C). Validated on Cohen 2006 by scripts/screening-benchmark.mjs:
  //     v1 (deployed)            AUC 0.848 / WSS@95 0.310
  //     v2 (this)                AUC 0.858 / WSS@95 0.303   ← matches/beats the published
  //     reference TF-IDF+LR      AUC 0.855 / WSS@95 0.319      sklearn benchmark on AUC.
  // The feature set + hybrid fusion are UNCHANGED: dropping MeSH/keywords (the reference's
  // "base" config) raises AUC slightly but drops WSS@95 below the 0.30 target in this
  // engine, and the existing features add no NEW fetch cost — so they are retained.
  // Cold-start behaviour before a model can be trained is identical to v1.
  'v2-lexical-tuned': Object.freeze({
    label: 'Lexical tuned v2',
    summary: 'Deployed feature set + hybrid, with the logistic regression converged to the '
      + 'regularised optimum (heavy-ball momentum + sklearn-style C, class-balanced). '
      + 'Higher AUC (≈0.858, matching the published TF-IDF+LR benchmark) at equal recall.',
    config: Object.freeze({
      classifier: {
        // sklearn-style inverse regularisation: effective L2 λ = 1/(C·nEff). C=8 is a
        // touch weaker than the deployed l2 — it holds WSS@95 while momentum lifts AUC.
        cInverseReg: 8.0,
        momentum: 0.9,        // heavy-ball: reaches the optimum the plain-GD config missed
        learningRate: 1.0,
        epochs: 300,
        tolerance: 1e-6,
        classWeight: 'balanced',
      },
    }),
  }),

  // v3 — v2's tuned classifier PLUS criteria-based eligibility (P10) as an ADDITIVE
  // hybrid signal. The eligibility signal only participates when the project has
  // eligibility criteria and the record was assessed; when it is absent the hybrid
  // renormalizes it away, so a run without eligibility data scores byte-identically
  // to v2. NOT the default version (v2 remains default) — selectable / rollback-able.
  'v3-eligibility-lexical': Object.freeze({
    label: 'Eligibility + lexical v3',
    summary: 'v2 lexical-tuned classifier plus deterministic criteria-based eligibility '
      + 'screening as an additive, renormalizable hybrid signal. Identical to v2 on any '
      + 'run without eligibility criteria; adds an eligibility signal + assist suggestions '
      + 'when criteria are configured.',
    config: Object.freeze({
      classifier: Object.freeze({
        cInverseReg: 8.0,
        momentum: 0.9,
        learningRate: 1.0,
        epochs: 300,
        tolerance: 1e-6,
        classWeight: 'balanced',
      }),
      hybrid: Object.freeze({ weights: Object.freeze({ eligibility: 0.10 }) }),
    }),
  }),
});

/**
 * resolveEngineConfig — resolve a named engine config version (+ optional further
 * override) into a fully-populated config. Unknown/empty version → the default
 * version. The chosen version id is stamped on the result as `engineConfigVersion`
 * for run provenance.
 * @param {string} [version]
 * @param {object} [override]
 * @returns {typeof DEFAULT_AI_CONFIG & {engineConfigVersion:string}}
 */
export function resolveEngineConfig(version, override = {}) {
  const id = ENGINE_CONFIG_VERSIONS[version] ? version : ENGINE_CONFIG_DEFAULT_VERSION;
  const base = ENGINE_CONFIG_VERSIONS[id].config || {};
  const merged = deepMerge(deepMerge(DEFAULT_AI_CONFIG, base), override || {});
  merged.engineConfigVersion = id;
  return merged;
}
