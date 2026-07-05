/**
 * extraction/numberTokens.js — PURE, DOM-free number-token snapper for click-assign
 * smart capture. pdf.js hands us a text-run string and a click character offset; we
 * must return the FULL token under the cursor, never a fragment. This module knows
 * nothing about pdf.js, the DOM, the clock, or randomness: it is a deterministic
 * function of (string, offset). Same input -> byte-identical output.
 *
 * The numeric-pattern spirit is borrowed from patternExtract.js / pdfTextGrid.js
 * (NUMERIC_CELL_PATTERNS) but nothing is imported from those DOM-adjacent paths — a
 * few tiny regex constants are duplicated on purpose so this file stays importable
 * server-side with zero dependencies.
 *
 * TOKEN SHAPE
 *   token = { text, start, end, kind, value?, lo?, hi?, est?, a?, b? }
 *     text   the literal characters covered (thousands commas KEPT: "1,234")
 *     start  0-based character offset of the first character (inclusive)
 *     end    character offset one PAST the last character (exclusive); the token
 *            covers [start, end), so text === runStr.slice(start, end)
 *     kind   'number' | 'percent' | 'range' | 'ratioCI' | 'pair' | 'meanSd'
 *
 *   KIND -> extra fields (numeric fields strip thousands commas + treat U+2212 as '-')
 *     number   value          "1,234" · "12.3" · "-3" · "+1.5"      -> value
 *     percent  value          "12.3%" (value is the numeric percent, 12.3)
 *     range    lo, hi         "1.05–2.67" · "0.95 to 1.08" · "−0.5–1.2"
 *     ratioCI  est, lo, hi    "1.05 (95% CI 0.89–1.24)" · "1.05 (0.89-1.24)"
 *     pair     a, b           "12/34" (events/total, n/N)
 *     meanSd   a, b           "5.2 ± 1.1" (a=mean, b=sd); the '±'/'+/-' SD form is
 *                             NEVER read as a range
 *
 * RICHNESS (overlap resolution)
 *   When several tokens cover the same characters we keep the RICHEST:
 *     ratioCI (5) > meanSd (4) = pair (4) > range (3) > percent (2) > number (1)
 *   So clicking anywhere inside "1.05 (95% CI 0.89–1.24)" returns the full ratioCI
 *   triplet, while clicking the bare "0.89" inside a plain range returns the range.
 *
 * EXPORTS
 *   snapNumberToken(runStr, offset) -> token | null
 *       Expand outward from the clicked offset to the whole token; prefer the richest
 *       token that CONTAINS the offset. Clicking whitespace / a gap returns null.
 *   findNumberTokens(runStr) -> token[]
 *       Every non-overlapping token left-to-right; richest-match wins on overlap.
 *   parseNumberList(runStr) -> number[]
 *       Convenience: the numeric value of every bare number literal, left-to-right
 *       (ignores structure — "0.95 to 1.08" -> [0.95, 1.08]).
 *
 * DETERMINISM / SAFETY
 *   No I/O, no clock, no randomness. Non-string input -> null / []. Never throws.
 */

/* ── Shared regex fragments (all ASCII; unicode via \uXXXX escapes) ────────── */

// Integer with optional thousands commas: 1,234 / 1234 (events/total operands).
const INT = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)';
// Number with optional thousands commas and optional decimals: 1,234 / 1234 / 12.3
const NUM = INT + '(?:\\.\\d+)?';
// Optional leading sign: hyphen-minus, plus, or unicode minus (U+2212).
const SIGN = '[-+\\u2212]';
const SIGNED = '(?:' + SIGN + ')?' + NUM;
// Dash characters usable as a range separator: hyphen, en dash, em dash, U+2212.
const DASH = '[-\\u2013\\u2014\\u2212]';
// Range separator, captured WITH surrounding whitespace so the ambiguity rule can
// inspect spacing. Covers a dash or the word " to ".
const SEP = '(\\s*' + DASH + '\\s*|\\s+to\\s+)';
// "95% CI" / "95% confidence interval" head (optional inside a ratioCI paren).
const CI_LABEL = '(?:\\d{1,2}(?:\\.\\d+)?\\s*%\\s*(?:CI|[Cc]onfidence\\s+[Ii]nterval)s?\\b[\\s:,]*)?';

const RICH = { ratioCI: 5, meanSd: 4, pair: 4, range: 3, percent: 2, number: 1 };

// Fresh RegExp objects (module-level, reused with an explicit lastIndex reset).
const RE_NUMBER = new RegExp(SIGNED, 'g');
const RE_PERCENT = new RegExp('(' + SIGNED + ')\\s*%', 'g');
const RE_RANGE = new RegExp('(' + SIGNED + ')' + SEP + '(' + SIGNED + ')', 'gi');
// Inside a parenthetical CI the bounds may ALSO be comma/semicolon-separated —
// "1.05 (0.89, 1.24)" is the common journal form (4.md §13.3). The comma requires a
// trailing space so a thousands-grouped "(1,240)" never reads as a bound pair; comma
// stays EXCLUDED from bare RE_RANGE (outside parens "3, 5" is a list, not a CI).
const RSEP = '(\\s*' + DASH + '\\s*|\\s+to\\s+|\\s*[,;]\\s+)';
const RE_RATIO = new RegExp(
  '(' + NUM + ')\\s*\\(\\s*' + CI_LABEL + '(' + SIGNED + ')' + RSEP + '(' + SIGNED + ')\\s*\\)',
  'gi'
);
const RE_PAIR = new RegExp('(' + INT + ')\\s*/\\s*(' + INT + ')', 'g');
const RE_MEANSD = new RegExp('(' + SIGNED + ')\\s*(?:\\u00b1|\\+/[-\\u2212])\\s*(' + NUM + ')', 'g');

const UNICODE_MINUS_RE = /−/g;

/* ── Public API ───────────────────────────────────────────────────────────── */

/**
 * snapNumberToken(runStr, offset) — the full token under a click.
 * Expands from the clicked character offset outward to cover the whole token even
 * when the offset lands mid-token, returning the RICHEST token that contains it.
 * @param {string} runStr  the pdf.js text-run string
 * @param {number} offset  0-based character offset of the click
 * @returns {object|null}  a token (see file header), or null on whitespace/gap/bad input
 */
export function snapNumberToken(runStr, offset) {
  if (typeof runStr !== 'string' || !runStr) return null;
  const off = Math.floor(Number(offset));
  if (!Number.isFinite(off) || off < 0 || off >= runStr.length) return null;
  let best = null;
  for (const c of collectCandidates(runStr)) {
    if (off < c.start || off >= c.end) continue; // does not contain the click
    if (best === null || cmp(c, best) < 0) best = c;
  }
  return best ? toToken(best) : null;
}

/**
 * findNumberTokens(runStr) — every non-overlapping token, left-to-right.
 * Richest-match wins on overlap (a ratioCI suppresses the range and numbers inside).
 * @param {string} runStr
 * @returns {object[]} tokens ordered by `start`
 */
export function findNumberTokens(runStr) {
  if (typeof runStr !== 'string' || !runStr) return [];
  const cands = collectCandidates(runStr).sort(cmp); // richest first
  const kept = [];
  for (const c of cands) {
    if (kept.some((k) => c.start < k.end && k.start < c.end)) continue; // overlaps a kept token
    kept.push(c);
  }
  kept.sort((a, b) => a.start - b.start || b.rich - a.rich);
  return kept.map(toToken);
}

/**
 * parseNumberList(runStr) — numeric value of every bare number literal, in order.
 * @param {string} runStr
 * @returns {number[]}
 */
export function parseNumberList(runStr) {
  if (typeof runStr !== 'string' || !runStr) return [];
  return scanNumbers(runStr).map((n) => n.value);
}

/* ── Candidate collection ─────────────────────────────────────────────────── */

/**
 * collectCandidates(s) — every raw match of every kind, as flat candidate records
 * { kind, start, end, text, rich, seq, ...extra }. Overlaps are resolved by the
 * caller (snap / find) using `cmp`, so this stays a pure harvest.
 */
function collectCandidates(s) {
  const cands = [];
  let seq = 0;
  const push = (kind, start, end, extra) => {
    cands.push({ kind, start, end, text: s.slice(start, end), rich: RICH[kind], seq: seq++, ...extra });
  };

  // number — bare numeric literals (sign dropped when it is really a separator).
  for (const n of scanNumbers(s)) push('number', n.start, n.end, { value: n.value });

  // percent — "12.3%".
  RE_PERCENT.lastIndex = 0;
  for (let m; (m = RE_PERCENT.exec(s)); ) {
    if (m.index === RE_PERCENT.lastIndex) RE_PERCENT.lastIndex++;
    const value = toNum(m[1]);
    if (value === null) continue;
    push('percent', m.index, m.index + m[0].length, { value });
  }

  // ratioCI — "1.05 (95% CI 0.89–1.24)" / "1.05 (0.89-1.24)".
  RE_RATIO.lastIndex = 0;
  for (let m; (m = RE_RATIO.exec(s)); ) {
    if (m.index === RE_RATIO.lastIndex) RE_RATIO.lastIndex++;
    const est = toNum(m[1]);
    const lo = toNum(m[2]);
    const hi = toNum(m[4]);
    if (est === null || lo === null || hi === null) continue;
    if (lo > hi) continue; // a descending CI is a false positive
    push('ratioCI', m.index, m.index + m[0].length, { est, lo, hi });
  }

  // range — "1.05–2.67" / "0.95 to 1.08" (with the negative-hyphen ambiguity rule).
  RE_RANGE.lastIndex = 0;
  for (let m; (m = RE_RANGE.exec(s)); ) {
    if (m.index === RE_RANGE.lastIndex) RE_RANGE.lastIndex++;
    const loRaw = m[1];
    const sepRaw = m[2];
    const spaced = /^\s/.test(sepRaw) && /\s$/.test(sepRaw);
    // "-0.5-1.2": a plain UNSPACED hyphen after a negative low bound is ambiguous.
    if (sepRaw.trim() === '-' && (loRaw[0] === '-' || loRaw[0] === '−') && !spaced) continue;
    const lo = toNum(loRaw);
    const hi = toNum(m[3]);
    if (lo === null || hi === null) continue;
    push('range', m.index, m.index + m[0].length, { lo, hi });
  }

  // pair — "12/34" events/total, n/N.
  RE_PAIR.lastIndex = 0;
  for (let m; (m = RE_PAIR.exec(s)); ) {
    if (m.index === RE_PAIR.lastIndex) RE_PAIR.lastIndex++;
    const start = m.index;
    const end = start + m[0].length;
    if (start > 0 && s[start - 1] === '/') continue; // "…/12/34" date chain
    if (s[end] === '/') continue; // "05/12/2020" date chain
    if (s[end] === '.' && /\d/.test(s[end + 1] || '')) continue; // "12/45.6" decimal
    const a = toNum(m[1]);
    const b = toNum(m[2]);
    if (a === null || b === null) continue;
    push('pair', start, end, { a, b });
  }

  // meanSd — "5.2 ± 1.1" / "5.2 +/- 1.1" (NEVER a range).
  RE_MEANSD.lastIndex = 0;
  for (let m; (m = RE_MEANSD.exec(s)); ) {
    if (m.index === RE_MEANSD.lastIndex) RE_MEANSD.lastIndex++;
    const a = toNum(m[1]);
    const b = toNum(m[2]);
    if (a === null || b === null) continue;
    push('meanSd', m.index, m.index + m[0].length, { a, b });
  }

  return cands;
}

/**
 * scanNumbers(s) — every bare number literal as { start, end, text, value }.
 * A leading sign is dropped when the preceding character is a digit, because there
 * it is a separator ("3-4" -> 3 and 4, not 3 and -4), not the number's own sign.
 */
function scanNumbers(s) {
  const out = [];
  RE_NUMBER.lastIndex = 0;
  for (let m; (m = RE_NUMBER.exec(s)); ) {
    if (m.index === RE_NUMBER.lastIndex) RE_NUMBER.lastIndex++;
    let start = m.index;
    let text = m[0];
    const first = text[0];
    if ((first === '-' || first === '+' || first === '−') && start > 0 && /\d/.test(s[start - 1])) {
      start += 1;
      text = text.slice(1);
    }
    if (!text) continue;
    const value = toNum(text);
    if (value === null) continue;
    out.push({ start, end: start + text.length, text, value });
  }
  return out;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * cmp(a, b) — order candidates richest-first: higher richness, then longer span,
 * then earlier start, then earlier discovery. Used both to break overlap ties in
 * findNumberTokens and to pick the winning token in snapNumberToken.
 */
function cmp(a, b) {
  return (
    b.rich - a.rich ||
    (b.end - b.start) - (a.end - a.start) ||
    a.start - b.start ||
    a.seq - b.seq
  );
}

/** toToken(c) — project an internal candidate to the public token shape. */
function toToken(c) {
  const t = { text: c.text, start: c.start, end: c.end, kind: c.kind };
  if (c.kind === 'number' || c.kind === 'percent') t.value = c.value;
  else if (c.kind === 'range') {
    t.lo = c.lo;
    t.hi = c.hi;
  } else if (c.kind === 'ratioCI') {
    t.est = c.est;
    t.lo = c.lo;
    t.hi = c.hi;
  } else if (c.kind === 'pair' || c.kind === 'meanSd') {
    t.a = c.a;
    t.b = c.b;
  }
  return t;
}

/** toNum(s) — Number with thousands commas stripped and U+2212 treated as minus. */
function toNum(s) {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (!str) return null;
  const ascii = str.replace(UNICODE_MINUS_RE, '-').replace(/,/g, '');
  const n = Number(ascii);
  return Number.isFinite(n) ? n : null;
}
