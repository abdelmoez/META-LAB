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
