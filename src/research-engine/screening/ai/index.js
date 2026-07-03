/**
 * index.js — barrel for the PecanRev Screening Intelligence Engine.
 *
 * Pure, deterministic, dependency-free AI screening. Import surface:
 *
 *   import { trainAndScore, computeValidation, QUEUE_MODES } from '.../ai/index.js';
 *
 * See screening-ai-engine.md for the architecture and model documentation.
 */
export {
  DEFAULT_AI_CONFIG, resolveConfig,
  ENGINE_CONFIG_VERSIONS, ENGINE_CONFIG_DEFAULT_VERSION, resolveEngineConfig,
} from './config.js';
export { tokenize, ngrams, recordFeatures, recordText, hasUsableText, splitKeywordField } from './text.js';
export { buildVectorizer, transform, dot, cosine } from './vectorizer.js';
export { trainLogReg, predictProba, sigmoid, topWeightedFeatures } from './logreg.js';
export { coldStartScore, detectStudyDesign, picoConcepts } from './coldStart.js';
export { createEmbeddingProvider, hashingEmbed, cosineDense } from './embeddings.js';
export { buildEmbeddingText, normalizeForEmbedding, embeddingTextHash, EMBEDDING_TEXT_DEFAULTS } from './embeddingText.js';
export { chunk, progressFraction } from './batch.js';
export { hybridScore } from './hybrid.js';
export { uncertainty, confidence, predictionLabel, rankItems, scoreBand, QUEUE_MODES } from './ranking.js';
export { buildExplanation, termContributions } from './explain.js';
export { trainAndScore, crossValidate, stratifiedFolds, decisionToLabel, summarizeLabels } from './activeLearning.js';
export {
  crossValidatePerRecord, cvRowFields, fmtScore,
  AI_CV_COLUMNS, CV_SCORE_TYPES, CV_ENGINE_VERSION,
} from './crossValidate.js';
export {
  rocAuc, confusionAt, metricsFromConfusion, recallAtK,
  wssAtRecall, stageMetrics, smallSampleWarning, computeValidation, bootstrapCI,
  recallTargetedThreshold,
} from './validation.js';
export { buildCitationFeatures } from './citationSignals.js';
export {
  fitCalibrator, applyCalibrator, fitPlatt, fitIsotonic, fit1DLogistic,
  calibrationMetrics, heldOutCalibrationMetrics, brierScore, logLoss, expectedCalibrationError,
  reliabilityBins, calibrationSlopeIntercept, selectCalibrationMethod,
} from './calibration.js';
export {
  evaluateStopping, estimateRecall, recentInclusionYield, stoppingPreconditions,
  retrospectiveStopping, STOPPING_LANGUAGE,
} from './stopping.js';
export {
  scoreHistogram, populationStabilityIndex, detectClassCollapse,
  runDriftSnapshot, computeDrift, DRIFT_DEFAULTS,
} from './drift.js';
export {
  evaluateEligibility, eligibilityScoreFromAssessment, computeEligibilityValidation,
  DEFAULT_ELIGIBILITY_CONFIG, ENGINE_VERSION as ELIGIBILITY_ENGINE_VERSION,
} from './eligibility.js';
