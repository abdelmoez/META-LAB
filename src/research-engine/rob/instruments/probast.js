/**
 * probast.js — PROBAST, the Prediction model Risk Of Bias ASsessment Tool
 * (Wolff 2019). The platform's instrument for studies developing, validating or
 * updating diagnostic/prognostic prediction models (115.md tool 13).
 *
 * PURE: data + deterministic proposals. No Prisma / Express / React / network /
 * randomness / Date.now().
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 * Four domains, twenty signalling questions (2 + 3 + 6 + 9), answered
 * Yes / Probably yes / Probably no / No / No information. Every domain is judged
 * for RISK OF BIAS (low / high / unclear); the first three are separately judged
 * for CONCERNS REGARDING APPLICABILITY (low / high / unclear). Domain 4
 * (Analysis) has no applicability section. As in QUADAS-2 the two axes are
 * structurally separate — see shared.js `applicabilityDomainId` for how the
 * second axis persists.
 *
 * Unlike QUADAS-2, PROBAST DOES define official overall rules, for both axes,
 * and they are encoded verbatim below. There is still no numeric score:
 * `scoringAllowed: false`.
 *
 * ── PER MODEL EVALUATION, NOT PER PAPER ─────────────────────────────────────
 * The form is completed separately for each evaluation of a DISTINCT model, and
 * its answer grid has two columns — "Dev" (development) and "Val" (validation).
 * `evaluationTypes` records the three cases the tool recognises; the assessment's
 * `variant` selects one.
 *
 * ── THE SHADED BOXES ────────────────────────────────────────────────────────
 * The official form marks signalling questions that do not apply to a given
 * evaluation type by SHADING the box: "Shaded boxes indicate where signalling
 * questions do not apply and should not be answered." The per-question shading
 * map was not captured during INV-115, so this definition does not claim one.
 * Instead 'NA' is offered as an explicit response with the label "Not applicable"
 * and `naIsAnswer: true`, so a reviewer can record a non-applicable signalling
 * question and still complete the assessment. This is a deliberate, documented
 * substitution of an explicit answer for the printed shading — not an extra
 * judgement option, and it does not affect any rule below.
 *
 * ── SOURCE ──────────────────────────────────────────────────────────────────
 * All twenty signalling questions, the domain-level risk and applicability
 * prompts, the free-text "Describe…" prompts and the Step 4 overall rules are
 * reproduced VERBATIM from the official assessment form read during INV-115:
 *   https://www.probast.org/wp-content/uploads/2020/02/PROBAST_20190515.pdf
 *   (document self-identifies as "PROBAST – Version of 15/05/2019")
 * cross-checked against the Explanation & Elaboration paper hosted on the same
 * site. Where the E&E paper's tables print a question slightly differently
 * (1.1, 3.2, 4.6, 4.9) the FORM wording is used, as the form is the instrument.
 *
 * ── VERSION SCOPE ───────────────────────────────────────────────────────────
 * PROBAST 2019 is the current tool for classical regression-based prediction
 * models and is what ships here. PROBAST+AI (BMJ 2025;388:e082505) extends the
 * approach to AI/ML prediction models in two parts (development; evaluation) and
 * is the developers' recommendation for AI/ML model reviews — recorded in
 * `extensions`, tracked rather than shipped.
 */

import {
  RESPONSES_SIGNALLING,
  responseOptions,
  ROB_LHU,
  CONCERN_LHU,
  answerCode,
  answerableQuestions,
  freezeInstrument,
  reviewerJudged,
} from './shared.js';

/* ════════════ vocabularies ════════════ */

/**
 * Y / PY / PN / N / NI as printed, plus the explicit NA that stands in for the
 * form's shaded boxes (see the header note).
 */
export const PROBAST_RESPONSES = Object.freeze([...RESPONSES_SIGNALLING, 'NA']);
export const PROBAST_JUDGMENTS = Object.freeze(['low', 'high', 'unclear']);

/** The three evaluations the form distinguishes (its "Dev" / "Val" columns). */
export const EVALUATION_TYPES = Object.freeze([
  { value: 'development', label: 'Model development only (Dev)' },
  { value: 'validation', label: 'Model validation only (Val)' },
  { value: 'development-and-validation', label: 'Model development and validation (Dev + Val)' },
]);

const yesish = (v) => v === 'Y' || v === 'PY';
const noish = (v) => v === 'N' || v === 'PN';
const noInfo = (v) => v === 'NI';

const sq = (id, text) => ({ id, text, kind: 'signaling', guidance: '', branch: null, responses: PROBAST_RESPONSES });

/* ════════════ instrument DATA ════════════ */

const DOMAINS = [
  {
    id: 'D1',
    name: 'Participants',
    shortLabel: 'Participants',
    description: 'The data sources the model evaluation drew on and how participants were included or excluded.',
    describePrompt: 'Describe the sources of data and criteria for participant selection:',
    questions: [
      sq('1.1', 'Were appropriate data sources used, e.g. cohort, RCT or nested case-control study data?'),
      sq('1.2', 'Were all inclusions and exclusions of participants appropriate?'),
    ],
    judgment: {
      axis: 'rob',
      prompt: 'Risk of bias introduced by selection of participants',
      levels: ROB_LHU,
      computed: true,
    },
    applicability: {
      axis: 'applicability',
      id: '1.A',
      prompt: 'Concern that the included participants and setting do not match the review question',
      describePrompt: 'Describe included participants, setting and dates:',
      levels: CONCERN_LHU,
      computed: false,
    },
  },
  {
    id: 'D2',
    name: 'Predictors',
    shortLabel: 'Predictors',
    description: 'How the predictors in the final model were defined, assessed, and whether they are available when the model is meant to be used.',
    describePrompt: 'List and describe predictors included in the final model, e.g. definition and timing of assessment:',
    questions: [
      sq('2.1', 'Were predictors defined and assessed in a similar way for all participants?'),
      sq('2.2', 'Were predictor assessments made without knowledge of outcome data?'),
      sq('2.3', 'Are all predictors available at the time the model is intended to be used?'),
    ],
    judgment: {
      axis: 'rob',
      prompt: 'Risk of bias introduced by predictors or their assessment',
      levels: ROB_LHU,
      computed: true,
    },
    applicability: {
      axis: 'applicability',
      id: '2.A',
      prompt: 'Concern that the definition, assessment or timing of predictors in the model do not match the review question',
      levels: CONCERN_LHU,
      computed: false,
    },
  },
  {
    id: 'D3',
    name: 'Outcome',
    shortLabel: 'Outcome',
    description: 'How the outcome was defined and determined, whether predictors leaked into the outcome definition, and the interval between predictor assessment and outcome determination.',
    describePrompt: 'Describe the outcome, how it was defined and determined, and the time interval between predictor assessment and outcome determination:',
    questions: [
      sq('3.1', 'Was the outcome determined appropriately?'),
      sq('3.2', 'Was a pre-specified or standard outcome definition used?'),
      sq('3.3', 'Were predictors excluded from the outcome definition?'),
      sq('3.4', 'Was the outcome defined and determined in a similar way for all participants?'),
      sq('3.5', 'Was the outcome determined without knowledge of predictor information?'),
      sq('3.6', 'Was the time interval between predictor assessment and outcome determination appropriate?'),
    ],
    judgment: {
      axis: 'rob',
      prompt: 'Risk of bias introduced by the outcome or its determination',
      levels: ROB_LHU,
      computed: true,
    },
    applicability: {
      axis: 'applicability',
      id: '3.A',
      prompt: 'Concern that the outcome, its definition, timing or determination do not match the review question',
      describePrompt: 'At what time point was the outcome determined; if a composite outcome was used, describe the relative frequency/distribution of each contributing outcome:',
      levels: CONCERN_LHU,
      computed: false,
    },
  },
  {
    id: 'D4',
    name: 'Analysis',
    shortLabel: 'Analysis',
    description: 'Sample size and events, handling of predictors and missing data, predictor selection, model performance, overfitting and optimism, and whether the presented model matches the analysis.',
    questions: [
      sq('4.1', 'Were there a reasonable number of participants with the outcome?'),
      sq('4.2', 'Were continuous and categorical predictors handled appropriately?'),
      sq('4.3', 'Were all enrolled participants included in the analysis?'),
      sq('4.4', 'Were participants with missing data handled appropriately?'),
      sq('4.5', 'Was selection of predictors based on univariable analysis avoided?'),
      sq('4.6', 'Were complexities in the data (e.g. censoring, competing risks, sampling of controls) accounted for appropriately?'),
      sq('4.7', 'Were relevant model performance measures evaluated appropriately?'),
      sq('4.8', 'Were model overfitting and optimism in model performance accounted for?'),
      sq('4.9', 'Do predictors and their assigned weights in the final model correspond to the results from multivariable analysis?'),
    ],
    judgment: {
      axis: 'rob',
      prompt: 'Risk of bias introduced by the analysis',
      levels: ROB_LHU,
      computed: true,
    },
    // No applicability section: only the first three domains are rated for
    // concerns regarding applicability.
  },
];

export const PROBAST = freezeInstrument({
  id: 'PROBAST',
  name: 'Prediction model Risk Of Bias ASsessment Tool (PROBAST)',
  abbreviation: 'PROBAST',
  version: '2019-05-15',
  instrumentVersion: '2019-05-15',
  organization: 'PROBAST group (Wolff, Moons, Riley et al.); probast.org',
  designs: ['prediction-model'],
  variant: 'development-and-validation',
  variantLabel: 'Model development and validation (Dev + Val)',
  description:
    'Four-domain, twenty-signalling-question tool for studies developing, validating or updating a diagnostic '
    + 'or prognostic prediction model. Every domain is judged for risk of bias; the first three are separately '
    + 'judged for concerns regarding applicability. Official overall rules exist for both axes; no score does.',
  citation:
    'Wolff RF, Moons KGM, Riley RD, et al. PROBAST: a tool to assess the risk of bias and applicability of '
    + 'prediction model studies. Ann Intern Med 2019;170(1):51-58. Explanation and elaboration: Moons KGM, '
    + 'Wolff RF, Riley RD, et al. Ann Intern Med 2019;170(1):W1-W33.',
  guidanceUrl: 'https://www.probast.org/',
  license:
    'Tool downloads are free from probast.org; the defining papers are copyrighted by Annals of Internal '
    + 'Medicine. No explicit software-embedding licence is published, so this is a free-with-citation posture '
    + 'rather than a named licence.',
  consensusSupported: true,
  scoringAllowed: false,
  naIsAnswer: true,
  perModelEvaluation: true,
  evaluationTypes: EVALUATION_TYPES,
  responseOptions: responseOptions(PROBAST_RESPONSES),
  judgmentLevels: ROB_LHU,
  applicabilityLevels: CONCERN_LHU,
  extensions: Object.freeze([
    {
      id: 'PROBAST+AI',
      name: 'PROBAST+AI',
      note: 'Updated tool covering regression AND AI/ML prediction models, in two parts (model development; model evaluation). The developers recommend it for AI/ML model reviews. Tracked, not shipped.',
      citation: 'Moons KGM, Damen JAA, Kaul T, et al. PROBAST+AI: an updated quality, risk of bias, and applicability assessment tool for prediction models using regression or artificial intelligence methods. BMJ 2025;388:e082505.',
    },
  ]),
  domains: DOMAINS,
  overall: Object.freeze({
    axis: 'rob',
    computed: true,
    levels: ROB_LHU,
    rule: 'probast-2019-overall',
    guidance:
      'Low risk of bias — If all domains were rated low risk of bias. If a prediction model was developed '
      + 'without any external validation, and it was rated as low risk of bias for all domains, consider '
      + 'downgrading to high risk of bias. Such a model can only be considered as low risk of bias, if the '
      + 'development was based on a very large data set and included some form of internal validation. '
      + 'High risk of bias — If at least one domain is judged to be at high risk of bias. '
      + 'Unclear risk of bias — If an unclear risk of bias was noted in at least one domain and it was low '
      + 'risk for all other domains.',
    applicability: Object.freeze({
      axis: 'applicability',
      computed: true,
      levels: CONCERN_LHU,
      rule: 'probast-2019-overall-applicability',
      guidance:
        'Low concerns regarding applicability — If low concerns regarding applicability for all domains. '
        + 'High concerns regarding applicability — If high concerns regarding applicability for at least one '
        + 'domain. Unclear concerns regarding applicability — If unclear concerns (but no "high concern") '
        + 'regarding applicability for at least one domain.',
    }),
  }),
  overallGuidance:
    'PROBAST produces two overall judgements per model evaluation: overall risk of bias (low only when every '
    + 'domain is low, high when any domain is high, unclear when a domain is unclear and the rest are low) and '
    + 'overall concerns regarding applicability across the first three domains (high wins, then unclear, then '
    + 'low). A model developed without external validation that is low in all domains should be considered for '
    + 'downgrading. There is no PROBAST score.',
});

/* ════════════ judgements ════════════ */

/**
 * Propose the RISK OF BIAS judgement for one domain (pure).
 *
 * The form states that all signalling questions are phrased so that "yes"
 * indicates absence of bias, and that any question rated "no" or "probably no"
 * FLAGS THE POTENTIAL for bias, leaving the domain rating to the assessor. So:
 *
 *   - every applicable question Yes/Probably yes  → propose LOW
 *   - any No/Probably no                          → NO proposal; return the
 *                                                   flagged question ids
 *   - no No/Probably no, but some No information  → propose UNCLEAR
 *   - anything still unanswered                   → no proposal
 *
 * 'NA' answers (the form's shaded boxes) are skipped entirely.
 */
export function judgeDomain(domainId, answers) {
  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) throw new Error(`Unknown PROBAST domain: ${domainId}`);
  const a = answers || {};
  const qs = answerableQuestions(domain).filter((q) => answerCode(a, q.id) !== 'NA');

  const flagged = qs.filter((q) => noish(answerCode(a, q.id))).map((q) => q.id);
  const unknown = qs.filter((q) => noInfo(answerCode(a, q.id))).map((q) => q.id);
  const unanswered = qs.filter((q) => {
    const v = answerCode(a, q.id);
    return v == null || v === '';
  }).map((q) => q.id);

  if (flagged.length) {
    return {
      ...reviewerJudged([
        `Signalling question${flagged.length === 1 ? '' : 's'} ${flagged.join(', ')} rated "No" or "Probably no", which flags the potential for bias.`,
        'PROBAST asks the assessor to judge whether the domain is high, low or unclear risk of bias — it defines no mapping from a flagged question to a rating.',
      ]),
      domainId,
      axis: 'rob',
      flaggedQuestions: flagged,
    };
  }
  if (unanswered.length) {
    return {
      ...reviewerJudged([`Not yet judged: signalling question${unanswered.length === 1 ? '' : 's'} ${unanswered.join(', ')} unanswered.`]),
      domainId,
      axis: 'rob',
    };
  }
  if (unknown.length) {
    return {
      domainId,
      axis: 'rob',
      judgment: 'unclear',
      computed: true,
      reasons: [`No information available for signalling question${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')} — risk of bias is unclear.`],
    };
  }
  if (!qs.length) {
    return { ...reviewerJudged(['Every signalling question in this domain is marked not applicable.']), domainId, axis: 'rob' };
  }
  return {
    domainId,
    axis: 'rob',
    judgment: 'low',
    computed: true,
    reasons: [`Every applicable signalling question in ${domain.name} is rated Yes or Probably yes, indicating absence of bias.`],
  };
}

/**
 * The APPLICABILITY concern for one domain — reviewer-judged, exactly as on the
 * form (the concern is recorded directly, not derived from signalling answers).
 * Pure.
 */
export function judgeApplicability(domainId, concern) {
  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) throw new Error(`Unknown PROBAST domain: ${domainId}`);
  if (!domain.applicability) throw new Error(`PROBAST domain ${domainId} has no applicability section`);
  if (concern && CONCERN_LHU.some((l) => l.value === concern)) {
    return {
      domainId,
      axis: 'applicability',
      judgment: concern,
      computed: false,
      reviewerJudged: true,
      reasons: [`${CONCERN_LHU.find((l) => l.value === concern).label}, recorded by the reviewer.`],
    };
  }
  return {
    ...reviewerJudged([domain.applicability.prompt]),
    domainId,
    axis: 'applicability',
  };
}

/** Normalise a domain-judgement map entry to its level string. */
function levelOf(entry) {
  if (entry == null) return undefined;
  if (typeof entry === 'string') return entry || undefined;
  return entry.judgment || undefined;
}

/**
 * Roll up a set of Low/High/Unclear levels using PROBAST's Step 4 rule: high
 * wins, then unclear, then low; anything unjudged makes the roll-up impossible.
 * Shared by the risk-of-bias and applicability axes, which use the same logic.
 */
function rollup(levels, ids) {
  const missing = ids.filter((id) => !levels[id]);
  if (missing.length) return { resolved: null, missing };
  const values = ids.map((id) => levels[id]);
  if (values.includes('high')) return { resolved: 'high', missing: [] };
  if (values.includes('unclear')) return { resolved: 'unclear', missing: [] };
  return { resolved: 'low', missing: [] };
}

/**
 * Overall RISK OF BIAS across the four domains — the Step 4 table, verbatim.
 *
 *   Low     all four domains low
 *   High    at least one domain high
 *   Unclear at least one domain unclear and low for all others
 *
 * @param {Record<string, string|{judgment:string}>} domainJudgments
 * @param {{ evaluationType?: string }} [options] when 'development' (a model
 *   developed with no external validation) an all-low result additionally
 *   carries `considerDowngrade` and the form's downgrade caveat.
 * Pure.
 */
export function judgeOverall(domainJudgments, options) {
  const src = domainJudgments || {};
  const levels = {};
  for (const d of DOMAINS) levels[d.id] = levelOf(src[d.id]);
  const ids = DOMAINS.map((d) => d.id);
  const { resolved, missing } = rollup(levels, ids);

  if (!resolved) {
    return {
      ...reviewerJudged([`Overall risk of bias is not determined yet — no judgement for ${missing.join(', ')}.`]),
      // The two axes are INDEPENDENT (Step 4 is two separate tables): a reviewer
      // who has recorded all three applicability concerns has an overall
      // applicability judgement whether or not the four risk-of-bias domains are
      // in yet. Withholding it here would make it invisible to every consumer that
      // reads the roll-up — including the row the server persists.
      applicability: judgeOverallApplicability(src),
      multiSomeConcernsFlag: false,
    };
  }

  const reasons = [];
  let considerDowngrade = false;
  if (resolved === 'high') {
    reasons.push(`At least one domain is judged to be at high risk of bias (${ids.filter((id) => levels[id] === 'high').join(', ')}).`);
  } else if (resolved === 'unclear') {
    reasons.push(`An unclear risk of bias was noted in at least one domain (${ids.filter((id) => levels[id] === 'unclear').join(', ')}) and it was low risk for all other domains.`);
  } else {
    reasons.push('All domains were rated low risk of bias.');
    if (options && options.evaluationType === 'development') {
      considerDowngrade = true;
      reasons.push('This model was developed without any external validation: consider downgrading to high risk of bias. Such a model can only be considered as low risk of bias if the development was based on a very large data set and included some form of internal validation.');
    }
  }

  return {
    judgment: resolved,
    axis: 'rob',
    computed: true,
    considerDowngrade,
    applicability: judgeOverallApplicability(src),
    multiSomeConcernsFlag: false,
    reasons,
  };
}

/**
 * Overall CONCERNS REGARDING APPLICABILITY across the first three domains — the
 * Step 4 table, verbatim. Reads the applicability axis from either
 * `{ 'D1-APP': 'low', … }` (the persistence key) or
 * `{ D1: { applicability: 'low' }, … }`.
 * Pure.
 */
export function judgeOverallApplicability(domainJudgments) {
  const src = domainJudgments || {};
  const ids = DOMAINS.filter((d) => d.applicability).map((d) => d.id);
  const levels = {};
  for (const id of ids) {
    const direct = levelOf(src[`${id}-APP`]);
    const nested = src[id] && typeof src[id] === 'object' ? levelOf(src[id].applicability) : undefined;
    levels[id] = direct || nested;
  }
  const { resolved, missing } = rollup(levels, ids);
  if (!resolved) {
    return {
      ...reviewerJudged([`Overall concerns regarding applicability are not determined yet — no judgement for ${missing.join(', ')}.`]),
      axis: 'applicability',
    };
  }
  const label = { low: 'low', high: 'high', unclear: 'unclear' }[resolved];
  return {
    judgment: resolved,
    axis: 'applicability',
    computed: true,
    reasons: [
      resolved === 'high'
        ? 'High concerns regarding applicability for at least one domain, so the prediction model evaluation is judged to have high concerns regarding applicability.'
        : resolved === 'unclear'
          ? 'Unclear concerns (but no "high concern") regarding applicability for at least one domain, so the prediction model evaluation is judged to have unclear concerns regarding applicability overall.'
          : 'Low concerns regarding applicability for all domains, so the prediction model evaluation is judged to have low concerns regarding applicability.',
    ],
    level: label,
  };
}

export default {
  PROBAST,
  PROBAST_RESPONSES,
  PROBAST_JUDGMENTS,
  EVALUATION_TYPES,
  judgeDomain,
  judgeApplicability,
  judgeOverall,
  judgeOverallApplicability,
};
