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
