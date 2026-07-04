#!/usr/bin/env node
/**
 * scripts/dump-text-items.mjs — dump pdf.js `getTextContent()` items for one or
 * more pages of a local PDF as stable JSON, for use as extraction fixtures under
 * tests/fixtures/extraction/.
 *
 * WHY
 *   The extraction engine (src/research-engine/extraction/) is pure and consumes
 *   normalized text items. Fixtures built from REAL pdf.js output exercise the
 *   whole pipeline (normalizeItems → … → grid/shape) exactly as the app does.
 *
 * USAGE
 *   node scripts/dump-text-items.mjs <file.pdf> --pages 6          # one page
 *   node scripts/dump-text-items.mjs <file.pdf> --pages 5-7        # a range
 *   node scripts/dump-text-items.mjs <file.pdf> --pages 5,7,9      # a list
 *   node scripts/dump-text-items.mjs <file.pdf> --pages 6 --out tests/fixtures/extraction/mypaper-p6.textitems.json
 *   node scripts/dump-text-items.mjs <file.pdf> --scan             # print page 1 text (identify a paper)
 *
 * OUTPUT SHAPE (stable, machine-independent)
 *   {
 *     "source": "<basename only — never a machine-specific path>",
 *     "pdfjsVersion": "<pdfjs-dist version used>",
 *     "fingerprint": "<pdf.js document fingerprint>",
 *     "pages": [
 *       {
 *         "page": 6,
 *         "viewBox": [x0, y0, x1, y1],
 *         "items": [ { "str", "transform", "width", "height", "fontName", "hasEOL" }, ... ]
 *       }
 *     ]
 *   }
 *
 *   Items are RAW pdf.js text items (transform kept verbatim, numbers rounded to
 *   4 decimals for cross-platform stability) so fixtures feed the same
 *   `normalizeItems()` entry point the app uses. fontName is pdf.js's internal
 *   name (e.g. "g_d0_f1") — stable for a given PDF, useful for font-change
 *   evidence in header/footnote detection.
 *
 * DETERMINISM
 *   Same PDF + same pages → byte-identical JSON (key order fixed, numbers
 *   rounded, no timestamps, no absolute paths).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfjsVersion = require('pdfjs-dist/package.json').version;

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/dump-text-items.mjs <file.pdf> --pages <N|A-B|A,B,C> [--out <file.json>] [--scan]');
  process.exit(args.length ? 0 : 1);
}

const pdfPath = args[0];
const scanMode = args.includes('--scan');
const pagesArg = argValue('--pages');
const outArg = argValue('--out');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function parsePages(spec, numPages) {
  if (!spec) return scanMode ? [1] : null;
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) {
      if (p >= 1 && p <= numPages) out.add(p);
    }
  }
  return [...out].sort((x, y) => x - y);
}

/** round(n) — 4-decimal rounding for cross-platform float stability. */
const round = (n) => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : n);

async function main() {
  // Use the legacy Node build of the SAME pdfjs-dist the app bundles.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(pdfPath));
  // Match the app's getDocument configuration (AppPdfViewer.jsx): isEvalSupported false.
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    // No worker in Node — main-thread parse is fine for a CLI dump.
  }).promise;

  const pages = parsePages(pagesArg, doc.numPages);
  if (!pages || !pages.length) {
    console.error(`--pages is required (document has ${doc.numPages} pages)`);
    process.exit(1);
  }

  if (scanMode) {
    for (const p of pages) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const text = tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').slice(0, 600);
      console.log(`--- page ${p} ---\n${text}\n`);
    }
    return;
  }

  const out = {
    source: basename(pdfPath),
    pdfjsVersion,
    fingerprint: Array.isArray(doc.fingerprints) ? doc.fingerprints[0] : String(doc.fingerprints || ''),
    pages: [],
  };

  for (const p of pages) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const view = page.view; // [x0, y0, x1, y1] in PDF user space
    out.pages.push({
      page: p,
      viewBox: view.map(round),
      items: tc.items
        .filter((it) => typeof it.str === 'string')
        .map((it) => ({
          str: it.str,
          transform: Array.isArray(it.transform) ? it.transform.map(round) : null,
          width: round(it.width),
          height: round(it.height),
          fontName: typeof it.fontName === 'string' ? it.fontName : null,
          hasEOL: !!it.hasEOL,
        })),
    });
  }

  const json = JSON.stringify(out, null, 2) + '\n';
  if (outArg) {
    mkdirSync(dirname(outArg), { recursive: true });
    writeFileSync(outArg, json);
    console.log(`Wrote ${outArg} (${out.pages.length} page(s), ${out.pages.reduce((s, p) => s + p.items.length, 0)} items)`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((err) => {
  console.error(`dump-text-items failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
