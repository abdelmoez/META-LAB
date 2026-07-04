/* ocr.js — LOCAL, deterministic TEXT RECOGNITION fallback for scanned / garbled
   PDF pages, so click-assign / pick-a-source / auto-generate keep working when a
   page has no extractable text layer.

   HONESTY: This is NOT "AI". It is offline optical character recognition running
   entirely in the browser (tesseract.js — a pinned WebAssembly build of the
   Tesseract engine). Nothing about the image ever leaves the browser. Always
   present this to users as "text recognition" (see OCR_LABEL) — never as AI.

   CSP / SELF-HOSTING: The production CSP is strict —
     script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
     connect-src 'self'; img-src 'self' data: blob:.
   By default tesseract.js downloads its worker JS, wasm core, and language data
   from a CDN (jsdelivr / unpkg). Under this CSP those cross-origin fetches are
   BLOCKED, and they would also violate the "nothing leaves the browser" rule.
   Therefore this module ONLY loads assets from SELF-HOSTED, same-origin paths
   under /tess/ — the app owner MUST stage those files (see
   docs/manager/ocr-self-hosting.md). The worker script is turned into a
   same-origin blob: URL by tesseract.js (allowed by worker-src 'self' blob:);
   the /tess/*.js and wasm fetches are same-origin (connect-src 'self').

   LAZINESS: tesseract.js is imported with a DYNAMIC import() only when OCR is
   actually invoked, so this heavy dependency never enters the main bundle and is
   never fetched unless the user explicitly runs text recognition.

   SCOPE: DOM-light. The caller supplies an already-rendered image (an
   HTMLCanvasElement, an ImageBitmap, or an image data: URL). This module does NOT
   render PDFs and does NOT map coordinates — every bbox it returns is in the
   supplied image's own PIXEL space; the caller maps those to PDF user space. */

/* Human-facing label. Callers MUST use this (or an equivalent honest phrase) —
   never the word "AI". */
export const OCR_LABEL = 'text recognition';

/* Same-origin base path where the self-hosted assets are staged. Keep in sync
   with docs/manager/ocr-self-hosting.md. */
const TESS_BASE = '/tess/';
const WORKER_PATH = `${TESS_BASE}worker.min.js`;
const CORE_PATH = TESS_BASE; // directory form — tesseract picks the best core
const LANG_PATH = TESS_BASE; // expects eng.traineddata.gz here
const LANG = 'eng';

/* Deterministic engine configuration.
   - OEM 1 = LSTM-only (the single neural engine; stable output for a given
     traineddata version). We ship only the LSTM core, so this is required.
   - PSM AUTO (3) = automatic page segmentation without orientation/script
     detection, so results do not depend on an OSD pass. */
const OEM_LSTM_ONLY = 1;
const PSM_AUTO = '3';

/* Parameters pinned for reproducibility. Same image + same pinned tesseract.js
   version ⇒ same text. */
const DETERMINISTIC_PARAMS = {
  tessedit_pageseg_mode: PSM_AUTO,
  // Preserve inter-word spacing so column/table text stays aligned for the
  // caller's coordinate mapping.
  preserve_interword_spaces: '1',
};

/* Module-singleton worker + the in-flight init promise (so concurrent callers
   share ONE worker instead of racing to create several). */
let _worker = null;
let _workerInit = null;

/**
 * ocrAssetsConfigured() → boolean
 *
 * Cheap, synchronous advertisement that this build is wired for SELF-HOSTED
 * assets. It does NOT (and cannot cheaply) confirm the files are actually
 * present on the server — that is verified lazily on first recognizeImage()
 * call, which throws a clear Error if the assets are missing. Staging the files
 * under public/tess/ (served at /tess/) is an owner responsibility documented in
 * docs/manager/ocr-self-hosting.md.
 *
 * Returns true to signal "this client is capable of text recognition once the
 * assets are installed", so callers can show/hide the feature affordance.
 */
export function ocrAssetsConfigured() {
  return true;
}

/* Lazily create (or reuse) the singleton worker. Any failure to load the
   self-hosted worker/core/lang assets surfaces as a clear, user-showable Error
   and leaves the module ready to retry on the next call. */
async function getWorker(logger) {
  if (_worker) return _worker;
  if (_workerInit) return _workerInit;

  _workerInit = (async () => {
    let createWorker;
    try {
      // Dynamic import keeps tesseract.js out of the main bundle.
      ({ createWorker } = await import('tesseract.js'));
    } catch (e) {
      _workerInit = null;
      throw new Error('Text recognition is unavailable (assets not installed).');
    }

    try {
      const worker = await createWorker(LANG, OEM_LSTM_ONLY, {
        workerPath: WORKER_PATH,
        corePath: CORE_PATH,
        langPath: LANG_PATH,
        // gzip:true (default) ⇒ fetch eng.traineddata.gz.
        gzip: true,
        logger: typeof logger === 'function' ? logger : undefined,
      });
      await worker.setParameters(DETERMINISTIC_PARAMS);
      _worker = worker;
      return worker;
    } catch (e) {
      // Most commonly a 404 on /tess/* (a core variant not staged — tesseract.js selects the
      // core from the browser's SIMD capability + OEM, so ALL tesseract-core*.wasm(.js)
      // variants must be present) or a CSP block. Preserve the real cause for diagnosis.
      _worker = null;
      _workerInit = null;
      const err = new Error('Text recognition is unavailable (assets not installed).');
      err.cause = e;
      throw err;
    }
  })();

  try {
    return await _workerInit;
  } finally {
    // Clear the shared promise once settled so a later call can retry after a
    // transient failure. On success _worker is set and getWorker short-circuits.
    if (_worker) _workerInit = null;
  }
}

/* Flatten tesseract's nested blocks→paragraphs→lines→words tree into a flat
   word list with pixel-space bboxes. Defensive against missing levels. */
function flattenWords(blocks) {
  const words = [];
  if (!Array.isArray(blocks)) return words;
  for (const block of blocks) {
    const paragraphs = (block && block.paragraphs) || [];
    for (const para of paragraphs) {
      const lines = (para && para.lines) || [];
      for (const line of lines) {
        const lineWords = (line && line.words) || [];
        for (const w of lineWords) {
          if (!w) continue;
          const b = w.bbox || {};
          words.push({
            text: typeof w.text === 'string' ? w.text : '',
            bbox: {
              x0: Number(b.x0) || 0,
              y0: Number(b.y0) || 0,
              x1: Number(b.x1) || 0,
              y1: Number(b.y1) || 0,
            },
            confidence: Number(w.confidence) || 0,
          });
        }
      }
    }
  }
  return words;
}

/**
 * recognizeImage(imageSource, { onProgress } = {}) → Promise<{
 *   text: string,
 *   words: Array<{ text, bbox:{x0,y0,x1,y1}, confidence }>,  // PIXEL space
 *   confidence: number,        // mean 0–100
 *   blocks?: Array             // raw tesseract block tree (nested, pixel space)
 * }>
 *
 * imageSource: anything tesseract.js can load directly — an HTMLCanvasElement,
 * an ImageBitmap, an HTMLImageElement, a Blob, or an image data: URL string.
 * (This module does NOT render PDFs; the caller rasterises the page first.)
 *
 * onProgress: optional (fraction:0–1) callback for a determinate progress bar.
 *
 * Throws a clear Error ('Text recognition is unavailable (assets not
 * installed).') if the self-hosted worker/core/lang assets cannot be loaded, so
 * the caller can surface an actionable message.
 */
export async function recognizeImage(imageSource, { onProgress } = {}) {
  if (imageSource == null) {
    throw new Error('recognizeImage: no image source provided.');
  }

  const logger =
    typeof onProgress === 'function'
      ? (m) => {
          if (m && m.status === 'recognizing text' && typeof m.progress === 'number') {
            try {
              onProgress(m.progress);
            } catch {
              /* caller progress handler must never break recognition */
            }
          }
        }
      : undefined;

  const worker = await getWorker(logger);

  let result;
  try {
    // Request the nested `blocks` tree (default output is text-only) so we can
    // extract per-word bboxes.
    result = await worker.recognize(imageSource, {}, { text: true, blocks: true });
  } catch (e) {
    const err = new Error('Text recognition failed to process this page.');
    err.cause = e;
    throw err;
  }

  const data = (result && result.data) || {};
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  return {
    text: typeof data.text === 'string' ? data.text : '',
    words: flattenWords(blocks),
    confidence: Number(data.confidence) || 0,
    blocks,
  };
}

/**
 * terminateOcr() → Promise<void>
 *
 * Free the singleton worker (and its wasm memory / blob worker). Safe to call
 * when no worker exists. A subsequent recognizeImage() lazily recreates one.
 */
export async function terminateOcr() {
  const w = _worker;
  _worker = null;
  _workerInit = null;
  if (w && typeof w.terminate === 'function') {
    try {
      await w.terminate();
    } catch {
      /* best-effort teardown */
    }
  }
}
