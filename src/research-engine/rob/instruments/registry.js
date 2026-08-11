/**
 * registry.js — the single place that knows every critical-appraisal instrument
 * the platform ships, and the pure judgement algorithm that belongs to each
 * (115.md decision 4: "instrument availability is registry-driven, NOT
 * flag-driven").
 *
 * PURE: imports + wiring. No Prisma / Express / React / network / randomness /
 * Date.now().
 *
 * Two exports matter:
 *
 *   ROB_INSTRUMENTS  { [id]: definition }              — serialisable data
 *   ROB_ALGORITHMS   { [id]: { judgeDomain, judgeOverall } }
 *
 * `engine.js` builds its dispatch tables from these, so adding an instrument
 * means adding a module and one line here — never a change to the engine, the
 * controller, or the renderer.
 *
 * ── ALGORITHM SIGNATURES ────────────────────────────────────────────────────
 * The engine calls `judgeDomain(domainId, answers)` and
 * `judgeOverall(domainJudgments)`. Instruments whose algorithm needs the
 * instrument itself (the NOS forms and the JBI checklists share one
 * implementation across several definitions) are BOUND here, exactly as nos.js
 * has always been bound in engine.js. Instruments whose judgement takes optional
 * extra context (a reviewer's decision or rating, a PROBAST evaluation type)
 * accept it as a trailing argument the engine simply does not pass.
 *
 * ── DELIBERATE OMISSIONS ────────────────────────────────────────────────────
 * ROBINS-E (2024) is NOT registered. It is current and well-maintained, but it
 * is published under CC BY-NC-ND 4.0, which forbids derivatives and restricts
 * commercial use — embedding its item text verbatim in this platform needs
 * permission from the developers. Documented exclusion, revisit with permission.
 * The CASP suite is excluded for the same class of reason (CC BY-NC-SA) and is
 * covered functionally by JBI Qualitative. ROBINS-I V2 (draft as of Nov 2025)
 * and QUADAS-3 (Feb 2026) are tracked, not shipped; see the notes on the
 * ROBINS-I and QUADAS-2 definitions.
 */

// ── the four pre-existing instruments (unchanged) ────────────────────────────
import { ROB2, judgeDomain as rob2JudgeDomain, judgeOverall as rob2JudgeOverall } from './rob2.js';
import { ROBINSI, judgeDomain as robinsJudgeDomain, judgeOverall as robinsJudgeOverall } from './robinsI.js';
import {
  NOS_COHORT, NOS_CASE_CONTROL,
  judgeDomain as nosJudgeDomain,
  judgeOverall as nosJudgeOverall,
} from './nos.js';

// ── the nine added by 115.md ────────────────────────────────────────────────
import { QUADAS2, judgeDomain as quadasJudgeDomain, judgeOverall as quadasJudgeOverall } from './quadas2.js';
import { AMSTAR2, judgeDomain as amstarJudgeDomain, judgeOverall as amstarJudgeOverall } from './amstar2.js';
import {
  JBI_CASE_SERIES, JBI_CASE_REPORT, JBI_PREVALENCE, JBI_CROSS_SECTIONAL, JBI_QUALITATIVE,
  judgeDomain as jbiJudgeDomain,
  judgeOverall as jbiJudgeOverall,
} from './jbi.js';
import { QUIPS, judgeDomain as quipsJudgeDomain, judgeOverall as quipsJudgeOverall } from './quips.js';
import { PROBAST, judgeDomain as probastJudgeDomain, judgeOverall as probastJudgeOverall } from './probast.js';

/** Bind an instrument-taking algorithm pair to one definition. */
function bind(instrument, judgeDomainFn, judgeOverallFn) {
  return {
    judgeDomain: (domainId, answers) => judgeDomainFn(instrument, domainId, answers),
    judgeOverall: (domainJudgments, options) => judgeOverallFn(domainJudgments, options),
  };
}

/**
 * Every instrument, keyed by the id stored in `RobAssessment.instrumentId`.
 * Order is the catalogue order in tools.js.
 */
export const ROB_INSTRUMENTS = Object.freeze({
  RoB2: ROB2,
  'ROBINS-I': ROBINSI,
  NOS: NOS_COHORT,
  'NOS-CC': NOS_CASE_CONTROL,
  'QUADAS-2': QUADAS2,
  'AMSTAR-2': AMSTAR2,
  'JBI-CaseSeries': JBI_CASE_SERIES,
  'JBI-CaseReport': JBI_CASE_REPORT,
  'JBI-Prevalence': JBI_PREVALENCE,
  'JBI-CrossSectional': JBI_CROSS_SECTIONAL,
  'JBI-Qualitative': JBI_QUALITATIVE,
  QUIPS,
  PROBAST,
});

/** The pure judgement algorithm for each instrument, keyed by the same ids. */
export const ROB_ALGORITHMS = Object.freeze({
  RoB2: { judgeDomain: rob2JudgeDomain, judgeOverall: rob2JudgeOverall },
  'ROBINS-I': { judgeDomain: robinsJudgeDomain, judgeOverall: robinsJudgeOverall },
  NOS: {
    judgeDomain: (domainId, answers) => nosJudgeDomain(NOS_COHORT, domainId, answers),
    judgeOverall: (domainJudgments) => nosJudgeOverall(NOS_COHORT, domainJudgments),
  },
  'NOS-CC': {
    judgeDomain: (domainId, answers) => nosJudgeDomain(NOS_CASE_CONTROL, domainId, answers),
    judgeOverall: (domainJudgments) => nosJudgeOverall(NOS_CASE_CONTROL, domainJudgments),
  },
  'QUADAS-2': { judgeDomain: quadasJudgeDomain, judgeOverall: quadasJudgeOverall },
  'AMSTAR-2': { judgeDomain: amstarJudgeDomain, judgeOverall: amstarJudgeOverall },
  'JBI-CaseSeries': bind(JBI_CASE_SERIES, jbiJudgeDomain, jbiJudgeOverall),
  'JBI-CaseReport': bind(JBI_CASE_REPORT, jbiJudgeDomain, jbiJudgeOverall),
  'JBI-Prevalence': bind(JBI_PREVALENCE, jbiJudgeDomain, jbiJudgeOverall),
  'JBI-CrossSectional': bind(JBI_CROSS_SECTIONAL, jbiJudgeDomain, jbiJudgeOverall),
  'JBI-Qualitative': bind(JBI_QUALITATIVE, jbiJudgeDomain, jbiJudgeOverall),
  QUIPS: { judgeDomain: quipsJudgeDomain, judgeOverall: quipsJudgeOverall },
  PROBAST: { judgeDomain: probastJudgeDomain, judgeOverall: probastJudgeOverall },
});

/** Every registered instrument id, in catalogue order. */
export const ROB_INSTRUMENT_IDS = Object.freeze(Object.keys(ROB_INSTRUMENTS));

/** Every registered definition, in catalogue order. */
export const ROB_INSTRUMENT_LIST = Object.freeze(ROB_INSTRUMENT_IDS.map((id) => ROB_INSTRUMENTS[id]));

/** True when `id` names a registered instrument. Total; never throws. */
export function isRegisteredInstrument(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ROB_INSTRUMENTS, id);
}

/** The definition for `id`, or undefined. Total; never throws. */
export function findInstrument(id) {
  return isRegisteredInstrument(id) ? ROB_INSTRUMENTS[id] : undefined;
}

/**
 * The instrument version to stamp on a new `RobAssessment` row. Reads the
 * definition rather than letting a caller pass a version string, so a row can
 * never claim a version the instrument does not have.
 */
export function instrumentVersionFor(id) {
  const inst = findInstrument(id);
  if (!inst) return '';
  return inst.instrumentVersion || inst.version || '';
}

/** Instruments that judge applicability separately from risk of bias. */
export const APPLICABILITY_INSTRUMENT_IDS = Object.freeze(
  ROB_INSTRUMENT_IDS.filter((id) => (ROB_INSTRUMENTS[id].domains || []).some((d) => d.applicability)),
);

/**
 * Instruments that are star-scored. This is the two NOS forms and nothing else:
 * every other tool in the set explicitly defines no score (115.md decision 5).
 */
export const SCORING_INSTRUMENT_IDS = Object.freeze(
  ROB_INSTRUMENT_IDS.filter((id) => ROB_INSTRUMENTS[id].scoring === 'stars'),
);

/**
 * Whether an instrument may present a numeric score. Derived, so it is true for
 * exactly the star-scored forms and false for everything else — including the
 * pre-115 definitions, which predate the explicit `scoringAllowed` field.
 */
export function scoringAllowedFor(id) {
  const inst = findInstrument(id);
  if (!inst) return false;
  if (typeof inst.scoringAllowed === 'boolean') return inst.scoringAllowed;
  return inst.scoring === 'stars';
}

export default {
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
};
