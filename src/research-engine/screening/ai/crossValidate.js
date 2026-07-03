/**
 * crossValidate.js — per-record OUT-OF-SAMPLE (cross-validated) relevance scores
 * for VALIDATION export (59.md Change 2). Pure, deterministic, no DB / no network.
 *
 * WHY this exists separately from activeLearning.crossValidate():
 *   - activeLearning.crossValidate() pools the held-out predictions and returns
 *     aggregate metrics (AUC / WSS@95 / Brier). Great for an internal snapshot.
 *   - For a validation EXPORT a researcher needs the PER-RECORD held-out score so
 *     they can recompute WSS@95 / AUC / calibration / Brier themselves, offline,
 *     from the CSV alone — with a guarantee that no score is in-sample.
 *
 * ANTI-LEAKAGE — the property the whole feature rests on. For each fold f the
 * ENTIRE pipeline is fit on the OTHER folds only:
 *   1. Feature extraction / TF-IDF vocabulary (IDF) — `buildVectorizer` is fed the
 *      TRAINING-fold records' features only; held-out records are transformed
 *      against that train-only vocabulary (the injected-vectorizer path in
 *      trainAndScore). A held-out record's text never influences the IDF used to
 *      score it.
 *   2. Logistic-regression fit + included/excluded semantic centroids — driven by
 *      the training-fold labels only (the held-out fold's labels are REMOVED, not
 *      merely unused), via trainAndScore's existing math (no re-implementation).
 *   3. Probability calibration — NESTED / held-out: the calibrator applied to a
 *      record in fold f is fit on the out-of-fold predictions of folds ≠ f, so the
 *      record's own label never reaches the calibrator that maps its score.
 *
 * Therefore: every exported (scoreRaw, probCalibrated) for a labelled record is the
 * score a model gave it when that record (and its whole fold) was held out. Records
 * with too few labels overall, or that are unlabelled / 'maybe', get a BLANK score
 * with a clear status — never a leaky in-sample number.
 */
import { resolveConfig } from './config.js';
import { recordFeatures } from './text.js';
import { buildVectorizer } from './vectorizer.js';
import { trainAndScore, stratifiedFolds } from './activeLearning.js';
import { fitCalibrator, applyCalibrator } from './calibration.js';

/** Bump when the CV scoring pipeline changes in a way that alters scores. Part of
 *  the reproducible model-version fingerprint exported alongside each score. */
export const CV_ENGINE_VERSION = 'cv-1.0';

/** Per-record score types exported in `ai_score_type`. We only ever EMIT
 *  'cross_validated' or 'not_available' — 'in_sample' is declared for documentation
 *  /schema completeness but is never produced here (that would be leakage). */
export const CV_SCORE_TYPES = Object.freeze({
  CROSS_VALIDATED: 'cross_validated',
  IN_SAMPLE: 'in_sample',
  NOT_AVAILABLE: 'not_available',
});

/** The CSV columns this module contributes, appended after the existing export
 *  columns. Centralised here so the export controller and tests share one source. */
export const AI_CV_COLUMNS = Object.freeze([
  'ai_relevance_score_raw',
  'ai_relevance_probability_calibrated',
  'ai_score_type',
  'ai_score_fold',
  'ai_score_model_version',
  'ai_score_generated_at',
  'ai_score_status',
]);

/** FNV-1a 32-bit hash → 8 hex chars. Dependency-free (the pure engine must not pull
 *  in node:crypto), deterministic, good enough for a reproducible content fingerprint. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/** Deterministic model-version fingerprint: same labelled inputs + config + folds
 *  ⇒ same string. Lets a researcher confirm two exports came from the same model. */
function modelVersionFingerprint(sortedLabelPairs, configKeys, k) {
  return `${CV_ENGINE_VERSION}-${fnv1a(`${JSON.stringify(configKeys)}\n${k}\n${sortedLabelPairs.join('|')}`)}`;
}

const isBinaryDecision = (d) => d === 'include' || d === 'exclude';

/** Round to a fixed precision without trailing-zero / float-noise, or '' for null. */
export function fmtScore(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return String(Math.round(v * 1e6) / 1e6);
}

/**
 * cvRowFields — map one per-record CV entry (+ run meta) to the 7 export column
 * values. Pure + shared by the controller and tests so the CSV/JSON shape is
 * verified without a DB. Unscored/unavailable rows yield BLANK score cells plus a
 * status — never an in-sample number.
 */
export function cvRowFields(entry, meta, generatedAt) {
  const e = entry || {};
  const scoreType = e.scoreType || (meta && meta.scoreType) || CV_SCORE_TYPES.NOT_AVAILABLE;
  const status = e.status || (meta && meta.status) || 'not_available';
  return {
    ai_relevance_score_raw: fmtScore(e.scoreRaw),
    ai_relevance_probability_calibrated: fmtScore(e.probCalibrated),
    ai_score_type: scoreType,
    ai_score_fold: e.fold == null ? '' : String(e.fold),
    ai_score_model_version: (meta && meta.modelVersion) || '',
    ai_score_generated_at: generatedAt || '',
    ai_score_status: status,
  };
}

/**
 * crossValidatePerRecord — produce a held-out (cross-validated) score for every
 * labelled record and a clear "not available" marker for the rest.
 *
 * @param {object} args — same engine inputs as trainAndScore, plus:
 * @param {Array} args.records
 * @param {Record<string,'include'|'exclude'|'maybe'|'undecided'>} args.labelByRecordId
 * @param {number} [args.k=5] — requested fold count (clamped to the class sizes)
 * @param {number} [args.minLabeledToScore=0] — governance floor (e.g. 50 screened):
 *        below this many binary labels, no scores are produced (status below_min_screened)
 * @param {number} [args.maxRecordsForCv=20000] — perf guard for very large projects
 * @returns {{ meta:object, results:Array<{recordId,scoreRaw,probCalibrated,fold,scoreType,status}>, byRecordId:Map }}
 */
export function crossValidatePerRecord(args = {}) {
  const cfg = resolveConfig(args.config);
  const records = Array.isArray(args.records) ? args.records : [];
  const labelByRecordId = args.labelByRecordId || {};
  const minLabeledToScore = Number.isFinite(args.minLabeledToScore) ? args.minLabeledToScore : 0;
  const maxRecordsForCv = Number.isFinite(args.maxRecordsForCv) ? args.maxRecordsForCv : 20000;

  const recIds = new Set(records.map((r) => r.id));
  const labeled = records
    .map((r) => r.id)
    .filter((id) => recIds.has(id) && isBinaryDecision(labelByRecordId[id]));
  const labelOf = (id) => (labelByRecordId[id] === 'include' ? 1 : 0);
  const nPos = labeled.filter((id) => labelOf(id) === 1).length;
  const nNeg = labeled.length - nPos;

  const configKeys = {
    provider: cfg.provider,
    includeThreshold: cfg.hybrid?.includeThreshold ?? null,
    calibration: cfg.calibration?.enabled ?? null,
  };

  // Per-record "not available" status for records that are not labelled includes/excludes.
  const unscoredStatus = (id) => {
    const d = labelByRecordId[id];
    if (d === 'maybe') return 'maybe_excluded_from_cv';
    if (d === 'undecided' || d == null || d === '') return 'not_screened';
    return 'not_screened';
  };

  // Build a uniform "all not_available" result (used by every early-out guard).
  const allNotAvailable = (status, reason, k = 0) => {
    const modelVersion = '';
    const results = records.map((r) => ({
      recordId: r.id,
      scoreRaw: null,
      probCalibrated: null,
      fold: null,
      scoreType: CV_SCORE_TYPES.NOT_AVAILABLE,
      status,
    }));
    const byRecordId = new Map(results.map((x) => [x.recordId, x]));
    return {
      meta: {
        engineVersion: CV_ENGINE_VERSION,
        scoreType: CV_SCORE_TYPES.NOT_AVAILABLE,
        status, reason,
        k, nLabeled: labeled.length, nPos, nNeg,
        modelVersion,
        calibrationMethod: 'none',
      },
      results,
      byRecordId,
    };
  };

  if (records.length > maxRecordsForCv) {
    return allNotAvailable('project_too_large_for_cv',
      `Project has ${records.length} records (> ${maxRecordsForCv}); on-demand cross-validation skipped for performance.`);
  }
  if (labeled.length < minLabeledToScore) {
    return allNotAvailable('below_min_screened',
      `Relevance scores become available after ${minLabeledToScore} screened (include/exclude) records — currently ${labeled.length}.`);
  }

  // Fold count: clamp to class sizes, then require every TRAINING split to still
  // clear the supervised thresholds (else CV would silently measure cold-start).
  let k = Math.max(2, Math.min(args.k || 5, nPos, nNeg));
  const minTrainPos = cfg.activeLearning.minPositivesToTrain;
  const minTrainNeg = cfg.activeLearning.minNegativesToTrain;
  if (labeled.length < cfg.activeLearning.minLabelsToTrain + k ||
      nPos - Math.ceil(nPos / k) < minTrainPos ||
      nNeg - Math.ceil(nNeg / k) < minTrainNeg) {
    return allNotAvailable('insufficient_labels_for_cv',
      `Need more screened labels for ${k}-fold cross-validation (have ${nPos} includes / ${nNeg} excludes).`,
      k);
  }

  // Deterministic stratified folds — same seeded assignment as the metrics path.
  const folds = stratifiedFolds(labeled, labelOf, k, cfg.classifier.seed);
  const foldOf = new Map();
  folds.forEach((ids, f) => ids.forEach((id) => foldOf.set(id, f)));

  // Only the labelled records participate in CV; pass just those to the engine so the
  // vectorizer + centroids are fit on the training FOLD, never on unlabelled text.
  const labeledRecords = records.filter((r) => foldOf.has(r.id));

  const rawByRecord = new Map(); // recordId → out-of-fold raw ranking score
  for (let f = 0; f < k; f++) {
    const heldSet = new Set(folds[f]);
    // Training labels = every labelled record NOT in fold f (held-out labels removed).
    const trainLabels = {};
    for (const id of labeled) if (!heldSet.has(id)) trainLabels[id] = labelByRecordId[id];
    // Fit the TF-IDF/IDF vocabulary on the TRAINING-fold records ONLY (strict, no
    // held-out text leaks into the feature space), then let trainAndScore reuse it.
    const trainRecords = labeledRecords.filter((r) => trainLabels[r.id] !== undefined);
    const foldVec = buildVectorizer(trainRecords.map((r) => recordFeatures(r, cfg.vectorizer)), cfg.vectorizer);
    const res = trainAndScore({ ...args, records: labeledRecords, labelByRecordId: trainLabels, vectorizer: foldVec });
    const scoreById = new Map(res.scores.map((s) => [s.recordId, s.score]));
    for (const id of folds[f]) {
      if (scoreById.has(id)) rawByRecord.set(id, scoreById.get(id));
    }
  }

  // ── Nested / held-out probability calibration ────────────────────────────────
  // For fold f, fit the calibrator on the out-of-fold (score,label) pairs of the
  // OTHER folds, then map fold-f records' raw scores through it. A record's own
  // label is therefore never in the calibrator that produces its probability.
  const calProbByRecord = new Map();
  let calibrationMethod = 'none';
  if (cfg.calibration?.enabled) {
    for (let f = 0; f < k; f++) {
      const trainScores = [];
      const trainLabels = [];
      for (const id of labeled) {
        if (foldOf.get(id) === f) continue;
        if (!rawByRecord.has(id)) continue;
        trainScores.push(rawByRecord.get(id));
        trainLabels.push(labelOf(id));
      }
      const cal = fitCalibrator(trainScores, trainLabels, cfg.calibration);
      if (cal.method !== 'none') calibrationMethod = cal.method;
      for (const id of folds[f]) {
        if (!rawByRecord.has(id)) continue;
        // Only expose a calibrated PROBABILITY when a real calibrator was fit; method
        // 'none' would just echo the raw score, which is NOT a probability → keep blank.
        calProbByRecord.set(id, cal.method === 'none' ? null : applyCalibrator(cal.params, rawByRecord.get(id)));
      }
    }
  }

  const sortedLabelPairs = [...labeled].sort().map((id) => `${id}:${labelByRecordId[id]}`);
  const modelVersion = modelVersionFingerprint(sortedLabelPairs, configKeys, k);

  const results = records.map((r) => {
    if (foldOf.has(r.id) && rawByRecord.has(r.id)) {
      return {
        recordId: r.id,
        scoreRaw: rawByRecord.get(r.id),
        probCalibrated: calProbByRecord.has(r.id) ? calProbByRecord.get(r.id) : null,
        fold: foldOf.get(r.id),
        scoreType: CV_SCORE_TYPES.CROSS_VALIDATED,
        status: 'cross_validated',
      };
    }
    return {
      recordId: r.id,
      scoreRaw: null,
      probCalibrated: null,
      fold: null,
      scoreType: CV_SCORE_TYPES.NOT_AVAILABLE,
      status: foldOf.has(r.id) ? 'cv_score_missing' : unscoredStatus(r.id),
    };
  });

  return {
    meta: {
      engineVersion: CV_ENGINE_VERSION,
      scoreType: CV_SCORE_TYPES.CROSS_VALIDATED,
      status: 'cross_validated',
      reason: '',
      k, nLabeled: labeled.length, nPos, nNeg,
      modelVersion,
      calibrationMethod,
      // Folds are exposed (labelled record ids per fold) so callers/tests can verify
      // the held-out property: a record in fold f was excluded from fold f's training.
      folds,
    },
    results,
    byRecordId: new Map(results.map((x) => [x.recordId, x])),
  };
}
