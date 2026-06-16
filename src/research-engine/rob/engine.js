/**
 * engine.js — generic, instrument-AGNOSTIC Risk-of-Bias engine functions.
 *
 * PURE: no Prisma / Express / React / network / randomness / Date.now(). These
 * functions take an instrument (e.g. ROB2) + an answers map and return proposals,
 * reachable questions, completeness, and a summary matrix. Future instruments
 * (ROBINS-I, QUADAS-2, …) that follow the same data shape reuse all of this.
 *
 * Answers map shape: { [questionId]: 'Y'|'PY'|'PN'|'N'|'NI'|'NA' } (a bare code,
 * or an object { response } — see _answerCode). The engine is the SINGLE SOURCE
 * OF TRUTH for judgements; the API and UI never re-implement the algorithm.
 */
import { ROB2, judgeDomain, judgeOverall, _answerCode } from './instruments/rob2.js';

const INSTRUMENTS = { RoB2: ROB2 };

/** Return a frozen instrument definition by id (only RoB2 in v1). */
export function getInstrument(id = 'RoB2') {
  const inst = INSTRUMENTS[id];
  if (!inst) throw new Error(`Unknown RoB instrument: ${id}`);
  return inst;
}

function findDomain(instrument, domainId) {
  const d = instrument.domains.find(x => x.id === domainId);
  if (!d) throw new Error(`Unknown domain ${domainId} for instrument ${instrument.id}`);
  return d;
}

/** Evaluate one branch clause { q, in:[...] } against the answers. */
function clauseHolds(clause, answers) {
  const v = _answerCode(answers, clause.q);
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
  const { judgment, reasons } = judgeDomain(domainId, answers || {});
  return { domainId, judgment, reasons };
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
 * @param {Record<string,{judgment}|string>} domainJudgments
 * @returns {{ judgment, reasons: string[], multiSomeConcernsFlag: boolean }}
 */
export function proposeOverall(instrument, domainJudgments) {
  return judgeOverall(domainJudgments);
}

/**
 * Completeness of an assessment: which REACHABLE questions are still unanswered.
 * @param {object} instrument
 * @param {{ answersByDomain: Record<string, Record<string,string>> }} assessment
 * @returns {{ perDomain: Record<string,{answered:number,required:number,missing:string[]}>, overall: {answered:number,required:number,complete:boolean} }}
 */
export function completeness(instrument, assessment) {
  const answersByDomain = (assessment && assessment.answersByDomain) || {};
  const perDomain = {};
  let totalAnswered = 0;
  let totalRequired = 0;
  for (const d of instrument.domains) {
    const answers = answersByDomain[d.id] || {};
    const reachable = d.questions.filter(q => isReachable(q, answers));
    const missing = reachable
      .filter(q => {
        const v = _answerCode(answers, q.id);
        return v == null || v === 'NA';
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
