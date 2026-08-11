/**
 * quips.js — QUIPS, the Quality In Prognosis Studies tool (Hayden 2013). The
 * platform's instrument for studies of prognostic factors (115.md tool 12).
 *
 * PURE: data + deterministic helpers. No Prisma / Express / React / network /
 * randomness / Date.now().
 *
 * ── TWO SCALES, AND THEY MEASURE DIFFERENT THINGS ───────────────────────────
 * QUIPS is easy to get wrong in software because it has two answer scales that
 * are NOT the same scale:
 *
 *   1. Per PROMPTING ITEM — "Rating of reporting": yes / partial / no / unsure.
 *      This rates whether the study REPORTED the issue adequately.
 *   2. Per DOMAIN — "Rating of risk of bias": High / Moderate / Low.
 *      This is the assessor's judgement, made "considering all relevant issues".
 *
 * The prompting items do not add up to the domain rating and there is no
 * algorithm between them. The tool's own instruction: "These issues are taken
 * together to inform the overall judgment of potential bias for each of the 6
 * domains." So every domain judgement here is `computed: false` — the platform
 * records the reviewer's rating and never proposes one.
 *
 * The last "issue" printed in each domain is that domain's SUMMARY statement
 * (e.g. "The study sample represents the population of interest on key
 * characteristics…"). It is not a separate item: it is the claim the domain
 * rating judges, so it is carried as the domain's judgement prompt rather than
 * as a 33rd, 34th … prompting item.
 *
 * ── NO OVERALL ALGORITHM, NO SCORE ──────────────────────────────────────────
 * QUIPS prescribes domain-level ratings only. Hayden 2013 defines no overall
 * algorithm and no numeric score; review teams define their own summary rules
 * (commonly "low overall if all or most domains are low"). The overall axis
 * therefore exists so a team can record the summary judgement it agreed, but it
 * is flagged `computed: false` and `official: false` so no UI can present it as
 * a QUIPS rule. `scoringAllowed: false`.
 *
 * ── SOURCE ──────────────────────────────────────────────────────────────────
 * Domain names, goal statements, "Biases" labels, prompting items, column
 * instructions and both rating scales are reproduced VERBATIM from the full
 * QUIPS tool hosted by the Cochrane Prognosis Methods Group, read during
 * INV-115:
 *   https://methods.cochrane.org/sites/methods.cochrane.org.prognosis/files/
 *   uploads/QUIPS%20tool.pdf
 * — which is the Supplement the Annals paper refers to as "the full version of
 * the QUIPS tool". The published Annals table prints an abbreviated, differently
 * worded and differently ordered version of the same items; the full tool is
 * used here as the source of record.
 *
 * "PF" throughout is the tool's own abbreviation for the prognostic factor, and
 * "(LIST)" is its own placeholder for the key characteristics the review team
 * specifies in advance. Both are reproduced as printed.
 */

import {
  RESPONSES_QUIPS,
  responseOptions,
  RISK_LMH,
  freezeInstrument,
  reviewerJudged,
  tallyResponses,
} from './shared.js';

/* ════════════ vocabularies ════════════ */

/** yes / partial / no / unsure — the "Rating of reporting" scale. */
export const QUIPS_RESPONSES = RESPONSES_QUIPS;
/** High / Moderate / Low — the "Rating of risk of bias" scale, per domain. */
export const QUIPS_JUDGMENTS = Object.freeze(['low', 'moderate', 'high']);

/** The tool's printed column instructions, kept for the renderer. */
export const COLUMN_INSTRUCTIONS = Object.freeze({
  issues:
    'These issues will guide your thinking and judgment about the overall risk of bias within each of the 6 '
    + 'domains. Some "issues" may not be relevant to the specific study or the review research question. These '
    + 'issues are taken together to inform the overall judgment of potential bias for each of the 6 domains.',
  reporting:
    'Rate the adequacy of reporting as yes, partial, no or unsure.',
  risk:
    'Rate potential risk of bias for each of the 6 domains as High, Moderate, or Low considering all relevant '
    + 'issues.',
});

/** Build one prompting item. `bias` is the printed "Biases" column label. */
function item(id, bias, text) {
  return { id, text, bias, kind: 'item', guidance: '', branch: null, responses: RESPONSES_QUIPS };
}

/** Build one domain from its goal statement, items and summary claim. */
function domain({ id, name, shortLabel, goal, items, summary }) {
  return {
    id,
    name,
    shortLabel,
    description: goal,
    goal,
    questions: items,
    judgment: {
      axis: 'rob',
      // The domain's printed SUMMARY statement — the claim the rating judges.
      prompt: summary,
      levels: RISK_LMH,
      // Hayden 2013 defines no mapping from prompting items to the rating.
      computed: false,
    },
  };
}

/* ════════════ instrument DATA ════════════ */

const DOMAINS = [
  domain({
    id: 'participation',
    name: 'Study Participation',
    shortLabel: 'Participation',
    goal: 'To judge the risk of selection bias (likelihood that relationship between PF and outcome is different for participants and eligible non-participants).',
    items: [
      item('1.1', 'Source of target population', 'The source population or population of interest is adequately described for key characteristics (LIST).'),
      item('1.2', 'Method used to identify population', 'The sampling frame and recruitment are adequately described, including methods to identify the sample sufficient to limit potential bias (number and type used, e.g., referral patterns in health care)'),
      item('1.3', 'Recruitment period', 'Period of recruitment is adequately described'),
      item('1.4', 'Place of recruitment', 'Place of recruitment (setting and geographic location) are adequately described'),
      item('1.5', 'Inclusion and exclusion criteria', 'Inclusion and exclusion criteria are adequately described (e.g., including explicit diagnostic criteria or "zero time" description).'),
      item('1.6', 'Adequate study participation', 'There is adequate participation in the study by eligible individuals'),
      item('1.7', 'Baseline characteristics', 'The baseline study sample (i.e., individuals entering the study) is adequately described for key characteristics (LIST).'),
    ],
    summary: 'The study sample represents the population of interest on key characteristics, sufficient to limit potential bias of the observed relationship between PF and outcome.',
  }),
  domain({
    id: 'attrition',
    name: 'Study Attrition',
    shortLabel: 'Attrition',
    goal: 'To judge the risk of attrition bias (likelihood that relationship between PF and outcome are different for completing and non-completing participants).',
    items: [
      item('2.1', 'Proportion of baseline sample available for analysis', 'Response rate (i.e., proportion of study sample completing the study and providing outcome data) is adequate.'),
      item('2.2', 'Attempts to collect information on participants who dropped out', 'Attempts to collect information on participants who dropped out of the study are described.'),
      item('2.3', 'Reasons and potential impact of subjects lost to follow-up', 'Reasons for loss to follow-up are provided.'),
      item('2.4', 'Outcome and prognostic factor information on those lost to follow-up', 'Participants lost to follow-up are adequately described for key characteristics (LIST).'),
      item('2.5', 'Outcome and prognostic factor information on those lost to follow-up', 'There are no important differences between key characteristics (LIST) and outcomes in participants who completed the study and those who did not.'),
    ],
    summary: 'Loss to follow-up (from baseline sample to study population analyzed) is not associated with key characteristics (i.e., the study data adequately represent the sample) sufficient to limit potential bias to the observed relationship between PF and outcome.',
  }),
  domain({
    id: 'prognostic-factor',
    name: 'Prognostic Factor Measurement',
    shortLabel: 'PF measurement',
    goal: 'To judge the risk of measurement bias related to how PF was measured (differential measurement of PF related to the level of outcome).',
    items: [
      item('3.1', 'Definition of the PF', "A clear definition or description of 'PF' is provided (e.g., including dose, level, duration of exposure, and clear specification of the method of measurement)."),
      item('3.2', 'Valid and Reliable Measurement of PF', 'Method of PF measurement is adequately valid and reliable to limit misclassification bias (e.g., may include relevant outside sources of information on measurement properties, also characteristics, such as blind measurement and limited reliance on recall).'),
      item('3.3', 'Valid and Reliable Measurement of PF', 'Continuous variables are reported or appropriate cut-points (i.e., not data-dependent) are used.'),
      item('3.4', 'Method and Setting of PF Measurement', 'The method and setting of measurement of PF is the same for all study participants.'),
      item('3.5', 'Proportion of data on PF available for analysis', 'Adequate proportion of the study sample has complete data for PF variable.'),
      item('3.6', 'Method used for missing data', "Appropriate methods of imputation are used for missing 'PF' data."),
    ],
    summary: 'PF is adequately measured in study participants to sufficiently limit potential bias.',
  }),
  domain({
    id: 'outcome',
    name: 'Outcome Measurement',
    shortLabel: 'Outcome measurement',
    goal: 'To judge the risk of bias related to the measurement of outcome (differential measurement of outcome related to the baseline level of PF).',
    items: [
      item('4.1', 'Definition of the Outcome', 'A clear definition of outcome is provided, including duration of follow-up and level and extent of the outcome construct.'),
      item('4.2', 'Valid and Reliable Measurement of Outcome', 'The method of outcome measurement used is adequately valid and reliable to limit misclassification bias (e.g., may include relevant outside sources of information on measurement properties, also characteristics, such as blind measurement and confirmation of outcome with valid and reliable test).'),
      item('4.3', 'Method and Setting of Outcome Measurement', 'The method and setting of outcome measurement is the same for all study participants.'),
    ],
    summary: 'Outcome of interest is adequately measured in study participants to sufficiently limit potential bias.',
  }),
  domain({
    id: 'confounding',
    name: 'Study Confounding',
    shortLabel: 'Confounding',
    goal: 'To judge the risk of bias due to confounding (i.e. the effect of PF is distorted by another factor that is related to PF and outcome).',
    items: [
      item('5.1', 'Important Confounders Measured', 'All important confounders, including treatments (key variables in conceptual model: LIST), are measured.'),
      item('5.2', 'Definition of the confounding factor', 'Clear definitions of the important confounders measured are provided (e.g., including dose, level, and duration of exposures).'),
      item('5.3', 'Valid and Reliable Measurement of Confounders', 'Measurement of all important confounders is adequately valid and reliable (e.g., may include relevant outside sources of information on measurement properties, also characteristics, such as blind measurement and limited reliance on recall).'),
      item('5.4', 'Method and Setting of Confounding Measurement', 'The method and setting of confounding measurement are the same for all study participants.'),
      item('5.5', 'Method used for missing data', 'Appropriate methods are used if imputation is used for missing confounder data.'),
      item('5.6', 'Appropriate Accounting for Confounding', 'Important potential confounders are accounted for in the study design (e.g., matching for key variables, stratification, or initial assembly of comparable groups).'),
      item('5.7', 'Appropriate Accounting for Confounding', 'Important potential confounders are accounted for in the analysis (i.e., appropriate adjustment).'),
    ],
    summary: 'Important potential confounders are appropriately accounted for, limiting potential bias with respect to the relationship between PF and outcome.',
  }),
  domain({
    id: 'analysis',
    name: 'Statistical Analysis and Reporting',
    shortLabel: 'Analysis & reporting',
    goal: 'To judge the risk of bias related to the statistical analysis and presentation of results.',
    items: [
      item('6.1', 'Presentation of analytical strategy', 'There is sufficient presentation of data to assess the adequacy of the analysis.'),
      item('6.2', 'Model development strategy', 'The strategy for model building (i.e., inclusion of variables in the statistical model) is appropriate and is based on a conceptual framework or model.'),
      item('6.3', 'Model development strategy', 'The selected statistical model is adequate for the design of the study.'),
      item('6.4', 'Reporting of results', 'There is no selective reporting of results.'),
    ],
    summary: 'The statistical analysis is appropriate for the design of the study, limiting potential for presentation of invalid or spurious results.',
  }),
];

export const QUIPS = freezeInstrument({
  id: 'QUIPS',
  name: 'Quality In Prognosis Studies (QUIPS)',
  abbreviation: 'QUIPS',
  version: '2013',
  instrumentVersion: '2013',
  organization: 'Hayden et al.; hosted by the Cochrane Prognosis Methods Group',
  designs: ['prognostic'],
  description:
    'Six-domain tool for studies of prognostic factors. Each domain lists prompting items rated for adequacy '
    + 'of reporting (yes / partial / no / unsure); the assessor then rates the domain\'s risk of bias as High, '
    + 'Moderate or Low considering all relevant issues. QUIPS defines no overall algorithm and no score.',
  citation:
    'Hayden JA, van der Windt DA, Cartwright JL, Côté P, Bombardier C. Assessing bias in studies of prognostic '
    + 'factors. Ann Intern Med 2013;158(4):280-286.',
  guidanceUrl: 'https://methods.cochrane.org/prognosis/tools',
  license:
    'Published in Annals of Internal Medicine (copyrighted); the full tool is distributed by the Cochrane '
    + 'Prognosis Methods Group. No standalone licence for the tool text is published, so terms for embedding '
    + 'item text in commercial software should be confirmed with the developers.',
  consensusSupported: true,
  scoringAllowed: false,
  columnInstructions: COLUMN_INSTRUCTIONS,
  responseOptions: responseOptions(RESPONSES_QUIPS),
  judgmentLevels: RISK_LMH,
  domains: DOMAINS,
  overall: Object.freeze({
    axis: 'rob',
    computed: false,
    official: false,
    levels: RISK_LMH,
    rule: null,
    guidance:
      'QUIPS prescribes domain-level ratings only: Hayden 2013 defines no overall algorithm and no numeric '
      + 'score. Review teams define their own summary rule (commonly "low overall if all or most domains are '
      + 'low") and record it in the protocol. Any overall value here is the review team\'s judgement, not a '
      + 'QUIPS output.',
  }),
  overallGuidance:
    'Rate each of the six domains High, Moderate or Low. QUIPS stops there — it defines no overall judgement '
    + 'and no score. An overall value may be recorded only as the review team\'s own pre-agreed summary rule, '
    + 'and must be labelled as such.',
});

/* ════════════ judgements ════════════ */

/**
 * A QUIPS domain rating is the assessor's, made "considering all relevant
 * issues" — there is no algorithm from prompting items to the rating. This
 * returns a reviewer-judged result carrying the reporting-adequacy tally (a
 * progress count, never a rating), or passes through the reviewer's rating when
 * one is supplied.
 *
 * @param {string} domainId
 * @param {object} answers            prompting item id → yes/partial/no/unsure
 * @param {{ rating?: string }} [options] the reviewer's domain rating
 * Pure.
 */
export function judgeDomain(domainId, answers, options) {
  const d = DOMAINS.find((x) => x.id === domainId);
  if (!d) throw new Error(`Unknown QUIPS domain: ${domainId}`);
  const tally = tallyResponses(d, answers || {});
  const rating = options && options.rating;

  if (rating && QUIPS_JUDGMENTS.includes(rating)) {
    const label = RISK_LMH.find((l) => l.value === rating).label;
    return {
      domainId,
      axis: 'rob',
      judgment: rating,
      computed: false,
      reviewerJudged: true,
      tally,
      reasons: [`${label}, rated by the assessor considering all relevant issues in ${d.name}.`],
    };
  }

  return {
    ...reviewerJudged([
      `${tally.answered} of ${tally.total} prompting items rated for adequacy of reporting.`,
      COLUMN_INSTRUCTIONS.risk,
    ]),
    domainId,
    axis: 'rob',
    tally,
  };
}

/**
 * QUIPS defines NO overall judgement. This passes through a summary rating the
 * review team recorded under its own pre-agreed rule, always stamped
 * `official: false` so no consumer can present it as a QUIPS output.
 *
 * @param {*} _domainJudgments accepted for engine-contract compatibility.
 * @param {{ rating?: string }} [options]
 * Pure.
 */
export function judgeOverall(_domainJudgments, options) {
  const rating = options && options.rating;
  if (rating && QUIPS_JUDGMENTS.includes(rating)) {
    return {
      judgment: rating,
      computed: false,
      official: false,
      reviewerJudged: true,
      multiSomeConcernsFlag: false,
      reasons: [
        `${RISK_LMH.find((l) => l.value === rating).label}, recorded by the review team under its own summary rule.`,
        'QUIPS itself defines no overall judgement — this is not a QUIPS output.',
      ],
    };
  }
  return {
    ...reviewerJudged([
      'QUIPS prescribes domain-level ratings only and defines no overall algorithm or score.',
      'An overall value, if recorded, is the review team\'s own pre-agreed summary rule.',
    ]),
    official: false,
    multiSomeConcernsFlag: false,
  };
}

export default {
  QUIPS,
  QUIPS_RESPONSES,
  QUIPS_JUDGMENTS,
  COLUMN_INSTRUCTIONS,
  judgeDomain,
  judgeOverall,
};
