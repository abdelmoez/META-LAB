/**
 * activeLearning.js — the orchestrator that turns a project's records + human
 * decisions into per-record relevance scores, with an active-learning loop.
 *
 * Pure functions, no DB, no network. The server is a thin adapter: it loads
 * records + decisions from Prisma, calls trainAndScore(), and persists the
 * result. Keeping ALL the intelligence here (deterministic, dependency-free)
 * is what makes the engine unit-testable and the metrics reproducible.
 *
 * Pipeline per run:
 *   1. Build a TF-IDF vocabulary over ALL records (unsupervised).
 *   2. If enough labels exist, train a class-weighted logistic regression.
 *   3. Compute included/excluded centroids for semantic similarity.
 *   4. For every record, fuse classifier + cold-start + semantic into a hybrid
 *      relevance score, with uncertainty, prediction, band, and an explanation.
 */
import { resolveConfig } from './config.js';
import { recordFeatures, hasUsableText } from './text.js';
import { buildVectorizer, transform, cosine } from './vectorizer.js';
import { cosineDense } from './embeddings.js';
import { trainLogReg, predictProba } from './logreg.js';
import { coldStartScore } from './coldStart.js';
import { hybridScore } from './hybrid.js';
import { uncertainty, predictionLabel, scoreBand } from './ranking.js';
import { buildExplanation } from './explain.js';
import { computeValidation } from './validation.js';
import { aggregateReviewerSignals, prioritizationScore } from './reviewerSignals.js';
import { mulberry32 } from '../sampling.js';

const NEIGHBOR_EXAMPLE_CAP = 300;

/** Map a screening decision string to a training label, per config. */
export function decisionToLabel(decision, cfg) {
  if (decision === 'include') return 1;
  if (decision === 'exclude') return 0;
  if (decision === 'maybe') return cfg.activeLearning.maybeAsPositive ? 1 : null;
  return null; // undecided / undefined → unlabeled
}

/** Sum a list of sparse vectors into one (component-wise); not normalized. */
function sparseSum(vectors) {
  const acc = {};
  for (const v of vectors) {
    for (const k in v) acc[k] = (acc[k] || 0) + v[k];
  }
  return acc;
}

/** centroid − vec (component-wise), for leave-one-out similarity. New object. */
function sparseMinus(centroid, vec) {
  const out = { ...centroid };
  for (const k in vec) out[k] = (out[k] || 0) - vec[k];
  return out;
}

/** Sum equal-length dense vectors → one array (or null if none). Ragged or
 *  non-finite components are skipped/zeroed so a bad vector can never poison the
 *  centroid with NaN. */
function denseSum(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== dim) continue;
    for (let i = 0; i < dim; i++) out[i] += Number.isFinite(v[i]) ? v[i] : 0;
  }
  return out;
}
/** dense centroid − vec, for leave-one-out. New array; no-op on length mismatch. */
function denseMinus(centroid, vec) {
  const out = centroid.slice();
  if (!Array.isArray(vec) || vec.length !== centroid.length) return out;
  for (let i = 0; i < out.length; i++) out[i] -= Number.isFinite(vec[i]) ? vec[i] : 0;
  return out;
}

/**
 * summarizeLabels — count decisions for the training-set summary panel.
 */
export function summarizeLabels(labelByRecordId, cfg) {
  const counts = { include: 0, exclude: 0, maybe: 0, undecided: 0 };
  for (const k of Object.keys(labelByRecordId || {})) {
    const d = labelByRecordId[k];
    if (counts[d] !== undefined) counts[d]++;
    else counts.undecided++;
  }
  let positives = counts.include + (cfg.activeLearning.maybeAsPositive ? counts.maybe : 0);
  let negatives = counts.exclude;
  return {
    ...counts,
    labeledForTraining: positives + negatives,
    positives,
    negatives,
    classBalance: positives + negatives > 0 ? positives / (positives + negatives) : null,
  };
}

/**
 * trainAndScore — main entry point.
 *
 * @param {object} args
 * @param {Array<{id,title,abstract,authors,year,journal,doi,pmid,keywords}>} args.records
 * @param {Record<string,string>} args.labelByRecordId — recordId → 'include'|'exclude'|'maybe'|'undecided'
 * @param {object|string|null} [args.picoSnapshot]
 * @param {string[]} [args.inclusionKeywords]
 * @param {string[]} [args.exclusionKeywords]
 * @param {string[]} [args.studyTypeFilter]
 * @param {object} [args.config] — partial AI config override
 * @param {Record<string,number[]>} [args.denseEmbeddings] — optional recordId → dense vector
 * @param {Record<string,Array<{reviewerId,decision,rating,notes}>>} [args.decisionsByRecordId]
 *   — per-record reviewer decisions WITH quality rating + note (prompt49 item 1).
 *   Used ONLY to derive separate reviewer-quality / note signals; the relevance
 *   classifier is unchanged (eligibility and quality stay distinct axes).
 * @param {boolean} [args.revealReviewerSignals] — false during blind review →
 *   reviewer signals are suppressed (no cross-reviewer leakage). Default true.
 * @returns {{ meta:object, scores:Array<object> }}
 */
export function trainAndScore(args = {}) {
  const cfg = resolveConfig(args.config);
  const records = Array.isArray(args.records) ? args.records : [];
  const labelByRecordId = args.labelByRecordId || {};
  const decisionsByRecordId = args.decisionsByRecordId || {};
  const revealReviewerSignals = args.revealReviewerSignals !== false;
  const ctx = {
    picoSnapshot: args.picoSnapshot,
    inclusionKeywords: args.inclusionKeywords || [],
    exclusionKeywords: args.exclusionKeywords || [],
    studyTypeFilter: args.studyTypeFilter || [],
  };

  // 1. Vocabulary over all records.
  const featureLists = records.map(r => recordFeatures(r, cfg.vectorizer));
  const vec = buildVectorizer(featureLists, cfg.vectorizer);
  const vectors = featureLists.map(f => transform(f, vec));
  const vectorById = new Map(records.map((r, i) => [r.id, vectors[i]]));

  // Optional dense embeddings (hosted/hashing provider). When present, the SEMANTIC
  // signal uses real embedding cosine instead of the lexical TF-IDF centroid. The
  // supervised classifier always stays on TF-IDF (deterministic, interpretable).
  // ALL-OR-NOTHING per run: the dense path is enabled only when EVERY record has a
  // dense vector of uniform dimension — never mixing embedding-cosine and TF-IDF-
  // cosine semantic subscores on one ranking scale.
  const denseMap = (args.denseEmbeddings && typeof args.denseEmbeddings === 'object') ? args.denseEmbeddings : null;
  let useDense = false;
  if (denseMap) {
    const dvals = records.map(r => denseMap[r.id]);
    const dim = Array.isArray(dvals[0]) ? dvals[0].length : 0;
    useDense = dim > 0 && dvals.every(v => Array.isArray(v) && v.length === dim);
  }
  const dense = useDense ? denseMap : null;

  // 2. Assemble labeled samples.
  const samples = [];
  const includedVecs = [];
  const excludedVecs = [];
  const denseIncludedVecs = [];
  const denseExcludedVecs = [];
  const includedExamples = [];
  records.forEach((r, i) => {
    const y = decisionToLabel(labelByRecordId[r.id], cfg);
    if (y === null) return;
    samples.push({ x: vectors[i], y });
    if (y === 1) {
      includedVecs.push(vectors[i]);
      if (dense && dense[r.id]) denseIncludedVecs.push(dense[r.id]);
      if (includedExamples.length < NEIGHBOR_EXAMPLE_CAP) {
        includedExamples.push({ recordId: r.id, title: r.title || '', vector: vectors[i] });
      }
    } else {
      excludedVecs.push(vectors[i]);
      if (dense && dense[r.id]) denseExcludedVecs.push(dense[r.id]);
    }
  });

  const labelSummary = summarizeLabels(labelByRecordId, cfg);
  const canTrain = samples.length >= cfg.activeLearning.minLabelsToTrain
    && labelSummary.positives >= cfg.activeLearning.minPositivesToTrain
    && labelSummary.negatives >= cfg.activeLearning.minNegativesToTrain;

  // 3. Train (optional) + semantic centroids (sparse TF-IDF, and dense if available).
  const model = canTrain ? trainLogReg(samples, vec.terms.length, cfg.classifier) : null;
  const includedCentroid = includedVecs.length ? sparseSum(includedVecs) : null;
  const excludedCentroid = excludedVecs.length ? sparseSum(excludedVecs) : null;
  const denseIncCentroid = denseIncludedVecs.length ? denseSum(denseIncludedVecs) : null;
  const denseExcCentroid = denseExcludedVecs.length ? denseSum(denseExcludedVecs) : null;

  // 4. Score every record.
  const scores = records.map((r, i) => {
    const vector = vectors[i];
    const cs = coldStartScore(r, ctx);
    const proba = model ? predictProba(model, vector) : null;
    // Leave-one-out: a record that is itself labelled must not be compared to a
    // centroid that contains its own vector (that self-similarity would inflate
    // semanticIncluded/Excluded). Subtract its own vector from the matching centroid.
    // NB: for a singleton-class centroid this neutralises the record's own semantic
    // signal to 0 — the conservative, intended behaviour (identical in the sparse
    // path); already-labelled records are not what the queue needs re-ranked anyway.
    const yi = decisionToLabel(labelByRecordId[r.id], cfg);
    const dv = dense ? dense[r.id] : null;
    let semInc, semExc;
    if (dv && (denseIncCentroid || denseExcCentroid)) {
      // Dense (embedding) semantic similarity, with leave-one-out for labelled records.
      const incC = (yi === 1 && denseIncCentroid) ? denseMinus(denseIncCentroid, dv) : denseIncCentroid;
      const excC = (yi === 0 && denseExcCentroid) ? denseMinus(denseExcCentroid, dv) : denseExcCentroid;
      semInc = incC ? cosineDense(dv, incC) : null;
      semExc = excC ? cosineDense(dv, excC) : null;
    } else {
      // Lexical (TF-IDF) semantic similarity, with leave-one-out.
      const incCentroid = (yi === 1 && includedCentroid) ? sparseMinus(includedCentroid, vector) : includedCentroid;
      const excCentroid = (yi === 0 && excludedCentroid) ? sparseMinus(excludedCentroid, vector) : excludedCentroid;
      semInc = incCentroid ? cosine(vector, incCentroid) : null;
      semExc = excCentroid ? cosine(vector, excCentroid) : null;
    }

    const hybrid = hybridScore({
      classifier: { available: !!model, proba: proba ?? 0 },
      coldStart: cs.score,
      semanticIncluded: semInc,
      semanticExcluded: semExc,
      keyword: null, // criteria/keyword signal already folded into coldStart (avoid double counting)
    }, cfg.hybrid);

    const missingAbstract = !hasUsableText(r);
    const uncert = uncertainty(model ? proba : hybrid.score);
    const confidence = model
      ? 1 - uncert
      : (cs.lowConfidence ? 0.15 : (1 - uncert) * 0.7); // cold-start inherently less confident

    // Nearest already-included records (bounded by NEIGHBOR_EXAMPLE_CAP).
    const neighbors = [];
    for (const ex of includedExamples) {
      if (ex.recordId === r.id) continue;
      const sim = cosine(vector, ex.vector);
      if (sim > 0) neighbors.push({ recordId: ex.recordId, title: ex.title, similarity: sim });
    }
    neighbors.sort((a, b) => b.similarity - a.similarity);
    const topNeighbors = neighbors.slice(0, 3);

    const picoMean = cs.signals.pico ? cs.signals.pico.mean : null;

    // prompt49 item 1 — SEPARATE reviewer signals (quality + notes). These never
    // touch the relevance `score` (so quality can't overwhelm eligibility); they
    // become a distinct quality/confidence axis + a bounded prioritisation, and
    // feed traceable factors into the explanation. Suppressed during blind review.
    const reviewer = aggregateReviewerSignals(decisionsByRecordId[r.id] || [], { reveal: revealReviewerSignals });
    const prioritization = prioritizationScore(hybrid.score, reviewer);
    // Persisted/serialised signals must NOT carry per-reviewer identity: drop
    // `byReviewer` (reviewerId+decision+rating) so it can never reach the client
    // via signalsJson, even in non-blind mode (it would expose individual reviewer
    // decisions to reviewers who haven't decided, biasing independent screening).
    // The aggregated, identity-free fields + explanation factors are kept.
    const reviewerPersistable = reviewer.hasSignals ? { ...reviewer, byReviewer: undefined } : null;

    const explanation = buildExplanation({
      coldStart: cs, hybrid, model, terms: vec.terms, vector,
      neighbors: topNeighbors, missingAbstract,
      reviewerSignals: reviewer.hasSignals ? reviewer : null,
    });

    return {
      recordId: r.id,
      score: hybrid.score,
      proba,
      coldStartScore: cs.score,
      uncertainty: uncert,
      confidence,
      prediction: predictionLabel(hybrid.score),
      band: scoreBand(hybrid.score),
      // prioritisation = relevance + a hard-clamped (±0.05) quality nudge, for
      // ranking/surfacing only; equals `score` when there is no quality signal.
      prioritization,
      missingAbstract,
      lowConfidence: !model && cs.lowConfidence,
      mode: hybrid.mode,
      subScores: hybrid.subScores,
      picoMean,
      semanticIncluded: semInc,
      // The four separate concepts the engine now exposes:
      //   relevance (score) · methodologicalQuality · reviewerConfidence · prioritization
      methodologicalQuality: reviewer.methodologicalQuality,
      reviewerConfidence: reviewer.reviewerConfidence,
      signals: {
        studyDesign: cs.signals.studyDesign,
        inclusionMatched: cs.signals.inclusion ? cs.signals.inclusion.matched : [],
        exclusionHits: cs.signals.exclusion ? cs.signals.exclusion.hits : 0,
        pico: cs.signals.pico,
        reviewer: reviewerPersistable,
        prioritization,
      },
      similar: topNeighbors,
      explanation,
    };
  });

  return {
    meta: {
      canTrain,
      mode: canTrain ? 'supervised' : 'cold_start',
      nRecords: records.length,
      nFeatures: vec.terms.length,
      vocabSize: vec.terms.length,
      labelCounts: labelSummary,
      minLabelsToTrain: cfg.activeLearning.minLabelsToTrain,
      modelInfo: model ? {
        epochs: model.epochs,
        converged: model.converged,
        classWeights: model.classWeights,
        nPos: model.nPos,
        nNeg: model.nNeg,
      } : null,
    },
    scores,
  };
}

/** Deal each class round-robin into k folds → deterministic stratified split. */
function stratifiedFolds(ids, labelOf, k, seed) {
  const byClass = { 1: [], 0: [] };
  for (const id of ids) byClass[labelOf(id)].push(id);
  const rng = mulberry32(seed >>> 0);
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const folds = Array.from({ length: k }, () => []);
  for (const cls of [1, 0]) shuffle(byClass[cls]).forEach((id, i) => folds[i % k].push(id));
  return folds;
}

/**
 * crossValidate — HONEST held-out validation via stratified k-fold CV. For each
 * fold, the model is trained on the OTHER folds' labels (the held-out fold's
 * labels are removed, not just unused) and the held-out records are scored. The
 * pooled held-out (score,label) pairs are then run through computeValidation, so
 * the metrics are out-of-sample — unlike the optimistic in-sample snapshot.
 *
 * Reuses the full trainAndScore pipeline per fold, so cold-start fallback and the
 * hybrid score are exactly what production uses.
 *
 * @param {object} args — same as trainAndScore, plus { k?:number }
 * @returns {{ heldOut:true, k:number, ...metrics }|{ insufficient:true, reason:string }}
 */
export function crossValidate(args = {}) {
  const cfg = resolveConfig(args.config);
  const records = Array.isArray(args.records) ? args.records : [];
  const labelByRecordId = args.labelByRecordId || {};
  const recIds = new Set(records.map(r => r.id));

  const labeled = Object.keys(labelByRecordId).filter(id =>
    recIds.has(id) && (labelByRecordId[id] === 'include' || labelByRecordId[id] === 'exclude'));
  const labelOf = (id) => (labelByRecordId[id] === 'include' ? 1 : 0);
  const nPos = labeled.filter(id => labelOf(id) === 1).length;
  const nNeg = labeled.length - nPos;

  let k = Math.max(2, Math.min(args.k || 5, nPos, nNeg));
  // Need every TRAINING split to still clear the supervised thresholds, else CV
  // would silently measure cold-start. Require a comfortable margin.
  const minTrainPos = cfg.activeLearning.minPositivesToTrain;
  const minTrainNeg = cfg.activeLearning.minNegativesToTrain;
  if (labeled.length < cfg.activeLearning.minLabelsToTrain + k ||
      nPos - Math.ceil(nPos / k) < minTrainPos ||
      nNeg - Math.ceil(nNeg / k) < minTrainNeg) {
    return { insufficient: true, reason: `Need more labels for ${k}-fold cross-validation (have ${nPos} includes / ${nNeg} excludes).` };
  }

  const folds = stratifiedFolds(labeled, labelOf, k, cfg.classifier.seed);
  const heldScores = [];
  const heldLabels = [];
  const heldIds = [];
  for (let f = 0; f < k; f++) {
    const heldSet = new Set(folds[f]);
    const trainLabels = {};
    for (const id of Object.keys(labelByRecordId)) if (!heldSet.has(id)) trainLabels[id] = labelByRecordId[id];
    const res = trainAndScore({ ...args, labelByRecordId: trainLabels });
    const byId = new Map(res.scores.map(s => [s.recordId, s]));
    for (const id of folds[f]) {
      const sc = byId.get(id);
      if (sc) { heldScores.push(sc.score); heldLabels.push(labelOf(id)); heldIds.push(id); }
    }
  }

  return {
    heldOut: true, k,
    // Pooled OUT-OF-FOLD predictions — each scored by a model that never saw it.
    // These are the honest inputs for probability calibration (se2.md §8).
    oof: { scores: heldScores, labels: heldLabels, ids: heldIds },
    ...computeValidation(heldScores, heldLabels, { threshold: cfg.hybrid.includeThreshold ?? 0.5 }),
  };
}
