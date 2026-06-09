/**
 * keywordFilter.js — META·SIFT keyword counting / filtering / highlighting engine
 * (prompt2 Task 8). Pure functions, no network, no database, no side effects.
 *
 * A "record" is an object with at least { id, title, abstract, keywords }.
 * A record's searchable text is: title + " " + abstract + " " + keywords
 * (any missing field is treated as the empty string "").
 *
 * Matching everywhere in this module is:
 *   - case-insensitive,
 *   - whole-PHRASE (so "controlled trial" only matches the two words together),
 *   - token-boundary aware (so "rat" does NOT match inside "operate"/"iterate"),
 *   - tolerant of punctuation/dashes/quotes around and inside phrases
 *     (so hyphenated terms like "non-randomized" / "cross-sectional" match).
 *
 * The companion module highlight.js produces character RANGES (start/end offsets)
 * for the abstract workbench. This module's buildHighlightSegments produces a
 * complementary SEGMENT list ({ text, type }) that fully reconstructs the input
 * text — designed for safe, data-only React rendering (no HTML strings, no
 * innerHTML, XSS-safe by construction).
 */

import {
  DEFAULT_INCLUDE_KEYWORDS,
  DEFAULT_EXCLUDE_KEYWORDS,
} from './defaultKeywords.js';

// Re-export the default keyword lists for caller convenience (Task 8.6).
export { DEFAULT_INCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS };

// ── text normalization ───────────────────────────────────────────────────────

// Unicode dash variants (hyphen-minus excluded — it is already ascii "-").
const DASH_RE = /[‐‑‒–—―−﹘﹣－]/g;
// Unicode single-quote variants → ascii apostrophe.
const SQUOTE_RE = /[‘’‚‛′´‵]/g;
// Unicode double-quote variants → ascii quote.
const DQUOTE_RE = /[“”„‟″«»]/g;

/**
 * normalizeText — normalize a string for case-insensitive phrase matching.
 *   - lowercases,
 *   - maps unicode dashes/quotes to their ascii equivalents,
 *   - collapses any run of whitespace to a single space,
 *   - trims leading/trailing whitespace.
 *
 * Non-string input (null/undefined/number) yields "".
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeText(s) {
  if (s == null) return '';
  let str = typeof s === 'string' ? s : String(s);
  str = str
    .replace(DASH_RE, '-')
    .replace(SQUOTE_RE, "'")
    .replace(DQUOTE_RE, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return str;
}

// ── phrase matching ──────────────────────────────────────────────────────────

// A "word char" for token-boundary purposes: ascii letters, digits, underscore.
// We deliberately do NOT include the hyphen, so "non-randomized" is matched as
// the literal phrase "non-randomized" and "rat" cannot bleed across a hyphen.
function isWordChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * findPhraseMatches — locate every token-boundary-aligned, case-insensitive
 * occurrence of `phrase` inside the ALREADY-normalized `normText`.
 *
 * Boundaries are only enforced on the word-char edges of the phrase, so phrases
 * whose own first/last character is non-word (rare) still match. Internal
 * structure of the phrase (spaces, hyphens) is matched literally after both
 * sides have been normalized identically.
 *
 * @param {string} normText  text already run through normalizeText
 * @param {string} normPhrase phrase already run through normalizeText
 * @returns {Array<{ start: number, end: number, len: number }>} offsets into normText
 */
function findPhraseMatches(normText, normPhrase) {
  const out = [];
  const pLen = normPhrase.length;
  if (!pLen || !normText) return out;

  const startsWord = isWordChar(normPhrase[0]);
  const endsWord = isWordChar(normPhrase[pLen - 1]);

  let from = 0;
  let idx;
  while ((idx = normText.indexOf(normPhrase, from)) !== -1) {
    const end = idx + pLen;
    const leftOk = !startsWord || idx === 0 || !isWordChar(normText[idx - 1]);
    const rightOk =
      !endsWord || end === normText.length || !isWordChar(normText[end]);
    if (leftOk && rightOk) out.push({ start: idx, end, len: pLen });
    from = idx + 1; // permit overlapping candidate positions
  }
  return out;
}

/**
 * recordSearchText — assemble a record's searchable text:
 *   title + " " + abstract + " " + keywords
 * Missing fields are treated as "". `keywords` may be an array (joined with
 * spaces) or a string.
 *
 * @param {object} record
 * @returns {string}
 */
function recordSearchText(record) {
  if (!record || typeof record !== 'object') return '';
  const title = typeof record.title === 'string' ? record.title : '';
  const abstract = typeof record.abstract === 'string' ? record.abstract : '';
  let keywords = '';
  if (Array.isArray(record.keywords)) keywords = record.keywords.join(' ');
  else if (typeof record.keywords === 'string') keywords = record.keywords;
  return `${title} ${abstract} ${keywords}`;
}

/**
 * recordContainsKeyword — true if `record`'s searchable text contains `keyword`
 * as a whole, case-insensitive, token-boundary-aware phrase (at least once).
 *
 * Examples:
 *   "controlled trial"  matches  "...a controlled trial of..."   (phrase)
 *   "rat"            does NOT match  "operate" / "iterate"        (boundaries)
 *   "non-randomized" matches  "Non‑Randomized design"            (unicode dash)
 *
 * @param {object} record
 * @param {string} keyword
 * @returns {boolean}
 */
export function recordContainsKeyword(record, keyword) {
  const normPhrase = normalizeText(keyword);
  if (!normPhrase) return false;
  const normText = normalizeText(recordSearchText(record));
  if (!normText) return false;
  return findPhraseMatches(normText, normPhrase).length > 0;
}

// ── counting ─────────────────────────────────────────────────────────────────

/**
 * countArticlesByKeyword — for each keyword, count how many ARTICLES (records)
 * contain that keyword at least once. Multiple occurrences within one article
 * still count as 1 (article-level, not occurrence-level).
 *
 * Returns a plain object mapping the ORIGINAL keyword string -> integer count.
 * Complexity is O(records × keywords), which is acceptable here.
 *
 * @param {object[]} records
 * @param {string[]} keywords
 * @returns {Object<string, number>}
 */
export function countArticlesByKeyword(records, keywords) {
  const counts = {};
  const recs = Array.isArray(records) ? records : [];
  const kws = Array.isArray(keywords) ? keywords : [];
  if (!kws.length) return counts;

  // Pre-normalize each record's text once (perf + correctness).
  const normTexts = recs.map(r => normalizeText(recordSearchText(r)));

  for (const keyword of kws) {
    const normPhrase = normalizeText(keyword);
    let n = 0;
    if (normPhrase) {
      for (const normText of normTexts) {
        if (normText && findPhraseMatches(normText, normPhrase).length > 0) n += 1;
      }
    }
    // Keyed by the original keyword string so callers can correlate.
    counts[keyword] = n;
  }
  return counts;
}

// ── filtering ────────────────────────────────────────────────────────────────

/**
 * filterRecordsByKeywords — keep records that match the selected keywords.
 *
 * DEFAULT MODE IS "OR": a record passes if it contains ANY one of the selected
 * keywords. Pass options.mode === 'AND' to require that a record contain ALL of
 * the selected keywords instead.
 *
 * An empty (or missing) selectedKeywords list is a no-op: the original records
 * array is returned UNCHANGED (same reference) — no filtering is applied.
 *
 * @param {object[]} records
 * @param {string[]} selectedKeywords
 * @param {{ mode?: 'OR'|'AND' }} [options]
 * @returns {object[]}
 */
export function filterRecordsByKeywords(records, selectedKeywords, options = {}) {
  const recs = Array.isArray(records) ? records : [];
  const selected = Array.isArray(selectedKeywords) ? selectedKeywords : [];
  // Empty selection → return all records unchanged (default OR semantics make an
  // empty "any" trivially permissive; we make that explicit here).
  if (selected.length === 0) return records;

  const mode = String(options.mode || 'OR').toUpperCase() === 'AND' ? 'AND' : 'OR';

  // Normalize phrases once; drop blanks so a stray "" doesn't poison AND mode.
  const normPhrases = selected
    .map(k => normalizeText(k))
    .filter(Boolean);
  if (normPhrases.length === 0) return records;

  return recs.filter(record => {
    const normText = normalizeText(recordSearchText(record));
    if (!normText) return false;
    if (mode === 'AND') {
      return normPhrases.every(p => findPhraseMatches(normText, p).length > 0);
    }
    // OR (default): any one match is enough.
    return normPhrases.some(p => findPhraseMatches(normText, p).length > 0);
  });
}

// ── highlight segments (data-only, XSS-safe) ────────────────────────────────

/**
 * buildHighlightSegments — split `text` into contiguous segments for safe React
 * rendering. Each segment is { text, type } where type is one of
 * 'plain' | 'include' | 'exclude'.
 *
 * INVARIANT: concatenating every segment.text in order exactly reconstructs the
 * original input `text` (no characters dropped, none added). This makes it safe
 * to render each segment as a plain React text node — there are NO HTML strings
 * and no innerHTML, so it is XSS-safe by construction.
 *
 * Matching is case-insensitive and phrase-aware (token boundaries, punctuation-
 * tolerant) — the same matcher used elsewhere in this module, run against a
 * normalized COPY of the text while preserving original offsets (normalization
 * here is structure-preserving: it only lowercases and maps single-char unicode
 * dashes/quotes to single ascii chars, so character indices stay aligned).
 *
 * Overlap rules:
 *   - Longer phrase matches win over shorter overlapping ones.
 *   - When an include span and an exclude span cover the same characters, the
 *     `priority` option decides the winner: 'exclude' (default) => exclude wins
 *     (red), 'include' => include wins (green).
 *
 * @param {string} text
 * @param {{ includeTerms?: string[], excludeTerms?: string[], priority?: 'exclude'|'include' }} [opts]
 * @returns {Array<{ text: string, type: 'plain'|'include'|'exclude' }>}
 */
export function buildHighlightSegments(
  text,
  { includeTerms = [], excludeTerms = [], priority = 'exclude' } = {}
) {
  if (typeof text !== 'string' || text.length === 0) return [];

  const includes = Array.isArray(includeTerms) ? includeTerms : [];
  const excludes = Array.isArray(excludeTerms) ? excludeTerms : [];
  if (includes.length === 0 && excludes.length === 0) {
    return [{ text, type: 'plain' }];
  }

  // Structure-preserving normalization: lowercase + single-char unicode dash/
  // quote → single ascii char. Crucially this is a per-character 1:1 mapping, so
  // offsets in `normText` line up exactly with offsets in the original `text`.
  // (We do NOT collapse whitespace here — that would shift offsets.)
  const normText = text
    .replace(DASH_RE, '-')
    .replace(SQUOTE_RE, "'")
    .replace(DQUOTE_RE, '"')
    .toLowerCase();

  // Gather candidate matches. Phrases are normalized with the FULL normalizeText
  // (which also collapses internal whitespace); since real keyword phrases use
  // single spaces this keeps phrase length aligned with how they appear in text.
  const candidates = [];
  for (const term of includes) {
    const np = normalizeText(term);
    if (!np) continue;
    for (const m of findPhraseMatches(normText, np)) {
      candidates.push({ start: m.start, end: m.end, len: m.len, type: 'include' });
    }
  }
  for (const term of excludes) {
    const np = normalizeText(term);
    if (!np) continue;
    for (const m of findPhraseMatches(normText, np)) {
      candidates.push({ start: m.start, end: m.end, len: m.len, type: 'exclude' });
    }
  }

  if (candidates.length === 0) return [{ text, type: 'plain' }];

  const excludeWins = String(priority).toLowerCase() !== 'include';

  // Greedy claiming priority:
  //   1. longer match wins (more specific phrase),
  //   2. on equal length, the `priority`-favoured type wins the tie/overlap,
  //   3. then earlier start position (stable, deterministic).
  candidates.sort((a, b) => {
    if (a.len !== b.len) return b.len - a.len;
    if (a.type !== b.type) {
      const aWins = excludeWins ? a.type === 'exclude' : a.type === 'include';
      return aWins ? -1 : 1;
    }
    return a.start - b.start;
  });

  const claimed = new Array(text.length).fill(false);
  const chosen = [];
  for (const c of candidates) {
    let free = true;
    for (let i = c.start; i < c.end; i++) {
      if (claimed[i]) { free = false; break; }
    }
    if (!free) continue;
    for (let i = c.start; i < c.end; i++) claimed[i] = true;
    chosen.push(c);
  }

  chosen.sort((a, b) => a.start - b.start);

  // Stitch into contiguous segments over the ORIGINAL text, filling the gaps
  // between matches with 'plain' segments so the full text is reconstructable.
  const segments = [];
  let cursor = 0;
  for (const c of chosen) {
    if (c.start > cursor) {
      segments.push({ text: text.slice(cursor, c.start), type: 'plain' });
    }
    segments.push({ text: text.slice(c.start, c.end), type: c.type });
    cursor = c.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), type: 'plain' });
  }
  return segments;
}
