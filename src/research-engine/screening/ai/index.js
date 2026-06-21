/**
 * index.js — barrel for the PecanRev Screening Intelligence Engine.
 *
 * Pure, deterministic, dependency-free AI screening. Import surface:
 *
 *   import { trainAndScore, computeValidation, QUEUE_MODES } from '.../ai/index.js';
 *
 * See screening-ai-engine.md for the architecture and model documentation.
 */
export { DEFAULT_AI_CONFIG, resolveConfig } from './config.js';
export { tokenize, ngrams, recordFeatures, recordText, hasUsableText, splitKeywordField } from './text.js';
export { buildVectorizer, transform, dot, cosine } from './vectorizer.js';
export { trainLogReg, predictProba, sigmoid, topWeightedFeatures } from './logreg.js';
export { coldStartScore, detectStudyDesign, picoConcepts } from './coldStart.js';
export { createEmbeddingProvider, hashingEmbed, cosineDense } from './embeddings.js';
export { hybridScore } from './hybrid.js';
export { uncertainty, confidence, predictionLabel, rankItems, scoreBand, QUEUE_MODES } from './ranking.js';
export { buildExplanation, termContributions } from './explain.js';
export { trainAndScore, crossValidate, decisionToLabel, summarizeLabels } from './activeLearning.js';
export {
  rocAuc, confusionAt, metricsFromConfusion, recallAtK,
  wssAtRecall, stageMetrics, smallSampleWarning, computeValidation, bootstrapCI,
} from './validation.js';
export {
  fitCalibrator, applyCalibrator, fitPlatt, fitIsotonic, fit1DLogistic,
  calibrationMetrics, brierScore, logLoss, expectedCalibrationError,
  reliabilityBins, calibrationSlopeIntercept, selectCalibrationMethod,
} from './calibration.js';
export {
  evaluateStopping, estimateRecall, recentInclusionYield, stoppingPreconditions,
  retrospectiveStopping, STOPPING_LANGUAGE,
} from './stopping.js';
