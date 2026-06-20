/**
 * pdfSearch.js — prompt39 follow-up. Pure, unit-testable helpers for the
 * AppPdfViewer lazy full-text search. Kept out of the component so the matching
 * logic and the abortable page-scan can be tested without pdf.js / a browser.
 */

/** Flatten a pdf.js page text-content object into one lowercased string. */
export function pageTextFromContent(content) {
  if (!content || !Array.isArray(content.items)) return '';
  return content.items.map((it) => (it && it.str) || '').join(' ').toLowerCase();
}

/** Does a (already-extracted) page's text contain the term? Case-insensitive. */
export function pageMatches(pageText, term) {
  const q = String(term || '').toLowerCase();
  if (!q) return false;
  return String(pageText || '').toLowerCase().includes(q);
}

/**
 * Scan pages 1..numPages for `term`, returning the 1-based page numbers that
 * contain it. ABORTABLE and RESILIENT:
 *  - `getPageText(i)` supplies (and may cache) the page text; a thrown/failed
 *    page is treated as empty text, never aborting the whole scan.
 *  - `isAborted()` is checked before each page; when it returns true the scan
 *    stops and returns `null` (signalling "discarded — do not apply results").
 *  - `onProgress(done, total)` is called after each page (optional).
 * Returns `number[]` of matching pages, or `null` if aborted.
 */
export async function collectMatchingPages({ numPages, getPageText, term, isAborted, onProgress } = {}) {
  const q = String(term || '').toLowerCase();
  const hits = [];
  if (!q || !numPages || typeof getPageText !== 'function') return hits;
  for (let i = 1; i <= numPages; i++) {
    if (typeof isAborted === 'function' && isAborted()) return null;
    let txt = '';
    try { txt = await getPageText(i); } catch { txt = ''; }
    if (pageMatches(txt, q)) hits.push(i);
    if (typeof onProgress === 'function') onProgress(i, numPages);
  }
  return hits;
}

/* ════════════════════════════════════════════════════════════════════════════
   prompt42 Task 6 — Chrome-like LIVE search with per-occurrence highlighting.
   These pure helpers find EVERY occurrence (with offset + length) so the viewer
   can wrap each one in the text layer, count them, and navigate between them with
   match-case / whole-word options. Kept pure + browser-free so they are unit-
   tested without pdf.js. The legacy page-level helpers above are unchanged.
   ════════════════════════════════════════════════════════════════════════════ */

/** Escape a user string so it can be embedded literally inside a RegExp. */
export function escapeRegExp(s) {
  return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find every occurrence of `term` in `text`, returning ordered, NON-OVERLAPPING
 * matches as { index, length } (character offsets into `text`). Pure + safe:
 *  - empty term / text  → []
 *  - matchCase=false (default) → case-insensitive
 *  - wholeWord=true → the term must sit on word boundaries (\b), so "diabetes"
 *    does NOT match inside "diabetess"; punctuation/space count as boundaries.
 * Used BOTH for the cross-page match index (over pdf.js text items) and for
 * wrapping matches in the rendered text-layer spans, so counts always agree.
 */
export function findMatchesInText(text, term, { matchCase = false, wholeWord = false } = {}) {
  const hay = String(text == null ? '' : text);
  const needle = String(term == null ? '' : term);
  if (!hay || !needle) return [];
  const flags = matchCase ? 'g' : 'gi';
  const core = escapeRegExp(needle);
  // \b is unreliable next to non-word chars in the term; anchor with explicit
  // non-word lookarounds so a term that starts/ends with a word char is bounded
  // and a term that doesn't (e.g. "≥") still matches.
  const pattern = wholeWord ? `(?<![\\p{L}\\p{N}_])${core}(?![\\p{L}\\p{N}_])` : core;
  let re;
  try { re = new RegExp(pattern, flags + 'u'); }
  catch { re = new RegExp(core, flags); } // very old engines without lookbehind/unicode
  const out = [];
  let m;
  while ((m = re.exec(hay)) !== null) {
    out.push({ index: m.index, length: m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width (defensive)
    if (out.length > 5000) break;                 // sanity cap per page
  }
  return out;
}

/** Total occurrences of `term` across an array of pdf.js text items (item.str). */
export function countMatchesInItems(items, term, options) {
  if (!Array.isArray(items)) return 0;
  let n = 0;
  for (const it of items) n += findMatchesInText((it && it.str) || '', term, options).length;
  return n;
}
