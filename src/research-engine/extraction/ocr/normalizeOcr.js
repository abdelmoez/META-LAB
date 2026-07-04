/**
 * extraction/ocr/normalizeOcr.js — RoadMap/4.md §24.4 (output shape) + §24.5 (cache key).
 * Normalize Tesseract.js OCR word output to the SAME positioned-text item contract the
 * pdf.js grid pipeline consumes (normalizeItems → itemsToRows → buildGrid in the sibling
 * pdfTextGrid.js), so OCR words and text-layer items compose in one grid.
 *
 * COORDINATE MAPPING
 *   Tesseract words arrive in IMAGE/canvas PIXEL space: origin top-left, y grows DOWN,
 *   bbox = { x0, y0, x1, y1 } with (x0,y0) the top-left corner and (x1,y1) the
 *   bottom-right. pdf.js items live in PDF USER space: y grows UP with a BASELINE
 *   origin. A rendered pdf.js viewport maps user → canvas as
 *     canvasX = userX × scale,  canvasY = (viewport.height − userY × scale)
 *   so the inverse applied here is
 *     x = x0 / scale,  y = (viewport.height − y1) / scale     (bbox BOTTOM ≈ baseline)
 *     w = (x1 − x0) / scale,  h = (y1 − y0) / scale
 *   A word near the image TOP (small y0/y1) therefore maps to a LARGE user-space y —
 *   exactly what itemsToRows expects (visually-first row has the largest y).
 *
 *   FALLBACK (no viewport): a documented identity-with-y-flip using opts.pageHeight —
 *   scale is treated as 1 and yUser = pageHeight − y1. When pageHeight is also absent
 *   or non-finite it defaults to 0 (y = −y1), which still preserves the top-row-first
 *   ordering the grid relies on.
 *
 * DETERMINISM / SAFETY (repo-wide extraction rules)
 *   Pure functions of their inputs — no DOM, no pdf.js import, no Date.now(), no
 *   Math.random(), no I/O. Same input → byte-identical output (coordinates are rounded
 *   to 4 decimals for stability). Malformed input NEVER throws: bad words are skipped,
 *   a non-array input returns [].
 *
 * EXPORTS
 *   normalizeOcrWords(words, opts?) — Tesseract words → pdf.js-contract items (§24.4)
 *   cacheKey(parts)                 — deterministic OCR cache key string (§24.5)
 *   OCR_MODES                       — the two supported recognition modes (§24.3)
 */

/** §24.3 — the two supported OCR modes ('text' general, 'digits' for ticks/cells). */
export const OCR_MODES = Object.freeze(['text', 'digits']);

/** Round to 4 decimals so repeated float pipelines stay byte-identical. */
function round4(v) {
  return Math.round(v * 10000) / 10000;
}

/**
 * normalizeOcrWords(words, opts?) — map Tesseract.js word objects to the normalized
 * positioned-text item contract used by pdfTextGrid.normalizeItems (§24.4).
 *
 * @param {Array<{text:string, confidence:number, bbox:{x0:number,y0:number,x1:number,y1:number}}>} words
 *   Tesseract.js words in image/canvas pixel space (y grows DOWN, origin top-left)
 * @param {{
 *   page?: number,
 *   viewport?: {width:number, height:number, scale:number},
 *   pageHeight?: number
 * }} [opts]
 *   viewport maps pixels → PDF user space; without it, the identity-with-y-flip
 *   fallback uses pageHeight (see module header). page defaults to 1.
 * @returns {Array<{str:string, x:number, y:number, w:number, h:number, source:'ocr', confidence:number, page:number}>}
 *   Words with empty/whitespace text or a non-finite bbox are skipped. Never throws.
 */
export function normalizeOcrWords(words, opts = {}) {
  if (!Array.isArray(words)) return [];
  const o = opts && typeof opts === 'object' ? opts : {};
  const page = Number.isFinite(Number(o.page)) ? Number(o.page) : 1;

  const vp = o.viewport && typeof o.viewport === 'object' ? o.viewport : null;
  const vpHeight = vp ? Number(vp.height) : NaN;
  const vpScale = vp ? Number(vp.scale) : NaN;
  const useViewport = Number.isFinite(vpHeight) && Number.isFinite(vpScale) && vpScale > 0;

  const pageHeightRaw = Number(o.pageHeight);
  const pageHeight = Number.isFinite(pageHeightRaw) ? pageHeightRaw : 0;

  const out = [];
  for (const word of words) {
    if (!word || typeof word !== 'object') continue;
    const str = typeof word.text === 'string' ? word.text : '';
    if (!str.trim()) continue;

    const bbox = word.bbox;
    if (!bbox || typeof bbox !== 'object') continue;
    const x0 = Number(bbox.x0);
    const y0 = Number(bbox.y0);
    const x1 = Number(bbox.x1);
    const y1 = Number(bbox.y1);
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue;

    let x;
    let y;
    let w;
    let h;
    if (useViewport) {
      x = x0 / vpScale;
      y = (vpHeight - y1) / vpScale;
      w = (x1 - x0) / vpScale;
      h = (y1 - y0) / vpScale;
    } else {
      // Documented fallback: identity with y-flip about opts.pageHeight (scale 1).
      x = x0;
      y = pageHeight - y1;
      w = x1 - x0;
      h = y1 - y0;
    }
    w = Math.max(0, w);
    h = Math.max(0, h);

    const confRaw = Number(word.confidence);
    const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(100, confRaw)) : 0;

    out.push({
      str,
      x: round4(x),
      y: round4(y),
      w: round4(w),
      h: round4(h),
      source: 'ocr',
      confidence,
      page,
    });
  }
  return out;
}

/**
 * cacheKey(parts) — deterministic OCR cache key (§24.5): PDF fingerprint + page +
 * mode + Tesseract version + rendering scale, joined into one stable string. Missing
 * or malformed parts fold to '' so the key is always a string and never throws.
 *
 * @param {{pdfFingerprint?:string, page?:number, mode?:string, tessVersion?:string, scale?:number}} parts
 * @returns {string} e.g. 'ocr|abc123|2|text|5.0.4|1.5'
 */
export function cacheKey(parts) {
  const p = parts && typeof parts === 'object' ? parts : {};
  // Percent-encode each field so an in-field '|' (or any delimiter) cannot alias two
  // distinct part-sets to the same key — the join stays injective and deterministic.
  const field = (v) => encodeURIComponent(v == null ? '' : String(v));
  return ['ocr', field(p.pdfFingerprint), field(p.page), field(p.mode), field(p.tessVersion), field(p.scale)].join('|');
}
