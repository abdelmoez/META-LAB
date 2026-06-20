/**
 * conceptKeywords.js — smarter screening keyword extraction (prompt43 Area 1).
 *
 * Pure functions, no database, no side effects. This module belongs to the
 * SCREENING engine and is deliberately independent of the Search-Builder engine
 * (src/research-engine/searchBuilder) — they solve different problems and are
 * owned/edited separately.
 *
 * Problem it fixes: the criteria → screening-keyword layer used to copy whole
 * eligibility SENTENCES verbatim (the old extractor only split on bullets /
 * commas / semicolons, so a sentence with no separators became ONE keyword). A
 * reviewer screening with "include adult patients with type 2 diabetes undergoing
 * bariatric surgery" got that entire sentence as a single highlight term, which
 * never matches an abstract.
 *
 * This extractor instead DIGESTS the text into clinically meaningful concepts and
 * adds a conservative set of obvious synonyms / abbreviations:
 *
 *   "Include adult patients with type 2 diabetes undergoing bariatric surgery"
 *      → adult · adults · type 2 diabetes · T2DM · diabetes mellitus type 2
 *        · bariatric surgery · metabolic surgery · sleeve gastrectomy · gastric bypass
 *
 * Pipeline (per criteria line):
 *   1. clean + strip a leading directive ("include" / "studies of" …)
 *   2. split into concept fragments on clinical connectors (with / and / undergoing …)
 *   3. trim filler / stopword / population words off each fragment edge
 *      ("adult patients" → "adult", "patients with X" → "X")
 *   4. keep clinically-useful fragments, drop pure filler / too-short ones
 *   5. expand each surviving concept via a curated, CONSERVATIVE synonym map
 *   6. dedupe (case/space-insensitive), keep stable order, cap.
 */
import { STOPWORDS } from './keywords.js';

const MAX_ITEMS = 40;       // hard cap on emitted keywords per side (avoid over-generation)
const MAX_SYN = 5;          // max synonyms added per concept
const MIN_SYN_LEN = 3;      // never emit a synonym shorter than this (avoids 2-letter
                            // abbreviations like "MI"/"HF" that highlight spurious words)

/** Local normalizer (kept here to avoid a circular import with criteriaKeywords.js). */
function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Population nouns that describe WHO (not the clinical concept) — trimmed off the
// edges of a fragment so "adult patients" → "adult" and "patients with X" → "X".
// Note: "adult/adults/elderly/child…" are NOT here — they carry real screening
// signal and are kept (and synonym-expanded). "case" is NOT here either, so
// "case report" / "case series" / "case-control" survive intact.
const POPULATION = new Set([
  'patient', 'patients', 'participant', 'participants', 'subject', 'subjects',
  'individual', 'individuals', 'people', 'person', 'persons',
  'population', 'populations',
]);

// Non-stopword filler words trimmed off either edge of a fragment (quantifiers /
// qualifiers with no screening signal). "only" turns "rct only" → "rct".
const EXTRA_FILLER = new Set([
  'only', 'both', 'either', 'neither', 'all', 'any', 'e.g', 'eg', 'ie', 'etc',
  // comparator / age tails left behind after a comparator split ("18 years or older",
  // "greater than 30") — trimmed off fragment edges so no bare comparator word survives.
  'older', 'younger', 'old', 'aged', 'over', 'under', 'above', 'below', 'least', 'between',
  'greater', 'less', 'more', 'fewer', 'exceeding', 'equal',
]);

// Pure number / measurement-unit tokens — trimmed off edges and not counted as a
// "content" word, so numeric eligibility tails ("18 years", "30 kg/m2") don't become
// junk keywords. (A bare number is matched by NUMERIC_RE.)
const UNIT_WORDS = new Set([
  'years', 'year', 'yrs', 'yr', 'months', 'month', 'mo', 'weeks', 'week', 'wk',
  'days', 'day', 'hours', 'hour', 'hrs', 'kg', 'g', 'mg', 'mcg', 'ug', 'ng',
  'ml', 'dl', 'l', 'mmhg', 'mmol', 'mol', 'bpm', 'cm', 'mm', 'm', 'm2', 'percent',
  'iu', 'units', 'unit',
]);
const NUMERIC_RE = /^\d+(?:[.,]\d+)?$/;

// Words that may begin a criteria line as a directive / glue and carry no
// screening signal. Stripped only from the START of a line (so a meaningful
// trailing "study" in "animal study"/"cohort study" is preserved).
const LEADING_DIRECTIVES = new Set([
  'include', 'included', 'including', 'includes', 'inclusion',
  'exclude', 'excluded', 'excluding', 'excludes', 'exclusion',
  'eligible', 'eligibility', 'only', 'studies', 'study', 'paper', 'papers',
  'article', 'articles', 'report', 'reports', 'all', 'any', 'must', 'should',
  'of', 'that', 'reporting', 'the', 'a', 'an', 'be', 'were', 'are', 'is',
]);

// Tokens that follow a bare "in" and form a protected term ("in vitro" etc.) — so
// the leading-stopword trim never amputates the medically-meaningful "in vitro".
const PROTECT_IN = new Set(['vitro', 'vivo', 'situ', 'utero']);

// Connectors that separate distinct clinical concepts inside one line. Multi-word
// connectors come first so the alternation prefers the longer match.
const CONNECTORS = [
  'as well as', 'who underwent', 'who received', 'who have', 'who had',
  'presenting with', 'diagnosed with', 'treated with', 'combined with',
  'compared with', 'compared to', 'greater than', 'less than', 'older than',
  'younger than', 'more than', 'fewer than', 'at least', 'due to', 'secondary to',
  'undergoing', 'receiving', 'comparing', 'compared', 'requiring', 'aged',
  'without', 'with', 'and', 'or', 'plus', 'versus', 'vs', 'for',
  'who', 'that', 'which',
];
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const CONNECTOR_RE = new RegExp(
  `\\s+(?:${CONNECTORS.map(escapeRe).join('|')})\\s+|\\s*[\\/&,;]\\s*`, 'gi',
);

// Edge-filler = stopwords ∪ population nouns ∪ quantifier filler ∪ numbers/units.
// Trimmed off BOTH ends of a fragment.
function isEdgeFiller(tok, next) {
  if (tok === 'in' && next && PROTECT_IN.has(next)) return false; // keep "in vitro"
  return STOPWORDS.has(tok) || POPULATION.has(tok) || EXTRA_FILLER.has(tok)
    || UNIT_WORDS.has(tok) || NUMERIC_RE.test(tok);
}

// A "content word" carries real screening signal: an alphabetic token of length ≥ 3
// that is not a stopword / population / filler / unit. A concept with NONE (e.g. a
// pure-symbol or pure-numeric fragment) is dropped.
function isContentWord(w) {
  if (w.length < 3 || !/[a-z]/.test(w)) return false;
  return !(STOPWORDS.has(w) || POPULATION.has(w) || EXTRA_FILLER.has(w) || UNIT_WORDS.has(w));
}

/**
 * Curated, conservative synonym / abbreviation families. Each family lists DISPLAY
 * spellings (abbreviations upper-cased); matching is case/space-insensitive. Kept
 * intentionally small and high-confidence so we never over-generate. Add families
 * here as the domain coverage grows.
 */
const SYNONYM_FAMILIES = [
  // Endocrine / metabolic
  ['type 2 diabetes', 'type 2 diabetes mellitus', 'diabetes mellitus type 2', 'T2DM', 'NIDDM'],
  ['type 1 diabetes', 'type 1 diabetes mellitus', 'diabetes mellitus type 1', 'T1DM', 'IDDM'],
  ['diabetes mellitus', 'diabetes'],
  ['gestational diabetes', 'gestational diabetes mellitus', 'GDM'],
  ['body mass index', 'BMI'],
  ['glycated hemoglobin', 'glycated haemoglobin', 'hemoglobin a1c', 'haemoglobin a1c', 'HbA1c'],
  ['non-alcoholic fatty liver disease', 'nonalcoholic fatty liver disease', 'NAFLD'],
  ['metabolic syndrome'],
  ['glucagon-like peptide-1', 'GLP-1'],
  // Surgery / interventions
  ['bariatric surgery', 'metabolic surgery', 'weight loss surgery', 'sleeve gastrectomy', 'gastric bypass', 'roux-en-y gastric bypass'],
  ['percutaneous coronary intervention', 'PCI', 'angioplasty'],
  ['coronary artery bypass graft', 'CABG'],
  // Cardiovascular
  ['myocardial infarction', 'heart attack'],
  ['heart failure', 'cardiac failure'],
  ['heart failure with reduced ejection fraction', 'HFrEF'],
  ['heart failure with preserved ejection fraction', 'HFpEF'],
  ['coronary artery disease', 'CAD'],
  ['cardiovascular disease', 'CVD'],
  ['atrial fibrillation', 'afib'],
  ['hypertension', 'high blood pressure'],
  ['blood pressure'],
  ['stroke', 'cerebrovascular accident'],
  // Renal / respiratory
  ['chronic kidney disease', 'CKD'],
  ['end-stage renal disease', 'ESRD'],
  ['chronic obstructive pulmonary disease', 'COPD'],
  ['obstructive sleep apnea', 'obstructive sleep apnoea', 'OSA'],
  // Rheum / other
  ['rheumatoid arthritis'],
  ['quality of life', 'QoL'],
  // Study design
  ['randomized controlled trial', 'randomised controlled trial', 'RCT'],
  // Age / sex qualifiers (real screening signal)
  ['adult', 'adults'],
  ['child', 'children', 'paediatric', 'pediatric'],
  ['elderly', 'older adults', 'geriatric'],
  ['adolescent', 'adolescents'],
  ['infant', 'infants', 'neonate', 'neonatal', 'newborn'],
  ['pregnant', 'pregnancy'],
];

// normalized member → its whole family (display spellings).
const SYN_INDEX = (() => {
  const m = new Map();
  for (const fam of SYNONYM_FAMILIES) for (const member of fam) m.set(norm(member), fam);
  return m;
})();

// Known MULTI-WORD concept phrases, longest first. These are pulled out of a line
// INTACT before connector-splitting, so a named entity that itself contains a
// connector word ("heart failure WITH reduced ejection fraction") is never shredded
// into weaker fragments and its synonyms (HFrEF, …) stay reachable.
const PROTECTED_PHRASES = (() => {
  const set = new Set();
  for (const fam of SYNONYM_FAMILIES) for (const member of fam) {
    const n = norm(member);
    if (n.includes(' ')) set.add(n);
  }
  return [...set].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);
})();

/**
 * expandSynonyms — given an extracted concept, return its high-confidence synonyms
 * (display-cased, excluding the concept itself and anything shorter than
 * MIN_SYN_LEN), capped. Returns [] when the concept isn't in the curated map.
 * @param {string} concept
 * @returns {string[]}
 */
export function expandSynonyms(concept) {
  const fam = SYN_INDEX.get(norm(concept));
  if (!fam) return [];
  const out = [];
  const self = norm(concept);
  for (const member of fam) {
    const n = norm(member);
    if (n === self || n.length < MIN_SYN_LEN) continue;
    out.push(member);
    if (out.length >= MAX_SYN) break;
  }
  return out;
}

// Clean an individual line: lowercase, replace sentence punctuation with spaces,
// collapse whitespace. Hyphens and slashes are preserved (slashes are split later
// as connectors; hyphens keep terms like "double-blind"/"covid-19" intact).
function cleanLine(line) {
  return String(line)
    .toLowerCase()
    .replace(/[()[\]{}"'`.:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip a leading run of directive / glue words from a token list (line start only),
// so "include adult patients…" → "adult patients…" without harming a trailing
// "study". Never strips a protected "in vitro".
function stripLeadingDirectives(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'in' && PROTECT_IN.has(tokens[i + 1])) break;
    if (LEADING_DIRECTIVES.has(t)) { i++; continue; }
    break;
  }
  return tokens.slice(i);
}

// Trim filler/stopword/population words off BOTH edges of a fragment's tokens.
function trimEdges(tokens) {
  let s = 0, e = tokens.length;
  while (s < e && isEdgeFiller(tokens[s], tokens[s + 1])) s++;
  while (e > s && isEdgeFiller(tokens[e - 1], null)) e--;
  return tokens.slice(s, e);
}

// Keep a cleaned concept only if it carries screening signal: it must contain at
// least one content word (so pure stopword / population / numeric / symbol fragments
// are dropped), and a single-word concept must itself be a content word.
function keepConcept(concept) {
  if (!concept) return false;
  const words = concept.split(' ').filter(Boolean);
  if (!words.length) return false;
  if (!words.some(isContentWord)) return false;
  if (words.length === 1 && !isContentWord(words[0])) return false;
  return true;
}

// Pull every known multi-word concept phrase out of a line INTACT (longest first),
// replacing each hit with a separator so the remainder still splits cleanly on
// connectors and nothing is double-counted. Returns { phrases, rest }.
function extractProtectedPhrases(line) {
  let rest = ` ${line} `;
  const phrases = [];
  for (const phrase of PROTECTED_PHRASES) {
    const needle = ` ${phrase} `;
    let idx;
    while ((idx = rest.indexOf(needle)) !== -1) {
      phrases.push(phrase);
      rest = `${rest.slice(0, idx)} , ${rest.slice(idx + needle.length)}`;
    }
  }
  return { phrases, rest: rest.trim() };
}

/**
 * extractConcepts — digest free-text criteria into an ordered list of clinically
 * meaningful concept phrases (NO synonyms; lower-cased). Splits the text into
 * lines/bullets; for each line it pulls out known multi-word concepts intact, then
 * splits the remainder into connector-delimited fragments and trims filler off each.
 * @param {string} text
 * @returns {string[]}
 */
export function extractConcepts(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '')) // drop a leading bullet / "1." / "2)"
    .map(cleanLine)
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  const add = (concept) => {
    if (!keepConcept(concept)) return;
    const n = norm(concept);
    if (seen.has(n)) return;
    seen.add(n);
    out.push(concept);
  };

  for (const line of lines) {
    const stripped = stripLeadingDirectives(line.split(' ')).join(' ');
    if (!stripped) continue;
    // Known named entities first (kept whole), then the rest by connector.
    const { phrases, rest } = extractProtectedPhrases(stripped);
    for (const p of phrases) add(p);
    for (const frag of rest.split(CONNECTOR_RE)) {
      if (!frag) continue;
      add(trimEdges(frag.trim().split(' ').filter(Boolean)).join(' '));
    }
  }
  return out;
}

/**
 * extractConceptKeywords — the public extractor: concepts PLUS their conservative
 * synonyms, deduped (case/space-insensitive), in stable order, capped at MAX_ITEMS.
 * Each concept is immediately followed by its synonyms so related terms cluster.
 * @param {string} text
 * @returns {string[]}
 */
export function extractConceptKeywords(text) {
  const concepts = extractConcepts(text);
  const out = [];
  const seen = new Set();
  const push = (term) => {
    const n = norm(term);
    if (!n || seen.has(n) || out.length >= MAX_ITEMS) return;
    seen.add(n);
    out.push(term);
  };
  for (const c of concepts) {
    push(c);
    for (const syn of expandSynonyms(c)) push(syn);
  }
  return out;
}
