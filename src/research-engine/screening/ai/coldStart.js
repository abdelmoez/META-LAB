/**
 * coldStart.js — cold-start relevance prior + PICO/criteria matching.
 *
 * Pure functions, no DB, no network. Before enough human labels exist to train
 * a supervised model, the engine must NOT pretend it has one. Instead it scores
 * records from an honest, transparent PRIOR built from:
 *   - the project's inclusion / exclusion eligibility criteria,
 *   - the PICO concepts (Population / Intervention / Comparator / Outcome),
 *   - study-design detection,
 *   - explicit inclusion / exclusion keyword lists.
 *
 * The result is always explainable: every contribution is reported in `signals`.
 */
import { extractKeywords } from '../keywords.js';
import { criteriaKeywordsFromSnapshot, normalizeKeyword } from '../criteriaKeywords.js';
import { recordText } from './text.js';

/** Study-design detectors, ordered most-specific first. */
const DESIGN_PATTERNS = [
  ['systematic_review', /\b(systematic review|meta[- ]?analys[ie]s|prisma)\b/i],
  ['rct', /\b(randomi[sz]ed (controlled )?trial|\brct\b|double[- ]blind|placebo[- ]controlled|randomly assigned)\b/i],
  ['cohort', /\b(cohort study|prospective cohort|retrospective cohort|longitudinal)\b/i],
  ['case_control', /\b(case[- ]control)\b/i],
  ['cross_sectional', /\b(cross[- ]sectional|prevalence study|survey)\b/i],
  ['case_report', /\b(case report|case series)\b/i],
  ['animal', /\b(in vitro|in vivo|mouse|murine|rat\b|rodent|animal model)\b/i],
  ['review', /\b(narrative review|literature review|editorial|commentary|letter to the editor)\b/i],
];

/**
 * detectStudyDesign — best-effort study-design label from a record's text.
 * @param {{title?,abstract?,keywords?}} record
 * @returns {string} a design key, or '' if none detected
 */
export function detectStudyDesign(record) {
  const text = recordText(record);
  for (const [label, re] of DESIGN_PATTERNS) {
    if (re.test(text)) return label;
  }
  return '';
}

/** Does `haystackLower` contain `term` as a (roughly) word-bounded phrase? */
function textContains(haystackPadded, term) {
  const t = normalizeKeyword(term);
  if (!t || t.length < 3) return false;
  return haystackPadded.includes(` ${t} `);
}

/**
 * picoConcepts — derive per-dimension concept term lists from a picoSnapshot.
 * Inclusion/Exclusion come from the criteria digest; P/I/C/O from the raw fields.
 *
 * @param {object|string|null} picoSnapshot
 * @returns {{population:string[], intervention:string[], comparator:string[],
 *           outcome:string[], inclusion:string[], exclusion:string[]}}
 */
export function picoConcepts(picoSnapshot) {
  let pico = picoSnapshot;
  if (typeof pico === 'string') { try { pico = JSON.parse(pico || '{}'); } catch { pico = {}; } }
  if (!pico || typeof pico !== 'object') pico = {};

  const crit = criteriaKeywordsFromSnapshot(pico);
  const dim = (field) => extractKeywords({ [field]: typeof pico[field] === 'string' ? pico[field] : '' });

  return {
    population: dim('P').inclusion,
    intervention: dim('I').inclusion,
    comparator: dim('C').inclusion,
    outcome: dim('O').inclusion,
    inclusion: crit.inclusion,
    exclusion: crit.exclusion,
  };
}

/** Fraction of `terms` present in the padded text, plus the matched terms. */
function coverage(haystackPadded, terms) {
  const list = Array.isArray(terms) ? terms : [];
  if (!list.length) return { fraction: null, matched: [], total: 0 };
  const matched = [];
  for (const t of list) if (textContains(haystackPadded, t)) matched.push(t);
  return { fraction: matched.length / list.length, matched, total: list.length };
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

/**
 * coldStartScore — compute the transparent cold-start relevance prior for a
 * record against project criteria/PICO/keywords.
 *
 * @param {{title?,abstract?,keywords?,journal?}} record
 * @param {object} ctx
 * @param {object|string|null} [ctx.picoSnapshot]
 * @param {string[]} [ctx.inclusionKeywords] — explicit highlight/include terms
 * @param {string[]} [ctx.exclusionKeywords] — explicit exclude terms
 * @param {string[]} [ctx.studyTypeFilter] — desired study-design keys/labels
 * @returns {{ score:number, lowConfidence:boolean, signals:object }}
 */
export function coldStartScore(record, ctx = {}) {
  const padded = ` ${recordText(record).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  // PICO/criteria concepts depend ONLY on the (per-run constant) picoSnapshot, not
  // on the record. Callers scoring many records should derive them ONCE and pass
  // them in via ctx.concepts; otherwise we derive them here (back-compatible).
  // Re-deriving per record was the dominant hot path at scale (criteria digest +
  // synonym expansion × N records × k CV folds).
  const concepts = ctx.concepts || picoConcepts(ctx.picoSnapshot);

  // PICO dimension matches (only dimensions that actually have terms count).
  const pico = {
    population: coverage(padded, concepts.population),
    intervention: coverage(padded, concepts.intervention),
    comparator: coverage(padded, concepts.comparator),
    outcome: coverage(padded, concepts.outcome),
  };
  const picoFractions = Object.values(pico).map(p => p.fraction).filter(f => f != null);
  const picoMean = picoFractions.length ? mean(picoFractions) : null;

  // Inclusion signal = criteria-derived inclusion ∪ explicit inclusion keywords.
  const inclusionTerms = [...new Set([...(concepts.inclusion || []), ...(ctx.inclusionKeywords || [])])];
  const exclusionTerms = [...new Set([...(concepts.exclusion || []), ...(ctx.exclusionKeywords || [])])];
  const incl = coverage(padded, inclusionTerms);
  const excl = coverage(padded, exclusionTerms);

  const positives = [];
  if (picoMean != null) positives.push(picoMean);
  if (incl.fraction != null) positives.push(incl.fraction);
  const hasPrior = positives.length > 0;
  const positive = hasPrior ? mean(positives) : 0.15; // neutral coverage if nothing configured

  // Coverage → prior via a gentle curve centred at ~15% coverage (= neutral 0.5).
  const prior = 0.5 + 0.5 * Math.tanh(2.4 * (positive - 0.15));

  // Exclusion hits scale the prior down (1 hit → ×0.7, 2+ → ×0.5).
  const exclusionSignal = excl.matched.length === 0 ? 0 : Math.min(1, excl.matched.length / 2);
  const score = clamp01(prior * (1 - 0.5 * exclusionSignal));

  const design = detectStudyDesign(record);
  const wantsDesign = Array.isArray(ctx.studyTypeFilter) ? ctx.studyTypeFilter.map(normalizeKeyword) : [];
  const designMatch = wantsDesign.length
    ? (design ? wantsDesign.some(w => w.includes(design) || design.includes(w)) : null)
    : null;

  return {
    score,
    lowConfidence: !hasPrior,
    signals: {
      pico: {
        population: { match: pico.population.fraction, matched: pico.population.matched },
        intervention: { match: pico.intervention.fraction, matched: pico.intervention.matched },
        comparator: { match: pico.comparator.fraction, matched: pico.comparator.matched },
        outcome: { match: pico.outcome.fraction, matched: pico.outcome.matched },
        mean: picoMean,
      },
      inclusion: { coverage: incl.fraction, matched: incl.matched, total: incl.total },
      exclusion: { hits: excl.matched.length, matched: excl.matched },
      studyDesign: design || null,
      studyDesignMatch: designMatch,
    },
  };
}
