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

export {
  getInstrument,
  isReachable,
  nextQuestions,
  proposeDomain,
  proposeAllDomains,
  proposeOverall,
  completeness,
  summaryMatrix,
} from './engine.js';

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
