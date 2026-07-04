/**
 * extraction/cellGrammar.js — RoadMap/4.md §13. The SINGLE shared parser for cell
 * values and click-assign token snapping. Every extraction path (table extraction,
 * click-assign, OCR-derived text, prose corroboration) parses numbers HERE, so a
 * confidence interval, a p-value inequality, or a missing marker means the same
 * thing everywhere. Pure, dependency-free (no DOM, no clock, no randomness, no
 * pdf.js) — importable server-side, client-side, and from unit tests. Same input →
 * byte-identical output. NEVER throws for any input (§13.2).
 *
 * This module OWNS the discriminated ParsedCell contract (§10.3 / C3). It reuses the
 * lower-level offset-token snapper in numberTokens.js for click geometry (snapToken)
 * but adds the cell-level kinds numberTokens lacks: P (inequality preserved), MISSING,
 * the count+percentage composite PCT, and the "N of N" word form — and it discriminates
 * INT vs FLOAT. It replaces the divergent ad-hoc parsers (TableRegionMapper.parseNumCell
 * / splitCI, AssistedExtractionPanel.firstNumber) that this repo previously scattered
 * across components.
 *
 * PARSEDCELL SHAPE (parseCell) — raw ALWAYS preserved; null for unparseable text:
 *   { kind:'INT',     value, raw }
 *   { kind:'FLOAT',   value, raw }
 *   { kind:'PCT',     pct, count?, raw }        // "12 (9.6%)" → {pct:9.6, count:12}
 *   { kind:'N_OF_N',  numerator, denominator, raw }
 *   { kind:'MEAN_SD', mean, sd, raw }
 *   { kind:'CI',      low, high, raw, warning? }// reversed bounds PRESERVED + warned
 *   { kind:'P',       operator, value, raw }    // '<','≤','>','≥','=' | '' preserved
 *   { kind:'MISSING', marker, raw }             // NR / NA / N/A / — / - / not reported
 *
 * The whole cell must be consumed (aside from surrounding whitespace/brackets) for a
 * single-value kind to win — "SIRS 2.24" is NOT an INT, it is unparseable at the cell
 * level (click-assign uses snapToken for mid-string tokens; cells are whole values).
 */

import { snapNumberToken, findNumberTokens } from './numberTokens.js';

/* ── Character classes (all via \uXXXX so the file is ASCII-safe) ──────────── */

const NBSP_RE = /[   ]/g;            // non-breaking / figure / narrow-nbsp spaces
const UNICODE_MINUS_RE = /[−]/g;               // U+2212 MINUS SIGN → '-'
const DASH_CLASS = '[\\u002d\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212]'; // hyphen..em + minus

/** Missing-data markers (whole-cell, case-insensitive). A lone dash is MISSING only
 *  when it is the entire cell — never a minus sign or a CI separator. */
const MISSING_MARKERS = ['nr', 'na', 'n/a', 'nd', 'ns', 'not reported', 'not available', 'not applicable', 'not stated'];
const DASH_ONLY_RE = new RegExp('^' + DASH_CLASS + '+$');

/* ── Number primitives ─────────────────────────────────────────────────────── */

// Signed number with optional thousands commas AND optional leading-dot decimals
// (".56"): integer-with-commas | bare integer | leading-dot decimal, each with
// optional fractional part and optional scientific exponent.
const SIGN = '[+\\-\\u2212]?';
const MAG = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+)';
const EXP = '(?:[eE][+\\-]?\\d+)?';
const NUMBER_SRC = SIGN + MAG + EXP;
const NUMBER_RE = new RegExp('^' + NUMBER_SRC + '$');
const INT_RE = new RegExp('^' + SIGN + '(?:\\d{1,3}(?:,\\d{3})+|\\d+)$'); // no dot, no exponent

/** toNum(s) — Number with NBSP stripped, thousands commas removed, U+2212 → '-'. */
function toNum(s) {
  if (s == null) return null;
  const str = String(s).replace(NBSP_RE, ' ').trim();
  if (!str) return null;
  const ascii = str.replace(UNICODE_MINUS_RE, '-').replace(/,/g, '');
  if (!/^[+\-]?(?:\d|\.)/.test(ascii)) return null; // must start number-like
  const n = Number(ascii);
  return Number.isFinite(n) ? n : null;
}

/** clean(raw) — normalize whitespace/NBSP for matching; the ORIGINAL raw is kept. */
function clean(raw) {
  return String(raw).replace(NBSP_RE, ' ').replace(/\s+/g, ' ').trim();
}

/* ── Per-kind matchers (each returns a ParsedCell body or null; raw added by caller) ── */

const RE_PCT_COMPOUND = new RegExp('^(' + NUMBER_SRC + ')\\s*[\\(\\[\\{]\\s*(' + NUMBER_SRC + ')\\s*%\\s*[\\)\\]\\}]$');
const RE_PCT_BARE = new RegExp('^(' + NUMBER_SRC + ')\\s*%$');
const RE_N_OF_N_SLASH = new RegExp('^(' + SIGN + '\\d[\\d,]*)\\s*/\\s*(\\d[\\d,]*)$');
const RE_N_OF_N_WORD = new RegExp('^(\\d[\\d,]*)\\s+of\\s+(\\d[\\d,]*)$', 'i');
const RE_MEAN_SD = new RegExp('^(' + NUMBER_SRC + ')\\s*(?:\\u00b1|\\+/[-\\u2212])\\s*(' + NUMBER_SRC + ')$');
const RE_CI_BARE = new RegExp('^(' + NUMBER_SRC + ')\\s*(?:' + DASH_CLASS + '|to)\\s*(' + NUMBER_SRC + ')$', 'i');
const RE_CI_BRACKET = new RegExp('^[\\(\\[\\{]\\s*(' + NUMBER_SRC + ')\\s*(?:,|;|' + DASH_CLASS + '|to)\\s*(' + NUMBER_SRC + ')\\s*[\\)\\]\\}]$', 'i');
const RE_P = new RegExp('^p\\s*(<=|>=|≤|≥|<|>|=)?\\s*(' + NUMBER_SRC + ')$', 'i');
const RE_P_BARE_OP = new RegExp('^(<=|>=|≤|≥|<|>|=)\\s*(' + NUMBER_SRC + ')$'); // "<0.001" with no leading p

/** normalizeOp(op) — fold operator spellings to a single glyph; '' = plain equality. */
function normalizeOp(op) {
  if (!op) return '';
  const t = op.trim();
  if (t === '<=' || t === '≤') return '≤';
  if (t === '>=' || t === '≥') return '≥';
  if (t === '<' || t === '>' || t === '=') return t;
  return '';
}

/* ── Public: parseCell ─────────────────────────────────────────────────────── */

/**
 * parseCell(raw) — parse ONE table cell / value string to a discriminated ParsedCell,
 * or null when the whole cell is not a recognizable value. Never throws; raw preserved.
 *
 * Ordering matters (most specific first): MISSING → PCT-compound → CI-bracket →
 * N_OF_N → MEAN_SD → P → PCT-bare → CI-bare → INT/FLOAT. This prevents e.g. "12/34"
 * being read as a FLOAT or "1.40–3.57" as two numbers.
 *
 * @param {*} raw
 * @returns {object|null}
 */
export function parseCell(raw) {
  if (raw == null) return null;
  const rawStr = String(raw);
  const s = clean(rawStr);
  if (!s) return null;

  // MISSING — a lone dash, or a known marker as the whole cell.
  const low = s.toLowerCase();
  if (DASH_ONLY_RE.test(s) || MISSING_MARKERS.includes(low)) {
    return { kind: 'MISSING', marker: s, raw: rawStr };
  }

  let m;

  // PCT compound: "12 (9.6%)" / "12 [9.6%]" — count + percentage both preserved.
  if ((m = s.match(RE_PCT_COMPOUND))) {
    const count = toNum(m[1]);
    const pct = toNum(m[2]);
    if (count !== null && pct !== null) return { kind: 'PCT', pct, count, raw: rawStr };
  }

  // CI bracketed: "(1.40, 3.57)" / "[1.40–3.57]" / "{1.40 to 3.57}".
  if ((m = s.match(RE_CI_BRACKET))) {
    const low2 = toNum(m[1]);
    const high2 = toNum(m[2]);
    if (low2 !== null && high2 !== null) return ciCell(low2, high2, rawStr);
  }

  // N of N: "64/125" or "64 of 125".
  if ((m = s.match(RE_N_OF_N_SLASH)) || (m = s.match(RE_N_OF_N_WORD))) {
    const numerator = toNum(m[1]);
    const denominator = toNum(m[2]);
    if (numerator !== null && denominator !== null) {
      return { kind: 'N_OF_N', numerator, denominator, raw: rawStr };
    }
  }

  // Mean ± SD: "15.7 ± 2.1" / "15.7 +/- 2.1".
  if ((m = s.match(RE_MEAN_SD))) {
    const mean = toNum(m[1]);
    const sd = toNum(m[2]);
    if (mean !== null && sd !== null) return { kind: 'MEAN_SD', mean, sd, raw: rawStr };
  }

  // P value: "p<0.001" / "P = 0.03" / "<0.001" / "0.032".
  if ((m = s.match(RE_P)) || (m = s.match(RE_P_BARE_OP))) {
    const operator = normalizeOp(m[1]);
    const value = toNum(m[2]);
    if (value !== null) return { kind: 'P', operator, value, raw: rawStr };
  }

  // PCT bare: "9.6%".
  if ((m = s.match(RE_PCT_BARE))) {
    const pct = toNum(m[1]);
    if (pct !== null) return { kind: 'PCT', pct, raw: rawStr };
  }

  // CI bare: "1.40–3.57" / "1.40 to 3.57" (guarded against a signed single number).
  if ((m = s.match(RE_CI_BARE))) {
    const low2 = toNum(m[1]);
    const high2 = toNum(m[2]);
    // "-3" must not read as a CI (empty high). A bare "1.40-3.57" that is really a
    // negative range still parses; a single "-0.37" cannot match RE_CI_BARE (no 2nd num).
    if (low2 !== null && high2 !== null) return ciCell(low2, high2, rawStr);
  }

  // INT / FLOAT — the whole cell is a single number.
  if (NUMBER_RE.test(s)) {
    const value = toNum(s);
    if (value !== null) {
      const isInt = INT_RE.test(s.replace(/\s/g, ''));
      return { kind: isInt ? 'INT' : 'FLOAT', value, raw: rawStr };
    }
  }

  return null;
}

/** ciCell(low, high, raw) — build a CI cell; reversed bounds are PRESERVED with a
 *  warning, NEVER silently reordered (§13.1). */
function ciCell(low, high, raw) {
  const cell = { kind: 'CI', low, high, raw };
  if (low > high) cell.warning = 'lower bound exceeds upper bound';
  return cell;
}

/* ── Public: snapToken (click-assign) ──────────────────────────────────────── */

/**
 * snapToken(str, clickOffset, selectionRange?) — the token a user meant when they
 * clicked (or selected) inside a text run. Delegates geometry to numberTokens; adds
 * cell-grammar awareness for P-values and nearest-token fallback.
 *
 * @param {string} str            the text-run string
 * @param {number} clickOffset    0-based character offset of the click
 * @param {{start:number,end:number}} [selectionRange]  an explicit selection span
 * @returns {object|null} a token (numberTokens shape) possibly upgraded with pKind
 *
 * Cases (§13.3): clicking 2.24 → number 2.24; selecting "2.24 (1.40–3.57)" → ratioCI
 * composite; clicking n=64 → number 64; 1,024 → 1024; 12.5% → percent; <0.001 → a P
 * token that retains the operator; clicking near punctuation snaps to the nearest
 * token within a small window; empty/non-numeric returns null.
 */
export function snapToken(str, clickOffset, selectionRange) {
  if (typeof str !== 'string' || !str) return null;

  // Explicit selection: return the richest token fully covered by the selection.
  if (selectionRange && Number.isFinite(selectionRange.start) && Number.isFinite(selectionRange.end)) {
    const a = Math.min(selectionRange.start, selectionRange.end);
    const b = Math.max(selectionRange.start, selectionRange.end);
    const covered = findNumberTokens(str).filter((t) => t.start >= a - 1 && t.end <= b + 1);
    if (covered.length) {
      // Prefer a composite (ratioCI) spanning the selection, else the widest token.
      covered.sort((x, y) => (rich(y) - rich(x)) || ((y.end - y.start) - (x.end - x.start)));
      return upgradeP(str, covered[0]);
    }
  }

  const off = Math.floor(Number(clickOffset));
  if (!Number.isFinite(off)) return null;

  // Direct hit — only when the offset genuinely lands inside the run.
  if (off >= 0 && off < str.length) {
    const tok = snapNumberToken(str, off);
    if (tok) return upgradeP(str, tok);
  }

  // Nearest-token fallback: scan a small window either side of the click for the
  // closest token (so a click on the '(' or a space next to a value still snaps).
  const WINDOW = 3;
  const all = findNumberTokens(str);
  let best = null;
  let bestDist = Infinity;
  for (const t of all) {
    const dist = off < t.start ? t.start - off : off >= t.end ? off - (t.end - 1) : 0;
    if (dist <= WINDOW && dist < bestDist) {
      best = t;
      bestDist = dist;
    }
  }
  return best ? upgradeP(str, best) : null;
}

/** upgradeP(str, tok) — if a bare-number token is immediately preceded by a p-value
 *  operator ("<0.001", "p<0.001", "≤0.05"), annotate it as a P token so click-assign
 *  keeps the inequality. Returns the token (possibly with pOperator set). */
function upgradeP(str, tok) {
  if (!tok || (tok.kind !== 'number' && tok.kind !== 'percent')) return tok;
  const before = str.slice(0, tok.start);
  const m = before.match(/(<=|>=|≤|≥|<|>|=)\s*(?:p\s*)?$/i) || before.match(/p\s*(<=|>=|≤|≥|<|>|=)?\s*$/i);
  if (m && m[1]) {
    return { ...tok, kind: 'p', pOperator: normalizeOp(m[1]), value: tok.value };
  }
  return tok;
}

function rich(t) {
  const R = { ratioCI: 5, meanSd: 4, pair: 4, range: 3, percent: 2, p: 2, number: 1 };
  return R[t.kind] || 0;
}
