/**
 * themeEngine.js — the global brand-color palette generator (prompt37).
 *
 * The app's design system is CSS-variable based (see tokens.js): the brand /
 * accent color is a small set of tokens —
 *   --t-acc       primary brand color
 *   --t-acc2      hover / pressed (a deeper sibling)
 *   --t-acc-text  readable foreground laid ON the brand (button text)
 *   --t-acc-bg    a very soft brand-tinted background (chips, active tabs)
 * — that EVERY surface already consumes through the `C.acc*` helpers. So a
 * single brand color drives the whole platform: overriding these four tokens
 * (per day/night theme) re-skins landing, dashboard, screening, RoB, GRADE,
 * analysis, ops, maps, charts, buttons, tabs, focus rings… without touching
 * any component.
 *
 * This module is PURE (no React, no DOM, no network) so it can be used by the
 * Ops Style tab, by the ThemeProvider, by the pre-paint bootstrap, and by unit
 * tests interchangeably. It builds a balanced palette from ONE hex — it does
 * NOT flatten everything to the same color: it derives perceptually-related
 * shades and picks accessible foregrounds.
 *
 * Semantic colors (success/warning/destructive/neutral grays) are intentionally
 * NOT generated here — they stay meaningful and are untouched by re-theming.
 */

import { hexToRgb, contrastRatio, AA_NORMAL, AA_LARGE } from './contrast.js';

/* ─── Low-level color math (sRGB + HSL, dependency-free) ───────────────── */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const clamp255 = (n) => clamp(Math.round(n), 0, 255);

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('');
}

/** Linear sRGB mix: t (0..1) fraction of `b` blended into `a`. Returns hex. */
export function mix(a, b, t) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  const f = clamp(t, 0, 1);
  return rgbToHex([0, 1, 2].map((i) => ra[i] * (1 - f) + rb[i] * f));
}

export const mixWithWhite = (hex, amount) => mix(hex, '#ffffff', amount);
export const mixWithBlack = (hex, amount) => mix(hex, '#000000', amount);

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((c) => Math.round(c * 255));
}

export const hslToHex = (hsl) => rgbToHex(hslToRgb(hsl));

/* ─── Hex validation / normalization ──────────────────────────────────── */

/** Accepts "#abc", "abc", "#aabbcc", "aabbcc"; returns canonical "#aabbcc" or null. */
export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let h = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return '#' + h.toLowerCase();
}

export const isValidHex = (input) => normalizeHex(input) !== null;

/* ─── Accessible foreground ───────────────────────────────────────────── */

// Foreground candidates: pure white, or the app's near-black (matches the
// existing night accText #0b1020 so themed buttons read like the rest of the UI).
const FG_LIGHT = '#ffffff';
const FG_DARK = '#0b1020';

/** Pick whichever foreground has the higher WCAG contrast on `bg`. */
export function getReadableForeground(bg) {
  const hex = normalizeHex(bg) || '#000000';
  return contrastRatio(hex, FG_LIGHT) >= contrastRatio(hex, FG_DARK) ? FG_LIGHT : FG_DARK;
}

/* ─── Palette generation ──────────────────────────────────────────────── */

// Dark base the night soft-background is tinted from (between bg #0b1120 and
// card2 #1d2840 — a calm dark surface that takes a hint of brand cleanly).
const NIGHT_SOFT_BASE = '#151d33';

/**
 * generateThemeFromHex(hex) → a balanced two-theme brand palette.
 *
 * Returns:
 *   {
 *     brandColor: "#rrggbb",                       // normalized input
 *     day:   { acc, acc2, accText, accBg },        // the 4 overridable tokens
 *     night: { acc, acc2, accText, accBg },
 *     meta:  { ...richer named shades for the Ops preview... },
 *   }
 *
 * Day  = the brand at its chosen lightness (primary), a deeper sibling for
 *        hover/pressed, an accessible foreground, and a near-white tint.
 * Night = a LIGHTENED sibling (bright accents read better on dark surfaces,
 *        mirroring the stock indigo-400 night accent), its own deeper hover,
 *        an accessible (dark) foreground, and a dark brand-tinted surface.
 */
export function generateThemeFromHex(hex) {
  const brand = normalizeHex(hex);
  if (!brand) throw new Error(`generateThemeFromHex: invalid hex ${hex}`);

  const [h, s] = rgbToHsl(hexToRgb(brand));

  // ── Day ────────────────────────────────────────────────────────────────
  const dayAcc = brand;
  const dayAcc2 = mixWithBlack(brand, 0.16);     // deeper pressed/hover sibling
  const dayAccText = getReadableForeground(dayAcc);
  const dayAccBg = mixWithWhite(brand, 0.9);     // soft tint (≈ indigo-50 family)

  // ── Night ────────────────────────────────────────────────────────────────
  // Lightness target keeps the accent bright on dark without going neon; sat is
  // eased slightly so saturated hues don't vibrate on the dark slate surface.
  const nightS = clamp(s * 0.92, 0, 0.92);
  const nightAcc = hslToHex([h, nightS, 0.7]);
  const nightAcc2 = hslToHex([h, nightS, 0.6]);  // deeper sibling (≈ indigo-500)
  const nightAccText = getReadableForeground(nightAcc);
  const nightAccBg = mix(NIGHT_SOFT_BASE, brand, 0.18); // dark surface, hint of brand

  return {
    brandColor: brand,
    day: { acc: dayAcc, acc2: dayAcc2, accText: dayAccText, accBg: dayAccBg },
    night: { acc: nightAcc, acc2: nightAcc2, accText: nightAccText, accBg: nightAccBg },
    meta: {
      hue: Math.round(h),
      // Extra named shades surfaced in the Ops preview swatch row. These are
      // descriptive only — the four tokens above are what actually re-theme.
      primary: dayAcc,
      primaryHover: dayAcc2,
      primaryForeground: dayAccText,
      soft: dayAccBg,
      muted: mixWithWhite(brand, 0.7),
      border: mixWithWhite(brand, 0.62),
      ring: dayAcc,
      darkPrimary: nightAcc,
      darkSoft: nightAccBg,
    },
  };
}

/* ─── Override delivery (CSS-variable mapping) ─────────────────────────── */

// token key → the CSS custom property name it overrides (mirrors tokens.js varName).
export const BRAND_TOKEN_VARS = {
  acc: '--t-acc',
  acc2: '--t-acc2',
  accText: '--t-acc-text',
  accBg: '--t-acc-bg',
};

const STRICT_HEX = /^#[0-9a-fA-F]{6}$/;

/** A flat { '--t-acc': '#...', ... } map for one theme — applied as inline
 *  custom properties on <html> (inline wins over stylesheets, no specificity
 *  games, and lets the bootstrap repaint pre-React). Each value is re-validated
 *  as a strict hex (defense-in-depth: a tampered localStorage cache can never
 *  reach setProperty with a non-hex value — mirrors the index.html bootstrap). */
export function paletteToCssVars(palette, theme) {
  const t = palette && palette[theme];
  if (!t) return {};
  const out = {};
  for (const [key, varName] of Object.entries(BRAND_TOKEN_VARS)) {
    if (STRICT_HEX.test(t[key] || '')) out[varName] = t[key];
  }
  return out;
}

/** A full stylesheet override block (used by tests + as a documented fallback). */
export function buildBrandOverrideCss(palette) {
  const block = (theme, sel) => {
    const vars = paletteToCssVars(palette, theme);
    const body = Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ');
    return body ? `${sel} { ${body} }` : '';
  };
  return [
    block('day', ':root[data-theme="day"]'),
    block('night', ':root[data-theme="night"]'),
  ].filter(Boolean).join('\n');
}

/* ─── Accessibility diagnostics ───────────────────────────────────────── */

// Page backgrounds the accent text/links sit on (from tokens.js THEMES).
const DAY_BG = '#f6f7f9';
const NIGHT_BG = '#0b1120';

export function validateContrast(foreground, background) {
  const ratio = contrastRatio(foreground, background);
  return {
    ratio: Math.round(ratio * 100) / 100,
    passesAA: ratio >= AA_NORMAL,
    passesAALarge: ratio >= AA_LARGE,
  };
}

/**
 * diagnosePalette(palette) → human-facing accessibility report for the Ops tab.
 * Each check carries a label, the measured ratio, and a level (good/warn/fail).
 * `ok` is true when nothing is FAIL (warnings are allowed-with-confirm).
 */
export function diagnosePalette(palette) {
  const checks = [];
  // `min` = the WCAG target surfaced to the admin; `floor` = the "unusable" line
  // below which the check FAILS (and blocks the green OK badge). Button text is
  // normal-size text, so anything below AA 4.5 is a real fail (floor = 4.5, no
  // warn band). The accent used AS text on a background behaves like large/UI
  // text: 4.5 is the target, but [3.0, 4.5) is a savable "low contrast" warning.
  const add = (label, fg, bg, { min = AA_NORMAL, floor = AA_LARGE } = {}) => {
    const ratio = contrastRatio(fg, bg);
    const level = ratio >= min ? 'good' : ratio >= floor ? 'warn' : 'fail';
    checks.push({ label, ratio: Math.round(ratio * 100) / 100, min, level });
  };

  // Button text on the brand fill — normal text: fail below AA 4.5.
  add('Button text on brand (day)', palette.day.accText, palette.day.acc, { floor: AA_NORMAL });
  add('Button text on brand (night)', palette.night.accText, palette.night.acc, { floor: AA_NORMAL });
  // Active tab / link uses the accent color as text on the page background.
  add('Accent text on page (day)', palette.day.acc, DAY_BG);
  add('Accent text on page (night)', palette.night.acc, NIGHT_BG);
  // Accent text laid on its own soft chip background.
  add('Accent on soft chip (day)', palette.day.acc, palette.day.accBg);

  const warnings = checks
    .filter((c) => c.level !== 'good')
    .map((c) => (c.level === 'fail'
      ? `${c.label}: very poor contrast (${c.ratio}:1) — may be unreadable.`
      : `${c.label}: low contrast (${c.ratio}:1).`));

  return {
    checks,
    warnings,
    ok: checks.every((c) => c.level !== 'fail'),
    hasWarnings: warnings.length > 0,
  };
}

/* ─── Presets ─────────────────────────────────────────────────────────── */

export const DEFAULT_PRESET = 'default';
export const DEFAULT_BRAND = '#4f46e5'; // indigo-600 — the platform's original purple/indigo

// Professional, evidence-platform-appropriate palette. Each value is the DAY
// primary; the engine derives hover/foreground/soft + the full night theme.
// Hexes are chosen so the accent keeps usable contrast on white (active tabs,
// links) and lightens cleanly for dark mode.
export const PRESETS = [
  { id: 'default',  name: 'Default Indigo',     hex: '#4f46e5', note: 'The original META·LAB accent.' },
  { id: 'clinical', name: 'Clinical Blue',      hex: '#2563eb', note: 'Calm, trustworthy medical blue.' },
  { id: 'navy',     name: 'Academic Navy',      hex: '#1e40af', note: 'Deep, formal journal navy.' },
  { id: 'royal',    name: 'Royal Indigo',       hex: '#4338ca', note: 'Richer, deeper indigo.' },
  { id: 'teal',     name: 'Teal Research',      hex: '#0f766e', note: 'Fresh teal, easy on the eye.' },
  { id: 'emerald',  name: 'Emerald Evidence',   hex: '#047857', note: 'Confident evidence green.' },
  { id: 'cyan',     name: 'Cyan Modern',        hex: '#0e7490', note: 'Modern, technical cyan.' },
  { id: 'violet',   name: 'Scholar Violet',     hex: '#7c3aed', note: 'Vivid academic violet.' },
  { id: 'rose',     name: 'Rose',               hex: '#be123c', note: 'Warm, distinctive rose.' },
  { id: 'burgundy', name: 'Burgundy',           hex: '#9f1239', note: 'Deep, serious burgundy.' },
  { id: 'gold',     name: 'Gold Scholar',       hex: '#b45309', note: 'Warm amber-gold.' },
  { id: 'graphite', name: 'Graphite',           hex: '#475569', note: 'Neutral, understated slate.' },
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

/** Build the stored theme record from a preset id or a custom hex. */
export function buildThemeRecord({ presetId, hex }) {
  let brand = null;
  let preset = 'custom';
  if (presetId && PRESET_BY_ID[presetId]) {
    brand = PRESET_BY_ID[presetId].hex;
    preset = presetId;
  } else if (hex) {
    brand = normalizeHex(hex);
    // A custom hex that happens to equal a preset is labelled as that preset.
    const match = PRESETS.find((p) => p.hex === brand);
    preset = match ? match.id : 'custom';
  }
  if (!brand) return null;
  const palette = generateThemeFromHex(brand);
  return { brandColor: brand, preset, palette };
}

/** The default (reset) theme record. */
export function defaultThemeRecord() {
  return {
    brandColor: DEFAULT_BRAND,
    preset: DEFAULT_PRESET,
    palette: generateThemeFromHex(DEFAULT_BRAND),
  };
}
