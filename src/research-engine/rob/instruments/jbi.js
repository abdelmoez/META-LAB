/**
 * jbi.js — the five JBI (Joanna Briggs Institute) critical appraisal checklists
 * the platform ships: Case Series, Case Reports, Prevalence, Analytical
 * Cross-Sectional, and Qualitative Research (115.md, tool set decision 1).
 *
 * PURE: data only + two deterministic helpers. No Prisma / Express / React /
 * network / randomness / Date.now().
 *
 * ── ONE MODULE, FIVE INSTRUMENTS ────────────────────────────────────────────
 * These follow the nos.js precedent (two official forms in one file) rather than
 * five near-identical files: the checklists share their response set
 * (Yes / No / Unclear / Not applicable), their overall appraisal decision
 * (Include / Exclude / Seek further info), their organisation, their licence
 * posture, and their scoring stance. Only the item lists differ.
 *
 * ── SCORING: THERE IS NONE ──────────────────────────────────────────────────
 * The JBI checklists are deliberately non-prescriptive. No JBI document defines
 * a numeric score, a cut-off, or a pass mark; the JBI Manual for Evidence
 * Synthesis instructs review teams to agree their decision rules A PRIORI, and
 * JBI's own revised-tool programme is moving away from "quality scores" towards
 * risk-of-bias judgements. So:
 *
 *   scoringAllowed: false           — no summed score exists to compute
 *   overall.computed: false         — the appraisal decision is the REVIEWER's
 *
 * A UI may DISPLAY "7 of 10 items answered Yes" as a progress/answer count. It
 * must never present that count as a JBI rating (115.md decision 5).
 *
 * ── "NOT APPLICABLE" IS A REAL ANSWER ───────────────────────────────────────
 * On the shared Y/PY/PN/N/NI scale used by RoB 2 and ROBINS-I, 'NA' means "this
 * question was never asked" and completeness treats it as unanswered. On a JBI
 * checklist "Not applicable" is a printed, deliberate response — so these
 * definitions set `naIsAnswer: true` and the engine counts NA as answered.
 *
 * ── SOURCES (see scratchpad inv115-instruments.md §6) ───────────────────────
 * Item text is reproduced from the official JBI checklists (jbi.global) as
 * verified against the checklist PDFs and the JBI Manual appendices; each
 * instrument carries its own companion-paper citation below. The Qualitative
 * checklist prints its items interrogatively ("Is there congruity between…");
 * the noun-phrase form reproduced here is the form the verified source carried,
 * and is noted on the instrument.
 *
 * ── LICENSING (115.md decision 2) ───────────────────────────────────────────
 * The checklists are distributed free from jbi.global and JBI asks that the
 * checklist and its companion paper be cited. No formal licence text was
 * retrievable during INV-115 (jbi.global blocked automated access), so the
 * licence note below states the free-with-citation posture and flags that
 * embedding terms should be confirmed with JBI — it does not claim a licence
 * that was never verified.
 */

import {
  RESPONSES_YNUNA,
  responseOptions,
  JBI_DECISION,
  freezeInstrument,
  reviewerJudged,
  tallyResponses,
} from './shared.js';

/* ════════════ shared metadata ════════════ */

const ORGANIZATION = 'JBI (Joanna Briggs Institute), University of Adelaide';

const LICENSE =
  'Free to download and use from jbi.global with citation of the checklist and its companion paper. '
  + 'No formal licence text is published; terms for embedding item text in commercial software should be '
  + 'confirmed with JBI. Reproduced here with citation, unmodified.';

const GUIDANCE_URL = 'https://jbi.global/critical-appraisal-tools';

const RESPONSE_OPTIONS = responseOptions(RESPONSES_YNUNA);

const OVERALL = Object.freeze({
  axis: 'appraisal-decision',
  computed: false,
  levels: JBI_DECISION,
  rule: null,
  guidance:
    'JBI checklists end in an overall appraisal decision — Include, Exclude, or Seek further info — made by '
    + 'the reviewer against decision rules the review team agreed in advance. JBI defines no numeric score, '
    + 'no cut-off, and no algorithm mapping item answers to the decision.',
});

const OVERALL_GUIDANCE =
  'Record each item as Yes / No / Unclear / Not applicable, then record the overall appraisal decision '
  + '(Include / Exclude / Seek further info) agreed against the review protocol. Counting "Yes" answers is a '
  + 'progress count, not a JBI score — the instrument defines none.';

/** Build a checklist domain from a plain list of item texts. */
function checklist(id, name, shortLabel, description, items) {
  return {
    id,
    name,
    shortLabel,
    description,
    questions: items.map((text, i) => ({
      id: String(i + 1),
      text,
      kind: 'item',
      guidance: '',
      branch: null,
      responses: RESPONSES_YNUNA,
    })),
  };
}

/** Assemble one JBI instrument from its metadata + item list. */
function jbiInstrument({ id, name, abbreviation, design, description, citation, items, domainName, note }) {
  return freezeInstrument({
    id,
    name,
    abbreviation,
    // JBI does not print a version number on these checklists. '2020' is the
    // release the item text was verified against (checklist PDFs dated 2019-2020
    // on jbi.global); each checklist's own companion paper is cited separately.
    version: '2020',
    instrumentVersion: '2020',
    versionNote: 'JBI prints no version number on these checklists; 2020 is the release the item text was verified against.',
    organization: ORGANIZATION,
    designs: [design],
    description,
    citation,
    guidanceUrl: GUIDANCE_URL,
    license: LICENSE,
    consensusSupported: true,
    scoringAllowed: false,
    naIsAnswer: true,
    responseOptions: RESPONSE_OPTIONS,
    judgmentLevels: [],
    ...(note ? { sourceNote: note } : {}),
    domains: [checklist('checklist', domainName, 'Checklist', description, items)],
    overall: OVERALL,
    overallGuidance: OVERALL_GUIDANCE,
  });
}

/* ════════════ 1. Case Series — 10 items ════════════ */

export const JBI_CASE_SERIES = jbiInstrument({
  id: 'JBI-CaseSeries',
  name: 'JBI Critical Appraisal Checklist for Case Series',
  abbreviation: 'JBI Case Series',
  design: 'case-series',
  description:
    'JBI checklist for case series: ten items covering inclusion criteria, condition measurement, participant '
    + 'reporting and analysis, each answered Yes / No / Unclear / Not applicable.',
  citation:
    'Munn Z, Barker TH, Moola S, et al. Methodological quality of case series studies: an introduction to the '
    + 'JBI critical appraisal tool. JBI Evid Synth 2020;18(10):2127-2133.',
  domainName: 'Case series appraisal',
  items: [
    'Were there clear criteria for inclusion in the case series?',
    'Was the condition measured in a standard, reliable way for all participants included in the case series?',
    'Were valid methods used for identification of the condition for all participants included in the case series?',
    'Did the case series have consecutive inclusion of participants?',
    'Did the case series have complete inclusion of participants?',
    'Was there clear reporting of the demographics of the participants in the study?',
    'Was there clear reporting of clinical information of the participants?',
    'Were the outcomes or follow up results of cases clearly reported?',
    'Was there clear reporting of the presenting site(s)/clinic(s) demographic information?',
    'Was statistical analysis appropriate?',
  ],
});

/* ════════════ 2. Case Reports — 8 items ════════════ */

export const JBI_CASE_REPORT = jbiInstrument({
  id: 'JBI-CaseReport',
  name: 'JBI Critical Appraisal Checklist for Case Reports',
  abbreviation: 'JBI Case Report',
  design: 'case-report',
  description:
    'JBI checklist for case reports: eight items covering patient description, history, diagnostics, '
    + 'intervention, outcome and takeaway lessons, each answered Yes / No / Unclear / Not applicable.',
  citation:
    'Moola S, Munn Z, Tufanaru C, et al. Chapter 7: Systematic reviews of etiology and risk. In: Aromataris E, '
    + 'Munn Z (eds). JBI Manual for Evidence Synthesis. JBI, 2020.',
  domainName: 'Case report appraisal',
  items: [
    "Were patient's demographic characteristics clearly described?",
    "Was the patient's history clearly described and presented as a timeline?",
    'Was the current clinical condition of the patient on presentation clearly described?',
    'Were diagnostic tests or assessment methods and the results clearly described?',
    'Was the intervention(s) or treatment procedure(s) clearly described?',
    'Was the post-intervention clinical condition clearly described?',
    'Were adverse events (harms) or unanticipated events identified and described?',
    'Does the case report provide takeaway lessons?',
  ],
});

/* ════════════ 3. Prevalence — 9 items ════════════ */

export const JBI_PREVALENCE = jbiInstrument({
  id: 'JBI-Prevalence',
  name: 'JBI Critical Appraisal Checklist for Studies Reporting Prevalence Data',
  abbreviation: 'JBI Prevalence',
  design: 'prevalence',
  description:
    'JBI checklist for prevalence and cumulative-incidence studies: nine items covering sample frame, sampling, '
    + 'sample size, condition measurement, analysis and response rate.',
  citation:
    'Munn Z, Moola S, Lisy K, Riitano D, Tufanaru C. Methodological guidance for systematic reviews of '
    + 'observational epidemiological studies reporting prevalence and cumulative incidence data. '
    + 'Int J Evid Based Healthc 2015;13(3):147-153.',
  domainName: 'Prevalence study appraisal',
  items: [
    'Was the sample frame appropriate to address the target population?',
    'Were study participants sampled in an appropriate way?',
    'Was the sample size adequate?',
    'Were the study subjects and the setting described in detail?',
    'Was the data analysis conducted with sufficient coverage of the identified sample?',
    'Were valid methods used for the identification of the condition?',
    'Was the condition measured in a standard, reliable way for all participants?',
    'Was there appropriate statistical analysis?',
    'Was the response rate adequate, and if not, was the low response rate managed appropriately?',
  ],
});

/* ════════════ 4. Analytical Cross-Sectional — 8 items ════════════ */

export const JBI_CROSS_SECTIONAL = jbiInstrument({
  id: 'JBI-CrossSectional',
  name: 'JBI Critical Appraisal Checklist for Analytical Cross Sectional Studies',
  abbreviation: 'JBI Analytical Cross-Sectional',
  design: 'cross-sectional',
  description:
    'JBI checklist for analytical cross-sectional studies: eight items covering inclusion criteria, setting, '
    + 'exposure and outcome measurement, and the identification and handling of confounding.',
  citation:
    'Moola S, Munn Z, Tufanaru C, et al. Chapter 7: Systematic reviews of etiology and risk. In: Aromataris E, '
    + 'Munn Z (eds). JBI Manual for Evidence Synthesis. JBI, 2020.',
  domainName: 'Analytical cross-sectional appraisal',
  items: [
    'Were the criteria for inclusion in the sample clearly defined?',
    'Were the study subjects and the setting described in detail?',
    'Was the exposure measured in a valid and reliable way?',
    'Were objective, standard criteria used for measurement of the condition?',
    'Were confounding factors identified?',
    'Were strategies to deal with confounding factors stated?',
    'Were the outcomes measured in a valid and reliable way?',
    'Was appropriate statistical analysis used?',
  ],
});

/* ════════════ 5. Qualitative Research — 10 items ════════════ */

export const JBI_QUALITATIVE = jbiInstrument({
  id: 'JBI-Qualitative',
  name: 'JBI Critical Appraisal Checklist for Qualitative Research',
  abbreviation: 'JBI Qualitative',
  design: 'qualitative',
  description:
    'JBI checklist for qualitative research: ten items covering congruity between philosophical perspective, '
    + 'methodology, methods, analysis and interpretation, researcher positioning, participant voice, ethics '
    + 'and the flow of conclusions.',
  citation:
    'Lockwood C, Munn Z, Porritt K. Qualitative research synthesis: methodological guidance for systematic '
    + 'reviewers utilizing meta-aggregation. Int J Evid Based Healthc 2015;13(3):179-187.',
  domainName: 'Qualitative research appraisal',
  note:
    'The official checklist phrases each item interrogatively ("Is there congruity between the stated '
    + 'philosophical perspective and the research methodology?"). The declarative form reproduced here is the '
    + 'form carried by the source verified during INV-115; the substance of each item is unchanged.',
  items: [
    'Congruity between the stated philosophical perspective and the research methodology',
    'Congruity between the research methodology and the research question or objectives',
    'Congruity between the research methodology and the methods used to collect data',
    'Congruity between the research methodology and the representation and analysis of data',
    'Congruity between the research methodology and the interpretation of results',
    'A statement locating the researcher culturally or theoretically',
    'Influence of the researcher on the research, and vice versa, is addressed',
    'Participants, and their voices, are adequately represented',
    'Research is ethical according to current criteria or (for recent studies) evidence of ethical approval by an appropriate body',
    'Conclusions flow from the analysis or interpretation of the data',
  ],
});

/** The five checklists, in catalogue order. */
export const JBI_INSTRUMENTS = Object.freeze([
  JBI_CASE_SERIES,
  JBI_CASE_REPORT,
  JBI_PREVALENCE,
  JBI_CROSS_SECTIONAL,
  JBI_QUALITATIVE,
]);

/** True when an id names one of the five JBI checklists. */
export function isJbiInstrumentId(id) {
  return JBI_INSTRUMENTS.some((i) => i.id === id);
}

/* ════════════ judgements ════════════ */

/**
 * A JBI checklist has ONE section and no domain-level judgement — the reviewer
 * answers items and then makes the overall appraisal decision. The engine still
 * calls judgeDomain for every domain, so this returns a reviewer-judged result
 * carrying the answer TALLY (a progress count, never a rating).
 * Pure.
 */
export function judgeDomain(instrument, domainId, answers) {
  const domain = (instrument.domains || []).find((d) => d.id === domainId);
  if (!domain) throw new Error(`Unknown JBI domain ${domainId} for instrument ${instrument && instrument.id}`);
  const tally = tallyResponses(domain, answers || {});
  const out = reviewerJudged([
    `${tally.answered} of ${tally.total} items answered.`,
    'JBI defines no domain judgement and no score: the reviewer records the overall appraisal decision.',
  ]);
  return { ...out, domainId, tally };
}

/**
 * PASSTHROUGH, by design. JBI's overall appraisal decision is the reviewer's;
 * there is no algorithm mapping item answers to Include / Exclude / Seek further
 * info. When a decision is supplied it is validated against the official enum and
 * returned unchanged; anything else yields an empty, reviewer-judged result.
 *
 * @param {*} _domainJudgments accepted for engine-contract compatibility; unused.
 * @param {{ decision?: string }} [options]
 * Pure.
 */
export function judgeOverall(_domainJudgments, options) {
  const decision = options && options.decision;
  if (decision && JBI_DECISION.some((l) => l.value === decision)) {
    const label = JBI_DECISION.find((l) => l.value === decision).label;
    return {
      judgment: decision,
      reviewerJudged: true,
      computed: false,
      multiSomeConcernsFlag: false,
      reasons: [`Overall appraisal decision recorded by the reviewer: ${label}.`],
    };
  }
  return {
    ...reviewerJudged([
      'No overall appraisal decision recorded yet.',
      'JBI checklists define no algorithm and no score — Include / Exclude / Seek further info is the reviewer\'s decision against the review protocol.',
    ]),
    multiSomeConcernsFlag: false,
  };
}

/** The official overall-decision enum values, for validation at the boundaries. */
export const JBI_DECISION_VALUES = Object.freeze(JBI_DECISION.map((l) => l.value));

export default {
  JBI_CASE_SERIES,
  JBI_CASE_REPORT,
  JBI_PREVALENCE,
  JBI_CROSS_SECTIONAL,
  JBI_QUALITATIVE,
  JBI_INSTRUMENTS,
  JBI_DECISION_VALUES,
  isJbiInstrumentId,
  judgeDomain,
  judgeOverall,
};
