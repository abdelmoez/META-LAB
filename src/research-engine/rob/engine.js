/**
 * engine.js — generic, instrument-AGNOSTIC Risk-of-Bias engine functions.
 *
 * PURE: no Prisma / Express / React / network / randomness / Date.now(). These
 * functions take an instrument (e.g. ROB2) + an answers map and return proposals,
 * reachable questions, completeness, and a summary matrix. Future instruments
 * (ROBINS-I, QUADAS-2, …) that follow the same data shape reuse all of this.
 *
 * Answers map shape: { [questionId]: 'Y'|'PY'|'PN'|'N'|'NI'|'NA' } (a bare code,
 * or an object { response } — see answerCode). The engine is the SINGLE SOURCE
 * OF TRUTH for judgements; the API and UI never re-implement the algorithm.
 *
 * INSTRUMENT DISPATCH: the engine is instrument-AGNOSTIC. Each supported
 * instrument registers (a) its serialisable definition in INSTRUMENTS and (b) its
 * own pure judgement algorithm (judgeDomain / judgeOverall) in ALGORITHMS, keyed
 * by instrument id. proposeDomain / proposeAllDomains / proposeOverall dispatch to
 * the instrument's OWN algorithm — they are NOT hardcoded to any one instrument.
 * For RoB2 the dispatched functions ARE the original rob2.js functions, so RoB2
 * output is byte-identical to before this refactor (proven by tests/unit/rob2-*).
 */
import {
  ROB2,
  judgeDomain as rob2JudgeDomain,
  judgeOverall as rob2JudgeOverall,
} from './instruments/rob2.js';
import {
  ROBINSI,
  judgeDomain as robinsJudgeDomain,
  judgeOverall as robinsJudgeOverall,
} from './instruments/robinsI.js';
// 101.md §18–§21 — the Newcastle–Ottawa Scale. NOS is a SCORING instrument, not a
// judgement one: its algorithms need the instrument itself (the two forms differ),
// so they are bound per-form below rather than taking (domainId, answers).
import {
  NOS_COHORT, NOS_CASE_CONTROL,
  judgeDomain as nosJudgeDomain,
  judgeOverall as nosJudgeOverall,
  completeness as nosCompleteness,
  scoreAssessment,
} from './instruments/nos.js';
// 115.md decision 4 — instrument availability is REGISTRY-driven. The registry
// carries all thirteen definitions + their algorithms; the four literal entries
// below are kept so the pre-115 dispatch is visibly unchanged (the registry's
// entries for them are the very same frozen objects and functions).
import { ROB_INSTRUMENTS, ROB_ALGORITHMS } from './instruments/registry.js';

const INSTRUMENTS = {
  RoB2: ROB2,
  'ROBINS-I': ROBINSI,
  NOS: NOS_COHORT,
  'NOS-CC': NOS_CASE_CONTROL,
  ...ROB_INSTRUMENTS,
};

// Per-instrument judgement algorithms. Keyed by instrument id so the generic
// engine dispatches to the right one instead of importing a single instrument's
// functions directly.
const ALGORITHMS = {
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
  ...ROB_ALGORITHMS,
};

/** True for star-scored instruments (NOS), false for judgement instruments. */
export function isScoringInstrument(instrument) {
  return !!(instrument && instrument.scoring === 'stars');
}

/** Every registered instrument id, in catalogue order. */
export function instrumentIds() {
  return Object.keys(INSTRUMENTS);
}

/** True when `id` names a registered instrument. Total; never throws. */
export function hasInstrument(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(INSTRUMENTS, id);
}

/** Return a frozen instrument definition by id (any registered instrument). */
export function getInstrument(id = 'RoB2') {
  const inst = INSTRUMENTS[id];
  if (!inst) throw new Error(`Unknown RoB instrument: ${id}`);
  return inst;
}

/** Return the pure judgement algorithm { judgeDomain, judgeOverall } for an instrument. */
function getAlgorithm(instrument) {
  const algo = instrument && ALGORITHMS[instrument.id];
  if (!algo) throw new Error(`No judgement algorithm registered for instrument ${instrument && instrument.id}`);
  return algo;
}

/**
 * Coerce a stored answer to a bare response code (string) or undefined. Generic
 * across instruments (they share the Y/PY/PN/N/NI/NA answer shape). Accepts either
 * a bare code ('Y') or an object { response: 'Y' }.
 */
function answerCode(answers, qid) {
  const v = answers ? answers[qid] : undefined;
  if (v == null) return undefined;
  return typeof v === 'string' ? v : v.response;
}

function findDomain(instrument, domainId) {
  const d = instrument.domains.find(x => x.id === domainId);
  if (!d) throw new Error(`Unknown domain ${domainId} for instrument ${instrument.id}`);
  return d;
}

/** Evaluate one branch clause { q, in:[...] } against the answers. */
function clauseHolds(clause, answers) {
  const v = answerCode(answers, clause.q);
  return v != null && clause.in.includes(v);
}

/**
 * Is a question currently reachable given the answers? `branch === null` ⇒ always
 * reachable. allOf: every clause must hold. anyOf: at least one clause must hold.
 */
export function isReachable(question, answers) {
  const b = question.branch;
  if (!b) return true;
  if (b.allOf && !b.allOf.every(c => clauseHolds(c, answers))) return false;
  if (b.anyOf && !b.anyOf.some(c => clauseHolds(c, answers))) return false;
  return true;
}

/**
 * The questions in a domain that are currently reachable (the UI shows exactly
 * these, hiding branched-away questions). Order is preserved.
 */
export function nextQuestions(instrument, domainId, answers) {
  return findDomain(instrument, domainId).questions.filter(q => isReachable(q, answers || {}));
}

/**
 * Propose a domain judgement + a human-readable reasons trace.
 * @returns {{ domainId, judgment, reasons: string[] }}
 */
export function proposeDomain(instrument, domainId, answers) {
  findDomain(instrument, domainId); // validates the id
  const { judgeDomain } = getAlgorithm(instrument);
  const out = judgeDomain(domainId, answers || {}) || {};
  const proposal = { domainId, judgment: out.judgment, reasons: out.reasons };
  // Star-scored instruments (NOS) carry the score alongside the judgement string;
  // pass it through so proposeOverall sums stars rather than re-parsing numerals.
  if (out.stars != null) { proposal.stars = out.stars; proposal.maxStars = out.maxStars; }
  // 115.md: an instrument's algorithm may carry its own extra signal — AMSTAR 2's
  // flaw counts (which judgeOverall reads back), a QUADAS-2/PROBAST flagged-question
  // list, a reviewer-judged marker. Anything not already set is passed through
  // unchanged, so the four pre-115 instruments produce byte-identical proposals.
  for (const k of Object.keys(out)) {
    if (!Object.prototype.hasOwnProperty.call(proposal, k)) proposal[k] = out[k];
  }
  return proposal;
}

/** Propose all five domain judgements at once: { [domainId]: { judgment, reasons } }. */
export function proposeAllDomains(instrument, answersByDomain) {
  const out = {};
  for (const d of instrument.domains) {
    out[d.id] = proposeDomain(instrument, d.id, (answersByDomain && answersByDomain[d.id]) || {});
  }
  return out;
}

/**
 * Propose the overall judgement from per-domain judgements.
 *
 * `options` carries the extra CONTEXT an instrument's overall rule needs beyond
 * the domain judgements themselves. Today exactly one rule has any: PROBAST's
 * Step 4 downgrade caveat applies only to a model DEVELOPED without external
 * validation, which is a property of the evaluation (`{ evaluationType }`), not
 * of the answers. Every other algorithm ignores the second argument, so the
 * twelve other instruments produce byte-identical proposals whether it is passed
 * or not.
 *
 * @param {Record<string,{judgment}|string>} domainJudgments
 * @param {object} [options]
 * @returns {{ judgment, reasons: string[], multiSomeConcernsFlag: boolean }}
 */
export function proposeOverall(instrument, domainJudgments, options) {
  return getAlgorithm(instrument).judgeOverall(domainJudgments, options);
}

/**
 * Completeness of an assessment: which REACHABLE questions are still unanswered.
 * @param {object} instrument
 * @param {{ answersByDomain: Record<string, Record<string,string>> }} assessment
 * @returns {{ perDomain: Record<string,{answered:number,required:number,missing:string[]}>, overall: {answered:number,required:number,complete:boolean} }}
 */
export function completeness(instrument, assessment) {
  // Star-scored instruments answer with per-item OPTION values (and an array for
  // the additive Comparability item), not the shared Y/PY/PN/N/NI codes, so they
  // supply their own completeness. Dispatch before the judgement-instrument path.
  if (isScoringInstrument(instrument)) return nosCompleteness(instrument, assessment);
  const answersByDomain = (assessment && assessment.answersByDomain) || {};
  const perDomain = {};
  let totalAnswered = 0;
  let totalRequired = 0;
  // 115.md: two additive rules, both no-ops for the pre-115 instruments.
  //  · `answerable: false` marks a prompt that the instrument never asks the
  //    reviewer to ANSWER (a QUADAS-2/PROBAST applicability prompt), so it can
  //    never be "missing".
  //  · `naIsAnswer` marks an instrument where "Not applicable" is a printed,
  //    deliberate response (the JBI checklists, PROBAST's shaded questions)
  //    rather than "this was never asked". Default stays: NA counts as missing.
  const naCountsAsMissing = instrument.naIsAnswer !== true;
  for (const d of instrument.domains) {
    const answers = answersByDomain[d.id] || {};
    const reachable = d.questions.filter(q => q.answerable !== false && isReachable(q, answers));
    const missing = reachable
      .filter(q => {
        const v = answerCode(answers, q.id);
        if (v == null) return true;
        return v === 'NA' && naCountsAsMissing;
      })
      .map(q => q.id);
    const required = reachable.length;
    const answered = required - missing.length;
    perDomain[d.id] = { answered, required, missing };
    totalAnswered += answered;
    totalRequired += required;
  }
  return {
    perDomain,
    overall: {
      answered: totalAnswered,
      required: totalRequired,
      complete: totalAnswered === totalRequired && totalRequired > 0,
    },
  };
}

/**
 * Build the robvis-style summary matrix from a list of assessments. Each
 * assessment supplies its resolved (final-or-proposed) per-domain + overall
 * judgements. Feeds the traffic-light plot; multi-row "comes free" later.
 * @param {Array<{ id, label, studyLabel?, domainJudgments: Record<string,string>, overall: string }>} assessments
 * @returns {{ instrumentId, domains: Array<{id,shortLabel}>, rows: Array }}
 */
export function summaryMatrix(assessments = [], instrument = ROB2) {
  const domains = instrument.domains.map(d => ({ id: d.id, shortLabel: d.shortLabel }));
  const rows = assessments.map(a => ({
    id: a.id,
    label: a.label || a.studyLabel || a.id,
    cells: instrument.domains.map(d => ({
      domainId: d.id,
      judgment: (a.domainJudgments && a.domainJudgments[d.id]) || null,
    })),
    overall: a.overall || null,
  }));
  return { instrumentId: instrument.id, domains, rows };
}
