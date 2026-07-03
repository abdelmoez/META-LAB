/**
 * gradeModel.js — P12. The engine-agnostic GRADE domain model.
 *
 * GRADE (Grading of Recommendations Assessment, Development and Evaluation) rates
 * the CERTAINTY of a body of evidence for one outcome. This module formalises the
 * arithmetic that the app has been doing inline (GRADE_OPTIONS + gradeSuggestions
 * in the monolith) into a single, pure, deterministic model that the server, the
 * GRADE tab, and the manuscript Summary-of-Findings table can all share.
 *
 * Pure: no Prisma / Express / React / Date.now() / randomness. Given the same
 * inputs it always returns the same certainty.
 *
 * Methodology (standard, published GRADE guidance — no invented thresholds):
 *   - Starting certainty: randomized trials start HIGH, observational studies start
 *     LOW. (Guyatt GH et al. GRADE guidelines: 3. Rating the quality of evidence.
 *     J Clin Epidemiol. 2011;64:401-6; GRADE Handbook §5.)
 *   - Five domains can rate DOWN (risk of bias, inconsistency, indirectness,
 *     imprecision, publication bias): each not serious (0), serious (−1) or very
 *     serious (−2). (Balshem H et al. J Clin Epidemiol. 2011;64:401-6.)
 *   - Three domains can rate UP for observational evidence when there is no reason
 *     to rate down (large magnitude of effect +1/+2, dose–response gradient +1,
 *     plausible residual confounding +1). (Guyatt GH et al. GRADE guidelines: 9.
 *     Rating up the quality of evidence. J Clin Epidemiol. 2011;64:1311-6.)
 *   - Final certainty = start + Σ modifiers, clamped to 1..4 → Very low / Low /
 *     Moderate / High.
 */

// ── Certainty levels (numeric 4..1) ──────────────────────────────────────────
export const CERTAINTY_LEVELS = [
  { numeric: 4, key: 'high',     label: 'High' },
  { numeric: 3, key: 'moderate', label: 'Moderate' },
  { numeric: 2, key: 'low',      label: 'Low' },
  { numeric: 1, key: 'very_low', label: 'Very low' },
];

/** Map a clamped numeric (1..4) to its certainty level object. */
export function levelForNumeric(n) {
  const clamped = Math.max(1, Math.min(4, Math.round(n)));
  return CERTAINTY_LEVELS.find((l) => l.numeric === clamped) || CERTAINTY_LEVELS[3];
}

// ── Domain catalogue ─────────────────────────────────────────────────────────
// The five certainty domains that can only LOWER certainty, plus the three
// upgrade domains that apply ONLY to observational evidence. `reviewerOnly` marks
// domains that cannot be inferred from the data alone (indirectness, and every
// upgrade domain) — the auto-suggester leaves these for the reviewer.
export const DOWNGRADE_DOMAINS = ['rob', 'inconsistency', 'indirectness', 'imprecision', 'publicationBias'];
export const UPGRADE_DOMAINS = ['largeEffect', 'doseResponse', 'plausibleConfounding'];

export const GRADE_DOMAINS = [
  { key: 'rob',                 label: 'Risk of bias',                   direction: 'down', canRateUp: false, reviewerOnly: false, appliesTo: 'all' },
  { key: 'inconsistency',       label: 'Inconsistency',                  direction: 'down', canRateUp: false, reviewerOnly: false, appliesTo: 'all' },
  { key: 'indirectness',        label: 'Indirectness',                   direction: 'down', canRateUp: false, reviewerOnly: true,  appliesTo: 'all' },
  { key: 'imprecision',         label: 'Imprecision',                    direction: 'down', canRateUp: false, reviewerOnly: false, appliesTo: 'all' },
  { key: 'publicationBias',     label: 'Publication bias',               direction: 'down', canRateUp: false, reviewerOnly: false, appliesTo: 'all' },
  // Upgrade domains — observational evidence only, and only when nothing is rated down.
  { key: 'largeEffect',         label: 'Large magnitude of effect',      direction: 'up',   canRateUp: true,  reviewerOnly: true,  appliesTo: 'observational' },
  { key: 'doseResponse',        label: 'Dose–response gradient',         direction: 'up',   canRateUp: true,  reviewerOnly: true,  appliesTo: 'observational' },
  { key: 'plausibleConfounding',label: 'Plausible residual confounding', direction: 'up',   canRateUp: true,  reviewerOnly: true,  appliesTo: 'observational' },
];

/** Lookup a domain definition by key (null if unknown). */
export function domainDef(key) {
  return GRADE_DOMAINS.find((d) => d.key === key) || null;
}

/** Human label for a domain key (falls back to the key itself). */
export function domainLabel(key) {
  const d = domainDef(key);
  return d ? d.label : String(key || '');
}

// ── Rating vocabulary → numeric modifier ─────────────────────────────────────
// Two equivalent down-rating vocabularies are supported so the same model serves
// both the classic GRADE wording (not serious / serious / very serious) and the
// "concern" wording used by some instruments (no / some / major concern). Upgrade
// ratings apply +1 / +2. `not_applicable` and unknown ratings contribute 0.
export const GRADE_RATINGS = {
  not_serious:       { modifier: 0,  label: 'Not serious',                  direction: 'down' },
  serious:           { modifier: -1, label: 'Serious',                      direction: 'down' },
  very_serious:      { modifier: -2, label: 'Very serious',                 direction: 'down' },
  no_concern:        { modifier: 0,  label: 'No concern',                   direction: 'down' },
  some_concern:      { modifier: -1, label: 'Some concerns',                direction: 'down' },
  major_concern:     { modifier: -2, label: 'Major concerns',              direction: 'down' },
  not_applicable:    { modifier: 0,  label: 'Not applicable',               direction: 'none' },
  // Upgrade ratings (observational only).
  large:             { modifier: 1,  label: 'Large effect (rate up)',       direction: 'up' },
  very_large:        { modifier: 2,  label: 'Very large effect (rate up)',  direction: 'up' },
  upgrade_one:       { modifier: 1,  label: 'Rate up one level',            direction: 'up' },
  upgrade_two:       { modifier: 2,  label: 'Rate up two levels',           direction: 'up' },
};

/** True if `rating` is a recognised GRADE judgment. */
export function isKnownRating(rating) {
  return typeof rating === 'string' && Object.prototype.hasOwnProperty.call(GRADE_RATINGS, rating);
}

/** Numeric modifier for a rating (0 for unknown / null / not_applicable). */
export function ratingModifier(rating) {
  return isKnownRating(rating) ? GRADE_RATINGS[rating].modifier : 0;
}

// ── Starting certainty from study design ─────────────────────────────────────
/**
 * Classify a free-text design (or a PICO object's studyDesign) into the GRADE
 * design family. Observational patterns are checked first so "non-randomised
 * trial" is not misread as randomised by the "random" pattern.
 */
function classifyDesign(designOrPico) {
  let raw = designOrPico;
  if (raw && typeof raw === 'object') raw = raw.studyDesign != null ? raw.studyDesign : raw.design;
  const s = String(raw == null ? '' : raw).toLowerCase().trim();
  if (!s) return 'unclear';
  if (/non[-\s]?random|observ|cohort|case[-\s]?control|cross[-\s]?section|registry|quasi|before[-\s]?after|ecologic|nrsi/.test(s)) return 'observational';
  if (/\brct\b|random|experimental|\btrial\b/.test(s)) return 'randomized';
  return 'unclear';
}

/**
 * startLevelForDesign(designOrPico) → { numeric, label, key, design, assumed }
 * Randomized/experimental → High (4). Observational → Low (2). When the design is
 * unclear the model defaults to randomized/High (matching the project model's
 * default studyDesign of "RCT") and flags `assumed:true` so the UI can prompt the
 * reviewer to confirm the design — the starting point is documented, never silent.
 */
export function startLevelForDesign(designOrPico) {
  const family = classifyDesign(designOrPico);
  if (family === 'observational') {
    const lvl = levelForNumeric(2);
    return { numeric: lvl.numeric, label: lvl.label, key: lvl.key, design: 'observational', assumed: false };
  }
  const lvl = levelForNumeric(4);
  return {
    numeric: lvl.numeric, label: lvl.label, key: lvl.key,
    design: family === 'randomized' ? 'randomized' : 'randomized',
    assumed: family === 'unclear',
  };
}

/** Coerce a start level (number | {numeric} | design string) into a start object. */
function normalizeStart(startLevel) {
  if (startLevel && typeof startLevel === 'object' && typeof startLevel.numeric === 'number') {
    const lvl = levelForNumeric(startLevel.numeric);
    return { numeric: lvl.numeric, label: startLevel.label || lvl.label, key: startLevel.key || lvl.key, design: startLevel.design, assumed: !!startLevel.assumed };
  }
  if (typeof startLevel === 'number' && Number.isFinite(startLevel)) {
    const lvl = levelForNumeric(startLevel);
    return { numeric: lvl.numeric, label: lvl.label, key: lvl.key, design: undefined, assumed: false };
  }
  // treat anything else as a design descriptor
  return startLevelForDesign(startLevel);
}

/** Normalise a domains input (object map OR array) into [{domain, rating}]. */
function normalizeDomains(domains) {
  if (!domains) return [];
  const pick = (v) => {
    if (v && typeof v === 'object') return v.rating != null ? v.rating : (v.suggest != null ? v.suggest : v.value);
    return v;
  };
  let entries;
  if (Array.isArray(domains)) {
    entries = domains.filter(Boolean).map((d) => ({ domain: d.domain || d.key, rating: pick(d) }));
  } else {
    entries = Object.keys(domains).map((k) => ({ domain: k, rating: pick(domains[k]) }));
  }
  // keep only recognised ratings — null / '' / unknown contribute nothing and are dropped
  return entries.filter((e) => isKnownRating(e.rating));
}

/**
 * computeCertainty({ startLevel, domains }) → certainty result.
 *
 * @param {number|{numeric:number}|string} startLevel  start certainty (4 High / 2
 *        Low), or a design descriptor to derive it from.
 * @param {Object|Array} domains  domain judgments, either an object map
 *        ({ rob:'serious', inconsistency:'not_serious', … }) or an array
 *        ([{ domain:'rob', rating:'serious' }, …]). Values may also be objects
 *        carrying { rating } or { suggest }.
 * @returns {{ level:string, levelKey:string, numeric:number, rawNumeric:number,
 *            modifiersApplied:Array<{domain,rating,modifier}>, startLevel:object }}
 *
 * Deterministic and GRADE-correct: sum every modifier, clamp the result to 1..4,
 * map to the level. modifiersApplied lists every recognised domain judgment (a
 * modifier of 0 means the domain was judged but did not lower/raise certainty).
 */
export function computeCertainty({ startLevel, domains } = {}) {
  const start = normalizeStart(startLevel);
  const entries = normalizeDomains(domains);
  const modifiersApplied = entries.map((e) => ({ domain: e.domain, rating: e.rating, modifier: ratingModifier(e.rating) }));
  const sum = modifiersApplied.reduce((a, m) => a + m.modifier, 0);
  const raw = start.numeric + sum;
  const clamped = Math.max(1, Math.min(4, raw));
  const lvl = levelForNumeric(clamped);
  return {
    level: lvl.label,
    levelKey: lvl.key,
    numeric: clamped,
    rawNumeric: raw,
    modifiersApplied,
    startLevel: start,
  };
}

/** Convenience: certainty level from a start numeric + a total modifier. */
export function certaintyFromModifiers(startNumeric, totalModifier) {
  return levelForNumeric(Math.max(1, Math.min(4, (Number(startNumeric) || 0) + (Number(totalModifier) || 0))));
}

export const GRADE_MODEL_VERSION = 'v1';
