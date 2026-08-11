/**
 * quadas2.js — QUADAS-2, the Quality Assessment of Diagnostic Accuracy Studies
 * tool, version 2 (Whiting 2011). The platform's diagnostic-test-accuracy
 * instrument (115.md tool 5).
 *
 * PURE: data + a deterministic proposal. No Prisma / Express / React / network /
 * randomness / Date.now().
 *
 * ── THE SPLIT IS STRUCTURAL ─────────────────────────────────────────────────
 * QUADAS-2 judges TWO different things and they must never be collapsed into one
 * cell:
 *
 *   A. RISK OF BIAS          — all four domains  — LOW / HIGH / UNCLEAR
 *   B. APPLICABILITY CONCERN — the first three   — LOW / HIGH / UNCLEAR
 *
 * A study can be at low risk of bias and still be a poor match for the review
 * question (high applicability concern), and vice versa. The two axes are
 * therefore separate fields on the domain (`judgment` and `applicability`), not
 * two labels on one judgement, and they persist to two RobDomainJudgment rows —
 * 'D1' for risk of bias, 'D1-APP' for applicability (see shared.js
 * `applicabilityDomainId`). Domain 4 (Flow and Timing) has no applicability
 * section; the official form ends after its risk-of-bias judgement.
 *
 * ── NO OVERALL JUDGEMENT ────────────────────────────────────────────────────
 * `overall: null`, deliberately. QUADAS-2 prescribes PER-DOMAIN reporting and
 * defines no overall algorithm, no summary rating, and no score. That is a fact
 * about the instrument, not a gap here — nothing downstream may invent one, and
 * `scoringAllowed: false` says the same thing about numbers.
 *
 * ── DOMAIN JUDGEMENT: WHAT THE TOOL ACTUALLY LICENCES ───────────────────────
 * The Annals paper states that if the answers to all signalling questions for a
 * domain are "yes", risk of bias can be judged LOW, and that any "no" flags the
 * POTENTIAL for bias — it does not say a "no" makes the domain high. So the
 * algorithm here proposes Low only for an all-yes domain, proposes Unclear when
 * the only non-yes answers are "unclear" (insufficient reporting), and REFUSES
 * to propose anything once a signalling question is answered "no": it returns a
 * reviewer-judged result naming the flagged questions. Proposing "high" from a
 * single "no" would be an invented rule.
 *
 * ── TAILORING ───────────────────────────────────────────────────────────────
 * QUADAS-2 is the one instrument in the platform's set whose developers
 * explicitly EXPECT review-specific tailoring (Phase 2 of the four-phase
 * application: state the review question, tailor the tool and produce
 * review-specific guidance, draw a flow diagram, judge bias and applicability).
 * `tailoringSanctioned: true` records that; the tailoring UI itself is out of
 * scope for this module.
 *
 * ── SOURCE ──────────────────────────────────────────────────────────────────
 * Signalling questions, the four risk-of-bias summary questions, the three
 * applicability concern questions and the printed answer labels are reproduced
 * VERBATIM from the official Bristol template, read during INV-115:
 *   https://www.bristol.ac.uk/media-library/sites/quadas/migrated/documents/quadas2.pdf
 * The template prints "RISK: LOW /HIGH/UNCLEAR" with an inconsistent space after
 * "LOW" on domains 2-4; the spacing is normalised here, the words are not.
 *
 * ── VERSION SCOPE ───────────────────────────────────────────────────────────
 * QUADAS-2 (2011) is the single version of this tool and remains the de facto
 * standard in DTA reviews. QUADAS-C (2021) is an EXTENSION for comparative
 * accuracy studies used alongside QUADAS-2, not a replacement. QUADAS-3
 * (published 17 Feb 2026) is the developers' revision; adoption is only
 * beginning, so it is tracked rather than shipped.
 */

import {
  RESPONSES_YNU,
  responseOptions,
  ROB_LHU,
  CONCERN_LHU,
  answerCode,
  answerableQuestions,
  freezeInstrument,
  reviewerJudged,
} from './shared.js';

/* ════════════ vocabularies ════════════ */

export const QUADAS2_RESPONSES = RESPONSES_YNU;          // Yes / No / Unclear
export const QUADAS2_JUDGMENTS = Object.freeze(['low', 'high', 'unclear']);

const sq = (id, text) => ({ id, text, kind: 'signaling', guidance: '', branch: null, responses: RESPONSES_YNU });

const robAxis = (prompt) => ({ axis: 'rob', prompt, levels: ROB_LHU, computed: true });

const applicabilityAxis = (id, prompt, describePrompt) => ({
  axis: 'applicability',
  id,
  prompt,
  levels: CONCERN_LHU,
  // The reviewer records the concern directly; QUADAS-2 defines no algorithm
  // mapping the signalling questions onto the applicability axis.
  computed: false,
  ...(describePrompt ? { describePrompt } : {}),
});

/* ════════════ instrument DATA ════════════ */

const DOMAINS = [
  {
    id: 'D1',
    name: 'Patient Selection',
    shortLabel: 'Patient selection',
    description: 'How patients were sampled, whether a case-control design was avoided, and whether exclusions were appropriate.',
    describePrompt: 'Describe methods of patient selection:',
    questions: [
      sq('1.1', 'Was a consecutive or random sample of patients enrolled?'),
      sq('1.2', 'Was a case-control design avoided?'),
      sq('1.3', 'Did the study avoid inappropriate exclusions?'),
      {
        id: '1.A',
        text: 'Is there concern that the included patients do not match the review question?',
        kind: 'applicability',
        answerable: false,
        guidance: 'Recorded as a CONCERN (low / high / unclear) on the applicability axis, not as a Yes/No/Unclear answer.',
        branch: null,
      },
    ],
    judgment: robAxis('Could the selection of patients have introduced bias?'),
    applicability: applicabilityAxis(
      '1.A',
      'Is there concern that the included patients do not match the review question?',
      'Describe included patients (prior testing, presentation, intended use of index test and setting):',
    ),
  },
  {
    id: 'D2',
    name: 'Index Test(s)',
    shortLabel: 'Index test',
    description: 'Whether the index test was interpreted blind to the reference standard, and whether any threshold was pre-specified. Complete this domain once per index test.',
    describePrompt: 'Describe the index test and how it was conducted and interpreted:',
    perIndexTest: true,
    questions: [
      sq('2.1', 'Were the index test results interpreted without knowledge of the results of the reference standard?'),
      sq('2.2', 'If a threshold was used, was it pre-specified?'),
      {
        id: '2.A',
        text: 'Is there concern that the index test, its conduct, or interpretation differ from the review question?',
        kind: 'applicability',
        answerable: false,
        guidance: 'Recorded as a CONCERN (low / high / unclear) on the applicability axis, not as a Yes/No/Unclear answer.',
        branch: null,
      },
    ],
    judgment: robAxis('Could the conduct or interpretation of the index test have introduced bias?'),
    applicability: applicabilityAxis(
      '2.A',
      'Is there concern that the index test, its conduct, or interpretation differ from the review question?',
    ),
  },
  {
    id: 'D3',
    name: 'Reference Standard',
    shortLabel: 'Reference standard',
    description: 'Whether the reference standard is likely to classify the target condition correctly, and whether it was interpreted blind to the index test.',
    describePrompt: 'Describe the reference standard and how it was conducted and interpreted:',
    questions: [
      sq('3.1', 'Is the reference standard likely to correctly classify the target condition?'),
      sq('3.2', 'Were the reference standard results interpreted without knowledge of the results of the index test?'),
      {
        id: '3.A',
        text: 'Is there concern that the target condition as defined by the reference standard does not match the review question?',
        kind: 'applicability',
        answerable: false,
        guidance: 'Recorded as a CONCERN (low / high / unclear) on the applicability axis, not as a Yes/No/Unclear answer.',
        branch: null,
      },
    ],
    judgment: robAxis('Could the reference standard, its conduct, or its interpretation have introduced bias?'),
    applicability: applicabilityAxis(
      '3.A',
      'Is there concern that the target condition as defined by the reference standard does not match the review question?',
    ),
  },
  {
    id: 'D4',
    name: 'Flow and Timing',
    shortLabel: 'Flow and timing',
    description: 'The interval between index test and reference standard, whether every patient received a reference standard (and the same one), and whether all patients were analysed.',
    describePrompt: 'Describe any patients who did not receive the index test(s) and/or reference standard or who were excluded from the 2x2 table (refer to flow diagram):',
    questions: [
      sq('4.1', 'Was there an appropriate interval between index test(s) and reference standard?'),
      sq('4.2', 'Did all patients receive a reference standard?'),
      sq('4.3', 'Did patients receive the same reference standard?'),
      sq('4.4', 'Were all patients included in the analysis?'),
    ],
    judgment: robAxis('Could the patient flow have introduced bias?'),
    // No applicability section: the official form ends after D4's risk judgement.
  },
];

export const QUADAS2 = freezeInstrument({
  id: 'QUADAS-2',
  name: 'Quality Assessment of Diagnostic Accuracy Studies, version 2 (QUADAS-2)',
  abbreviation: 'QUADAS-2',
  version: '2011',
  instrumentVersion: '2011',
  organization: 'University of Bristol (QUADAS group)',
  designs: ['diagnostic-accuracy'],
  description:
    'Four-domain tool for diagnostic test accuracy studies. Every domain is judged for RISK OF BIAS and the '
    + 'first three are separately judged for CONCERNS REGARDING APPLICABILITY to the review question. '
    + 'QUADAS-2 defines no overall judgement and no score.',
  citation:
    'Whiting PF, Rutjes AWS, Westwood ME, et al. QUADAS-2: a revised tool for the quality assessment of '
    + 'diagnostic accuracy studies. Ann Intern Med 2011;155(8):529-536.',
  guidanceUrl: 'https://www.bristol.ac.uk/population-health-sciences/projects/quadas/',
  license:
    'Free to use with citation; the developers explicitly encourage review-specific tailoring. No formal '
    + 'licence text is published on the Bristol site, so this is a free-with-citation posture rather than a '
    + 'named licence.',
  consensusSupported: true,
  scoringAllowed: false,
  tailoringSanctioned: true,
  responseOptions: responseOptions(RESPONSES_YNU),
  judgmentLevels: ROB_LHU,
  applicabilityLevels: CONCERN_LHU,
  phases: Object.freeze([
    'Phase 1: State the review question',
    'Phase 2: Develop review-specific guidance (tailor the tool)',
    'Phase 3: Draw a flow diagram for the primary study',
    'Phase 4: Judge bias and applicability',
  ]),
  extensions: Object.freeze([
    {
      id: 'QUADAS-C',
      name: 'QUADAS-C',
      note: 'Extension for COMPARATIVE accuracy studies, used together with QUADAS-2 (not a replacement).',
      citation: 'Yang B, Mallett S, Takwoingi Y, et al. QUADAS-C: a tool for assessing risk of bias in comparative diagnostic accuracy studies. Ann Intern Med 2021;174(11):1592-1599.',
    },
  ]),
  domains: DOMAINS,
  overall: null,
  overallGuidance:
    'QUADAS-2 prescribes per-domain reporting: four risk-of-bias judgements and three applicability-concern '
    + 'judgements, each Low / High / Unclear. The tool defines no overall judgement, no summary rating and no '
    + 'score, so none is computed or displayed.',
});

/* ════════════ judgements ════════════ */

const isYes = (v) => v === 'Y';
const isNo = (v) => v === 'N';
const isUnclear = (v) => v === 'U';

/**
 * Propose the RISK OF BIAS judgement for one domain (pure).
 *
 * Encodes exactly what the tool licenses and nothing more:
 *   - every signalling question answered "yes"          → propose LOW
 *   - at least one answered "no"                        → NO proposal; the tool
 *                                                         says a "no" flags the
 *                                                         POTENTIAL for bias and
 *                                                         the reviewer judges
 *   - no "no", but at least one "unclear"               → propose UNCLEAR
 *                                                         (insufficient reporting)
 *   - not all questions answered yet                    → no proposal
 *
 * The applicability axis is NOT touched here: it is judged independently by the
 * reviewer (see `judgeApplicability`).
 */
export function judgeDomain(domainId, answers) {
  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) throw new Error(`Unknown QUADAS-2 domain: ${domainId}`);
  const qs = answerableQuestions(domain);
  const a = answers || {};

  const flagged = qs.filter((q) => isNo(answerCode(a, q.id))).map((q) => q.id);
  const unclear = qs.filter((q) => isUnclear(answerCode(a, q.id))).map((q) => q.id);
  const unanswered = qs.filter((q) => {
    const v = answerCode(a, q.id);
    return v == null || v === '';
  }).map((q) => q.id);

  if (flagged.length) {
    return {
      ...reviewerJudged([
        `Signalling question${flagged.length === 1 ? '' : 's'} ${flagged.join(', ')} answered "No", which flags the potential for bias.`,
        'QUADAS-2 does not map a "No" onto a domain judgement — the reviewer decides whether the domain is High, Low or Unclear risk of bias.',
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
  if (unclear.length) {
    return {
      domainId,
      axis: 'rob',
      judgment: 'unclear',
      computed: true,
      reasons: [`Reporting is insufficient to answer signalling question${unclear.length === 1 ? '' : 's'} ${unclear.join(', ')} — risk of bias is unclear.`],
    };
  }
  return {
    domainId,
    axis: 'rob',
    judgment: 'low',
    computed: true,
    reasons: [`All signalling questions in ${domain.name} answered "Yes" — risk of bias can be judged low.`],
  };
}

/**
 * The APPLICABILITY concern for one domain. Always reviewer-judged: QUADAS-2
 * defines no algorithm on this axis, and a domain can be Low risk of bias with
 * High applicability concern (and vice versa) — that independence is the whole
 * point of the split.
 *
 * @param {string} domainId  D1 | D2 | D3 (D4 has no applicability section)
 * @param {string} [concern] the level the reviewer recorded
 * Pure.
 */
export function judgeApplicability(domainId, concern) {
  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) throw new Error(`Unknown QUADAS-2 domain: ${domainId}`);
  if (!domain.applicability) {
    throw new Error(`QUADAS-2 domain ${domainId} has no applicability section`);
  }
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
    ...reviewerJudged([
      domain.applicability.prompt,
      'QUADAS-2 applicability concerns are judged by the reviewer against the review question; they are independent of the risk-of-bias judgement.',
    ]),
    domainId,
    axis: 'applicability',
  };
}

/**
 * QUADAS-2 has NO overall judgement. This exists only so the generic engine can
 * call `proposeOverall` without special-casing; it always returns an empty,
 * explicitly-undefined result.
 * Pure.
 */
export function judgeOverall() {
  return {
    judgment: '',
    computed: false,
    overallDefined: false,
    multiSomeConcernsFlag: false,
    reasons: [
      'QUADAS-2 defines no overall judgement: results are reported per domain, as four risk-of-bias judgements and three applicability-concern judgements.',
    ],
  };
}

export default {
  QUADAS2,
  QUADAS2_RESPONSES,
  QUADAS2_JUDGMENTS,
  judgeDomain,
  judgeApplicability,
  judgeOverall,
};
