/**
 * contrast.js — pure WCAG 2.1 contrast utilities (no DOM, no framework).
 *
 * Used by the accessibility token tests (roadmap 0.4) to lock AA contrast on
 * the theme's text/background pairs, and reusable by components that need to
 * pick an accessible foreground.
 */

/** Parse "#rgb" or "#rrggbb" → [r,g,b] 0..255. */
export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a hex color: ${hex}`);
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG relative luminance of an sRGB hex color. */
export function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(a, b) {
  const L1 = relLuminance(a);
  const L2 = relLuminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

/** AA thresholds: 4.5 normal text, 3.0 large text / UI components. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3.0;

export function meetsAA(a, b, large = false) {
  return contrastRatio(a, b) >= (large ? AA_LARGE : AA_NORMAL);
}
