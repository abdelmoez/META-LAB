/**
 * renderRegion.js — RoadMap/1.md. Render a rectangular REGION of a pdf.js page to a
 * PNG data URL, so the local plot digitizer can work on a crisp crop of a figure.
 * The region is expressed in PDF USER SPACE (x right from left, y UP from the page
 * bottom) — the same space AppPdfViewer's region-select reports.
 *
 * Deterministic, no network (the caller supplies the already-loaded pdf.js `doc`).
 */

/**
 * @param {object} doc      a pdf.js PDFDocumentProxy (from AppPdfViewer onDocLoaded)
 * @param {number} pageNum  1-based page number
 * @param {{x0,y0,x1,y1}} region  PDF user-space rectangle (y up; y0<y1)
 * @param {{scale?:number, maxWidth?:number}} [opts]
 * @returns {Promise<{dataUrl:string, width:number, height:number}>}
 */
export async function renderRegionToDataUrl(doc, pageNum, region, opts = {}) {
  if (!doc) throw new Error('No PDF document.');
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1, rotation: 0 });
  const Hp = base.height;

  // Pick a render scale that makes the region reasonably large (min ~2×), capped so
  // the crop width stays near maxWidth for a sharp but bounded canvas.
  const regionW = Math.max(1, region.x1 - region.x0);
  const maxWidth = opts.maxWidth || 900;
  let scale = opts.scale || Math.min(6, Math.max(2, maxWidth / regionW));

  const vp = page.getViewport({ scale, rotation: 0 });
  // Region → viewport pixel rectangle (y flip: user y up → canvas y down).
  const left = Math.max(0, Math.round(region.x0 * scale));
  const right = Math.min(vp.width, Math.round(region.x1 * scale));
  const top = Math.max(0, Math.round((Hp - region.y1) * scale));
  const bottom = Math.min(vp.height, Math.round((Hp - region.y0) * scale));
  const cw = Math.max(1, right - left);
  const ch = Math.max(1, bottom - top);

  // Render the full page to an offscreen canvas, then crop the region.
  const full = document.createElement('canvas');
  full.width = Math.ceil(vp.width);
  full.height = Math.ceil(vp.height);
  const fctx = full.getContext('2d', { alpha: false });
  fctx.fillStyle = '#ffffff';
  fctx.fillRect(0, 0, full.width, full.height);
  await page.render({ canvasContext: fctx, viewport: vp }).promise;

  const crop = document.createElement('canvas');
  crop.width = cw; crop.height = ch;
  const cctx = crop.getContext('2d', { alpha: false });
  cctx.drawImage(full, left, top, cw, ch, 0, 0, cw, ch);

  try { page.cleanup && page.cleanup(); } catch { /* noop */ }
  return { dataUrl: crop.toDataURL('image/png'), width: cw, height: ch };
}

export default renderRegionToDataUrl;
