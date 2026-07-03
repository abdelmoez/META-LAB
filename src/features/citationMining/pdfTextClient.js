/**
 * pdfTextClient.js — CLIENT-SIDE text extraction for a user-selected seed-review
 * file. It REUSES the exact same pdf.js pipeline as the RoB guided-appraisal
 * extractor (src/frontend/rob/robFullText.js): the bundled
 * `pdfjs-dist/legacy/build/pdf.min.mjs` build with its off-thread worker, read
 * page-by-page via `getTextContent()`. The difference is only the source — here it
 * is an <input type=file> File (the seed review the user uploads) rather than an
 * attached screening PDF. The extracted text is POSTed to the server, which parses
 * the reference list with the pure engine; the raw PDF never leaves the browser.
 *
 * BEST-EFFORT + honest: never throws. A .txt file is decoded as UTF-8 text; a PDF
 * is parsed with pdf.js; anything else resolves to empty text with a `reason` the
 * caller can surface. `onProgress(done,total)` drives the upload progress UI.
 */

// Cap pages so a huge PDF can't freeze the tab; a reference list sits at the end,
// but we scan generously (references can span many pages in a long review).
const MAX_PAGES = 200;

/** First bytes of a PDF are "%PDF-". */
function isPdfBytes(buf) {
  try {
    const a = new Uint8Array(buf.slice(0, 5));
    return a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46 && a[4] === 0x2d;
  } catch { return false; }
}

/**
 * extractTextFromFile(file, { onProgress })
 * @returns {Promise<{ text:string, pages:number, kind:'pdf'|'text'|'none', reason?:string }>}
 */
export async function extractTextFromFile(file, { onProgress } = {}) {
  if (!file) return { text: '', pages: 0, kind: 'none', reason: 'no-file' };
  let buf;
  try { buf = await file.arrayBuffer(); } catch { return { text: '', pages: 0, kind: 'none', reason: 'read-failed' }; }

  const looksTxt = /\.txt$/i.test(file.name || '') || (file.type || '').startsWith('text/');
  if (!isPdfBytes(buf)) {
    if (looksTxt) {
      try {
        const text = new TextDecoder('utf-8').decode(new Uint8Array(buf)).trim();
        return text ? { text, pages: 0, kind: 'text' } : { text: '', pages: 0, kind: 'none', reason: 'empty-text' };
      } catch { return { text: '', pages: 0, kind: 'none', reason: 'decode-failed' }; }
    }
    return { text: '', pages: 0, kind: 'none', reason: 'not-pdf' };
  }

  try {
    // Lazy-load pdf.js (same build + worker config as AppPdfViewer / robFullText) so
    // this heavy dependency only loads when a user actually uploads a seed review.
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
    const task = pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false });
    const doc = await task.promise;
    const total = Math.min(doc.numPages || 0, MAX_PAGES);
    const parts = [];
    for (let p = 1; p <= total; p++) {
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        parts.push((content.items || []).map((it) => (it && it.str) || '').join(' '));
      } catch { /* skip an unreadable page, keep the rest */ }
      try { onProgress && onProgress(p, total); } catch { /* ignore */ }
    }
    try { await doc.cleanup?.(); doc.destroy?.(); } catch { /* best-effort */ }

    const text = parts.join('\n\n').replace(/[ \t]+/g, ' ').trim();
    return text
      ? { text, pages: total, kind: 'pdf' }
      : { text: '', pages: total, kind: 'none', reason: 'empty-text' };
  } catch {
    return { text: '', pages: 0, kind: 'none', reason: 'error' };
  }
}

export default extractTextFromFile;
