/**
 * appraisal.js — deterministic GUIDED risk-of-bias appraisal from study text.
 *
 * PURE: no Prisma / Express / React / network / randomness / Date.now() and NO
 * external model. Given a study's text (title / abstract / full text or sections),
 * it proposes a signalling-question answer + supporting evidence quote for each
 * question of a chosen instrument (RoB 2 or ROBINS-I), then feeds those SUGGESTED
 * answers through the instrument's OWN judgement algorithm (via engine.js) so the
 * proposed domain/overall judgements come from ONE source of truth — never a
 * second, hand-rolled mapping.
 *
 * Mechanism (fully transparent, no "AI"): each signalling question has a table of
 * CUE PHRASES mapped to a response (e.g. "randomly assigned" ⇒ 1.1 = Yes;
 * "per-protocol" ⇒ 2.6 = No). The text is split into sentences (with character
 * offsets); the best-matching sentence becomes the verbatim `evidenceQuote` and
 * sets the `suggestedResponse` + a `confidence` derived from match strength. When
 * no cue is found the question defaults to "No information" with low confidence —
 * the appraisal is honest about thin evidence and never fabricates a confident
 * judgement. A human reviewer confirms or overrides every suggestion.
 */

import { getInstrument, proposeDomain, proposeOverall } from './engine.js';

export const ROB_APPRAISAL_VERSION = 'v1';

// Below this many characters of text, suggestions are flagged as low-confidence.
const THIN_TEXT_CHARS = 400;

// ── Cue tables ───────────────────────────────────────────────────────────────
// CUES[instrumentId][questionId] = [{ response, phrases:[...], weight }]. Phrases
// are matched case-insensitively as substrings. `weight` (1 weak, 2 strong)
// drives the confidence and the winning sentence. Phrases reflect standard
// reporting language for each signalling concept.
const CUES = {
  RoB2: {
    // D1 — randomisation
    '1.1': [
      { response: 'Y', weight: 2, phrases: ['randomly assigned', 'randomly allocated', 'random sequence', 'computer-generated random', 'random number table', 'permuted block', 'block randomization', 'block randomisation', 'stratified randomization', 'stratified randomisation'] },
      { response: 'Y', weight: 1, phrases: ['randomized', 'randomised', 'randomization', 'randomisation'] },
      { response: 'N', weight: 2, phrases: ['quasi-random', 'alternate allocation', 'alternately allocated', 'by date of birth', 'odd or even', 'non-randomized', 'non-randomised'] },
    ],
    '1.2': [
      { response: 'Y', weight: 2, phrases: ['allocation concealment', 'concealed allocation', 'allocation was concealed', 'sealed opaque envelope', 'opaque sealed envelope', 'sequentially numbered', 'central randomization', 'central randomisation', 'central allocation'] },
      { response: 'N', weight: 2, phrases: ['allocation was not concealed', 'no allocation concealment', 'open allocation', 'unconcealed allocation'] },
    ],
    '1.3': [
      { response: 'Y', weight: 2, phrases: ['baseline imbalance', 'baseline differences', 'groups differed at baseline', 'imbalanced at baseline', 'differed significantly at baseline'] },
      { response: 'N', weight: 2, phrases: ['similar at baseline', 'baseline characteristics were similar', 'well balanced at baseline', 'well-balanced at baseline', 'no significant baseline differences', 'comparable at baseline'] },
    ],
    // D2 — deviations
    '2.1': [
      { response: 'N', weight: 2, phrases: ['double-blind', 'double blind', 'participants were blinded', 'participants were masked', 'placebo-controlled', 'placebo controlled'] },
      { response: 'Y', weight: 2, phrases: ['open-label', 'open label', 'unblinded', 'no blinding', 'participants were aware'] },
    ],
    '2.2': [
      { response: 'N', weight: 2, phrases: ['double-blind', 'double blind', 'personnel were blinded', 'providers were blinded', 'caregivers were blinded', 'masked'] },
      { response: 'Y', weight: 1, phrases: ['open-label', 'open label', 'unblinded', 'single-blind', 'single blind'] },
    ],
    '2.6': [
      { response: 'Y', weight: 2, phrases: ['intention-to-treat', 'intention to treat', 'itt analysis', 'analyzed as randomized', 'analysed as randomised', 'modified intention-to-treat'] },
      { response: 'N', weight: 2, phrases: ['per-protocol analysis', 'per protocol analysis', 'as-treated analysis', 'completers only', 'excluded from the analysis'] },
    ],
    // D3 — missing outcome data
    '3.1': [
      { response: 'Y', weight: 2, phrases: ['complete follow-up', 'no loss to follow-up', 'all participants completed', 'outcome data were available for all', 'data were available for all'] },
      { response: 'N', weight: 2, phrases: ['lost to follow-up', 'loss to follow-up', 'withdrew', 'dropout', 'drop-out', 'attrition', 'discontinued the study'] },
    ],
    '3.2': [
      { response: 'Y', weight: 2, phrases: ['sensitivity analysis', 'multiple imputation', 'robust to missing', 'no differential attrition'] },
    ],
    // D4 — measurement of the outcome
    '4.3': [
      { response: 'N', weight: 2, phrases: ['blinded outcome assessment', 'outcome assessors were blinded', 'assessors were blinded', 'outcome assessors were masked', 'blinded assessors'] },
      { response: 'Y', weight: 2, phrases: ['assessors were aware', 'unblinded assessment', 'open outcome assessment', 'outcome assessors were aware'] },
    ],
    // D5 — selection of the reported result
    '5.1': [
      { response: 'Y', weight: 2, phrases: ['pre-specified', 'prespecified', 'pre-registered', 'prospectively registered', 'registered protocol', 'statistical analysis plan', 'clinicaltrials.gov', 'trial registration'] },
      { response: 'N', weight: 2, phrases: ['not pre-specified', 'no protocol', 'post hoc', 'post-hoc', 'not registered'] },
    ],
    '5.2': [
      { response: 'Y', weight: 2, phrases: ['multiple outcome measurements', 'multiple scales', 'multiple time points', 'selectively reported'] },
    ],
    '5.3': [
      { response: 'Y', weight: 1, phrases: ['multiple analyses', 'adjusted and unadjusted', 'several models'] },
    ],
  },
  'ROBINS-I': {
    // D1 — confounding
    '1.1': [
      { response: 'Y', weight: 2, phrases: ['observational', 'non-randomized', 'non-randomised', 'cohort study', 'retrospective cohort', 'prospective cohort', 'registry-based', 'routinely collected data', 'electronic health record'] },
    ],
    '1.4': [
      { response: 'Y', weight: 2, phrases: ['adjusted for', 'multivariable', 'multivariate model', 'propensity score', 'propensity-matched', 'inverse probability', 'inverse-probability weighting', 'controlled for confounders', 'matched for', 'covariate adjustment'] },
      { response: 'N', weight: 2, phrases: ['unadjusted analysis', 'did not adjust', 'no adjustment for confounders', 'crude analysis'] },
    ],
    '1.5': [
      { response: 'Y', weight: 1, phrases: ['validated measure', 'measured validly', 'accurately measured confounders'] },
    ],
    '1.6': [
      { response: 'Y', weight: 2, phrases: ['adjusted for post-baseline', 'adjusted for a mediator', 'adjusted for variables on the causal pathway'] },
    ],
    '1.7': [
      { response: 'Y', weight: 2, phrases: ['marginal structural model', 'g-computation', 'g-methods', 'time-varying confounding was controlled'] },
    ],
    // D2 — selection
    '2.1': [
      { response: 'N', weight: 2, phrases: ['new-user design', 'incident users', 'inception cohort', 'enrolled at treatment initiation', 'at treatment initiation'] },
      { response: 'Y', weight: 2, phrases: ['prevalent users', 'prevalent-user', 'excluded early deaths', 'survivors', 'selected based on'] },
    ],
    '2.4': [
      { response: 'Y', weight: 1, phrases: ['follow-up began at intervention', 'start of follow-up coincided', 'follow-up started at baseline'] },
      { response: 'N', weight: 2, phrases: ['immortal time', 'prevalent-user', 'left-truncation'] },
    ],
    '2.5': [
      { response: 'Y', weight: 1, phrases: ['adjusted for', 'propensity score', 'inverse probability'] },
    ],
    // D3 — classification of interventions
    '3.1': [
      { response: 'Y', weight: 1, phrases: ['clearly defined intervention', 'intervention groups were defined', 'well-defined exposure'] },
    ],
    '3.2': [
      { response: 'Y', weight: 1, phrases: ['recorded at baseline', 'prospectively recorded', 'recorded at the time of intervention'] },
      { response: 'N', weight: 2, phrases: ['self-reported retrospectively', 'ascertained retrospectively', 'recall of exposure', 'retrospective ascertainment'] },
    ],
    '3.3': [
      { response: 'Y', weight: 2, phrases: ['classification after the outcome', 'retrospective classification', 'recall bias', 'exposure ascertained after outcome'] },
      { response: 'N', weight: 1, phrases: ['prospectively classified', 'blinded to outcome', 'classified before the outcome'] },
    ],
    // D4 — deviations
    '4.1': [
      { response: 'Y', weight: 2, phrases: ['protocol deviations', 'contamination between groups', 'cross-over between groups', 'switched treatment'] },
      { response: 'N', weight: 1, phrases: ['delivered as intended', 'high fidelity', 'as per usual care'] },
    ],
    '4.3': [
      { response: 'Y', weight: 1, phrases: ['co-interventions were similar', 'balanced co-interventions', 'similar concomitant treatment'] },
      { response: 'N', weight: 2, phrases: ['differential co-intervention', 'additional treatments in one group', 'unbalanced co-interventions'] },
    ],
    '4.4': [
      { response: 'Y', weight: 1, phrases: ['implemented successfully', 'high implementation fidelity', 'protocol was followed'] },
    ],
    '4.5': [
      { response: 'Y', weight: 1, phrases: ['adherence was high', 'high adherence', 'good adherence'] },
      { response: 'N', weight: 2, phrases: ['poor adherence', 'low adherence', 'non-adherence', 'discontinued treatment'] },
    ],
    '4.6': [
      { response: 'Y', weight: 1, phrases: ['per-protocol analysis', 'instrumental variable', 'inverse probability of adherence'] },
    ],
    // D5 — missing data
    '5.1': [
      { response: 'Y', weight: 2, phrases: ['complete data', 'no missing data', 'data available for all', 'complete case data for all'] },
      { response: 'N', weight: 2, phrases: ['missing data', 'incomplete data', 'lost to follow-up', 'loss to follow-up'] },
    ],
    '5.4': [
      { response: 'Y', weight: 1, phrases: ['missingness was similar', 'similar across groups', 'similar proportions of missing'] },
      { response: 'N', weight: 2, phrases: ['differential missingness', 'more missing in one group'] },
    ],
    '5.5': [
      { response: 'Y', weight: 2, phrases: ['sensitivity analysis', 'multiple imputation', 'complete-case and imputation', 'robust to missing data'] },
    ],
    // D6 — measurement of outcomes
    '6.1': [
      { response: 'N', weight: 2, phrases: ['objective outcome', 'all-cause mortality', 'laboratory-confirmed', 'registry-based outcome', 'hard endpoint'] },
      { response: 'Y', weight: 1, phrases: ['subjective outcome', 'self-reported outcome', 'clinician-assessed', 'patient-reported'] },
    ],
    '6.2': [
      { response: 'N', weight: 2, phrases: ['blinded outcome assessment', 'assessors were blinded', 'masked assessors', 'blinded to intervention'] },
      { response: 'Y', weight: 2, phrases: ['assessors were aware', 'unblinded assessment', 'outcome assessors were aware'] },
    ],
    '6.3': [
      { response: 'Y', weight: 1, phrases: ['same method of assessment', 'identical assessment', 'comparable assessment across groups'] },
      { response: 'N', weight: 2, phrases: ['different methods', 'more frequent monitoring in one group', 'assessment differed between groups'] },
    ],
    '6.4': [
      { response: 'Y', weight: 2, phrases: ['differential misclassification', 'measurement differed by group', 'systematic measurement error'] },
    ],
    // D7 — selective reporting
    '7.1': [
      { response: 'Y', weight: 2, phrases: ['multiple outcome measurements', 'selectively reported', 'multiple scales'] },
      { response: 'N', weight: 2, phrases: ['pre-registered', 'prespecified outcome', 'pre-specified outcome', 'registered protocol'] },
    ],
    '7.2': [
      { response: 'Y', weight: 1, phrases: ['multiple analyses', 'adjusted and unadjusted', 'several models'] },
    ],
    '7.3': [
      { response: 'Y', weight: 1, phrases: ['subgroup analyses', 'multiple subgroups', 'post hoc subgroups'] },
    ],
  },
};

// ── Text handling ────────────────────────────────────────────────────────────

/**
 * Split a string into sentences with exact character offsets. Each entry's
 * `text` equals str.slice(start, end) verbatim, so an evidence quote is always a
 * real substring of the source.
 */
function splitSentences(str) {
  const out = [];
  if (!str) return out;
  const boundary = /[.!?]+(\s+|$)/g;
  let start = 0;
  let m;
  while ((m = boundary.exec(str)) !== null) {
    const punctLen = m[0].replace(/\s+$/, '').length;
    const end = m.index + punctLen;
    let s = start;
    while (s < end && /\s/.test(str[s])) s++;
    if (s < end) out.push({ start: s, end, text: str.slice(s, end) });
    start = boundary.lastIndex;
  }
  if (start < str.length) {
    let s = start;
    while (s < str.length && /\s/.test(str[s])) s++;
    let e = str.length;
    while (e > s && /\s/.test(str[e - 1])) e--;
    if (s < e) out.push({ start: s, end: e, text: str.slice(s, e) });
  }
  return out;
}

/** Build the ordered list of text sources with their locator `where` tag. */
function buildSources({ title, abstract, text, sections }) {
  const sources = [];
  if (title && String(title).trim()) sources.push({ where: 'title', text: String(title) });
  if (abstract && String(abstract).trim()) sources.push({ where: 'abstract', text: String(abstract) });

  const fullParts = [];
  if (sections) {
    if (Array.isArray(sections)) {
      for (const s of sections) {
        if (s == null) continue;
        fullParts.push(typeof s === 'string' ? s : (s.text || ''));
      }
    } else if (typeof sections === 'object') {
      for (const v of Object.values(sections)) fullParts.push(typeof v === 'string' ? v : (v && v.text) || '');
    }
  }
  if (text && String(text).trim()) fullParts.push(String(text));
  const fullText = fullParts.filter(Boolean).join('\n\n');
  if (fullText.trim()) sources.push({ where: 'fullText', text: fullText });

  return sources;
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/**
 * Appraise one signalling question against the sources → a suggestion object.
 * Returns { suggestedResponse, confidence, evidenceQuote, evidenceLocator, rationale }.
 */
function appraiseQuestion(rules, sources, responseLabel) {
  let best = null; // { response, score, sentence, where, matched:[] }
  for (const source of sources) {
    const sentences = splitSentences(source.text);
    for (const sentence of sentences) {
      const lower = sentence.text.toLowerCase();
      for (const rule of rules) {
        const matched = rule.phrases.filter(p => lower.includes(p.toLowerCase()));
        if (matched.length === 0) continue;
        const score = rule.weight * (1 + 0.5 * (matched.length - 1));
        if (!best || score > best.score) {
          best = { response: rule.response, score, sentence, where: source.where, matched };
        }
      }
    }
  }

  if (!best) {
    return {
      suggestedResponse: 'NI',
      confidence: 0.1,
      evidenceQuote: null,
      evidenceLocator: null,
      rationale: 'No cue phrase for this signalling question was found in the provided text; defaulting to “No information”.',
    };
  }

  const confidence = Math.round(clamp(0.35 + 0.2 * best.score, 0.35, 0.95) * 100) / 100;
  return {
    suggestedResponse: best.response,
    confidence,
    evidenceQuote: best.sentence.text,
    evidenceLocator: { where: best.where, charStart: best.sentence.start, charEnd: best.sentence.end },
    rationale: `Suggested "${responseLabel(best.response)}" from the phrase${best.matched.length > 1 ? 's' : ''} ${best.matched.map(p => `“${p}”`).join(', ')} found in the ${best.where}.`,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Deterministic guided appraisal from study text.
 *
 * @param {object} args
 * @param {string|object} args.instrument  instrument id ('RoB2'|'ROBINS-I') or the instrument object
 * @param {string} [args.text]      full text (or any long body of text)
 * @param {object|Array} [args.sections]  { sectionName: text } map or array of {text} / strings → treated as full text
 * @param {string} [args.title]
 * @param {string} [args.abstract]
 * @returns {{
 *   instrumentId: string,
 *   domains: Array<{ domainId, questions: Array<{ questionId, suggestedResponse, confidence, evidenceQuote, evidenceLocator, rationale }>, proposedJudgment, reasons: string[] }>,
 *   overall: { proposedOverall, reasons: string[] },
 *   coverage: { textChars, hasFullText, domainsWithEvidence },
 *   warnings: Array<{ type, message }>
 * }}
 */
export function appraiseFromText({ instrument, text, sections, title, abstract } = {}) {
  const inst = typeof instrument === 'string'
    ? getInstrument(instrument)
    : (instrument && instrument.domains ? instrument : getInstrument('RoB2'));
  const instrumentId = inst.id;
  const cueTable = CUES[instrumentId] || {};

  const sources = buildSources({ title, abstract, text, sections });
  const textChars = sources.reduce((n, s) => n + s.text.length, 0);
  const hasFullText = sources.some(s => s.where === 'fullText');

  const labelMap = Object.fromEntries((inst.responseOptions || []).map(o => [o.value, o.label]));
  labelMap.NI = labelMap.NI || 'No information';
  const responseLabel = code => labelMap[code] || code;

  let domainsWithEvidence = 0;
  const domains = inst.domains.map(d => {
    let domainHasEvidence = false;
    const answers = {};
    const questions = d.questions.map(q => {
      const rules = cueTable[q.id] || [];
      const s = appraiseQuestion(rules, sources, responseLabel);
      answers[q.id] = s.suggestedResponse;
      if (s.evidenceQuote) domainHasEvidence = true;
      return { questionId: q.id, ...s };
    });
    if (domainHasEvidence) domainsWithEvidence += 1;

    // Feed the SUGGESTED answers through the instrument's own algorithm (one
    // source of truth) — no second, hand-rolled judgement mapping.
    const proposal = proposeDomain(inst, d.id, answers);
    return {
      domainId: d.id,
      questions,
      proposedJudgment: proposal.judgment,
      reasons: proposal.reasons,
    };
  });

  const overallDomainMap = Object.fromEntries(domains.map(d => [d.domainId, d.proposedJudgment]));
  const overall = proposeOverall(inst, overallDomainMap);

  const warnings = [];
  if (textChars < THIN_TEXT_CHARS) {
    warnings.push({
      type: 'thin-text',
      message: 'The provided text is very short; suggested appraisals are low-confidence and must be verified against the full study report.',
    });
  }
  if (!hasFullText) {
    warnings.push({
      type: 'no-fulltext',
      message: 'No full text was provided (title/abstract only); many signalling questions cannot be reliably answered from an abstract.',
    });
  }
  if (domainsWithEvidence === 0) {
    warnings.push({
      type: 'no-evidence',
      message: 'No cue phrases matched the text; every domain defaults to “No information”. Review the study manually.',
    });
  }

  return {
    instrumentId,
    domains,
    overall: { proposedOverall: overall.judgment, reasons: overall.reasons },
    coverage: { textChars, hasFullText, domainsWithEvidence },
    warnings,
  };
}
