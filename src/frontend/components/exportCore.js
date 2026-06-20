/**
 * exportCore.js — shared export plumbing for the ExportDialog (prompt9 Task 6).
 *
 * Pure utilities, no React. Every export trigger in META·LAB / META·SIFT / ops
 * routes through ExportDialog.jsx, which consumes these helpers. The contract
 * here is FROZEN — adapter authors (F-monolith / F-sift / F-ops) code against:
 *
 *   PRESETS                          — figure size presets (px = output width)
 *   rasterizeSvg(svg, W, H, opts)    — SVG string → PNG Blob via canvas
 *   downloadBlob(blob, filename)     — anchor-click download
 *   downloadText(text, filename, mime)
 *   validateCustomSize(px)           — 320..6000 px guard → { ok, value, error }
 *
 * IMPORTANT: exported artifacts must carry absolute hex colors — never bake
 * `var(--t-*)` theme variables into an SVG passed to rasterizeSvg (the canvas
 * has no access to the document's custom properties).
 */

export const PRESETS = [
  { id: 'journal-1col', label: 'Journal single column', px: 1063, note: '90mm @300dpi' },
  { id: 'journal-2col', label: 'Journal double column', px: 2244, note: '190mm @300dpi' },
  { id: 'poster',       label: 'Conference poster',     px: 3000 },
  { id: 'slide',        label: 'Presentation slide',    px: 1920 },
  { id: 'custom',       label: 'Custom' },
];

export const CUSTOM_MIN_PX = 320;
export const CUSTOM_MAX_PX = 6000;

/**
 * Rasterize an SVG string to a PNG Blob.
 *
 * @param {string} svgString  — complete SVG markup with absolute (hex) colors
 * @param {number} srcW       — intrinsic SVG width  (e.g. the builder's W)
 * @param {number} srcH       — intrinsic SVG height (e.g. the builder's H)
 * @param {{ targetWidthPx?: number, transparent?: boolean, background?: string }} [opts]
 *   targetWidthPx — output width in px (height scales proportionally);
 *                   defaults to srcW (scale 1)
 *   transparent   — skip the opaque background fill (default false)
 *   background    — fill color painted under the figure (default '#ffffff')
 * @returns {Promise<Blob>} PNG blob
 */
export function rasterizeSvg(svgString, srcW, srcH, {
  targetWidthPx,
  transparent = false,
  background = '#ffffff',
} = {}) {
  return new Promise((resolve, reject) => {
    const w = Number(srcW);
    const h = Number(srcH);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      reject(new Error('Invalid figure dimensions.'));
      return;
    }
    const scale = (Number(targetWidthPx) > 0 ? Number(targetWidthPx) : w) / w;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('Canvas is not available in this browser.')); return; }

    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = () => {
      try {
        if (!transparent) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        // Explicit destination size — works even when the SVG only has a viewBox.
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('PNG generation failed.'))),
          'image/png',
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e instanceof Error ? e : new Error('Could not rasterize the figure.'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not render the SVG for export.'));
    };
    img.src = url;
  });
}

/** Trigger a browser download of a Blob via a synthetic anchor click. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a delay so the browser has started the download first.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Trigger a browser download of a text payload (CSV/JSON/SVG/RIS/…). */
export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/* ════════════════════════════════════════════════════════════════════════════
   prompt42 Task 8 — zero-dependency ZIP writer (STORE / no compression).
   The repo deliberately keeps a tiny dependency footprint (the PDF viewer and the
   world map are hand-rolled rather than pulling a library), so the journal-
   submission package is assembled with a small, dependency-free ZIP writer instead
   of adding jszip + a lockfile entry + bundle weight. STORE is a valid ZIP that
   every OS/tool opens; our entries (SVG/PNG/CSV/MD/HTML/JSON) are small enough that
   skipping DEFLATE costs little. Pure + unit-testable (uses only TextEncoder/Blob/
   DataView, all available in the test runtime).
   ════════════════════════════════════════════════════════════════════════════ */

// CRC-32 (IEEE) with a cached lookup table — required by the ZIP spec per entry.
let _crcTable = null;
function crcTable() {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  _crcTable = t;
  return t;
}
export function crc32(bytes) {
  const t = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ t[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  return { dosDate: date & 0xffff, dosTime: time & 0xffff };
}

/**
 * Build a ZIP Blob from entries (STORE, no compression).
 * @param {Array<{name:string, text?:string, blob?:Blob}>} entries
 * @param {{date?:Date}} [opts]
 * @returns {Promise<Blob>} application/zip
 */
export async function zipFiles(entries, { date } = {}) {
  const enc = new TextEncoder();
  const files = [];
  for (const e of entries || []) {
    if (!e || !e.name) continue;
    let data;
    if (e.blob) data = new Uint8Array(await e.blob.arrayBuffer());
    else data = enc.encode(e.text != null ? String(e.text) : '');
    files.push({ nameBytes: enc.encode(e.name), data, crc: crc32(data) });
  }
  const { dosDate, dosTime } = dosDateTime(date || new Date());
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  let centralSize = 0;
  for (const f of files) {
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, f.crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, f.nameBytes.length, true); lh.setUint16(28, 0, true);
    localChunks.push(new Uint8Array(lh.buffer), f.nameBytes, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, f.crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, f.nameBytes.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    centralChunks.push(new Uint8Array(ch.buffer), f.nameBytes);
    centralSize += 46 + f.nameBytes.length;
    offset += 30 + f.nameBytes.length + f.data.length;
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true); eocd.setUint32(16, offset, true); eocd.setUint16(20, 0, true);
  return new Blob([...localChunks, ...centralChunks, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

/** Filesystem-safe slug for filenames inside the ZIP (and the ZIP name itself). */
export function safeFilePart(s, fallback = 'file') {
  const t = String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return t || fallback;
}

/**
 * Validate a user-typed custom export width.
 * @param {string|number} px
 * @returns {{ ok: boolean, value: number|null, error: string|null }}
 *   ok=false carries the clamped nearest-valid value (when derivable) plus a
 *   human error message; ok=true carries the rounded integer width.
 */
export function validateCustomSize(px) {
  const n = Math.round(Number(px));
  if (px === '' || px === null || px === undefined || !Number.isFinite(n) || n <= 0) {
    return { ok: false, value: null, error: 'Enter a width in pixels.' };
  }
  if (n < CUSTOM_MIN_PX || n > CUSTOM_MAX_PX) {
    return {
      ok: false,
      value: Math.min(CUSTOM_MAX_PX, Math.max(CUSTOM_MIN_PX, n)),
      error: `Width must be between ${CUSTOM_MIN_PX} and ${CUSTOM_MAX_PX} px.`,
    };
  }
  return { ok: true, value: n, error: null };
}
