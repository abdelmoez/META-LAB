/**
 * sof.js — P12. Summary-of-Findings certainty map + GRADE footnotes.
 *
 * The manuscript Summary-of-Findings table (research-engine/manuscript/tables.js →
 * buildSummaryOfFindingsTable) reads certainty from opts.gradeByOutcome keyed by
 * the per-outcome pair.key produced by getOutcomePairs. This module turns per-
 * outcome GRADE assessments into exactly that map, plus the human-readable
 * footnotes that explain each non-"not serious" rating in GRADE style.
 *
 * Pure: no Prisma / Express / React / Date.now() / randomness.
 *
 * An "assessment" here is one outcome's GRADE judgment:
 *   {
 *     key,            // stable outcome key === getOutcomePairs pair.key
 *     design | pico | startLevel,   // to derive the starting certainty
 *     domains: {      // ratings keyed by GRADE domain
 *       rob:'serious', inconsistency:'not_serious', indirectness:'not_serious',
 *       imprecision:'serious', publicationBias:'not_serious',
 *       // optional observational upgrades: largeEffect:'large', doseResponse:'large', …
 *     },
 *     reasons?: { [domain]: 'free-text rationale' },   // appended to footnotes
 *     label?,                                          // outcome label for footnotes
 *   }
 */

import {
  computeCertainty,
  startLevelForDesign,
  GRADE_DOMAINS,
  GRADE_RATINGS,
  domainLabel,
  ratingModifier,
  isKnownRating,
} from './gradeModel.js';

const clean = (s) => String(s == null ? '' : s).trim();

/** Domain iteration order for deterministic footnotes (model order). */
const DOMAIN_ORDER = GRADE_DOMAINS.map((d) => d.key);

/** Extract the ratings object from an assessment (supports a few shapes). */
function assessmentDomains(assessment) {
  if (!assessment) return {};
  const d = assessment.domains || assessment.ratings || assessment.grade || {};
  return d && typeof d === 'object' ? d : {};
}

/** The rating string for a domain value (unwraps { rating } / { suggest }). */
function ratingOf(v) {
  if (v && typeof v === 'object') return v.rating != null ? v.rating : (v.suggest != null ? v.suggest : v.value);
  return v;
}

/** Resolve the starting-certainty descriptor for an assessment. */
function startFor(assessment) {
  if (assessment && assessment.startLevel != null) return assessment.startLevel;
  if (assessment && assessment.design != null) return assessment.design;
  if (assessment && assessment.pico) return assessment.pico;
  return undefined; // → startLevelForDesign('unclear') = High, assumed:true
}

/** Phrase describing the size/direction of a rating for a footnote. */
function ratingPhrase(rating) {
  const m = ratingModifier(rating);
  const meta = GRADE_RATINGS[rating] || {};
  if (m <= -2) return `rated down two levels (${meta.label ? meta.label.toLowerCase() : 'very serious'})`;
  if (m === -1) return `rated down one level (${meta.label ? meta.label.toLowerCase() : 'serious'})`;
  if (m >= 2) return 'rated up two levels';
  if (m === 1) return 'rated up one level';
  return 'no change';
}

/**
 * gradeFootnotes(assessment) → string[]
 * One footnote per domain that changed the certainty (modifier ≠ 0), in GRADE
 * house style, in domain order. A per-domain rationale (assessment.reasons[domain])
 * is appended when provided. Domains judged "not serious" produce no footnote.
 */
export function gradeFootnotes(assessment) {
  const domains = assessmentDomains(assessment);
  const reasons = (assessment && assessment.reasons) || {};
  const notes = [];
  for (const key of DOMAIN_ORDER) {
    if (!(key in domains)) continue;
    const rating = ratingOf(domains[key]);
    if (!isKnownRating(rating)) continue;
    if (ratingModifier(rating) === 0) continue; // not serious / not applicable → no footnote
    const why = clean(reasons[key]);
    notes.push(`${domainLabel(key)}: ${ratingPhrase(rating)}${why ? ` — ${why}` : ''}.`);
  }
  return notes;
}

/**
 * buildGradeByOutcome(assessments) → { [pairKey]: { certainty, certaintyKey,
 *   numeric, footnotes, modifiersApplied, startLevel } }
 *
 * @param {Array|Object} assessments  either an array of per-outcome assessments
 *        (each with a `key`), or an object map { pairKey: assessment }.
 * @returns {Object} map keyed by outcome pair.key. `certainty` is the level label
 *          ('High'|'Moderate'|'Low'|'Very low') the SoF table renders; footnotes
 *          explain every non-"not serious" domain.
 */
export function buildGradeByOutcome(assessments) {
  const out = {};
  if (!assessments) return out;

  const list = Array.isArray(assessments)
    ? assessments.filter(Boolean).map((a) => ({ key: a.key != null ? a.key : a.outcomeKey, assessment: a }))
    : Object.keys(assessments).map((k) => ({ key: k, assessment: assessments[k] }));

  for (const { key, assessment } of list) {
    if (key == null || key === '') continue;
    const domains = assessmentDomains(assessment);
    const cert = computeCertainty({ startLevel: startLevelForDesign(startFor(assessment)), domains });
    out[key] = {
      certainty: cert.level,
      certaintyKey: cert.levelKey,
      numeric: cert.numeric,
      footnotes: gradeFootnotes(assessment),
      modifiersApplied: cert.modifiersApplied,
      startLevel: cert.startLevel,
    };
  }
  return out;
}

export const GRADE_SOF_VERSION = 'v1';
