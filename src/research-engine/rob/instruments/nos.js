/**
 * nos.js — the Newcastle–Ottawa Scale (NOS) for non-randomised observational
 * studies, in its two OFFICIAL forms: cohort and case-control (101.md §18–§22).
 *
 * PURE: data + deterministic scoring. No Prisma / Express / React / network /
 * randomness / Date.now().
 *
 * ── SOURCE OF THE INSTRUMENT ────────────────────────────────────────────────
 * Encoded verbatim from the Ottawa Hospital Research Institute's own artefacts,
 * fetched and read rather than recalled (101.md §21 requires exactly this):
 *   Scale  (rating sheet)  https://www.ohri.ca/sites/ohri/files/2025-09/nosgen.pdf
 *          p.1 = CASE CONTROL form, p.2 = COHORT form
 *   Manual (coding manual) https://www.ohri.ca/sites/ohri/files/2025-09/nos_manual.pdf
 *   Landing page           https://www.ohri.ca/en/who-we-are/core-facilities-and-platforms/
 *                          ottawa-methods-centre/newcastle-ottawa-scale
 * Option text is reproduced as printed, including the instrument's own blanks
 * ("____") which are PROTOCOL-DEFINED and filled by the review team, never by us.
 *
 * ── WHY THIS IS NOT SHAPED LIKE RoB 2 / ROBINS-I ────────────────────────────
 * RoB 2 and ROBINS-I ask signalling questions with a shared Y/PY/PN/N/NI answer
 * set and derive a JUDGEMENT. The NOS is a different kind of instrument: each item
 * has its OWN closed option list, and scoring is additive STARS. So this file adds
 * two things to the shared instrument contract (both optional, so rob2.js and
 * robinsI.js are untouched and byte-identical):
 *
 *   question.options : [{ value, text, star }]   per-item option list
 *   question.select  : 'one' | 'many'            widget + scoring arity
 *
 * The arity is load-bearing, not cosmetic. The official header note reads:
 *
 *   "A study can be awarded a maximum of one star for each numbered item within
 *    the Selection and Outcome categories. A maximum of two stars can be given
 *    for Comparability"
 *
 * Several Selection/Outcome/Exposure items legitimately have TWO starred options
 * (cohort Selection 1 a&b, Selection 3 a&b, Outcome 1 a&b; case-control Exposure
 * 1 a&b). They are mutually exclusive ALTERNATIVES capped at one star — a UI that
 * let both be ticked would over-score the study. Comparability is the sole item
 * where the two starred options are INDEPENDENT and ADDITIVE (0/1/2 stars).
 *
 * ── THRESHOLDS: DELIBERATELY ABSENT ─────────────────────────────────────────
 * 101.md §22 is right to be wary. Both official documents were read end to end:
 * neither contains any threshold, band, or good/fair/poor mapping. There is NO
 * official NOS interpretation rule. The familiar 0–3 / 4–6 / 7–9 bands appear in
 * no OHRI document — they are a secondary-literature convention. This module
 * therefore ships NO built-in verdict; see nosThresholds.js, which offers the
 * AHRQ per-domain standard as an explicitly ATTRIBUTED, opt-in mapping.
 *
 * ── CROSS-SECTIONAL STUDIES ─────────────────────────────────────────────────
 * There is no official NOS for cross-sectional designs — OHRI publishes exactly
 * two forms. Adaptations exist (Modesti 2016 etc.) but are third-party. We do not
 * ship one under the NOS name.
 */

/* ════════════ vocabularies ════════════ */

/** NOS scores stars, not risk judgements — this is the scoring mode marker. */
export const NOS_SCORING = 'stars';

/** Star cap per category, from the official header note on both forms. */
export const CATEGORY_MAX = Object.freeze({ selection: 4, comparability: 2, outcome: 3, exposure: 3 });

export const NOS_MAX_STARS = 9;

/* ════════════ COHORT form (nosgen.pdf p.2) ════════════ */

const COHORT_DOMAINS = [
  {
    id: 'selection',
    name: 'Selection',
    shortLabel: 'Selection',
    maxStars: 4,
    description: 'How the exposed and non-exposed cohorts were assembled, how exposure was ascertained, and whether the outcome was absent at baseline.',
    questions: [
      {
        id: 'S1',
        text: 'Representativeness of the exposed cohort',
        select: 'one',
        // Manual gloss (nos_manual.pdf p.3). Note the manual carries the verbatim
        // typo "the predominant users users of estrogen"; we paraphrase the intent
        // rather than reproduce a typo as guidance.
        guidance: 'Consider whether the exposed cohort is drawn from a source that represents the average person with this exposure in the community, rather than a selected subgroup.',
        options: [
          { value: 'a', text: 'truly representative of the average _______________ (describe) in the community', star: true },
          { value: 'b', text: 'somewhat representative of the average ______________ in the community', star: true },
          { value: 'c', text: 'selected group of users eg nurses, volunteers', star: false },
          { value: 'd', text: 'no description of the derivation of the cohort', star: false },
        ],
        branch: null,
      },
      {
        id: 'S2',
        text: 'Selection of the non exposed cohort',
        select: 'one',
        guidance: 'Allocation of stars as per rating sheet — the official coding manual gives no further guidance for this item.',
        options: [
          { value: 'a', text: 'drawn from the same community as the exposed cohort', star: true },
          { value: 'b', text: 'drawn from a different source', star: false },
          { value: 'c', text: 'no description of the derivation of the non exposed cohort', star: false },
        ],
        branch: null,
      },
      {
        id: 'S3',
        text: 'Ascertainment of exposure',
        select: 'one',
        guidance: 'Allocation of stars as per rating sheet — the official coding manual gives no further guidance for this item.',
        options: [
          { value: 'a', text: 'secure record (eg surgical records)', star: true },
          { value: 'b', text: 'structured interview', star: true },
          { value: 'c', text: 'written self report', star: false },
          { value: 'd', text: 'no description', star: false },
        ],
        branch: null,
      },
      {
        id: 'S4',
        text: 'Demonstration that outcome of interest was not present at start of study',
        select: 'one',
        guidance: 'In the case of mortality studies, outcome of interest is still the presence of a disease/incident, rather than death: that is to say that a statement of no history of disease or incident earns a star.',
        options: [
          { value: 'a', text: 'yes', star: true },
          { value: 'b', text: 'no', star: false },
        ],
        branch: null,
      },
    ],
  },
  {
    id: 'comparability',
    name: 'Comparability',
    shortLabel: 'Comparability',
    maxStars: 2,
    // The ONLY additive item on either form.
    additive: true,
    description: 'Whether the cohorts were made comparable, by matching in the design or adjustment in the analysis.',
    questions: [
      {
        id: 'C1',
        text: 'Comparability of cohorts on the basis of the design or analysis',
        select: 'many',
        guidance: 'A maximum of 2 stars can be allotted in this category. Either exposed and non-exposed individuals must be matched in the design and/or confounders must be adjusted for in the analysis. Statements of no differences between groups, or that differences were not statistically significant, are NOT sufficient for establishing comparability. If the relative risk for the exposure of interest is adjusted for the confounders listed, the groups are considered comparable on each variable used in the adjustment.',
        // The blank in option a is filled from the project's protocol (see
        // nosProtocol.js) — the instrument does not name the factor.
        options: [
          { value: 'a', text: 'study controls for _____________ (select the most important factor)', star: true },
          { value: 'b', text: 'study controls for any additional factor', star: true, note: 'This criteria could be modified to indicate specific control for a second important factor.' },
        ],
        branch: null,
      },
    ],
  },
  {
    id: 'outcome',
    name: 'Outcome',
    shortLabel: 'Outcome',
    maxStars: 3,
    description: 'How the outcome was assessed, and whether follow-up was long enough and complete enough.',
    questions: [
      {
        id: 'O1',
        text: 'Assessment of outcome',
        select: 'one',
        // The manual is materially MORE permissive than the rating sheet here
        // (record confirmation qualifies). Both are official; we surface the gloss.
        guidance: 'Coding manual: independent or blind assessment stated in the paper, or confirmation of the outcome by reference to secure records (x-rays, medical records, etc.).',
        options: [
          { value: 'a', text: 'independent blind assessment', star: true },
          { value: 'b', text: 'record linkage', star: true },
          { value: 'c', text: 'self report', star: false },
          { value: 'd', text: 'no description', star: false },
        ],
        branch: null,
      },
      {
        id: 'O2',
        text: 'Was follow-up long enough for outcomes to occur',
        select: 'one',
        guidance: 'An acceptable length of time should be decided before quality assessment begins (e.g. 5 yrs. for exposure to breast implants). Set it in the project protocol so every study is judged against the same period.',
        options: [
          { value: 'a', text: 'yes (select an adequate follow up period for outcome of interest)', star: true },
          { value: 'b', text: 'no', star: false },
        ],
        branch: null,
      },
      {
        id: 'O3',
        text: 'Adequacy of follow up of cohorts',
        select: 'one',
        guidance: 'This item assesses the follow-up of the exposed and non-exposed cohorts to ensure that losses are not related to either the exposure or the outcome. The percentage is left blank on the official form — the review team sets it in the protocol. Option b earns its star if EITHER follow-up exceeds the threshold OR a description of those lost is provided.',
        options: [
          { value: 'a', text: 'complete follow up - all subjects accounted for', star: true },
          { value: 'b', text: 'subjects lost to follow up unlikely to introduce bias - small number lost - > ____ % (select an adequate %) follow up, or description provided of those lost)', star: true },
          { value: 'c', text: 'follow up rate < ____% (select an adequate %) and no description of those lost', star: false },
          { value: 'd', text: 'no statement', star: false },
        ],
        branch: null,
      },
    ],
  },
];

/* ════════════ CASE-CONTROL form (nosgen.pdf p.1) ════════════ */

const CASE_CONTROL_DOMAINS = [
  {
    id: 'selection',
    name: 'Selection',
    shortLabel: 'Selection',
    maxStars: 4,
    description: 'How cases were defined and sampled, and how controls were selected and defined.',
    questions: [
      {
        id: 'S1',
        text: 'Is the case definition adequate?',
        select: 'one',
        guidance: 'Independent validation means more than one source, or a reference to primary record such as x-rays or medical/hospital records.',
        options: [
          { value: 'a', text: 'yes, with independent validation', star: true },
          { value: 'b', text: 'yes, eg record linkage or based on self reports', star: false },
          { value: 'c', text: 'no description', star: false },
        ],
        branch: null,
      },
      {
        id: 'S2',
        text: 'Representativeness of the cases',
        select: 'one',
        guidance: 'Consider whether the case series is consecutive or otherwise obviously representative, rather than a convenience sample.',
        options: [
          { value: 'a', text: 'consecutive or obviously representative series of cases', star: true },
          { value: 'b', text: 'potential for selection biases or not stated', star: false },
        ],
        branch: null,
      },
      {
        id: 'S3',
        text: 'Selection of Controls',
        select: 'one',
        guidance: 'Community controls are drawn from the same population as the cases; hospital controls may share the exposure of interest.',
        options: [
          { value: 'a', text: 'community controls', star: true },
          { value: 'b', text: 'hospital controls', star: false },
          { value: 'c', text: 'no description', star: false },
        ],
        branch: null,
      },
      {
        id: 'S4',
        text: 'Definition of Controls',
        select: 'one',
        guidance: 'Controls should be free of the outcome (endpoint) under study.',
        options: [
          { value: 'a', text: 'no history of disease (endpoint)', star: true },
          { value: 'b', text: 'no description of source', star: false },
        ],
        branch: null,
      },
    ],
  },
  {
    id: 'comparability',
    name: 'Comparability',
    shortLabel: 'Comparability',
    maxStars: 2,
    additive: true,
    description: 'Whether cases and controls were made comparable, by matching in the design or adjustment in the analysis.',
    questions: [
      {
        id: 'C1',
        text: 'Comparability of cases and controls on the basis of the design or analysis',
        select: 'many',
        guidance: 'A maximum of 2 stars can be allotted in this category. Either cases and controls must be matched in the design and/or confounders must be adjusted for in the analysis. Statements of no differences between groups, or that differences were not statistically significant, are NOT sufficient for establishing comparability. If the odds ratio for the exposure of interest is adjusted for the confounders listed, the groups are considered comparable on each variable used in the adjustment.',
        options: [
          { value: 'a', text: 'study controls for _______________ (Select the most important factor.)', star: true },
          { value: 'b', text: 'study controls for any additional factor', star: true, note: 'This criteria could be modified to indicate specific control for a second important factor.' },
        ],
        branch: null,
      },
    ],
  },
  {
    id: 'exposure',
    name: 'Exposure',
    shortLabel: 'Exposure',
    maxStars: 3,
    description: 'How exposure was ascertained, whether identically in both groups, and how non-response was handled.',
    questions: [
      {
        id: 'E1',
        text: 'Ascertainment of exposure',
        select: 'one',
        guidance: 'Blinding of the interviewer to case/control status is what distinguishes option b from option c.',
        options: [
          { value: 'a', text: 'secure record (eg surgical records)', star: true },
          { value: 'b', text: 'structured interview where blind to case/control status', star: true },
          { value: 'c', text: 'interview not blinded to case/control status', star: false },
          { value: 'd', text: 'written self report or medical record only', star: false },
          { value: 'e', text: 'no description', star: false },
        ],
        branch: null,
      },
      {
        id: 'E2',
        text: 'Same method of ascertainment for cases and controls',
        select: 'one',
        // Honest note: the official coding manual OMITS this item entirely under
        // EXPOSURE. We do not invent guidance for it (101.md §17).
        guidance: 'Allocation of stars as per rating sheet — the official coding manual does not cover this item.',
        options: [
          { value: 'a', text: 'yes', star: true },
          { value: 'b', text: 'no', star: false },
        ],
        branch: null,
      },
      {
        id: 'E3',
        text: 'Non-Response rate',
        select: 'one',
        guidance: 'A star is earned only when the non-response rate is the same for both groups.',
        options: [
          { value: 'a', text: 'same rate for both groups', star: true },
          { value: 'b', text: 'non respondents described', star: false },
          { value: 'c', text: 'rate different and no designation', star: false },
        ],
        branch: null,
      },
    ],
  },
];

/* ════════════ instrument objects ════════════ */

const freezeDomains = (domains) => domains.map((d) => Object.freeze({
  ...d,
  questions: d.questions.map((q) => Object.freeze({
    ...q,
    options: q.options.map((o) => Object.freeze({ ...o })),
  })),
}));

const OFFICIAL_NOTE_COHORT = 'A study can be awarded a maximum of one star for each numbered item within the Selection and Outcome categories. A maximum of two stars can be given for Comparability';
const OFFICIAL_NOTE_CASE_CONTROL = 'A study can be awarded a maximum of one star for each numbered item within the Selection and Exposure categories. A maximum of two stars can be given for Comparability.';

const SOURCE = Object.freeze({
  scale: 'https://www.ohri.ca/sites/ohri/files/2025-09/nosgen.pdf',
  manual: 'https://www.ohri.ca/sites/ohri/files/2025-09/nos_manual.pdf',
  page: 'https://www.ohri.ca/en/who-we-are/core-facilities-and-platforms/ottawa-methods-centre/newcastle-ottawa-scale',
});

export const NOS_COHORT = Object.freeze({
  id: 'NOS',
  variant: 'cohort',
  variantLabel: 'Cohort studies',
  name: 'Newcastle–Ottawa Scale (cohort studies)',
  instrumentVersion: 'ohri-nosgen',
  design: 'cohort',
  scoring: NOS_SCORING,
  maxStars: NOS_MAX_STARS,
  officialNote: OFFICIAL_NOTE_COHORT,
  source: SOURCE,
  // Present for contract-compatibility with the judgement instruments; NOS has no
  // judgement levels of its own, which is the point of §22.
  judgmentLevels: [],
  responseOptions: [],
  domains: freezeDomains(COHORT_DOMAINS),
  overallGuidance:
    'The Newcastle–Ottawa Scale produces a star profile across Selection (max 4), Comparability (max 2) and Outcome (max 3), to a maximum of 9. The scale itself defines no cut-off for good or poor quality; any threshold is a decision of the review team.',
});

export const NOS_CASE_CONTROL = Object.freeze({
  id: 'NOS-CC',
  variant: 'case-control',
  variantLabel: 'Case-control studies',
  name: 'Newcastle–Ottawa Scale (case-control studies)',
  instrumentVersion: 'ohri-nosgen',
  design: 'case-control',
  scoring: NOS_SCORING,
  maxStars: NOS_MAX_STARS,
  officialNote: OFFICIAL_NOTE_CASE_CONTROL,
  source: SOURCE,
  judgmentLevels: [],
  responseOptions: [],
  domains: freezeDomains(CASE_CONTROL_DOMAINS),
  overallGuidance:
    'The Newcastle–Ottawa Scale produces a star profile across Selection (max 4), Comparability (max 2) and Exposure (max 3), to a maximum of 9. The scale itself defines no cut-off for good or poor quality; any threshold is a decision of the review team.',
});

/* ════════════ scoring ════════════ */

/**
 * Normalize a stored answer into the array of selected option values.
 * Accepts: 'a' | ['a','b'] | { response:'a' } | { response:['a','b'] } | undefined.
 * Pure.
 */
export function selectedValues(answer) {
  if (answer == null) return [];
  const raw = (typeof answer === 'object' && !Array.isArray(answer)) ? answer.response : answer;
  if (raw == null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((v) => String(v)).filter(Boolean);
}

/** Look up a question in an instrument by domain + question id. Pure. */
function findQuestion(instrument, domainId, questionId) {
  const d = (instrument.domains || []).find((x) => x.id === domainId);
  if (!d) return null;
  return (d.questions || []).find((q) => q.id === questionId) || null;
}

/**
 * Stars earned by ONE question, honouring the official arity rule.
 *
 *  select:'one'  → at most ONE star even if two starred options were somehow
 *                  stored (defensive: the header note caps the item at one).
 *  select:'many' → one star per selected starred option (Comparability only).
 *
 * Pure.
 */
export function questionStars(question, answer) {
  if (!question) return 0;
  const chosen = selectedValues(answer);
  if (!chosen.length) return 0;
  const starred = new Set((question.options || []).filter((o) => o.star).map((o) => o.value));
  const hits = chosen.filter((v) => starred.has(v)).length;
  if (question.select === 'many') return hits;
  return hits > 0 ? 1 : 0;
}

/**
 * Score one domain: { domainId, stars, maxStars, complete, answered, required }.
 * Pure.
 */
export function scoreDomain(instrument, domainId, answers) {
  const d = (instrument.domains || []).find((x) => x.id === domainId);
  if (!d) throw new Error(`Unknown NOS domain ${domainId} for instrument ${instrument && instrument.id}`);
  const a = answers || {};
  let stars = 0;
  let answered = 0;
  for (const q of d.questions) {
    const ans = a[q.id];
    if (selectedValues(ans).length) answered += 1;
    stars += questionStars(q, ans);
  }
  // Defensive cap: a corrupted answer blob can never exceed the official maximum.
  const capped = Math.min(stars, d.maxStars);
  return {
    domainId,
    stars: capped,
    maxStars: d.maxStars,
    answered,
    required: d.questions.length,
    complete: answered === d.questions.length,
  };
}

/**
 * Score a whole assessment.
 * @param {object} instrument NOS_COHORT | NOS_CASE_CONTROL
 * @param {object} answersByDomain { [domainId]: { [questionId]: answer } }
 * @returns {{ byDomain, total, maxStars, complete, profile }}
 *   profile is the compact "4/4 · 2/2 · 3/3" representation the §26 table uses.
 * Pure.
 */
export function scoreAssessment(instrument, answersByDomain) {
  const src = answersByDomain || {};
  const byDomain = {};
  let total = 0;
  let complete = true;
  for (const d of instrument.domains) {
    const s = scoreDomain(instrument, d.id, src[d.id] || {});
    byDomain[d.id] = s;
    total += s.stars;
    if (!s.complete) complete = false;
  }
  return {
    instrumentId: instrument.id,
    variant: instrument.variant,
    byDomain,
    total,
    maxStars: instrument.maxStars,
    complete,
    profile: instrument.domains.map((d) => `${byDomain[d.id].stars}/${byDomain[d.id].maxStars}`).join(' · '),
  };
}

/**
 * Completeness in the shape the generic RoB engine reports, so the NOS plugs into
 * the existing progress UI unchanged.
 * Pure.
 */
export function completeness(instrument, assessment) {
  const answersByDomain = (assessment && assessment.answersByDomain) || {};
  const perDomain = {};
  let totalAnswered = 0;
  let totalRequired = 0;
  for (const d of instrument.domains) {
    const a = answersByDomain[d.id] || {};
    const missing = d.questions.filter((q) => !selectedValues(a[q.id]).length).map((q) => q.id);
    const required = d.questions.length;
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
 * Contract shim so the generic engine's proposeDomain/proposeOverall can call NOS
 * without special-casing. The NOS has no judgement algorithm — it has a score — so
 * the "judgment" it reports is the star count as a string ("3"), with a reasons
 * trace naming the starred options. Callers that care read `stars`.
 * Pure.
 */
export function judgeDomain(instrument, domainId, answers) {
  const s = scoreDomain(instrument, domainId, answers);
  const d = instrument.domains.find((x) => x.id === domainId);
  const reasons = [];
  for (const q of d.questions) {
    const chosen = selectedValues(answers && answers[q.id]);
    if (!chosen.length) { reasons.push(`${q.id}: not yet answered`); continue; }
    const earned = questionStars(q, answers && answers[q.id]);
    const texts = chosen
      .map((v) => (q.options.find((o) => o.value === v) || {}).text)
      .filter(Boolean)
      .map((t) => String(t).slice(0, 80));
    reasons.push(`${q.id}: ${texts.join('; ')} → ${earned} star${earned === 1 ? '' : 's'}`);
  }
  return { domainId, judgment: String(s.stars), stars: s.stars, maxStars: s.maxStars, reasons };
}

/**
 * The NOS has no overall judgement — only a total. Signature matches the generic
 * engine contract (`domainJudgments`, the same argument RoB 2 and ROBINS-I take),
 * so proposeOverall dispatches without special-casing.
 *
 * Each entry may be this module's own domain result ({ stars }), a bare numeric
 * star count, or the numeral-as-string the persistence layer stores in
 * RobDomainJudgment.finalJudgment. Anything unparseable contributes 0 rather than
 * silently inflating the score.
 *
 * `judgment` is deliberately the numeral, NOT a quality label — see §22 and
 * nosThresholds.js.
 * Pure.
 */
export function judgeOverall(instrument, domainJudgments) {
  const src = domainJudgments || {};
  const per = instrument.domains.map((d) => ({ d, stars: starsOf(src[d.id], d.maxStars) }));
  const total = per.reduce((sum, x) => sum + x.stars, 0);
  return {
    judgment: String(total),
    stars: total,
    maxStars: instrument.maxStars,
    profile: per.map((x) => `${x.stars}/${x.d.maxStars}`).join(' · '),
    reasons: per.map((x) => `${x.d.name}: ${x.stars}/${x.d.maxStars}`),
    multiSomeConcernsFlag: false,
  };
}

/**
 * Coerce ONE stored domain result to a star count, clamped to the domain maximum.
 *
 * Accepts every shape the star count legitimately arrives in: this module's own
 * domain result ({ stars }), the generic engine's proposal ({ judgment: '4' }), a
 * bare number, or the numeral-as-string that RobDomainJudgment.finalJudgment
 * persists. Anything unparseable contributes 0 rather than silently inflating a
 * quality score.
 * Pure.
 */
function starsOf(v, maxStars) {
  let n2 = NaN;
  if (v && typeof v === 'object') {
    n2 = Number(v.stars);
    if (!Number.isFinite(n2)) n2 = Number(v.judgment);
  } else {
    n2 = Number(v);
  }
  if (!Number.isFinite(n2)) return 0;
  return Math.max(0, Math.min(n2, maxStars));
}

export default {
  NOS_COHORT,
  NOS_CASE_CONTROL,
  NOS_SCORING,
  NOS_MAX_STARS,
  CATEGORY_MAX,
  selectedValues,
  questionStars,
  scoreDomain,
  scoreAssessment,
  completeness,
  judgeDomain,
  judgeOverall,
};
