/**
 * robFullText.js — best-effort CLIENT-SIDE full-text extraction for the guided
 * RoB appraisal (P14).
 *
 * It REUSES the existing pdf.js pipeline (the same `pdfjs-dist/legacy` build the
 * universal AppPdfViewer loads, whose off-thread worker is already configured when
 * the RoB workspace is mounted) and the existing screening PDF attachment routes —
 * it introduces NO new PDF system and NO new server endpoint. Given a study's
 * screening record (screenProjectId + recordId), it resolves the attached PDF,
 * fetches its bytes with the session cookie, and concatenates each page's
 * `getTextContent()` items into one string.
 *
 * BEST-EFFORT by design: if the study has no linked screening record, no attached
 * PDF, the download fails, or the bytes are not a PDF, it resolves to empty text —
 * the caller then sends an empty `fullText` and the server appraises title +
 * abstract only (its `coverage` reports "no full text"). It NEVER throws.
 */
import { screeningApi } from '../screening/api-client/screeningApi.js';

// Cap the number of pages scanned so a very long PDF cannot freeze the tab; the
// signalling-question cues live in the methods/results, comfortably within this.
const MAX_PAGES = 80;

/** First bytes of a PDF are "%PDF-" — guards against an HTML/JSON error body. */
function isPdfBytes(buf) {
  try {
    const a = new Uint8Array(buf.slice(0, 5));
    return a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46 && a[4] === 0x2d;
  } catch { return false; }
}

/**
 * Extract the full text of a study's attached PDF, if any.
 * @param {{ screenProjectId?:string, recordId?:string }} args
 * @returns {Promise<{ text:string, pages:number, source:'fullText'|'none', reason?:string }>}
 */
export async function extractStudyFullText({ screenProjectId, recordId } = {}) {
  if (!screenProjectId || !recordId) return { text: '', pages: 0, source: 'none', reason: 'no-record' };
  try {
    const listing = await screeningApi.listPdf(screenProjectId, recordId).catch(() => null);
    const attachment = (listing && listing.attachments && listing.attachments[0]) || null;
    if (!attachment) return { text: '', pages: 0, source: 'none', reason: 'no-pdf' };

    const url = screeningApi.pdfDownloadUrl(screenProjectId, recordId, attachment.id);
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return { text: '', pages: 0, source: 'none', reason: 'download-failed' };
    const buf = await res.arrayBuffer();
    if (!isPdfBytes(buf)) return { text: '', pages: 0, source: 'none', reason: 'not-pdf' };

    // Lazy-load pdf.js (already bundled + worker-configured by AppPdfViewer) so this
    // heavy dependency only loads when a reviewer actually runs an appraisal.
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
    }
    try { await doc.cleanup?.(); doc.destroy?.(); } catch { /* best-effort */ }

    const text = parts.join('\n\n').replace(/[ \t]+/g, ' ').trim();
    return text
      ? { text, pages: total, source: 'fullText' }
      : { text: '', pages: total, source: 'none', reason: 'empty-text' };
  } catch {
    return { text: '', pages: 0, source: 'none', reason: 'error' };
  }
}
