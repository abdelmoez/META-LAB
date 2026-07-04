/**
 * extraction/patternExtract.js — P5+. Deterministic regex harvesting of statistics
 * from article text. The richer sibling of heuristicExtract.js: instead of proposing
 * one value per Data Element, it sweeps a text once and reports EVERY recognizable
 * statistical token, each anchored to its containing sentence so a human can verify.
 * It NEVER invents a value — every Match points at literal characters in the input.
 *
 * OUTPUT
 *   extractStats(text) -> Match[] ordered by index (position in the text).
 *   Match = { kind, value, index, length, excerpt }
 *     kind    'nEq' | 'eventsTotal' | 'meanSd' | 'ci' | 'ratioCI' | 'pValue'
 *             | 'percent' | 'followup' | 'doi' | 'pmid'
 *     value   kind-specific shape (see table below)
 *     index   0-based character offset of the match in the input
 *     length  character length of the matched span
 *     excerpt trimmed text of the sentence containing the match (splitSentences)
 *
 * KINDS + VALUE SHAPES
 *   nEq         { n }                    "n = 123", "N=1,234"
 *   eventsTotal { events, total }        "12/45", "12 of 45"
 *   meanSd      { mean, sd }             "12.3 +/- 4.5" (unicode plus-minus too),
 *                                        "12.3 (SD 4.5)", "12.3 (SD: 4.5)"
 *   ci          { lo, hi, level }        "95% CI 1.2 to 3.4", "95% CI: 1.2-3.4",
 *                                        "(95% CI, 1.2-3.4)" with hyphen/en/em dash,
 *                                        "95% confidence interval 1.2 to 3.4"
 *   ratioCI     { measure, est, lo, hi, adjusted }
 *                                        "HR 0.75 (95% CI 0.60-0.94)",
 *                                        "adjusted OR: 1.32; 95% CI, 1.01 to 1.72",
 *                                        "aHR = 0.8, 95% CI 0.7-0.9"
 *   pValue      { p, op }                "p = 0.03", "P<0.001", "p = .04"
 *   percent     { pct }                  "45.2%" (a CI level like "95% CI" is NOT
 *                                        reported as a percent)
 *   followup    { text, amount, unit }   "followed for 24 months",
 *                                        "12-month follow-up",
 *                                        "median follow-up of 3 years"
 *                                        (unit is lowercase singular)
 *   doi         { doi }                  "10.1001/jama.2020.12345" (trailing
 *                                        punctuation stripped)
 *   pmid        { pmid }                 "PMID: 12345678" (kept as a string id)
 *
 * REJECTION RULES (conservative by design)
 *   eventsTotal  events > total or total = 0; '%' immediately after; date-like
 *                slash chains ("05/12/2020"), month/year pairs ("12/2020"), and a
 *                decimal continuation ("12/45.6"); a dose/unit token right after
 *                ("120/80 mmHg", "5/325 mg").
 *   ci           ambiguous negative range: when the low bound starts with a plain
 *                hyphen AND the separator is a plain UNSPACED hyphen ("-0.5-1.2")
 *                the parse is ambiguous -> dropped. "-0.5 to 1.2", "-0.5 - 1.2"
 *                (spaced) and "−0.5–1.2" (unicode minus / en dash) are
 *                unambiguous -> kept.
 *   ratioCI      requires lo <= est <= hi and all three > 0, else dropped.
 *   pValue       p must be <= 1 (an impossible p is a false positive).
 *
 * NUMBERS may carry thousands commas ("1,234"); negatives accept both hyphen-minus
 * and the unicode minus sign (U+2212).
 *
 * DEDUP
 *   Overlapping matches of the SAME kind keep the first (earliest) one. Different
 *   kinds may overlap on purpose: "45/100 patients (45%)" yields one eventsTotal
 *   and one percent; "HR 0.75 (95% CI ...)" yields one ratioCI and one ci.
 *
 * DETERMINISM
 *   Pure function of its input; no I/O, no randomness, no clock. Same input ->
 *   byte-identical output. Malformed input never throws — falsy/non-string -> [].
 */

import { splitSentences } from './heuristicExtract.js';

/* ── Shared regex fragments (all ASCII; unicode via \uXXXX escapes) ────────── */

// A number with optional thousands commas and optional decimals: 1,234 / 1234 / 12.3
const NUM_SRC = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
// Integer only (thousands commas allowed).
const INT_SRC = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)';
// Optionally signed number; sign is hyphen-minus or unicode minus (U+2212).
const SIGNED_SRC = '(?:[-\\u2212])?' + NUM_SRC;
// Range separator between CI bounds; captured whole (with whitespace) so the
// ambiguity rule can inspect spacing. Covers "to", hyphen, en dash, em dash, comma.
const RANGE_SEP_SRC = '(\\s+to\\s+|\\s*[-\\u2013\\u2014,]\\s*)';
// "95% CI" / "95% confidence interval" head; captures the level.
const CI_LABEL_SRC =
  '(\\d{1,2}(?:\\.\\d+)?)\\s*%\\s*(?:CI|[Cc]onfidence\\s+[Ii]nterval)s?\\b[\\s:,]*';
const TIME_UNIT_SRC = '(day|days|week|weeks|month|months|year|years)';

// Dose / pressure / time unit token right after an a/b pair -> not events/total.
const DOSE_UNIT_AFTER = new RegExp(
  '^\\s{0,4}(?:mg|mcg|\\u00b5g|ug|g|kg|ml|dl|l|iu|u|mmhg|mmol|mol|meq|units?|min(?:utes?)?|h(?:ou)?rs?|h)\\b',
  'i'
);
const PERCENT_AFTER = /^\s{0,4}%/;

/* ── Main entry ───────────────────────────────────────────────────────────── */

/**
 * extractStats(text) — harvest every recognizable statistic from a text.
 * @param {string} text
 * @returns {Array<{kind:string, value:object, index:number, length:number, excerpt:string}>}
 *   ordered by index; [] for falsy/non-string input.
 */
export function extractStats(text) {
  const src = coerce(text);
  if (!src.trim()) return [];
  const sentences = splitSentences(src);
  const all = [
    ...matchNEq(src, sentences),
    ...matchEventsTotal(src, sentences),
    ...matchMeanSd(src, sentences),
    ...matchCi(src, sentences),
    ...matchRatioCi(src, sentences),
    ...matchPValue(src, sentences),
    ...matchPercent(src, sentences),
    ...matchFollowup(src, sentences),
    ...matchDoi(src, sentences),
    ...matchPmid(src, sentences),
  ];
  return dedupeSameKind(all);
}

/* ── Per-kind matchers (each exported for standalone use/tests) ───────────── */

/** nEq — "n = 123", "N=1,234" → { n }. */
export function matchNEq(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  const re = new RegExp('\\b[nN]\\s*=\\s*(' + INT_SRC + ')\\b', 'g');
  return runPattern(re, src, sents, 'nEq', (m) => {
    const end = m.index + m[0].length;
    // "n = 0.5" — the integer regex stopped at the decimal point; not an N.
    if (src[end] === '.' && /\d/.test(src[end + 1] || '')) return null;
    const n = toInt(m[1]);
    return n === null ? null : { value: { n } };
  });
}

/** eventsTotal — "12/45", "12 of 45" → { events, total } (see rejection rules). */
export function matchEventsTotal(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  const out = [];

  const guard = (m, events, total, slashForm) => {
    if (events === null || total === null) return false;
    if (total === 0 || events > total) return false;
    const end = m.index + m[0].length;
    const before = m.index > 0 ? src[m.index - 1] : '';
    const tail = src.slice(end, end + 24);
    if (before === '/' || before === '.') return false; // date chain / decimal prefix
    if (PERCENT_AFTER.test(tail)) return false; // "20/30%"
    if (DOSE_UNIT_AFTER.test(tail)) return false; // "120/80 mmHg", "5/325 mg"
    if (src[end] === '.' && /\d/.test(src[end + 1] || '')) return false; // "12/45.6"
    if (slashForm) {
      if (src[end] === '/') return false; // "05/12/2020"
      if (total >= 1900 && total <= 2100 && events <= 31) return false; // "12/2020"
    }
    return true;
  };

  const reSlash = new RegExp('\\b(' + INT_SRC + ')\\s*/\\s*(' + INT_SRC + ')\\b', 'g');
  out.push(
    ...runPattern(reSlash, src, sents, 'eventsTotal', (m) => {
      const events = toInt(m[1]);
      const total = toInt(m[2]);
      return guard(m, events, total, true) ? { value: { events, total } } : null;
    })
  );

  const reOf = new RegExp('\\b(' + INT_SRC + ')\\s+of\\s+(' + INT_SRC + ')\\b', 'gi');
  out.push(
    ...runPattern(reOf, src, sents, 'eventsTotal', (m) => {
      const events = toInt(m[1]);
      const total = toInt(m[2]);
      return guard(m, events, total, false) ? { value: { events, total } } : null;
    })
  );

  return dedupeSameKind(out);
}

/** meanSd — "12.3 +/- 4.5" (or U+00B1), "12.3 (SD 4.5)", "12.3 (SD: 4.5)" → { mean, sd }. */
export function matchMeanSd(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  const out = [];

  const build = (m) => {
    const mean = toNum(m[1]);
    const sd = toNum(m[2]);
    if (mean === null || sd === null) return null;
    return { value: { mean, sd } };
  };

  const rePm = new RegExp(
    '(' + SIGNED_SRC + ')\\s*(?:\\u00b1|\\+/[-\\u2212])\\s*(' + NUM_SRC + ')',
    'g'
  );
  out.push(...runPattern(rePm, src, sents, 'meanSd', build));

  const reParen = new RegExp(
    '(' + SIGNED_SRC + ')\\s*\\(\\s*[Ss][Dd]\\s*[:=]?\\s*(' + NUM_SRC + ')\\s*\\)',
    'g'
  );
  out.push(...runPattern(reParen, src, sents, 'meanSd', build));

  return dedupeSameKind(out);
}

/** ci — "95% CI 1.2 to 3.4" and variants → { lo, hi, level }. */
export function matchCi(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  const re = new RegExp(
    '\\b' + CI_LABEL_SRC + '(' + SIGNED_SRC + ')' + RANGE_SEP_SRC + '(' + SIGNED_SRC + ')',
    'g'
  );
  // groups: 1 level, 2 lo, 3 sep, 4 hi
  return runPattern(re, src, sents, 'ci', (m) => {
    const bounds = parseRange(m[2], m[3], m[4]);
    if (!bounds) return null;
    const level = toNum(m[1]);
    if (level === null) return null;
    return { value: { lo: bounds.lo, hi: bounds.hi, level } };
  });
}

/** ratioCI — "HR 0.75 (95% CI 0.60-0.94)", "aOR = 1.3, 95% CI 1.1-1.6" →
 *  { measure, est, lo, hi, adjusted }. Requires 0 < lo <= est <= hi. */
export function matchRatioCi(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  // Case-sensitive measure tokens (OR/RR/HR/IRR) so the English word "or" and
  // "hr" (hour) never match. The bare "a" prefix (aHR/aOR) must be attached;
  // "adj"/"adjusted" may be separated by space or hyphen.
  const re = new RegExp(
    '\\b(?:([Aa]djusted|[Aa]dj\\.?)[\\s-]*|(a))?(OR|RR|HR|IRR)\\b\\s*[:=]?\\s*(' +
      NUM_SRC +
      ')[\\s,;:]*\\(?\\s*' +
      CI_LABEL_SRC +
      '(' +
      SIGNED_SRC +
      ')' +
      RANGE_SEP_SRC +
      '(' +
      SIGNED_SRC +
      ')',
    'g'
  );
  // groups: 1 adjusted-word, 2 attached 'a', 3 measure, 4 est, 5 level, 6 lo, 7 sep, 8 hi
  return runPattern(re, src, sents, 'ratioCI', (m) => {
    const est = toNum(m[4]);
    const bounds = parseRange(m[6], m[7], m[8]);
    if (est === null || !bounds) return null;
    const { lo, hi } = bounds;
    if (!(lo > 0 && hi > 0 && est > 0)) return null;
    if (!(lo <= est && est <= hi)) return null;
    return { value: { measure: m[3], est, lo, hi, adjusted: !!(m[1] || m[2]) } };
  });
}

/** pValue — "p = 0.03", "P<0.001", "p = .04" → { p, op } with op in =|<|>. */
export function matchPValue(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  const re = /\b[Pp](?:\s*-?\s*[Vv]alue)?\s*([=<>])\s*(\d+(?:\.\d+)?|\.\d+)/g;
  return runPattern(re, src, sents, 'pValue', (m) => {
    const p = toNum(m[2]);
    if (p === null || p > 1) return null; // an impossible p is a false positive
    return { value: { p, op: m[1] } };
  });
}

/** percent — "45.2%" → { pct }. A CI level ("95% CI ...") is NOT a percent. */
export function matchPercent(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  const re = new RegExp(
    '(' + SIGNED_SRC + ')\\s*%(?!\\s*(?:[Cc][Ii]\\b|[Cc]onfidence\\b))',
    'g'
  );
  return runPattern(re, src, sents, 'percent', (m) => {
    const pct = toNum(m[1]);
    return pct === null ? null : { value: { pct } };
  });
}

/** followup — "followed for 24 months", "12-month follow-up", "median follow-up
 *  of 3 years" → { text, amount, unit } (unit lowercase singular). */
export function matchFollowup(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  const out = [];

  const build = (m) => {
    const amount = toNum(m[1]);
    if (amount === null) return null;
    const unit = m[2].toLowerCase().replace(/s$/, '');
    return { value: { text: m[0].trim(), amount, unit } };
  };

  // "followed for 12 months", "median follow-up of 3 years"
  const re1 = new RegExp(
    '\\b(?:(?:median|mean)\\s+)?follow(?:ed\\b|[\\s-]?up\\b)[^.?!]{0,40}?\\b(' +
      NUM_SRC +
      ')\\s*' +
      TIME_UNIT_SRC +
      '\\b',
    'gi'
  );
  out.push(...runPattern(re1, src, sents, 'followup', build));

  // "12-month follow-up", "3 year follow up"
  const re2 = new RegExp(
    '\\b(' + NUM_SRC + ')[\\s-]*' + TIME_UNIT_SRC + '[\\s-]*follow[\\s-]?up\\b',
    'gi'
  );
  out.push(...runPattern(re2, src, sents, 'followup', build));

  return dedupeSameKind(out);
}

/** doi — "10.xxxx/..." → { doi } with trailing punctuation stripped. */
export function matchDoi(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  const re = /\b10\.\d{4,9}\/[^\s]+/g;
  return runPattern(re, src, sents, 'doi', (m) => {
    const doi = m[0].replace(/[.,;:!?)\]}>"']+$/, '');
    const slash = doi.indexOf('/');
    if (slash < 0 || slash === doi.length - 1) return null; // nothing after the slash
    return { value: { doi }, length: doi.length };
  });
}

/** pmid — "PMID: 12345678" → { pmid } (string identifier). */
export function matchPmid(text, sentences) {
  const src = coerce(text);
  if (!src) return [];
  const sents = sentences || splitSentences(src);
  const re = /\bPMID\s*:?\s*(\d{1,9})\b/gi;
  return runPattern(re, src, sents, 'pmid', (m) => ({ value: { pmid: m[1] } }));
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function coerce(t) {
  return typeof t === 'string' ? t : '';
}

/** Run a /g regex over the text; build(m) returns { value, index?, length? } or null. */
function runPattern(re, text, sentences, kind, build) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
    const built = build(m);
    if (!built) continue;
    const index = built.index === undefined ? m.index : built.index;
    const length = built.length === undefined ? m[0].length : built.length;
    out.push({
      kind,
      value: built.value,
      index,
      length,
      excerpt: excerptFor(sentences, index, text, length),
    });
  }
  return out;
}

/** excerptFor — the trimmed text of the sentence containing character `pos`. */
function excerptFor(sentences, pos, text, length) {
  for (const s of sentences) {
    if (pos >= s.start && pos < s.end) return s.text;
  }
  if (sentences.length) return sentences[sentences.length - 1].text;
  return text.slice(pos, pos + length).trim();
}

/**
 * parseRange(loRaw, sepRaw, hiRaw) — parse two CI bounds around a captured
 * separator, applying the negative-range ambiguity rule: a low bound that starts
 * with a plain hyphen joined by a plain UNSPACED hyphen ("-0.5-1.2") is ambiguous
 * and dropped; spaced hyphens, "to", commas, en/em dashes, and the unicode minus
 * are unambiguous. Returns { lo, hi } or null.
 */
function parseRange(loRaw, sepRaw, hiRaw) {
  const sepCore = sepRaw.trim();
  const spaced = /^\s/.test(sepRaw) && /\s$/.test(sepRaw);
  if (sepCore === '-' && loRaw.charAt(0) === '-' && !spaced) return null;
  const lo = toNum(loRaw);
  const hi = toNum(hiRaw);
  if (lo === null || hi === null) return null;
  return { lo, hi };
}

/**
 * dedupeSameKind(matches) — global ordering + same-kind overlap dedupe.
 * Sorts by index (stable on the original insertion order), then drops any match
 * whose span overlaps an already-kept match OF THE SAME KIND (first one wins).
 * Different kinds may overlap freely.
 */
function dedupeSameKind(matches) {
  const order = matches.map((m, i) => ({ m, i }));
  order.sort((a, b) => a.m.index - b.m.index || a.i - b.i);
  const maxEndByKind = Object.create(null);
  const kept = [];
  for (const { m } of order) {
    const maxEnd = maxEndByKind[m.kind];
    if (maxEnd !== undefined && m.index < maxEnd) continue; // overlaps a kept match
    maxEndByKind[m.kind] = m.index + m.length;
    kept.push(m);
  }
  return kept;
}

const UNICODE_MINUS_RE = new RegExp('\\u2212', 'g');

/** toNum — Number with thousands commas stripped and U+2212 treated as minus. */
function toNum(s) {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (!str) return null;
  const ascii = str.replace(UNICODE_MINUS_RE, '-');
  const n = Number(ascii.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** toInt — like toNum but integers only. */
function toInt(s) {
  const n = toNum(s);
  return n !== null && Number.isInteger(n) ? n : null;
}
