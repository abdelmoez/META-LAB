/**
 * amstar2.js — AMSTAR 2, the critical appraisal tool for systematic reviews that
 * include randomised or non-randomised studies of healthcare interventions
 * (Shea 2017). The platform's umbrella-review instrument (115.md tool 6).
 *
 * PURE: data + a deterministic rating rule. No Prisma / Express / React /
 * network / randomness / Date.now().
 *
 * ── NO SCORE. EVER. ─────────────────────────────────────────────────────────
 * This is the single most important thing about AMSTAR 2 in software. The BMJ
 * paper is explicit that "responses to AMSTAR 2 items should not be used to
 * derive an overall score", and amstar.ca repeats that the tool "is not intended
 * to generate an overall score". What AMSTAR 2 produces is an OVERALL CONFIDENCE
 * rating in the results of the review — High / Moderate / Low / Critically low —
 * derived from the NUMBER and CRITICALITY of the weaknesses found, not from a
 * sum. Hence `scoringAllowed: false`, and a UI must never render "12/16".
 *
 * ── CRITICAL DOMAINS ────────────────────────────────────────────────────────
 * Seven of the sixteen items are CRITICAL domains — a failure in one of them
 * undermines the validity of the review's conclusions. The official default set
 * is items 2, 4, 7, 9, 11, 13 and 15. The paper allows a review team to
 * re-designate criticality with justification, so `rateConfidence` accepts a
 * caller-supplied critical set rather than hard-coding the default.
 *
 * ── SOURCE ──────────────────────────────────────────────────────────────────
 * Item text, the per-item response options, the seven critical domains (Box 1)
 * and the four overall-confidence definitions (Box 2) are reproduced VERBATIM
 * from the official checklist PDF, https://amstar.ca/docs/AMSTAR-2.pdf, read
 * during INV-115, cross-checked against the open-access BMJ paper (PMC5833365).
 * Printed punctuation is preserved as printed, including the missing comma in
 * item 11 and the space in item 13's "interpreting/ discussing".
 *
 * NOT reproduced: the "For Yes:" / "For Partial Yes:" sub-criteria bullets that
 * sit under each printed item. They are guidance for the rater rather than the
 * item, and they carry review-specific thresholds; a reviewer should work from
 * the official checklist alongside this form.
 *
 * ── LICENSING (115.md decision 2) ───────────────────────────────────────────
 * AMSTAR 2 is distributed free from amstar.ca and the defining paper is open
 * access under a Creative Commons attribution licence, which is the practical
 * basis for reproducing item text with citation. Commercial embedding terms are
 * not separately stated by amstar.ca.
 */

import {
  RESPONSE_LABELS,
  responseOptions,
  AMSTAR_CONFIDENCE,
  answerCode,
  freezeInstrument,
  reviewerJudged,
} from './shared.js';

/** Every response code AMSTAR 2 prints anywhere on the checklist, in print order. */
export const AMSTAR_RESPONSES = Object.freeze(['Y', 'PARTIAL_YES', 'N', 'NMA', 'ONLY_NRSI', 'ONLY_RCT']);

/* ════════════ vocabularies ════════════ */

/**
 * The official default critical domains (Shea 2017). A review team may
 * re-designate these with justification — see `rateConfidence`.
 */
export const CRITICAL_ITEMS = Object.freeze(['2', '4', '7', '9', '11', '13', '15']);

/**
 * The items whose printed response block offers "No meta-analysis conducted",
 * verbatim from the official checklist. That response means the item does not
 * apply — it is NEVER a weakness.
 */
export const META_ANALYSIS_ITEMS = Object.freeze(['11', '12', '15']);

/**
 * The items whose printed response block offers "Partial Yes", verbatim from the
 * official checklist. Note this is NOT the same set as the critical domains —
 * item 8 offers Partial Yes and is not critical; items 11, 13 and 15 are critical
 * and do not offer it.
 */
export const PARTIAL_YES_ITEMS = Object.freeze(['2', '4', '7', '8', '9']);

/**
 * Responses that mean "this item does not apply to this review" rather than
 * "the review failed this item". Never counted as a weakness.
 */
export const NOT_APPLICABLE_RESPONSES = Object.freeze(['NMA', 'ONLY_NRSI', 'ONLY_RCT']);

/**
 * The response that marks an item as NOT met. AMSTAR 2 counts "weaknesses" and
 * "critical flaws"; the mapping used here is deliberate and explicit:
 *
 *   'N'                       → the item is not met → weakness
 *                               (critical flaw when the item is a critical domain)
 *   'PARTIAL_YES'             → partial adherence → NOT a weakness by default
 *   'NMA'/'ONLY_NRSI'/'ONLY_RCT'
 *                             → the item does not apply → never a weakness
 *   unanswered                → never counted, in either direction
 *
 * Box 1 and Box 2 operationalise "critical flaw" and "non-critical weakness"
 * only through the critical-domain list and the four rating definitions — the
 * checklist prints no response→flaw table. The Partial-Yes treatment is
 * therefore an IMPLEMENTATION DECISION, not an official rule, which is why it is
 * a parameter of `countFlaws` (`partialYesIsWeakness`) rather than a hard-coded
 * assumption.
 */
export const FLAW_RESPONSE = 'N';

/* ════════════ instrument DATA ════════════ */

// Item text verbatim from https://amstar.ca/docs/AMSTAR-2.pdf. `responses` is the
// printed response block for that item, also verbatim.
//
// Items 9 and 11 print TWO stacked response blocks (one for RCTs, one for NRSI).
// `RobAnswer` is unique on (assessmentId, questionId), so this definition records
// ONE response per item and carries the official split in `blocks` for the
// renderer and for the reviewer's rationale. The item's own `responses` is the
// union of both blocks, so no printed option is lost.
const ITEMS = [
  {
    id: '1',
    text: 'Did the research questions and inclusion criteria for the review include the components of PICO?',
    responses: ['Y', 'N'],
  },
  {
    id: '2',
    text: 'Did the report of the review contain an explicit statement that the review methods were established prior to the conduct of the review and did the report justify any significant deviations from the protocol?',
    responses: ['Y', 'PARTIAL_YES', 'N'],
  },
  {
    id: '3',
    text: 'Did the review authors explain their selection of the study designs for inclusion in the review?',
    responses: ['Y', 'N'],
  },
  {
    id: '4',
    text: 'Did the review authors use a comprehensive literature search strategy?',
    responses: ['Y', 'PARTIAL_YES', 'N'],
  },
  {
    id: '5',
    text: 'Did the review authors perform study selection in duplicate?',
    responses: ['Y', 'N'],
  },
  {
    id: '6',
    text: 'Did the review authors perform data extraction in duplicate?',
    responses: ['Y', 'N'],
  },
  {
    id: '7',
    text: 'Did the review authors provide a list of excluded studies and justify the exclusions?',
    responses: ['Y', 'PARTIAL_YES', 'N'],
  },
  {
    id: '8',
    text: 'Did the review authors describe the included studies in adequate detail?',
    responses: ['Y', 'PARTIAL_YES', 'N'],
  },
  {
    id: '9',
    text: 'Did the review authors use a satisfactory technique for assessing the risk of bias (RoB) in individual studies that were included in the review?',
    responses: ['Y', 'PARTIAL_YES', 'N', 'ONLY_NRSI', 'ONLY_RCT'],
    blocks: [
      { id: 'rct', label: 'RCTs', responses: ['Y', 'PARTIAL_YES', 'N', 'ONLY_NRSI'] },
      { id: 'nrsi', label: 'NRSI', responses: ['Y', 'PARTIAL_YES', 'N', 'ONLY_RCT'] },
    ],
  },
  {
    id: '10',
    text: 'Did the review authors report on the sources of funding for the studies included in the review?',
    responses: ['Y', 'N'],
  },
  {
    id: '11',
    text: 'If meta-analysis was performed did the review authors use appropriate methods for statistical combination of results?',
    responses: ['Y', 'N', 'NMA'],
    blocks: [
      { id: 'rct', label: 'RCTs', responses: ['Y', 'N', 'NMA'] },
      { id: 'nrsi', label: 'For NRSI', responses: ['Y', 'N', 'NMA'] },
    ],
  },
  {
    id: '12',
    text: 'If meta-analysis was performed, did the review authors assess the potential impact of RoB in individual studies on the results of the meta-analysis or other evidence synthesis?',
    responses: ['Y', 'N', 'NMA'],
  },
  {
    id: '13',
    text: 'Did the review authors account for RoB in individual studies when interpreting/ discussing the results of the review?',
    responses: ['Y', 'N'],
  },
  {
    id: '14',
    text: 'Did the review authors provide a satisfactory explanation for, and discussion of, any heterogeneity observed in the results of the review?',
    responses: ['Y', 'N'],
  },
  {
    id: '15',
    text: 'If they performed quantitative synthesis did the review authors carry out an adequate investigation of publication bias (small study bias) and discuss its likely impact on the results of the review?',
    responses: ['Y', 'N', 'NMA'],
  },
  {
    id: '16',
    text: 'Did the review authors report any potential sources of conflict of interest, including any funding they received for conducting the review?',
    responses: ['Y', 'N'],
  },
];

// The Box 1 label for each critical domain, verbatim from the official checklist.
const CRITICAL_LABELS = Object.freeze({
  2: 'Protocol registered before commencement of the review',
  4: 'Adequacy of the literature search',
  7: 'Justification for excluding individual studies',
  9: 'Risk of bias from individual studies being included in the review',
  11: 'Appropriateness of meta-analytical methods',
  13: 'Consideration of risk of bias when interpreting the results of the review',
  15: 'Assessment of presence and likely impact of publication bias',
});

const DOMAIN = {
  id: 'items',
  name: 'AMSTAR 2 items',
  shortLabel: 'Items',
  description:
    'The sixteen AMSTAR 2 items. Seven are critical domains, marked `critical: true`; a failure in a critical '
    + 'domain undermines the validity of the review.',
  questions: ITEMS.map((item) => ({
    id: item.id,
    text: item.text,
    kind: 'item',
    critical: CRITICAL_ITEMS.includes(item.id),
    ...(CRITICAL_LABELS[item.id] ? { criticalDomainLabel: CRITICAL_LABELS[item.id] } : {}),
    guidance: '',
    branch: null,
    responses: item.responses,
    ...(item.blocks ? { blocks: item.blocks } : {}),
  })),
};

export const AMSTAR2 = freezeInstrument({
  id: 'AMSTAR-2',
  name: 'A MeaSurement Tool to Assess systematic Reviews, version 2 (AMSTAR 2)',
  abbreviation: 'AMSTAR 2',
  version: '2017',
  instrumentVersion: '2017',
  organization: 'AMSTAR (Shea, Reeves, Wells et al.); amstar.ca',
  designs: ['systematic-review'],
  description:
    'Sixteen-item critical appraisal tool for systematic reviews of randomised and/or non-randomised studies '
    + 'of healthcare interventions. Produces an overall CONFIDENCE rating (High / Moderate / Low / Critically '
    + 'low) from the number and criticality of weaknesses — never a score.',
  citation:
    'Shea BJ, Reeves BC, Wells G, et al. AMSTAR 2: a critical appraisal tool for systematic reviews that '
    + 'include randomised or non-randomised studies of healthcare interventions, or both. BMJ 2017;358:j4008.',
  guidanceUrl: 'https://amstar.ca/Amstar-2.php',
  license:
    'Free to use from amstar.ca; the defining BMJ paper is open access under a Creative Commons attribution '
    + 'licence, which is the basis for reproducing item text with citation. Commercial embedding terms are not '
    + 'separately stated by amstar.ca.',
  consensusSupported: true,
  scoringAllowed: false,
  itemTextForm: 'verbatim',
  criticalItems: CRITICAL_ITEMS,
  partialYesItems: PARTIAL_YES_ITEMS,
  metaAnalysisItems: META_ANALYSIS_ITEMS,
  responseOptions: responseOptions(AMSTAR_RESPONSES),
  judgmentLevels: AMSTAR_CONFIDENCE,
  domains: [DOMAIN],
  overall: Object.freeze({
    axis: 'confidence',
    computed: true,
    levels: AMSTAR_CONFIDENCE,
    rule: 'amstar2-confidence',
    // Box 2, "Rating overall confidence in the results of the review", verbatim.
    guidance:
      'High — No or one non-critical weakness: the systematic review provides an accurate and comprehensive '
      + 'summary of the results of the available studies that address the question of interest. '
      + 'Moderate — More than one non-critical weakness: the systematic review has more than one weakness but '
      + 'no critical flaws. It may provide an accurate summary of the results of the available studies that '
      + 'were included in the review. '
      + 'Low — One critical flaw with or without non-critical weaknesses: the review has a critical flaw and '
      + 'may not provide an accurate and comprehensive summary of the available studies that address the '
      + 'question of interest. '
      + 'Critically low — More than one critical flaw with or without non-critical weaknesses: the review has '
      + 'more than one critical flaw and should not be relied on to provide an accurate and comprehensive '
      + 'summary of the available studies.',
    note:
      'Multiple non-critical weaknesses may diminish confidence in the review and it may be appropriate to '
      + 'move the overall appraisal down from moderate to low confidence.',
  }),
  overallGuidance:
    'AMSTAR 2 yields an overall confidence rating in the results of the review, driven by CRITICAL flaws first: '
    + 'more than one critical flaw is Critically low, exactly one is Low, and with no critical flaws the rating '
    + 'turns on how many non-critical weaknesses remain (0-1 = High, more than one = Moderate). There is no '
    + 'AMSTAR 2 score and none may be displayed.',
});

/* ════════════ the rating rule ════════════ */

/**
 * Count weaknesses from an answers map.
 *
 * @param {Record<string,string|{response:string}>} answers  item id → response
 * @param {{ criticalItems?: string[], partialYesIsWeakness?: boolean }} [options]
 *   criticalItems         re-designated critical set (default: the official seven)
 *   partialYesIsWeakness  whether 'Partial Yes' counts as not-met (default false;
 *                         see FLAW_RESPONSE — this is an implementation decision,
 *                         not an official AMSTAR 2 rule)
 * @returns {{ criticalFlaws, nonCriticalWeaknesses, criticalFlawItems, nonCriticalWeaknessItems, unanswered }}
 * Pure.
 */
export function countFlaws(answers, options = {}) {
  const criticalItems = options.criticalItems || CRITICAL_ITEMS;
  const partialYesIsWeakness = options.partialYesIsWeakness === true;
  const criticalFlawItems = [];
  const nonCriticalWeaknessItems = [];
  const unanswered = [];

  for (const q of DOMAIN.questions) {
    const v = answerCode(answers, q.id);
    if (v == null || v === '') { unanswered.push(q.id); continue; }
    if (NOT_APPLICABLE_RESPONSES.includes(v)) continue;
    const notMet = v === FLAW_RESPONSE || (partialYesIsWeakness && v === 'PARTIAL_YES');
    if (!notMet) continue;
    if (criticalItems.includes(q.id)) criticalFlawItems.push(q.id);
    else nonCriticalWeaknessItems.push(q.id);
  }

  return {
    criticalFlaws: criticalFlawItems.length,
    nonCriticalWeaknesses: nonCriticalWeaknessItems.length,
    criticalFlawItems,
    nonCriticalWeaknessItems,
    unanswered,
  };
}

/**
 * The official overall-confidence rule (Shea 2017), encoded exactly:
 *
 *   Critically low  more than one critical flaw (± non-critical weaknesses)
 *   Low             one critical flaw (± non-critical weaknesses)
 *   Moderate        no critical flaw, more than one non-critical weakness
 *   High            no critical flaw, no or one non-critical weakness
 *
 * @param {{ criticalFlaws:number, nonCriticalWeaknesses:number }} counts
 * @returns {{ judgment, reasons: string[] }}
 * Pure.
 */
export function rateConfidence(counts) {
  const critical = Math.max(0, Number(counts && counts.criticalFlaws) || 0);
  const nonCritical = Math.max(0, Number(counts && counts.nonCriticalWeaknesses) || 0);
  const reasons = [];

  if (critical > 1) {
    reasons.push(`More than one critical flaw (${critical}) — the review has more than one critical weakness and should not be relied on to provide an accurate and comprehensive summary of the available studies.`);
    return { judgment: 'critically-low', reasons };
  }
  if (critical === 1) {
    reasons.push('Exactly one critical flaw — the review has a critical flaw and may not provide an accurate and comprehensive summary of the available studies.');
    if (nonCritical > 0) reasons.push(`Also ${nonCritical} non-critical weakness${nonCritical === 1 ? '' : 'es'}, which do not change the rating.`);
    return { judgment: 'low', reasons };
  }
  if (nonCritical > 1) {
    reasons.push(`No critical flaws and more than one non-critical weakness (${nonCritical}) — the review may provide an accurate summary of the results of the available studies that were included.`);
    return { judgment: 'moderate', reasons };
  }
  reasons.push(nonCritical === 0
    ? 'No critical flaws and no non-critical weaknesses — the review provides an accurate and comprehensive summary of the results of the available studies.'
    : 'No critical flaws and one non-critical weakness — the review provides an accurate and comprehensive summary of the results of the available studies.');
  return { judgment: 'high', reasons };
}

/* ════════════ engine contract ════════════ */

/**
 * AMSTAR 2 has no per-domain judgement — the sixteen items feed the overall
 * confidence rating directly. This returns a reviewer-judged (empty) judgement
 * carrying the flaw counts, which `judgeOverall` reads back through the engine's
 * proposal pass-through.
 * Pure.
 */
export function judgeDomain(domainId, answers) {
  if (domainId !== DOMAIN.id) throw new Error(`Unknown AMSTAR 2 domain: ${domainId}`);
  const flaws = countFlaws(answers || {});
  const out = reviewerJudged([
    `${flaws.criticalFlaws} critical flaw${flaws.criticalFlaws === 1 ? '' : 's'} and ${flaws.nonCriticalWeaknesses} non-critical weakness${flaws.nonCriticalWeaknesses === 1 ? '' : 'es'} so far.`,
    'AMSTAR 2 makes no per-item or per-domain judgement — the items feed the overall confidence rating.',
  ]);
  return { ...out, domainId, flaws };
}

/**
 * Propose the overall confidence rating.
 *
 * Accepts the engine's per-domain proposal map ({ items: { flaws } }), a bare
 * counts object ({ criticalFlaws, nonCriticalWeaknesses }), or an answers map
 * ({ '1': 'Y', … }) — whichever the caller has to hand.
 * Pure.
 */
export function judgeOverall(input) {
  const counts = resolveCounts(input);
  if (!counts) {
    return {
      ...reviewerJudged(['No AMSTAR 2 responses recorded yet — the overall confidence rating is not yet determined.']),
      multiSomeConcernsFlag: false,
    };
  }
  const rated = rateConfidence(counts);
  return {
    judgment: rated.judgment,
    computed: true,
    criticalFlaws: counts.criticalFlaws,
    nonCriticalWeaknesses: counts.nonCriticalWeaknesses,
    multiSomeConcernsFlag: false,
    reasons: rated.reasons,
  };
}

function resolveCounts(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.items && typeof input.items === 'object' && input.items.flaws) return input.items.flaws;
  if (typeof input.criticalFlaws === 'number') return input;
  if (input.flaws && typeof input.flaws === 'number') return null;
  // Otherwise treat it as an answers map — but only if at least one key matches an item id.
  const ids = new Set(ITEMS.map((i) => i.id));
  const looksLikeAnswers = Object.keys(input).some((k) => ids.has(k));
  return looksLikeAnswers ? countFlaws(input) : null;
}

/** The confidence-level enum values, for validation at the boundaries. */
export const AMSTAR_CONFIDENCE_VALUES = Object.freeze(AMSTAR_CONFIDENCE.map((l) => l.value));

/** Human labels for the AMSTAR 2 responses (re-exported for the renderer). */
export const AMSTAR_RESPONSE_LABELS = Object.freeze(
  AMSTAR_RESPONSES.reduce((acc, code) => { acc[code] = RESPONSE_LABELS[code]; return acc; }, {}),
);

export default {
  AMSTAR2,
  AMSTAR_RESPONSES,
  CRITICAL_ITEMS,
  PARTIAL_YES_ITEMS,
  META_ANALYSIS_ITEMS,
  NOT_APPLICABLE_RESPONSES,
  AMSTAR_CONFIDENCE_VALUES,
  AMSTAR_RESPONSE_LABELS,
  countFlaws,
  rateConfidence,
  judgeDomain,
  judgeOverall,
};
