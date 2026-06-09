/**
 * keywords.js — META·SIFT Beta keyword extraction for screening highlight.
 * Pure functions, no database, no side effects.
 *
 * Turns a PICO / eligibility-criteria object into two flat lists of candidate
 * phrases — one describing what we WANT (inclusion) and one describing what we
 * DON'T (exclusion) — suitable for driving abstract highlighting.
 */

/**
 * A compact English stopword set. Exported for reuse/testing. Used to drop
 * single-word candidate phrases that carry no screening signal. Multi-word
 * phrases are preserved even if they contain stopwords (e.g. "risk of bias").
 */
export const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he',
  'her', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'may',
  'might', 'must', 'no', 'nor', 'not', 'of', 'on', 'or', 'our', 'shall',
  'she', 'should', 'so', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'to', 'too', 'us', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'would', 'you', 'your',
]);

const MAX_ITEMS = 40;

/**
 * splitPhrases — break a free-text criteria string into candidate phrases.
 * Splits on line breaks, bullets (-, *, •, and "1." / "2)" style enumerators),
 * semicolons and commas. Each resulting phrase is trimmed; empties dropped.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitPhrases(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    // Normalize newlines, then strip leading bullets / enumerators per line.
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '') // leading bullet / "1." / "2)"
        .trim()
    )
    .join('\n')
    // Now split the whole blob on the remaining separators.
    .split(/[\n;,]|(?:[-*•·]\s)/)
    .map(p => p.trim())
    .filter(Boolean);
}

/**
 * cleanPhrase — normalize an individual candidate phrase: collapse whitespace,
 * strip surrounding punctuation, lowercase. Returns '' if nothing usable.
 *
 * @param {string} phrase
 * @returns {string}
 */
function cleanPhrase(phrase) {
  return phrase
    .toLowerCase()
    .replace(/[()[\]{}"'`.:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * keepPhrase — decide whether a cleaned phrase is worth keeping.
 * - Multi-word phrases are kept (they are the high-value signal), unless every
 *   word is a stopword.
 * - Single-word phrases are dropped if < 3 chars or if they are a stopword.
 *
 * @param {string} phrase — already cleaned/lowercased
 * @returns {boolean}
 */
function keepPhrase(phrase) {
  if (!phrase) return false;
  const words = phrase.split(' ').filter(Boolean);
  if (words.length === 0) return false;
  const allStop = words.every(w => STOPWORDS.has(w));
  if (allStop) return false;
  if (words.length === 1) {
    const w = words[0];
    if (w.length < 3) return false;
    if (STOPWORDS.has(w)) return false;
  }
  return true;
}

/**
 * dedupeAndOrder — lowercase-dedupe a phrase list and apply deterministic
 * ordering: multi-word phrases first (longer word-count first), then by length
 * desc, then alphabetical. Capped at MAX_ITEMS.
 *
 * @param {string[]} phrases — already cleaned/lowercased
 * @returns {string[]}
 */
function dedupeAndOrder(phrases) {
  const seen = new Set();
  const unique = [];
  for (const p of phrases) {
    if (!seen.has(p)) {
      seen.add(p);
      unique.push(p);
    }
  }
  unique.sort((a, b) => {
    const wa = a.split(' ').length;
    const wb = b.split(' ').length;
    if (wa !== wb) return wb - wa;        // more words first (phrases > singles)
    if (a.length !== b.length) return b.length - a.length; // longer first
    return a.localeCompare(b);            // alphabetical tiebreak
  });
  return unique.slice(0, MAX_ITEMS);
}

/**
 * collect — split + clean + filter a single free-text field into kept phrases.
 *
 * @param {string} text
 * @returns {string[]}
 */
function collect(text) {
  return splitPhrases(text)
    .map(cleanPhrase)
    .filter(keepPhrase);
}

/**
 * extractKeywords — derive inclusion / exclusion highlight phrases from a PICO
 * + eligibility object. All fields are optional strings.
 *
 * Inclusion candidates are folded from P, I, C, O, keywords, question and the
 * free-text inclusion criteria (these all describe what we WANT). Exclusion
 * candidates come from the free-text exclusion criteria only.
 *
 * @param {object} pico
 * @param {string} [pico.P] population
 * @param {string} [pico.I] intervention
 * @param {string} [pico.C] comparator
 * @param {string} [pico.O] outcome
 * @param {string} [pico.question] research question
 * @param {string} [pico.incl] inclusion criteria (free text / bullets)
 * @param {string} [pico.excl] exclusion criteria (free text / bullets)
 * @param {string} [pico.keywords] additional keywords
 * @returns {{ inclusion: string[], exclusion: string[] }}
 */
export function extractKeywords(pico = {}) {
  const {
    P = '', I = '', C = '', O = '',
    question = '', incl = '', excl = '', keywords = '',
  } = pico || {};

  const inclusionRaw = [
    ...collect(P),
    ...collect(I),
    ...collect(C),
    ...collect(O),
    ...collect(keywords),
    ...collect(question),
    ...collect(incl),
  ];
  const exclusionRaw = collect(excl);

  return {
    inclusion: dedupeAndOrder(inclusionRaw),
    exclusion: dedupeAndOrder(exclusionRaw),
  };
}
