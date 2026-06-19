/**
 * themeValidate.js — strict validation of the global brand-theme record
 * (prompt37). PURE: no DB, no framework, no DOM — unit-testable in isolation.
 *
 * The stored palette is injected verbatim into CSS custom properties on every
 * page (logged-out landing included), so EVERY color value must be a strict
 * `#rrggbb` hex. That single rule both keeps the theme sane AND closes any CSS
 * value-injection vector (no `;`, `}`, `url()`, `expression()` can survive).
 *
 * The server does NOT trust shape beyond this: brandColor + preset + an optional
 * fully-hex palette. The frontend engine (src/frontend/theme/themeEngine.js) is
 * the generator; here we only gatekeep what gets persisted.
 */

const HEX = /^#[0-9a-f]{6}$/;
const PRESET = /^[a-z0-9_-]{1,32}$/;

export const DEFAULT_BRAND = '#4f46e5'; // indigo-600 (matches themeEngine.DEFAULT_BRAND)
export const DEFAULT_PRESET = 'default';

/** Normalize "#ABC"/"abc"/"#aabbcc" → "#aabbcc" (lowercase) or null. */
export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let h = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return '#' + h.toLowerCase();
}

const TOKEN_KEYS = ['acc', 'acc2', 'accText', 'accBg'];

/** Validate one theme side ({acc,acc2,accText,accBg}, all strict hex). */
function cleanSide(side) {
  if (!side || typeof side !== 'object') return null;
  const out = {};
  for (const k of TOKEN_KEYS) {
    const v = normalizeHex(side[k]);
    if (!v) return null; // any missing/invalid token → reject the whole palette
    out[k] = v;
  }
  return out;
}

/**
 * validateThemePatch(body) → { ok, value?, error? }
 * value (on success): { brandColor, preset, palette|null, updatedAt:null(filled by caller) }
 */
export function validateThemePatch(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body required' };

  // Reset shortcut: { reset:true } → default theme, no palette stored.
  if (body.reset === true) {
    return { ok: true, value: { brandColor: DEFAULT_BRAND, preset: DEFAULT_PRESET, palette: null } };
  }

  const brandColor = normalizeHex(body.brandColor);
  if (!brandColor) return { ok: false, error: 'brandColor must be a valid hex color' };

  let preset = DEFAULT_PRESET;
  if (body.preset != null) {
    if (typeof body.preset !== 'string' || !PRESET.test(body.preset)) {
      return { ok: false, error: 'preset must be a short slug' };
    }
    preset = body.preset;
  }

  let palette = null;
  if (body.palette != null) {
    if (typeof body.palette !== 'object') return { ok: false, error: 'palette must be an object' };
    const day = cleanSide(body.palette.day);
    const night = cleanSide(body.palette.night);
    if (!day || !night) return { ok: false, error: 'palette day/night must be complete hex colors' };
    palette = { day, night };
  }

  return { ok: true, value: { brandColor, preset, palette } };
}

/** The persisted default (used when no row exists / on reset). */
export function defaultThemeSettings() {
  return { brandColor: DEFAULT_BRAND, preset: DEFAULT_PRESET, palette: null, updatedAt: null };
}
