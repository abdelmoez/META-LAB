/**
 * shared.js — the EXTENDED critical-appraisal instrument contract (115.md W1-A).
 *
 * PURE: data + helpers only. No Prisma / Express / React / network / randomness /
 * Date.now().
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * rob2.js, robinsI.js and nos.js each grew their own copy of the response
 * vocabulary because, at the time, there were only two shapes of instrument
 * (signalling-question → judgement, and starred-option → score). The 2026 tool
 * set adds three more shapes:
 *
 *   1. TWO JUDGEMENT AXES per domain — QUADAS-2 and PROBAST judge *risk of bias*
 *      AND, separately, *concern regarding applicability*. This is structural,
 *      not a label: a domain can be Low risk of bias and High applicability
 *      concern at the same time, and the two must never be collapsed.
 *   2. CHECKLIST items — JBI and AMSTAR 2 ask flat items (not branching
 *      signalling questions) with their own answer sets (Yes/No/Unclear/NA,
 *      Yes/Partial Yes/No), and the "overall" is a reviewer DECISION or a
 *      confidence RATING, never a score.
 *   3. NON-ANSWERABLE prompts — QUIPS lists *prompting items* that inform a
 *      single domain judgement rather than being rated one by one, and the
 *      applicability axes of QUADAS-2/PROBAST are judgement prompts rather than
 *      answerable questions. These carry `answerable: false` so completeness
 *      does not demand an answer that the instrument never asks for.
 *
 * Everything here is ADDITIVE. rob2.js, robinsI.js, nos.js and nosThresholds.js
 * are untouched by this file: their definitions omit every new field, and every
 * new field has a default that reproduces the old behaviour exactly.
 *
 * ── THE CONTRACT (what a definition looks like) ─────────────────────────────
 *   {
 *     id, name, abbreviation, version, instrumentVersion, organization,
 *     designs: [<design id from tools.js ROB_DESIGNS>],
 *     description, citation, guidanceUrl, license,
 *     scoringAllowed: boolean,      // false for every tool except the NOS
 *     consensusSupported: boolean,
 *     responseOptions: [{ value, label }],
 *     judgmentLevels: [{ value, label }],
 *     naIsAnswer?: boolean,         // true when "Not applicable" is a real answer
 *     domains: [{
 *       id, name, shortLabel, description,
 *       questions: [{ id, text, kind, guidance, branch, answerable?, responses? }],
 *       judgment?:      { axis:'rob', prompt, levels, computed },
 *       applicability?: { axis:'applicability', id, prompt, levels, computed },
 *     }],
 *     overall: null | { axis, computed, levels, rule, guidance },
 *     overallGuidance: string,
 *   }
 *
 * `overall: null` means the instrument PRESCRIBES NO OVERALL JUDGEMENT (QUADAS-2).
 * That is a fact about the instrument, not a gap in the implementation — nothing
 * downstream may invent one.
 *
 * `scoringAllowed: false` means the instrument defines no summed score. Counting
 * how many items are answered "Yes" is a PROGRESS COUNT, never a rating, and a
 * definition with scoringAllowed:false must not carry a numeric scoring rule
 * (`maxStars`, `scoring`, `scoreRule`, `thresholds`, …). The registry-integrity
 * test enforces exactly that.
 */

/* ════════════ item kinds ════════════ */

/**
 * `signaling`     — a signalling question feeding a domain judgement
 *                   (RoB 2, ROBINS-I, QUADAS-2, PROBAST).
 * `item`          — a flat checklist item answered in its own right
 *                   (JBI, AMSTAR 2).
 * `applicability` — a prompt for the applicability CONCERN axis of a domain
 *                   (QUADAS-2, PROBAST). Not answerable: the reviewer records a
 *                   concern level on the domain, not a response on the item.
 * `consideration` — a prompting item the reviewer weighs when judging the domain
 *                   as a whole, with no answer of its own (QUIPS).
 */
export const ITEM_KINDS = Object.freeze(['signaling', 'item', 'applicability', 'consideration']);

/* ════════════ response vocabularies ════════════ */

export const RESPONSE_LABELS = Object.freeze({
  Y: 'Yes',
  PY: 'Probably yes',
  PN: 'Probably no',
  N: 'No',
  NI: 'No information',
  NA: 'Not applicable',
  U: 'Unclear',
  PARTIAL_YES: 'Partial Yes',
  NMA: 'No meta-analysis conducted',
  ONLY_NRSI: 'Includes only NRSI',
  ONLY_RCT: 'Includes only RCTs',
  PARTIAL: 'Partial',
  UNSURE: 'Unsure',
});

/** Y/PY/PN/N/NI — RoB 2, ROBINS-I, PROBAST. */
export const RESPONSES_SIGNALLING = Object.freeze(['Y', 'PY', 'PN', 'N', 'NI']);
/** Yes/No/Unclear — QUADAS-2. */
export const RESPONSES_YNU = Object.freeze(['Y', 'N', 'U']);
/** Yes/No/Unclear/Not applicable — every JBI checklist. */
export const RESPONSES_YNUNA = Object.freeze(['Y', 'N', 'U', 'NA']);
/** Yes/Partial Yes/No — AMSTAR 2 items that define a partial-yes criterion. */
export const RESPONSES_AMSTAR_PARTIAL = Object.freeze(['Y', 'PARTIAL_YES', 'N']);
/** Yes/No — AMSTAR 2 items with no partial-yes criterion. */
export const RESPONSES_AMSTAR_PLAIN = Object.freeze(['Y', 'N']);
/**
 * yes / partial / no / unsure — the QUIPS "Rating of reporting" scale. Note this
 * rates the ADEQUACY OF REPORTING of a prompting item, not the risk of bias: the
 * risk-of-bias rating is made per DOMAIN on the High/Moderate/Low scale.
 */
export const RESPONSES_QUIPS = Object.freeze(['Y', 'PARTIAL', 'N', 'UNSURE']);

/** Build the `[{ value, label }]` option list the data-driven UI renders. */
export function responseOptions(codes) {
  return Object.freeze((codes || []).map((value) => Object.freeze({
    value,
    label: RESPONSE_LABELS[value] || value,
  })));
}

/* ════════════ judgement scales ════════════ */

const scale = (entries) => Object.freeze(entries.map(([value, label]) => Object.freeze({ value, label })));

/** Low / High / Unclear risk of bias — QUADAS-2, PROBAST. */
export const ROB_LHU = scale([
  ['low', 'Low risk of bias'],
  ['high', 'High risk of bias'],
  ['unclear', 'Unclear risk of bias'],
]);

/** Low / High / Unclear CONCERN regarding applicability — QUADAS-2, PROBAST. */
export const CONCERN_LHU = scale([
  ['low', 'Low concern regarding applicability'],
  ['high', 'High concern regarding applicability'],
  ['unclear', 'Unclear concern regarding applicability'],
]);

/** Low / Moderate / High risk of bias — QUIPS. */
export const RISK_LMH = scale([
  ['low', 'Low risk of bias'],
  ['moderate', 'Moderate risk of bias'],
  ['high', 'High risk of bias'],
]);

/** AMSTAR 2 overall confidence in the results of the review. */
export const AMSTAR_CONFIDENCE = scale([
  ['high', 'High'],
  ['moderate', 'Moderate'],
  ['low', 'Low'],
  ['critically-low', 'Critically low'],
]);

/** The JBI overall appraisal decision — chosen by the reviewer, never computed. */
export const JBI_DECISION = scale([
  ['include', 'Include'],
  ['exclude', 'Exclude'],
  ['seek-further-info', 'Seek further info'],
]);

/* ════════════ answer helpers ════════════ */

/**
 * Coerce a stored answer to a bare response code (string) or undefined. Accepts a
 * bare code ('Y') or an object ({ response: 'Y' }) — the same tolerance the
 * existing instruments have. Pure.
 */
export function answerCode(answers, questionId) {
  const v = answers ? answers[questionId] : undefined;
  if (v == null) return undefined;
  return typeof v === 'string' ? v : v.response;
}

/** Every answerable question of a domain, in order. Pure. */
export function answerableQuestions(domain) {
  return (domain.questions || []).filter((q) => q.answerable !== false);
}

/**
 * Tally the answers of one domain: { total, answered, byResponse }. `total`
 * counts ANSWERABLE questions only. Pure.
 *
 * This is a PROGRESS COUNT, not a score (115.md decision 5). Callers must not
 * present `byResponse.Y / total` as a rating.
 */
export function tallyResponses(domain, answers) {
  const qs = answerableQuestions(domain);
  const byResponse = {};
  let answered = 0;
  for (const q of qs) {
    const v = answerCode(answers, q.id);
    if (v == null || v === '') continue;
    answered += 1;
    byResponse[v] = (byResponse[v] || 0) + 1;
  }
  return { total: qs.length, answered, byResponse };
}

/* ════════════ the second judgement axis ════════════ */

/**
 * The persistence key for a domain's APPLICABILITY judgement.
 *
 * `RobDomainJudgment` is unique on (assessmentId, domainId), so the two axes of a
 * QUADAS-2 / PROBAST domain must occupy two rows. The risk-of-bias axis keeps the
 * bare domain id ('D1') so nothing downstream changes; the applicability axis gets
 * a derived, reserved suffix. Both directions are pure and total.
 */
export const APPLICABILITY_SUFFIX = '-APP';

export function applicabilityDomainId(domainId) {
  return `${domainId}${APPLICABILITY_SUFFIX}`;
}

export function isApplicabilityDomainId(id) {
  return typeof id === 'string' && id.endsWith(APPLICABILITY_SUFFIX);
}

export function baseDomainId(id) {
  return isApplicabilityDomainId(id) ? id.slice(0, -APPLICABILITY_SUFFIX.length) : id;
}

/** True when the instrument judges applicability separately from risk of bias. */
export function hasApplicabilityAxis(instrument) {
  return !!(instrument && (instrument.domains || []).some((d) => d.applicability));
}

/** The domains of an instrument that carry an applicability axis, in order. */
export function applicabilityDomains(instrument) {
  return (instrument && instrument.domains ? instrument.domains : []).filter((d) => d.applicability);
}

/* ════════════ freezing ════════════ */

/**
 * Deep-freeze an instrument definition (domains → questions → nested option and
 * judgement objects) so a consumer can never mutate the shared singleton. Mirrors
 * the freezing the existing instruments do by hand. Pure.
 */
export function freezeInstrument(def) {
  const domains = (def.domains || []).map((d) => Object.freeze({
    ...d,
    questions: (d.questions || []).map((q) => Object.freeze({
      ...q,
      ...(q.options ? { options: Object.freeze(q.options.map((o) => Object.freeze({ ...o }))) } : {}),
      ...(q.responses ? { responses: Object.freeze([...q.responses]) } : {}),
    })),
    ...(d.judgment ? { judgment: Object.freeze({ ...d.judgment }) } : {}),
    ...(d.applicability ? { applicability: Object.freeze({ ...d.applicability }) } : {}),
  }));
  return Object.freeze({ ...def, domains: Object.freeze(domains) });
}

/* ════════════ reviewer-judged results ════════════ */

/**
 * The result shape a NON-COMPUTED judgement returns. Several tools in the 2026
 * set deliberately define no algorithm mapping answers to a judgement (QUIPS
 * domains and overall, the JBI overall decision, every applicability axis, the
 * QUADAS-2 domain judgement once a signalling question is answered "No"). Rather
 * than invent one, the engine returns an EMPTY judgement plus `reviewerJudged`
 * so the UI can say "your call" instead of showing a fabricated proposal.
 *
 * `judgment` is '' rather than null because RobDomainJudgment.proposedJudgment /
 * RobOverall.proposedOverall are non-nullable Strings with a '' default.
 * Pure.
 */
export function reviewerJudged(reasons) {
  return {
    judgment: '',
    reviewerJudged: true,
    computed: false,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
  };
}

export default {
  ITEM_KINDS,
  RESPONSE_LABELS,
  RESPONSES_SIGNALLING,
  RESPONSES_YNU,
  RESPONSES_YNUNA,
  RESPONSES_AMSTAR_PARTIAL,
  RESPONSES_AMSTAR_PLAIN,
  RESPONSES_QUIPS,
  responseOptions,
  ROB_LHU,
  CONCERN_LHU,
  RISK_LMH,
  AMSTAR_CONFIDENCE,
  JBI_DECISION,
  answerCode,
  answerableQuestions,
  tallyResponses,
  APPLICABILITY_SUFFIX,
  applicabilityDomainId,
  isApplicabilityDomainId,
  baseDomainId,
  hasApplicabilityAxis,
  applicabilityDomains,
  freezeInstrument,
  reviewerJudged,
};
