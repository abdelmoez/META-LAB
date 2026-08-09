/**
 * keywordNormalize.js — THE canonical screening-keyword normalizers (107.md §§2-3).
 *
 * Pure functions, no database, no side effects.
 *
 * Before 107.md there were four different keyword normalizers with four different
 * semantics (criteriaKeywords.normalizeKeyword, conceptKeywords' local `norm`,
 * keywordFilter.normalizeText and an ad-hoc `.trim().toLowerCase()` in the add-term
 * UI), so "drug‑resistant epilepsy" (unicode dash) and "drug-resistant  epilepsy"
 * (double space) were three different keywords depending on which code path you
 * reached. `normalizeKeywordKey` is now the single dedup key used by the reducer,
 * the server ops endpoint, the keyword editor and the abstract-selection shortcut.
 *
 * It deliberately matches the folding `keywordFilter.normalizeText` already applies
 * when MATCHING keywords against abstracts, so two phrases that highlight the same
 * text can never be stored as two separate keywords.
 */

// Unicode dash variants (hyphen-minus excluded — it is already ascii "-").
const DASH_RE = /[‐‑‒–—―−﹘﹣－]/g;
// Unicode single-quote variants → ascii apostrophe.
const SQUOTE_RE = /[‘’‚‛′´‵]/g;
// Unicode double-quote variants → ascii quote.
const DQUOTE_RE = /[“”„‟″«»]/g;

/**
 * normalizeKeywordKey — the canonical dedup/comparison key for a keyword.
 *   - folds unicode dashes / quotes to their ascii equivalents,
 *   - lowercases,
 *   - collapses any run of whitespace (incl. line breaks) to one space,
 *   - trims.
 * Non-string input yields "".
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeKeywordKey(s) {
  if (s == null) return '';
  return String(s)
    .replace(DASH_RE, '-')
    .replace(SQUOTE_RE, "'")
    .replace(DQUOTE_RE, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Punctuation that may be stripped from the EDGES of a user-selected phrase. The
// set is deliberately small: hyphens, slashes and periods INSIDE the phrase are
// medically meaningful ("drug-resistant", "kg/m2", "1.5 T") and are never touched.
const EDGE_PUNCT = new Set([
  ',', '.', ';', ':', '!', '?', "'", '"', '(', ')', '[', ']', '{', '}', '«', '»',
  '‘', '’', '“', '”', '‹', '›',
]);
// Bracket pairs — a closing bracket whose opener is still inside the phrase is part
// of the phrase ("type 2 diabetes (T2DM)"), not accidental edge punctuation.
const OPENERS = { ')': '(', ']': '[', '}': '{', '»': '«', '›': '‹' };
const CLOSERS = { '(': ')', '[': ']', '{': '}', '«': '»', '‹': '›' };

/**
 * normalizeSelectedPhrase — turn a raw text selection into a storable keyword
 * (107.md §3 "Text Normalization"):
 *   - collapse line breaks / repeated whitespace to single spaces,
 *   - trim,
 *   - strip a fully-wrapping bracket/quote pair,
 *   - strip accidental leading/trailing punctuation (loop while the edge char is in
 *     EDGE_PUNCT), while PRESERVING medically meaningful internal punctuation and
 *     a bracket whose partner is inside the phrase,
 *   - preserve the display casing verbatim.
 *
 *   "  drug-resistant\n epilepsy,  "  →  "drug-resistant epilepsy"
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeSelectedPhrase(s) {
  if (s == null) return '';
  let str = String(s).replace(/\s+/g, ' ').trim();

  // A phrase entirely wrapped in one matching pair loses the pair ("(T2DM)" → "T2DM").
  let wrapped = true;
  while (wrapped && str.length >= 2) {
    const first = str[0];
    const last = str[str.length - 1];
    const closes = CLOSERS[first];
    const quoted = (first === '"' || first === "'") && last === first;
    if ((closes && last === closes) || quoted) {
      const inner = str.slice(1, -1).trim();
      // Only unwrap when the pair really is a wrapper (no unbalanced partner inside).
      if (!inner.includes(first) && !inner.includes(last)) { str = inner; continue; }
    }
    wrapped = false;
  }

  // Trailing edge punctuation.
  while (str.length) {
    const ch = str[str.length - 1];
    if (!EDGE_PUNCT.has(ch)) break;
    // Keep a closer whose opener is still in the phrase.
    if (OPENERS[ch] && str.slice(0, -1).includes(OPENERS[ch])) break;
    str = str.slice(0, -1).trimEnd();
  }
  // Leading edge punctuation.
  while (str.length) {
    const ch = str[0];
    if (!EDGE_PUNCT.has(ch)) break;
    if (CLOSERS[ch] && str.slice(1).includes(CLOSERS[ch])) break;
    str = str.slice(1).trimStart();
  }
  return str;
}
