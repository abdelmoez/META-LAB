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

// 115.md W1-A — the nine instruments added to the 2026 tool set, plus the shared
// contract they extended and the registry that binds all thirteen together.
export {
  QUADAS2,
  QUADAS2_RESPONSES,
  judgeDomain as quadas2JudgeDomain,
  judgeApplicability as quadas2JudgeApplicability,
  judgeOverall as quadas2JudgeOverall,
} from './instruments/quadas2.js';

export {
  AMSTAR2,
  AMSTAR_RESPONSES,
  CRITICAL_ITEMS as AMSTAR_CRITICAL_ITEMS,
  PARTIAL_YES_ITEMS as AMSTAR_PARTIAL_YES_ITEMS,
  META_ANALYSIS_ITEMS as AMSTAR_META_ANALYSIS_ITEMS,
  AMSTAR_CONFIDENCE_VALUES,
  countFlaws as amstarCountFlaws,
  rateConfidence as amstarRateConfidence,
  judgeOverall as amstarJudgeOverall,
} from './instruments/amstar2.js';

export {
  JBI_CASE_SERIES,
  JBI_CASE_REPORT,
  JBI_PREVALENCE,
  JBI_CROSS_SECTIONAL,
  JBI_QUALITATIVE,
  JBI_INSTRUMENTS,
  JBI_DECISION_VALUES,
  isJbiInstrumentId,
  judgeOverall as jbiJudgeOverall,
} from './instruments/jbi.js';

export {
  QUIPS,
  QUIPS_RESPONSES,
  QUIPS_JUDGMENTS,
  judgeDomain as quipsJudgeDomain,
  judgeOverall as quipsJudgeOverall,
} from './instruments/quips.js';

export {
  PROBAST,
  PROBAST_RESPONSES,
  EVALUATION_TYPES as PROBAST_EVALUATION_TYPES,
  judgeDomain as probastJudgeDomain,
  judgeApplicability as probastJudgeApplicability,
  judgeOverall as probastJudgeOverall,
  judgeOverallApplicability as probastJudgeOverallApplicability,
} from './instruments/probast.js';

export {
  ITEM_KINDS,
  RESPONSE_LABELS as ROB_RESPONSE_LABELS,
  responseOptions as robResponseOptions,
  ROB_LHU,
  CONCERN_LHU,
  RISK_LMH,
  AMSTAR_CONFIDENCE,
  JBI_DECISION,
  APPLICABILITY_SUFFIX,
  applicabilityDomainId,
  isApplicabilityDomainId,
  baseDomainId,
  hasApplicabilityAxis,
  applicabilityDomains,
  tallyResponses,
} from './instruments/shared.js';

export {
  ROB_INSTRUMENTS,
  ROB_ALGORITHMS,
  ROB_INSTRUMENT_IDS,
  ROB_INSTRUMENT_LIST,
  APPLICABILITY_INSTRUMENT_IDS,
  SCORING_INSTRUMENT_IDS,
  isRegisteredInstrument,
  findInstrument,
  instrumentVersionFor,
  scoringAllowedFor,
} from './instruments/registry.js';

export {
  getInstrument,
  hasInstrument,
  instrumentIds,
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
  ROB_DESIGNS,
  ROB_DESIGN_IDS,
  DEFAULT_ROB_TOOL,
  ACTIVE_ROB_TOOLS,
  getRobTool,
  robDesignLabel,
  isRobToolActive,
  isStarScoredTool,
  isScoringAllowedTool,
  normalizeRobTool,
  toolsForDesignId,
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
