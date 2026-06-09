/**
 * highlight.js — META·SIFT Beta abstract/title highlighting.
 * Pure functions, no database, no side effects.
 *
 * Given a body of text and inclusion/exclusion phrase lists, produces a sorted,
 * non-overlapping set of character ranges to highlight. Matching is
 * case-insensitive and word-boundary aware (never highlights inside a larger
 * word). When candidate matches collide, the LONGER match wins; on an exact tie
 * exclusion wins (the stronger, safety-oriented signal).
 */

/**
 * escapeRegExp — escape a string for safe literal use inside a RegExp.
 * @param {string} s
 * @returns {string}
 */
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A "word char" for boundary purposes: letters, digits, underscore. We define
// our own boundary check instead of \b so that phrases starting/ending in
// non-word characters (e.g. "covid-19") still behave intuitively.
function isWordChar(ch) {
  return /[A-Za-z0-9]/.test(ch);
}

/**
 * findMatches — locate every word-boundary-aligned, case-insensitive occurrence
 * of `term` in `text`. Boundaries are enforced only on word-char edges of the
 * term, so terms whose own edges are non-word (e.g. punctuation) still match.
 *
 * @param {string} text
 * @param {string} term
 * @param {'inclusion'|'exclusion'} type
 * @returns {Array<{start,end,type,len}>}
 */
function findMatches(text, term, type) {
  const out = [];
  if (!term) return out;
  const lcText = text.toLowerCase();
  const lcTerm = term.toLowerCase();
  const tLen = lcTerm.length;
  if (tLen === 0) return out;

  const termStartsWord = isWordChar(lcTerm[0]);
  const termEndsWord = isWordChar(lcTerm[tLen - 1]);

  let from = 0;
  let idx;
  while ((idx = lcText.indexOf(lcTerm, from)) !== -1) {
    const end = idx + tLen;
    // Left boundary: only enforce if the term begins with a word char.
    const leftOk =
      !termStartsWord || idx === 0 || !isWordChar(lcText[idx - 1]);
    // Right boundary: only enforce if the term ends with a word char.
    const rightOk =
      !termEndsWord || end === lcText.length || !isWordChar(lcText[end]);
    if (leftOk && rightOk) {
      out.push({ start: idx, end, type, len: tLen });
    }
    from = idx + 1; // allow overlapping candidate positions
  }
  return out;
}

/**
 * computeHighlightRanges — produce sorted, non-overlapping highlight ranges.
 *
 * @param {string} text
 * @param {{ inclusion?: string[], exclusion?: string[] }} terms
 * @returns {Array<{ start:number, end:number, type:'inclusion'|'exclusion' }>}
 */
export function computeHighlightRanges(text, { inclusion = [], exclusion = [] } = {}) {
  if (!text || typeof text !== 'string') return [];
  if ((!inclusion || !inclusion.length) && (!exclusion || !exclusion.length)) {
    return [];
  }

  // Gather all candidate matches from both lists.
  const candidates = [];
  for (const term of inclusion || []) {
    candidates.push(...findMatches(text, term, 'inclusion'));
  }
  for (const term of exclusion || []) {
    candidates.push(...findMatches(text, term, 'exclusion'));
  }
  if (!candidates.length) return [];

  // Priority ordering for greedy claiming:
  //   1. longer match wins (more specific phrase)
  //   2. on equal length, exclusion wins (safety)
  //   3. then earlier start position
  candidates.sort((a, b) => {
    if (a.len !== b.len) return b.len - a.len;
    if (a.type !== b.type) return a.type === 'exclusion' ? -1 : 1;
    return a.start - b.start;
  });

  // Greedily claim character spans; reject any candidate overlapping a claimed
  // span. `claimed` tracks per-character occupancy.
  const claimed = new Array(text.length).fill(false);
  const chosen = [];
  for (const c of candidates) {
    let free = true;
    for (let i = c.start; i < c.end; i++) {
      if (claimed[i]) { free = false; break; }
    }
    if (!free) continue;
    for (let i = c.start; i < c.end; i++) claimed[i] = true;
    chosen.push({ start: c.start, end: c.end, type: c.type });
  }

  // Return sorted by position for a clean, render-ready set.
  chosen.sort((a, b) => a.start - b.start);
  return chosen;
}
