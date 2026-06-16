/**
 * institutionMatch.js — institution normalization + fuzzy matching (prompt26).
 *
 * Pure, framework-free. Avoids duplicate institutions caused by case, spacing,
 * punctuation, abbreviations and small typos — WITHOUT silently merging
 * uncertain matches. Reuses the engine's Levenshtein from the dedup module.
 *
 * Confidence bands (prompt26):
 *   ≥ 0.95  auto-match   · 0.80–0.94  possible match → Ops review · < 0.80  new
 */
import { levenshtein } from '../screening/deduplication.js';

// Abbreviation expansions (token-wise) so "univ" ≈ "university", etc.
const ABBREV = {
  univ: 'university', hosp: 'hospital', ctr: 'center', cntr: 'center',
  med: 'medical', inst: 'institute', dept: 'department', lab: 'laboratory',
  natl: 'national', intl: 'international', tech: 'technology', sci: 'science',
  eng: 'engineering', coll: 'college', sch: 'school', u: 'university',
};

// Generic institution-type words — dropped when building the distinctive KEY
// (but kept in the normalized form used for display/exact comparison).
const GENERIC = new Set([
  'university', 'college', 'institute', 'institution', 'hospital', 'center',
  'centre', 'medical', 'school', 'faculty', 'department', 'laboratory',
  'national', 'international', 'research',
]);

const STOP = new Set(['the', 'of', 'and', 'for', 'at', 'de', 'la', 'el', 'des', 'du', 'a']);

/**
 * Normalised display form: lower-case, punctuation→space, collapsed spaces,
 * abbreviations expanded. Preserves the institution's words (incl. type words).
 */
export function normalizeInstitution(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.split(' ').map(t => ABBREV[t] || t).join(' ');
}

/**
 * Distinctive key: the normalized tokens minus stop-words and generic
 * institution-type words, sorted — so "Harvard University" and "Harvard" share
 * the key "harvard". If stripping would empty the key, the generic words are
 * kept (so "Medical College" doesn't collapse to nothing).
 */
export function institutionKey(name) {
  const norm = normalizeInstitution(name);
  if (!norm) return '';
  let tokens = norm.split(' ').filter(t => t && !STOP.has(t));
  const distinctive = tokens.filter(t => !GENERIC.has(t));
  if (distinctive.length) tokens = distinctive;
  return [...new Set(tokens)].sort().join(' ');
}

/** Similarity in [0,1] between two institution names. */
export function institutionSimilarity(a, b) {
  const na = normalizeInstitution(a), nb = normalizeInstitution(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;                       // exact after normalization
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  const inter = [...ta].filter(x => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  const jac = union ? inter / union : 0;
  const maxLen = Math.max(na.length, nb.length);
  const lev = maxLen ? 1 - levenshtein(na, nb) / maxLen : 0;
  let score = Math.max(jac, lev);
  const ka = institutionKey(a), kb = institutionKey(b);
  if (ka && ka === kb) score = Math.max(score, 0.90); // same distinctive tokens → possible match (review)
  return Math.min(1, score);
}

export const INST_AUTO_THRESHOLD = 0.95;
export const INST_REVIEW_THRESHOLD = 0.80;

export function classifyInstitutionMatch(confidence) {
  if (confidence >= INST_AUTO_THRESHOLD) return 'auto';
  if (confidence >= INST_REVIEW_THRESHOLD) return 'review';
  return 'new';
}

/**
 * Match a name against existing institutions.
 * @param {string} name
 * @param {Array<string|{canonicalName:string}>} existing
 * @returns {{ input, normalized, key, bestMatch, confidence, disposition, candidates }}
 */
export function matchInstitution(name, existing = []) {
  const candidates = existing
    .map(e => (typeof e === 'string' ? { canonicalName: e } : e))
    .filter(e => e && e.canonicalName)
    .map(e => ({ ...e, confidence: institutionSimilarity(name, e.canonicalName) }))
    .filter(e => e.confidence > 0)
    .sort((x, y) => y.confidence - x.confidence);
  const top = candidates[0] || null;
  const confidence = top ? top.confidence : 0;
  return {
    input: name,
    normalized: normalizeInstitution(name),
    key: institutionKey(name),
    bestMatch: top,
    confidence,
    disposition: classifyInstitutionMatch(confidence),
    candidates: candidates.slice(0, 5),
  };
}

/**
 * Group a list of user-entered institution names by distinctive key. Returns
 * canonical groups (most common original spelling wins) + the list of variant
 * spellings — the data the Ops "possible duplicate institutions" view needs.
 * @param {string[]} names
 * @returns {Array<{ key, canonicalName, count, variants: string[] }>}
 */
export function groupInstitutions(names) {
  const groups = new Map();
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = institutionKey(name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, new Map());
    const variants = groups.get(key);
    variants.set(name, (variants.get(name) || 0) + 1);
  }
  return [...groups.entries()].map(([key, variants]) => {
    const sorted = [...variants.entries()].sort((a, b) => b[1] - a[1]);
    const count = sorted.reduce((a, [, n]) => a + n, 0);
    return { key, canonicalName: sorted[0][0], count, variants: sorted.map(([v]) => v) };
  }).sort((a, b) => b.count - a.count);
}
