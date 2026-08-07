/**
 * rob/index.js — barrel for the pure RoB engine (Risk of Bias).
 * Re-exports the RoB 2 instrument + the generic, instrument-agnostic engine
 * functions. Also re-exported from src/research-engine/index.js.
 */
export {
  ROB2,
  RESPONSES,
  RESPONSE_LABELS,
  JUDGMENTS,
  JUDGMENT_LABELS,
  judgeDomain,
  judgeOverall,
} from './instruments/rob2.js';

// ROBINS-I instrument (non-randomised studies) + its own judgement algorithm.
export {
  ROBINSI,
  JUDGMENTS as ROBINSI_JUDGMENTS,
  JUDGMENT_LABELS as ROBINSI_JUDGMENT_LABELS,
  judgeDomain as robinsJudgeDomain,
  judgeOverall as robinsJudgeOverall,
} from './instruments/robinsI.js';

// 101.md §18–§22 — Newcastle–Ottawa Scale: the two official OHRI forms, star
// scoring, and the deliberately-separate (and deliberately optional) threshold
// interpretation layer.
export {
  NOS_COHORT,
  NOS_CASE_CONTROL,
  NOS_SCORING,
  NOS_MAX_STARS,
  CATEGORY_MAX as NOS_CATEGORY_MAX,
  selectedValues as nosSelectedValues,
  questionStars as nosQuestionStars,
  scoreDomain as nosScoreDomain,
  scoreAssessment as nosScoreAssessment,
  completeness as nosCompleteness,
  judgeDomain as nosJudgeDomain,
  judgeOverall as nosJudgeOverall,
} from './instruments/nos.js';

export {
  THRESHOLD_MODES as NOS_THRESHOLD_MODES,
  DEFAULT_THRESHOLD_MODE as NOS_DEFAULT_THRESHOLD_MODE,
  AHRQ_STANDARD,
  QUALITY_LABELS as NOS_QUALITY_LABELS,
  applyAhrq,
  applyCustom as applyCustomNosBands,
  interpretNos,
  CONVENTIONAL_BANDS as NOS_CONVENTIONAL_BANDS,
  CONVENTIONAL_BANDS_NOTICE as NOS_CONVENTIONAL_BANDS_NOTICE,
} from './instruments/nosThresholds.js';

export {
  getInstrument,
  isReachable,
  isScoringInstrument,
  nextQuestions,
  proposeDomain,
  proposeAllDomains,
  proposeOverall,
  completeness,
  summaryMatrix,
} from './engine.js';

// 101.md §27 — which instruments the project ACTUALLY used (never the setting).
export { deriveRobUsage, robToolsPhrase } from './usage.js';

export {
  ROB_TOOLS,
  DEFAULT_ROB_TOOL,
  ACTIVE_ROB_TOOLS,
  getRobTool,
  isRobToolActive,
  isStarScoredTool,
  normalizeRobTool,
  toolsForStudyDesign,
  nosVariantForDesign,
} from './tools.js';

// Guided appraisal (text → suggested signalling answers → real judgement).
export { appraiseFromText, ROB_APPRAISAL_VERSION } from './appraisal.js';

// Reviewer agreement for ordinal RoB judgements (weighted κ).
export {
  weightedKappa,
  cohenKappaRob,
  robDomainAgreement,
  interpretKappa,
  ROB_AGREEMENT_VERSION,
} from './agreement.js';
