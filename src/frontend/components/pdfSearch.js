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
