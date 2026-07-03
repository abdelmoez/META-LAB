/**
 * robinsI.js — the ROBINS-I instrument for NON-RANDOMISED studies of
 * interventions (cohort / controlled before-after / interrupted time series etc.).
 *
 * PURE: data + deterministic algorithm. No Prisma / Express / React / network /
 * randomness / Date.now(). Same input → same output. Mirrors the shape of
 * instruments/rob2.js exactly so the generic engine (engine.js) can dispatch to
 * either instrument with no special-casing.
 *
 * SOURCE OF THE INSTRUMENT + ALGORITHM:
 *   Sterne JAC, Hernán MA, Reeves BC, et al. "ROBINS-I: a tool for assessing risk
 *   of bias in non-randomised studies of interventions." BMJ 2016;355:i4919.
 *   (plus the accompanying "Detailed guidance" document, riskofbias.info, 2016).
 *
 *   - The SEVEN bias domains, their signalling questions, the branching structure,
 *     the five-level judgement scale (Low / Moderate / Serious / Critical /
 *     No information) and the "reaching a risk-of-bias judgement" mapping are taken
 *     from that guidance. Each per-domain algorithm below cites the guidance rule
 *     it encodes.
 *   - The OVERALL roll-up follows the guidance "Reaching an overall judgement"
 *     table: the overall judgement is the WORST (highest) level reached in any
 *     domain, i.e. the overall risk of bias can never be lower than the most severe
 *     single domain; "No information" is used when ≥1 domain lacks information AND
 *     there is no clear indication of Serious/Critical risk anywhere.
 *
 * The engine COMPUTES the proposed judgement and returns a human-readable
 * `reasons` trace; the human decides and may override with a logged rationale.
 * Deterministic proposals err on the side of caution — uncertainty maps to
 * "No information" or a higher risk level, never to a fabricated "Low".
 */

// ── Response + judgement vocabularies ────────────────────────────────────────
export const RESPONSES = ['Y', 'PY', 'PN', 'N', 'NI', 'NA'];
export const RESPONSE_LABELS = {
  Y: 'Yes',
  PY: 'Probably yes',
  PN: 'Probably no',
  N: 'No',
  NI: 'No information',
  NA: 'Not applicable',
};

// ROBINS-I five-level ordinal scale (Sterne 2016). `ni` = "No information".
export const JUDGMENTS = ['low', 'moderate', 'serious', 'critical', 'ni'];
export const JUDGMENT_LABELS = {
  low: 'Low risk of bias',
  moderate: 'Moderate risk of bias',
  serious: 'Serious risk of bias',
  critical: 'Critical risk of bias',
  ni: 'No information',
};

// ── Response-class helpers (the algorithm only cares about these classes) ─────
const yp = r => r === 'Y' || r === 'PY';   // "Yes / Probably yes"
const np = r => r === 'N' || r === 'PN';   // "No / Probably no"
const ni = r => r === 'NI';                // "No information"

/** Coerce a stored answer to a bare response code (string) or undefined. */
function code(answers, qid) {
  const v = answers ? answers[qid] : undefined;
  if (v == null) return undefined;
  return typeof v === 'string' ? v : v.response;
}

// Reachability class sets used by the declarative `branch` rules.
const YP = ['Y', 'PY'];
const YPNI = ['Y', 'PY', 'NI'];
const NPNI = ['N', 'PN', 'NI'];

// ── Instrument DATA (serialisable) ───────────────────────────────────────────
const DOMAINS = [
  {
    id: 'D1',
    name: 'Bias due to confounding',
    shortLabel: 'Confounding',
    description:
      'Whether baseline (and, for time-varying treatments, time-varying) confounding of the effect of intervention was appropriately controlled by the analysis.',
    questions: [
      {
        id: '1.1',
        text: 'Is there potential for confounding of the effect of intervention in this study?',
        guidance:
          'If No/Probably no, the study can be considered at low risk of bias due to confounding and no further signalling questions for this domain need be answered.',
        branch: null,
      },
      {
        id: '1.2',
        text: 'Was the analysis based on splitting participants’ follow-up time according to intervention received?',
        guidance:
          'If Yes/Probably yes (e.g. time-varying treatment), answer 1.3, 1.7 and 1.8. If No/Probably no, answer 1.4, 1.5 and 1.6.',
        branch: { allOf: [{ q: '1.1', in: YPNI }] },
      },
      {
        id: '1.3',
        text: 'Were intervention discontinuations or switches likely to be related to factors that are prognostic for the outcome?',
        guidance: 'Relevant only when follow-up time was split by intervention received (time-varying confounding).',
        branch: { allOf: [{ q: '1.2', in: YP }] },
      },
      {
        id: '1.4',
        text: 'Did the authors use an appropriate analysis method that controlled for all the important confounding domains?',
        guidance: 'Appropriate methods include stratification, regression, matching, standardisation or inverse-probability weighting on the important confounders.',
        branch: { allOf: [{ q: '1.2', in: NPNI }] },
      },
      {
        id: '1.5',
        text: 'Were confounding domains that were controlled for measured validly and reliably by the variables available in this study?',
        guidance: 'Measurement error in the confounders leaves residual confounding even when they are adjusted for.',
        branch: { allOf: [{ q: '1.4', in: YP }] },
      },
      {
        id: '1.6',
        text: 'Did the authors control for any post-intervention variables that could have been affected by the intervention?',
        guidance: 'Adjusting for a variable on the causal pathway (a mediator) introduces bias; Yes/Probably yes is a serious problem.',
        branch: { allOf: [{ q: '1.1', in: YPNI }] },
      },
      {
        id: '1.7',
        text: 'Did the authors use an appropriate analysis method that controlled for all the important confounding domains and for time-varying confounding?',
        guidance: 'For time-varying treatments, appropriate methods (e.g. g-methods) are needed to control time-varying confounding.',
        branch: { allOf: [{ q: '1.2', in: YP }] },
      },
      {
        id: '1.8',
        text: 'Were confounding domains that were controlled for measured validly and reliably by the variables available in this study?',
        guidance: 'As 1.5, but for the time-varying-confounding analysis path.',
        branch: { allOf: [{ q: '1.7', in: YP }] },
      },
    ],
  },
  {
    id: 'D2',
    name: 'Bias in selection of participants into the study',
    shortLabel: 'Selection',
    description:
      'Whether selection into the study (or into the analysis) was related to intervention and outcome, e.g. because it was based on characteristics observed after the start of intervention.',
    questions: [
      {
        id: '2.1',
        text: 'Was selection into the study (or into the analysis) based on participant characteristics observed after the start of intervention?',
        guidance: 'If No/Probably no, selection bias of this type is unlikely. If Yes/Probably yes, answer 2.2 and 2.3.',
        branch: null,
      },
      {
        id: '2.2',
        text: 'Were the post-intervention variables that influenced selection likely to be associated with intervention?',
        guidance: 'Selection bias arises only when the selection variable is associated with BOTH intervention and outcome.',
        branch: { allOf: [{ q: '2.1', in: YP }] },
      },
      {
        id: '2.3',
        text: 'Were the post-intervention variables that influenced selection likely to be influenced by the outcome or a cause of the outcome?',
        guidance: 'Completes the “associated with both intervention and outcome” condition for selection bias.',
        branch: { allOf: [{ q: '2.2', in: YP }] },
      },
      {
        id: '2.4',
        text: 'Do start of follow-up and start of intervention coincide for most participants?',
        guidance: 'When they do not coincide, prevalent-user / immortal-time bias can arise.',
        branch: null,
      },
      {
        id: '2.5',
        text: 'Were adjustment techniques used that are likely to correct for the presence of selection biases?',
        guidance: 'Only asked when a selection concern (post-baseline selection, or non-coinciding follow-up) is present.',
        branch: { anyOf: [{ q: '2.1', in: YP }, { q: '2.4', in: NPNI }] },
      },
    ],
  },
  {
    id: 'D3',
    name: 'Bias in classification of interventions',
    shortLabel: 'Classification',
    description:
      'Whether intervention groups were clearly defined and whether the recorded information used to classify them was affected by knowledge of the outcome (differential misclassification).',
    questions: [
      {
        id: '3.1',
        text: 'Were intervention groups clearly defined?',
        guidance: 'Ambiguous or overlapping group definitions cause misclassification of intervention status.',
        branch: null,
      },
      {
        id: '3.2',
        text: 'Was the information used to define intervention groups recorded at the start of the intervention?',
        guidance: 'Contemporaneous recording avoids recall / retrospective misclassification.',
        branch: null,
      },
      {
        id: '3.3',
        text: 'Could classification of intervention status have been affected by knowledge of the outcome or risk of the outcome?',
        guidance: 'Yes/Probably yes indicates differential misclassification, a serious problem.',
        branch: null,
      },
    ],
  },
  {
    id: 'D4',
    name: 'Bias due to deviations from intended interventions',
    shortLabel: 'Deviations',
    description:
      'Whether there were deviations from the intended intervention beyond usual practice, whether co-interventions were balanced, and whether adherence/implementation problems were handled by an appropriate analysis.',
    questions: [
      {
        id: '4.1',
        text: 'Were there deviations from the intended intervention beyond what would be expected in usual practice?',
        guidance: 'Only deviations that arise because of the research context (not those reflecting usual care) are relevant here.',
        branch: null,
      },
      {
        id: '4.2',
        text: 'Were these deviations from intended intervention unbalanced between groups and likely to have affected the outcome?',
        guidance: 'Unbalanced, outcome-affecting deviations are the most serious form.',
        branch: { allOf: [{ q: '4.1', in: YP }] },
      },
      {
        id: '4.3',
        text: 'Were important co-interventions balanced across intervention groups?',
        guidance: 'Differential co-interventions bias the estimated effect of the intervention of interest.',
        branch: null,
      },
      {
        id: '4.4',
        text: 'Was the intervention implemented successfully for most participants?',
        guidance: 'Poor implementation fidelity dilutes or distorts the effect.',
        branch: null,
      },
      {
        id: '4.5',
        text: 'Did study participants adhere to the assigned intervention regimen?',
        guidance: 'Non-adherence, if not appropriately analysed, biases the estimated effect of adhering to the intervention.',
        branch: null,
      },
      {
        id: '4.6',
        text: 'Was an appropriate analysis used to estimate the effect of starting and adhering to the intervention?',
        guidance: 'e.g. per-protocol analysis with adjustment, or instrumental-variable methods. Only asked when implementation/adherence was imperfect.',
        branch: { anyOf: [{ q: '4.4', in: NPNI }, { q: '4.5', in: NPNI }] },
      },
    ],
  },
  {
    id: 'D5',
    name: 'Bias due to missing data',
    shortLabel: 'Missing data',
    description:
      'Whether outcome, intervention-status and confounder data were available for nearly all participants, and—if not—whether the result is robust to the missingness.',
    questions: [
      {
        id: '5.1',
        text: 'Were outcome data available for all, or nearly all, participants?',
        guidance: '“Nearly all” means enough to be confident of the findings.',
        branch: null,
      },
      {
        id: '5.2',
        text: 'Were participants excluded due to missing data on intervention status?',
        guidance: 'Exclusions for missing intervention status can bias the analysed sample.',
        branch: null,
      },
      {
        id: '5.3',
        text: 'Were participants excluded due to missing data on other variables needed for the analysis (e.g. confounders)?',
        guidance: 'Complete-case analysis on confounders can bias results.',
        branch: null,
      },
      {
        id: '5.4',
        text: 'Are the proportion of participants and reasons for missing data similar across interventions?',
        guidance: 'Differential missingness across groups is more likely to bias the result.',
        branch: { anyOf: [{ q: '5.1', in: NPNI }, { q: '5.2', in: YP }, { q: '5.3', in: YP }] },
      },
      {
        id: '5.5',
        text: 'Is there evidence that the result was robust to the presence of missing data?',
        guidance: 'e.g. appropriate methods (multiple imputation) and/or sensitivity analyses showing robustness.',
        branch: { anyOf: [{ q: '5.1', in: NPNI }, { q: '5.2', in: YP }, { q: '5.3', in: YP }] },
      },
    ],
  },
  {
    id: 'D6',
    name: 'Bias in measurement of outcomes',
    shortLabel: 'Measurement',
    description:
      'Whether the outcome measure could have been influenced by knowledge of the intervention received and whether ascertainment methods were comparable across groups.',
    questions: [
      {
        id: '6.1',
        text: 'Could the outcome measure have been influenced by knowledge of the intervention received?',
        guidance: 'Subjective / clinician-assessed outcomes are more susceptible than objective ones (e.g. all-cause mortality).',
        branch: null,
      },
      {
        id: '6.2',
        text: 'Were outcome assessors aware of the intervention received by study participants?',
        guidance: 'For participant-reported outcomes the assessor is the participant.',
        branch: null,
      },
      {
        id: '6.3',
        text: 'Were the methods of outcome assessment comparable across intervention groups?',
        guidance: 'Different methods, timings or intensities of ascertainment between groups cause bias.',
        branch: null,
      },
      {
        id: '6.4',
        text: 'Were any systematic errors in measurement of the outcome related to intervention received?',
        guidance: 'Yes/Probably yes indicates differential measurement error, a serious problem.',
        branch: null,
      },
    ],
  },
  {
    id: 'D7',
    name: 'Bias in selection of the reported result',
    shortLabel: 'Selective reporting',
    description:
      'Whether the reported result was selected, on the basis of the results, from multiple outcome measurements, multiple analyses, or different subgroups.',
    questions: [
      {
        id: '7.1',
        text: 'Is the reported effect estimate likely to be selected, on the basis of the results, from multiple outcome measurements within the outcome domain?',
        guidance: 'Selection among multiple measurements (scales, definitions, time points) on the basis of the results.',
        branch: null,
      },
      {
        id: '7.2',
        text: 'Is the reported effect estimate likely to be selected, on the basis of the results, from multiple analyses of the intervention–outcome relationship?',
        guidance: 'Selection among multiple analyses (adjusted/unadjusted, model variants) on the basis of the results.',
        branch: null,
      },
      {
        id: '7.3',
        text: 'Is the reported effect estimate likely to be selected, on the basis of the results, from different subgroups?',
        guidance: 'Selection among subgroup results on the basis of the results.',
        branch: null,
      },
    ],
  },
];

export const ROBINSI = Object.freeze({
  id: 'ROBINS-I',
  name: 'Risk Of Bias In Non-randomised Studies of Interventions (ROBINS-I)',
  instrumentVersion: '2016',
  variant: 'effect-of-assignment',
  variantLabel: 'Non-randomised studies of interventions',
  design: 'non-randomised',
  responseOptions: RESPONSES.filter(r => r !== 'NA').map(value => ({ value, label: RESPONSE_LABELS[value] })),
  judgmentLevels: JUDGMENTS.map(value => ({ value, label: JUDGMENT_LABELS[value] })),
  // Severity-ASCENDING category order for ordinal analyses (weighted κ). NOT the
  // same as `judgmentLevels` display order: "No information" (ni) is not the most
  // severe level — it ranks BELOW Serious/Critical and ABOVE Moderate (mirrors
  // OVERALL_RANK / RANK_TO_LEVEL used by judgeOverall). Weighted-κ disagreement
  // weights MUST use this order, or `ni` would be treated as maximally severe.
  judgmentOrder: ['low', 'moderate', 'ni', 'serious', 'critical'],
  domains: DOMAINS.map(d => Object.freeze({
    ...d,
    questions: d.questions.map(q => Object.freeze({ ...q })),
  })),
  overallGuidance:
    'ROBINS-I overall risk of bias is the WORST (most severe) judgement across the seven domains: Low only when every domain is Low; Moderate when the worst is Moderate; Serious when at least one domain is Serious (and none Critical); Critical when at least one domain is Critical. “No information” is used when one or more key domains lack information AND there is no indication of Serious or Critical risk elsewhere. The overall judgement can never be lower than the most severe single domain.',
});

// ── Per-domain judgement algorithms (pure) ───────────────────────────────────
// Each returns { judgment, reasons: string[] }. Uncertainty is resolved
// conservatively (towards "No information" or a higher risk level, never a
// fabricated "Low"). References are to Sterne 2016 / the ROBINS-I detailed
// guidance "reaching a risk of bias judgement" tables.

// D1 — Confounding. Low requires all important confounders controlled for and
// measured validly, no adjustment for post-intervention (mediator) variables.
// Serious = failure to control important confounding OR adjusting for a mediator.
// Critical = adjusting for a mediator AND failing to control confounding.
function domain1(a) {
  const q11 = code(a, '1.1'), q12 = code(a, '1.2'), q13 = code(a, '1.3');
  const q14 = code(a, '1.4'), q15 = code(a, '1.5'), q16 = code(a, '1.6');
  const q17 = code(a, '1.7'), q18 = code(a, '1.8');
  const reasons = [];

  if (np(q11)) {
    reasons.push('No potential for confounding of the effect of intervention (1.1 = No/Probably no).');
    return { judgment: 'low', reasons };
  }

  const timeSplit = yp(q12);
  const controlled = timeSplit ? q17 : q14;   // appropriate analysis controlling confounding?
  const valid = timeSplit ? q18 : q15;        // confounders measured validly/reliably?
  const switchConcern = timeSplit && yp(q13);

  if (yp(q16)) {
    if (np(controlled)) {
      reasons.push('The analysis adjusted for a post-intervention variable on the causal pathway (1.6 = Yes/Probably yes) AND failed to control important confounding — the study cannot provide useful evidence on the effect.');
      return { judgment: 'critical', reasons };
    }
    reasons.push('The analysis adjusted for a post-intervention (mediator) variable that could have been affected by the intervention (1.6 = Yes/Probably yes), introducing bias.');
    return { judgment: 'serious', reasons };
  }

  if (np(controlled)) {
    reasons.push(`The analysis did not control for all important confounding domains (${timeSplit ? '1.7' : '1.4'} = No/Probably no).`);
    return { judgment: 'serious', reasons };
  }

  if (yp(controlled)) {
    if (switchConcern) {
      reasons.push('Intervention discontinuations/switches were likely related to prognostic factors (1.3 = Yes/Probably yes) — potential time-varying confounding despite an otherwise appropriate analysis.');
      if (yp(valid)) return { judgment: 'moderate', reasons };
    }
    if (yp(valid)) {
      reasons.push(`Important confounding domains were controlled for (${timeSplit ? '1.7' : '1.4'} = Yes/Probably yes) and measured validly/reliably (${timeSplit ? '1.8' : '1.5'} = Yes/Probably yes).`);
      return { judgment: switchConcern ? 'moderate' : 'low', reasons };
    }
    if (np(valid) || ni(valid)) {
      reasons.push(`Confounders were controlled for, but not all were measured validly/reliably (${timeSplit ? '1.8' : '1.5'} = No/Probably no/NI) — residual confounding likely.`);
      return { judgment: 'moderate', reasons };
    }
    reasons.push('Important confounders were controlled for, but whether they were measured validly/reliably is not yet established.');
    return { judgment: 'moderate', reasons };
  }

  reasons.push('There is no information on whether the analysis appropriately controlled for confounding.');
  return { judgment: 'ni', reasons };
}

// D2 — Selection of participants. Low = no post-baseline selection and start of
// follow-up coincides with start of intervention. Serious = post-baseline
// selection associated with both intervention and outcome, unadjusted.
function domain2(a) {
  const q21 = code(a, '2.1'), q22 = code(a, '2.2'), q23 = code(a, '2.3');
  const q24 = code(a, '2.4'), q25 = code(a, '2.5');
  const reasons = [];
  const adjusted = yp(q25);

  if (yp(q21)) {
    const strong = yp(q22) && yp(q23);
    if (strong) {
      if (adjusted) {
        reasons.push('Selection was based on post-intervention characteristics associated with both intervention and outcome (2.1–2.3 = Yes/Probably yes), but adjustment techniques were used to correct for it (2.5 = Yes/Probably yes).');
        return { judgment: 'moderate', reasons };
      }
      reasons.push('Selection into the study was based on post-intervention characteristics associated with both intervention and outcome (2.1–2.3 = Yes/Probably yes) and was not corrected by adjustment.');
      return { judgment: 'serious', reasons };
    }
    reasons.push('Selection was based on characteristics observed after the start of intervention (2.1 = Yes/Probably yes), but the link to both intervention and outcome is not clearly established.');
    return { judgment: 'moderate', reasons };
  }

  if (np(q21)) {
    if (yp(q24)) {
      reasons.push('Selection was not based on post-intervention characteristics (2.1 = No/Probably no) and start of follow-up coincided with start of intervention (2.4 = Yes/Probably yes).');
      return { judgment: 'low', reasons };
    }
    if (np(q24)) {
      reasons.push('Start of follow-up did not coincide with start of intervention (2.4 = No/Probably no) — potential for prevalent-user / immortal-time bias.');
      return { judgment: adjusted ? 'moderate' : 'serious', reasons };
    }
    reasons.push('Selection was not based on post-intervention characteristics, but whether follow-up and intervention start coincide is not established (2.4 unanswered).');
    return { judgment: 'ni', reasons };
  }

  reasons.push('There is no information on whether selection into the study was based on post-intervention characteristics (2.1 = NI / unanswered).');
  return { judgment: 'ni', reasons };
}

// D3 — Classification of interventions. Low = clearly defined groups, recorded
// at intervention start, classification not affected by outcome knowledge.
function domain3(a) {
  const q31 = code(a, '3.1'), q32 = code(a, '3.2'), q33 = code(a, '3.3');
  const reasons = [];

  if (yp(q33)) {
    reasons.push('Classification of intervention status could have been affected by knowledge of the outcome (3.3 = Yes/Probably yes) — differential misclassification.');
    return { judgment: 'serious', reasons };
  }
  if (ni(q33)) {
    reasons.push('There is no information on whether classification of intervention status was affected by knowledge of the outcome (3.3 = NI) — non-differential misclassification cannot be excluded.');
    return { judgment: 'moderate', reasons };
  }
  if (np(q33)) {
    if (yp(q31) && yp(q32)) {
      reasons.push('Intervention groups were clearly defined (3.1 = Yes/Probably yes) and recorded at the start of intervention (3.2 = Yes/Probably yes), with classification unaffected by outcome knowledge (3.3 = No/Probably no).');
      return { judgment: 'low', reasons };
    }
    if (np(q31) || np(q32)) {
      reasons.push('Intervention groups were not clearly defined or not recorded at the start of intervention (3.1 / 3.2 = No/Probably no) — non-differential misclassification is likely.');
      return { judgment: 'moderate', reasons };
    }
    reasons.push('Classification was not affected by outcome knowledge, but whether groups were clearly defined and recorded contemporaneously is not fully established.');
    return { judgment: 'moderate', reasons };
  }

  reasons.push('There is insufficient information to judge classification of interventions (3.3 unanswered).');
  return { judgment: 'ni', reasons };
}

// D4 — Deviations from intended interventions. Critical = unbalanced,
// outcome-affecting deviations with no appropriate analysis.
function domain4(a) {
  const q41 = code(a, '4.1'), q42 = code(a, '4.2'), q43 = code(a, '4.3');
  const q44 = code(a, '4.4'), q45 = code(a, '4.5'), q46 = code(a, '4.6');
  const reasons = [];
  const approp = yp(q46);
  const anyAnswered = [q41, q42, q43, q44, q45, q46].some(v => v != null);

  if (yp(q41) && yp(q42)) {
    if (approp) {
      reasons.push('There were deviations from the intended intervention that were unbalanced and likely to have affected the outcome (4.1 & 4.2 = Yes/Probably yes), but an appropriate analysis was used (4.6 = Yes/Probably yes).');
      return { judgment: 'serious', reasons };
    }
    reasons.push('There were deviations from the intended intervention that were unbalanced and likely to have affected the outcome (4.1 & 4.2 = Yes/Probably yes) with no appropriate analysis to account for them — the study may be too problematic to provide useful evidence.');
    return { judgment: 'critical', reasons };
  }

  if (np(q43)) {
    reasons.push('Important co-interventions were not balanced across intervention groups (4.3 = No/Probably no).');
    return { judgment: approp ? 'moderate' : 'serious', reasons };
  }

  if (np(q44) || np(q45)) {
    if (approp) {
      reasons.push('Implementation/adherence was imperfect (4.4 / 4.5 = No/Probably no) but an appropriate analysis was used to estimate the effect of adhering to the intervention (4.6 = Yes/Probably yes).');
      return { judgment: 'low', reasons };
    }
    reasons.push('The intervention was not implemented successfully or participants did not adhere (4.4 / 4.5 = No/Probably no) and no appropriate analysis was used to account for this.');
    return { judgment: 'moderate', reasons };
  }

  const cleanDeviations = np(q41) || (yp(q41) && np(q42));
  if (cleanDeviations && yp(q43)) {
    reasons.push('No deviations beyond usual practice affected the result (4.1 / 4.2) and important co-interventions were balanced (4.3 = Yes/Probably yes).');
    return { judgment: 'low', reasons };
  }

  if (!anyAnswered) {
    reasons.push('There is no information about deviations from intended interventions.');
    return { judgment: 'ni', reasons };
  }
  reasons.push('Some deviation, co-intervention or adherence information is missing; the domain cannot be confirmed as low risk.');
  return { judgment: 'moderate', reasons };
}

// D5 — Missing data. Low = data for nearly all participants, or robust to the
// missingness. Serious = differential missingness with no evidence of robustness.
function domain5(a) {
  const q51 = code(a, '5.1'), q52 = code(a, '5.2'), q53 = code(a, '5.3');
  const q54 = code(a, '5.4'), q55 = code(a, '5.5');
  const reasons = [];
  const missing = np(q51) || yp(q52) || yp(q53);

  if (!missing) {
    if (yp(q51)) {
      reasons.push('Outcome data were available for all, or nearly all, participants (5.1 = Yes/Probably yes) with no exclusions for missing intervention/confounder data.');
      return { judgment: 'low', reasons };
    }
    reasons.push('Whether outcome data were available for nearly all participants is not established (5.1 = NI / unanswered).');
    return { judgment: 'ni', reasons };
  }

  if (yp(q55)) {
    reasons.push('There was missing data, but there is evidence the result was robust to it (5.5 = Yes/Probably yes).');
    return { judgment: 'low', reasons };
  }
  if (yp(q54)) {
    reasons.push('There was missing data; the proportion and reasons were similar across intervention groups (5.4 = Yes/Probably yes) but robustness to the missingness was not demonstrated.');
    return { judgment: 'moderate', reasons };
  }
  if (np(q54)) {
    reasons.push('Missing data differed in proportion or reasons across intervention groups (5.4 = No/Probably no) with no evidence the result was robust to it.');
    return { judgment: 'serious', reasons };
  }
  reasons.push('There was missing data and whether it was balanced across groups is not established (5.4 = NI / unanswered).');
  return { judgment: 'moderate', reasons };
}

// D6 — Measurement of outcomes. Serious = systematic measurement error related to
// intervention (differential). Low = comparable methods + objective or blinded.
function domain6(a) {
  const q61 = code(a, '6.1'), q62 = code(a, '6.2'), q63 = code(a, '6.3'), q64 = code(a, '6.4');
  const reasons = [];

  if (yp(q64)) {
    reasons.push('There were systematic errors in measurement of the outcome related to the intervention received (6.4 = Yes/Probably yes) — differential measurement error.');
    return { judgment: 'serious', reasons };
  }

  const subjectiveAware = yp(q61) && yp(q62);

  if (np(q63)) {
    if (subjectiveAware) {
      reasons.push('Outcome-assessment methods were not comparable across groups (6.3 = No/Probably no) and the outcome could be influenced by knowledge of the intervention with aware assessors (6.1 & 6.2 = Yes/Probably yes).');
      return { judgment: 'serious', reasons };
    }
    reasons.push('Outcome-assessment methods were not fully comparable across intervention groups (6.3 = No/Probably no).');
    return { judgment: 'moderate', reasons };
  }

  if (yp(q63)) {
    if (np(q61) || np(q62)) {
      reasons.push('Outcome-assessment methods were comparable across groups (6.3 = Yes/Probably yes) and the outcome was objective or assessors were blinded (6.1 / 6.2 = No/Probably no).');
      return { judgment: 'low', reasons };
    }
    if (subjectiveAware) {
      reasons.push('Methods were comparable across groups, but the outcome could be influenced by knowledge of the intervention and assessors were aware (6.1 & 6.2 = Yes/Probably yes).');
      return { judgment: 'moderate', reasons };
    }
    reasons.push('Outcome-assessment methods were comparable, but susceptibility to assessor knowledge is not fully established.');
    return { judgment: 'moderate', reasons };
  }

  if (np(q61) || np(q62)) {
    reasons.push('The outcome was objective or assessors were blinded, but comparability of assessment across groups is not established (6.3 = NI / unanswered).');
    return { judgment: 'moderate', reasons };
  }
  reasons.push('There is insufficient information to judge measurement of the outcome.');
  return { judgment: 'ni', reasons };
}

// D7 — Selection of the reported result. Serious = result-driven selection from
// multiple measurements, analyses or subgroups.
function domain7(a) {
  const q71 = code(a, '7.1'), q72 = code(a, '7.2'), q73 = code(a, '7.3');
  const reasons = [];

  if (yp(q71) || yp(q72) || yp(q73)) {
    if (yp(q71)) reasons.push('The reported result was likely selected from multiple outcome measurements on the basis of the results (7.1 = Yes/Probably yes).');
    if (yp(q72)) reasons.push('The reported result was likely selected from multiple analyses on the basis of the results (7.2 = Yes/Probably yes).');
    if (yp(q73)) reasons.push('The reported result was likely selected from different subgroups on the basis of the results (7.3 = Yes/Probably yes).');
    return { judgment: 'serious', reasons };
  }
  if (np(q71) && np(q72) && np(q73)) {
    reasons.push('The reported result corresponds to a pre-specified analysis with no evidence of result-driven selection from multiple measurements, analyses or subgroups (7.1–7.3 = No/Probably no).');
    return { judgment: 'low', reasons };
  }
  if ([q71, q72, q73].some(v => v != null)) {
    reasons.push('There is no clear evidence of result-driven selection, but the reporting/selection status is not fully established.');
    return { judgment: 'moderate', reasons };
  }
  reasons.push('There is no information on selection of the reported result.');
  return { judgment: 'ni', reasons };
}

const DOMAIN_ALGORITHMS = {
  D1: domain1, D2: domain2, D3: domain3, D4: domain4, D5: domain5, D6: domain6, D7: domain7,
};

/**
 * Propose a domain judgement from the answers (pure).
 * @returns {{ judgment: 'low'|'moderate'|'serious'|'critical'|'ni', reasons: string[] }}
 */
export function judgeDomain(domainId, answers) {
  const fn = DOMAIN_ALGORITHMS[domainId];
  if (!fn) throw new Error(`Unknown ROBINS-I domain: ${domainId}`);
  return fn(answers || {});
}

// Severity order for the overall roll-up. "No information" (ni) sits BELOW
// Serious/Critical (which override it) but ABOVE Moderate, per the guidance:
// overall is "No information" only when there is no indication of Serious/Critical
// risk anywhere and ≥1 key domain lacks information.
const OVERALL_RANK = { low: 0, moderate: 1, ni: 2, serious: 3, critical: 4 };
const RANK_TO_LEVEL = ['low', 'moderate', 'ni', 'serious', 'critical'];

/**
 * Propose the OVERALL judgement from the seven domain judgements (pure).
 * Overall = the worst (highest-rank) domain judgement; the overall risk of bias
 * can never be lower than the most severe single domain (Sterne 2016).
 * @param {Record<string,'low'|'moderate'|'serious'|'critical'|'ni'>|Array} domainJudgments
 * @returns {{ judgment, reasons: string[], criticalFlag: boolean, noInformationFlag: boolean }}
 */
export function judgeOverall(domainJudgments) {
  const values = (Array.isArray(domainJudgments)
    ? domainJudgments.map(d => (typeof d === 'string' ? d : d && d.judgment))
    : Object.values(domainJudgments || {}).map(d => (typeof d === 'string' ? d : d && d.judgment))
  ).filter(v => v != null && OVERALL_RANK[v] != null);

  const reasons = [];
  if (values.length === 0) {
    reasons.push('No domain judgements were available to roll up.');
    return { judgment: 'ni', reasons, criticalFlag: false, noInformationFlag: true };
  }

  let maxRank = 0;
  for (const v of values) maxRank = Math.max(maxRank, OVERALL_RANK[v]);
  const judgment = RANK_TO_LEVEL[maxRank];

  const counts = { low: 0, moderate: 0, serious: 0, critical: 0, ni: 0 };
  for (const v of values) counts[v] += 1;

  if (judgment === 'critical') {
    reasons.push(`At least one domain is at Critical risk of bias (${counts.critical} of ${values.length}) — the study is too problematic to provide useful evidence.`);
  } else if (judgment === 'serious') {
    reasons.push(`The most severe domain is at Serious risk of bias (${counts.serious} of ${values.length}); no domain is Critical.`);
  } else if (judgment === 'ni') {
    reasons.push(`One or more domains lack information (${counts.ni} of ${values.length}) and no domain indicates Serious or Critical risk — overall risk of bias cannot be determined.`);
  } else if (judgment === 'moderate') {
    reasons.push(`The most severe domain is at Moderate risk of bias (${counts.moderate} of ${values.length}) — the study is sound for a non-randomised study but not comparable to a well-performed randomised trial.`);
  } else {
    reasons.push('Every domain is judged at Low risk of bias — comparable to a well-performed randomised trial.');
  }

  return {
    judgment,
    reasons,
    criticalFlag: judgment === 'critical',
    noInformationFlag: judgment === 'ni',
  };
}

export { code as _answerCode, yp as _yp, np as _np, ni as _ni };
