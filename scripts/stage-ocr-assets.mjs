/**
 * stage-ocr-assets.mjs — stage the local text-recognition (OCR) assets into public/tess/
 * so tesseract.js loads them same-origin under the strict CSP (nothing leaves the browser).
 *
 * Runs as a build step (see package.json `build`). The wasm cores + worker come from the
 * installed `tesseract.js` / `tesseract.js-core` packages (no network). The English LSTM
 * language data (`eng.traineddata.gz`) is not shipped in node_modules, so it is fetched
 * once from the pinned tessdata 4.0.0 release if it is not already present.
 *
 * Deterministic + idempotent: existing files are left in place. If the traineddata cannot
 * be fetched (offline build), OCR simply reports "text recognition is unavailable" at
 * runtime — the rest of extraction keeps working. See docs/manager/ocr-self-hosting.md.
 */
import { mkdirSync, existsSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'tess');
mkdirSync(dest, { recursive: true });

// Copy the worker + EVERY tesseract-core*.wasm/.wasm.js variant. tesseract.js picks the
// core at runtime from the browser's capabilities AND the OEM (LSTM-only here selects the
// *-lstm variants, e.g. tesseract-core-relaxedsimd-lstm.wasm.js) — staging only a subset
// makes OCR fail on capable browsers with a "core failed to load" NetworkError. Staging the
// whole set (~30 MB, gitignored, served same-origin) guarantees the selected core is present.
const coreDir = join(root, 'node_modules', 'tesseract.js-core');
const COPIES = [['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js']];
try {
  for (const f of readdirSync(coreDir)) {
    if (/^tesseract-core.*\.wasm(\.js)?$/.test(f)) COPIES.push([join('node_modules', 'tesseract.js-core', f), f]);
  }
} catch { /* node_modules not installed yet — reported below */ }

let copied = 0, missing = 0;
for (const [from, to] of COPIES) {
  const src = join(root, from);
  const out = join(dest, to);
  if (existsSync(out)) { continue; }
  if (existsSync(src)) { copyFileSync(src, out); copied++; }
  else { console.warn(`[stage-ocr] missing source ${from} — run npm install first`); missing++; }
}

const TRAINEDDATA = join(dest, 'eng.traineddata.gz');
const TRAINEDDATA_URL = 'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz';

async function ensureTraineddata() {
  if (existsSync(TRAINEDDATA) && statSync(TRAINEDDATA).size > 1_000_000) return true;
  try {
    const res = await fetch(TRAINEDDATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const { writeFileSync } = await import('node:fs');
    writeFileSync(TRAINEDDATA, buf);
    return true;
  } catch (e) {
    console.warn(`[stage-ocr] could not fetch eng.traineddata.gz (${e.message}). OCR will report "text recognition unavailable" until it is staged. See docs/manager/ocr-self-hosting.md`);
    return false;
  }
}

const ok = await ensureTraineddata();
console.log(`[stage-ocr] public/tess ready — copied ${copied} asset(s)${missing ? `, ${missing} missing` : ''}, traineddata ${ok ? 'present' : 'MISSING'}.`);
