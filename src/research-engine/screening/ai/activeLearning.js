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
import { trainLogReg, predictProba } from './logreg.js';
import { coldStartScore } from './coldStart.js';
import { hybridScore } from './hybrid.js';
import { uncertainty, predictionLabel, scoreBand } from './ranking.js';
import { buildExplanation } from './explain.js';

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
 * @returns {{ meta:object, scores:Array<object> }}
 */
export function trainAndScore(args = {}) {
  const cfg = resolveConfig(args.config);
  const records = Array.isArray(args.records) ? args.records : [];
  const labelByRecordId = args.labelByRecordId || {};
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

  // 2. Assemble labeled samples.
  const samples = [];
  const includedVecs = [];
  const excludedVecs = [];
  const includedExamples = [];
  records.forEach((r, i) => {
    const y = decisionToLabel(labelByRecordId[r.id], cfg);
    if (y === null) return;
    samples.push({ x: vectors[i], y });
    if (y === 1) {
      includedVecs.push(vectors[i]);
      if (includedExamples.length < NEIGHBOR_EXAMPLE_CAP) {
        includedExamples.push({ recordId: r.id, title: r.title || '', vector: vectors[i] });
      }
    } else {
      excludedVecs.push(vectors[i]);
    }
  });

  const labelSummary = summarizeLabels(labelByRecordId, cfg);
  const canTrain = samples.length >= cfg.activeLearning.minLabelsToTrain
    && labelSummary.positives >= cfg.activeLearning.minPositivesToTrain
    && labelSummary.negatives >= cfg.activeLearning.minNegativesToTrain;

  // 3. Train (optional) + centroids.
  const model = canTrain ? trainLogReg(samples, vec.terms.length, cfg.classifier) : null;
  const includedCentroid = includedVecs.length ? sparseSum(includedVecs) : null;
  const excludedCentroid = excludedVecs.length ? sparseSum(excludedVecs) : null;

  // 4. Score every record.
  const scores = records.map((r, i) => {
    const vector = vectors[i];
    const cs = coldStartScore(r, ctx);
    const proba = model ? predictProba(model, vector) : null;
    const semInc = includedCentroid ? cosine(vector, includedCentroid) : null;
    const semExc = excludedCentroid ? cosine(vector, excludedCentroid) : null;

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
    const explanation = buildExplanation({
      coldStart: cs, hybrid, model, terms: vec.terms, vector,
      neighbors: topNeighbors, missingAbstract,
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
      missingAbstract,
      lowConfidence: !model && cs.lowConfidence,
      mode: hybrid.mode,
      subScores: hybrid.subScores,
      picoMean,
      semanticIncluded: semInc,
      signals: {
        studyDesign: cs.signals.studyDesign,
        inclusionMatched: cs.signals.inclusion ? cs.signals.inclusion.matched : [],
        exclusionHits: cs.signals.exclusion ? cs.signals.exclusion.hits : 0,
        pico: cs.signals.pico,
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
