/**
 * conceptExtraction.js — prompt40 Task 3. Deterministic, network-free extraction
 * of MULTIPLE meaningful search concepts from each PICO field (not just the first
 * word). Splits a phrase on clinical connectors, strips junk words, and maps each
 * segment to a medical concept family (phrase ladder + synonyms + abbreviation
 * expansions) so e.g.:
 *
 *   "type 2 diabetes mellitus with HFrEF"
 *     → concept "type 2 diabetes": [type 2 diabetes mellitus, diabetes mellitus, diabetes, T2DM]
 *     → concept "heart failure (HFrEF)": [heart failure with reduced ejection fraction, HFrEF, heart failure]
 *
 * Each emitted concept is OR-within (synonyms) and the engine's renderers AND
 * different concepts together. Pure + exported for unit testing.
 */
import { STOPWORDS } from '../screening/keywords.js';
import { CONCEPT_FAMILIES, ABBREVIATIONS, CONNECTORS, JUNK_WORDS } from './medicalSynonyms.js';

/** Lowercase, strip wrapping punctuation/quotes, collapse whitespace. Keeps hyphens. */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[“”"'’.()[\]{}:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word-boundary-aware phrase containment (so "af" doesn't match inside "graft"). */
function containsPhrase(hay, needle) {
  if (!needle) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escRe(needle)}(?:[^a-z0-9]|$)`, 'i').test(hay);
}

/**
 * Split a PICO phrase into concept segments on clinical connectors (with, versus,
 * undergoing, compared with, …) and punctuation separators (, ; /). Original case
 * is preserved in the returned segments.
 */
// "in"/"among" are SOFT connectors: they usually introduce a population qualifier
// ("heart failure in adults") rather than a second concept, and they appear inside
// fixed phrases ("carcinoma in situ", "pain in the chest"). So they are NOT generic
// split points — they only trim a trailing junk-only qualifier (see trimSoftQualifier).
const SOFT_CONNECTORS = ['in', 'among'];

/** Strip a trailing "in/among <qualifier>" only when the qualifier reduces to junk
 *  (a population descriptor), preserving fixed medical phrases otherwise. */
function trimSoftQualifier(seg) {
  let cur = seg;
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of SOFT_CONNECTORS) {
      const m = cur.match(new RegExp(`^(.*\\S)\\s${c}\\s(.+)$`, 'i')); // greedy → LAST occurrence
      if (m && m[1].trim() && stripJunk(m[2]) === '') { cur = m[1].trim(); changed = true; break; }
    }
  }
  return cur;
}

export function splitSegments(text) {
  let s = ` ${String(text || '').replace(/\s+/g, ' ').trim()} `;
  if (!s.trim()) return [];
  // Hard connectors (longest first so "compared with" wins over "with") + punctuation
  // are reliable concept boundaries; "in"/"among" are handled separately below.
  const hard = CONNECTORS.filter((c) => !SOFT_CONNECTORS.includes(c)).sort((a, b) => b.length - a.length);
  for (const c of hard) s = s.replace(new RegExp(`\\s${escRe(c)}\\s`, 'gi'), ' | ');
  s = s.replace(/[;,/]/g, ' | ');
  return s.split('|').map((x) => trimSoftQualifier(x.trim())).filter(Boolean);
}

/** Drop leading/trailing junk + stopwords from a segment (keeps the medical core). */
export function stripJunk(segment) {
  const tokens = String(segment || '').split(/\s+/).filter(Boolean);
  const isDrop = (w) => {
    const lw = w.toLowerCase().replace(/[^\w-]/g, '');
    return !lw || JUNK_WORDS.has(lw) || STOPWORDS.has(lw);
  };
  let i = 0; let j = tokens.length - 1;
  while (i <= j && isDrop(tokens[i])) i++;
  while (j >= i && isDrop(tokens[j])) j--;
  return tokens.slice(i, j + 1).join(' ').trim();
}

/** Best matching concept family for a normalized segment, or null. */
export function matchFamily(segNorm) {
  let best = null; let score = 0;
  for (const fam of CONCEPT_FAMILIES) {
    for (const trig of fam.triggers) {
      let sc = 0;
      if (segNorm === trig) sc = 1000 + trig.length;
      else if (containsPhrase(segNorm, trig)) sc = trig.length;
      if (sc > score) { score = sc; best = fam; }
    }
  }
  return best;
}

/** Expansion for a known single-token abbreviation, or null. */
export function expandAbbreviation(token) {
  return ABBREVIATIONS[norm(token)] || null;
}

// `field` is the SEARCH field (title/abstract); `sourceField` is the PICO field the
// term was extracted FROM (Population/Intervention/…) so each chip can show its
// provenance (SE1 Task 2 — "mark generated terms with their source field"). The
// original PICO text is never mutated — this is derived metadata only.
function mkTerm(text, isSyn, fieldLabel) {
  return {
    text,
    normalizedLabel: norm(text),
    type: 'freetext',
    field: 'tiab',
    sourceField: fieldLabel || '',
    source: 'pico_auto',
    synonym: !!isSyn,
  };
}

/**
 * Extract concepts from ONE PICO field's text.
 * @returns Array<{ label, normalizedLabel, field, source:'pico_auto', op:'AND',
 *   terms:[{text, normalizedLabel, type, field, sourceField, source, synonym}] }>
 */
export function extractConcepts(text, fieldLabel = '') {
  const concepts = [];
  const seenPrimary = new Set();
  for (const seg of splitSegments(text)) {
    const cleaned = stripJunk(seg);
    const segNorm = norm(cleaned);
    if (!segNorm) continue;
    const fam = matchFamily(segNorm);
    let label; let termTexts;
    if (fam) { label = fam.label; termTexts = fam.terms.slice(); }
    else {
      label = cleaned;
      termTexts = [cleaned];
      const ab = expandAbbreviation(segNorm);
      if (ab) termTexts.push(ab);
    }
    // Dedupe terms within the concept (by normalized text), preserve order.
    const seen = new Set(); const terms = [];
    for (const t of termTexts) {
      const n = norm(t);
      if (n && !seen.has(n)) { seen.add(n); terms.push(mkTerm(t, terms.length > 0, fieldLabel)); }
    }
    if (!terms.length) continue;
    const primaryNorm = norm(terms[0].text);
    if (seenPrimary.has(primaryNorm)) continue; // dedupe concept across the field
    seenPrimary.add(primaryNorm);
    concepts.push({ label, normalizedLabel: norm(label), field: fieldLabel, source: 'pico_auto', op: 'AND', terms });
  }
  return concepts;
}

const PICO_FIELDS = [['P', 'Population'], ['I', 'Intervention'], ['C', 'Comparator'], ['O', 'Outcome']];

/**
 * Extract concepts from a whole PICO object ({P,I,C,O}), processing each field
 * independently and grouping the resulting concepts by source field. Dedupes
 * concepts across the whole PICO by primary term.
 */
export function picoToConcepts(pico) {
  const out = [];
  const seen = new Set();
  for (const [k, label] of PICO_FIELDS) {
    const v = (pico && pico[k]) || '';
    for (const c of extractConcepts(v, label)) {
      const key = norm(c.terms[0]?.text);
      if (key && !seen.has(key)) { seen.add(key); out.push(c); }
    }
  }
  return out;
}
