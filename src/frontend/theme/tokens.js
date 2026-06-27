/**
 * tokens.js — the single design-token source for every surface
 * (landing, META·LAB, META·SIFT, ops console).
 *
 * Architecture
 * ------------
 * Colors live as CSS custom properties on <html>, switched by the
 * `data-theme` attribute ("night" | "day", night is the default).
 * Components keep using plain inline-style objects — they import the
 * `C` object below, whose values are `var(--t-*)` strings, so a theme
 * switch repaints everything without any React re-render.
 *
 * The legacy `${C.acc}44` hex+alpha concatenation does NOT work with
 * CSS variables — use `alpha(C.acc, 0.27)` (or pass the legacy
 * two-hex-digit suffix: `alpha(C.acc, '44')`), which emits a
 * `color-mix()` expression.
 *
 * Exported artifacts (downloaded SVG/PDF/CSV) must keep absolute hex
 * values — never bake `var(--t-*)` into anything the user exports.
 */

/* ─── Theme value maps ────────────────────────────────────────────── */

// prompt16 — Nextly-inspired design language. DAY is the default theme: a bright,
// clean, white/indigo SaaS palette (Tailwind gray scale + indigo-600 primary).
// NIGHT is the same language adapted to a dark slate-indigo surface.
export const THEMES = {
  day: {
    bg:      '#f6f7f9',   // faint gray page so white cards lift
    surf:    '#ffffff',
    card:    '#ffffff',
    card2:   '#f3f4f6',   // gray-100
    brd:     '#e5e7eb',   // gray-200
    brd2:    '#d1d5db',   // gray-300
    txt:     '#1f2937',   // gray-800 — headings / primary
    txt2:    '#4b5563',   // gray-600 — secondary
    muted:   '#676e77',   // muted body — WCAG AA (≥4.5:1) on bg/surf/card2 (roadmap 0.4; was gray-500 #6b7280 = 4.39:1 on card2)
    dim:     '#9ca3af',   // gray-400 — faint (decorative only — not used for body text)
    acc:     '#4f46e5',   // indigo-600 — primary
    acc2:    '#4338ca',   // indigo-700 — hover / pressed
    accText: '#ffffff',
    gold:    '#b45309',   // amber-700
    teal:    '#0d9488',   // teal-600
    grn:     '#059669',   // emerald-600
    grn2:    '#047857',   // emerald-700
    red:     '#dc2626',   // red-600
    yel:     '#d97706',   // amber-600
    purp:    '#7c3aed',   // violet-600
    accBg:   '#eef2ff',   // indigo-50
    grnBg:   '#ecfdf5',   // emerald-50
    redBg:   '#fef2f2',   // red-50
    yelBg:   '#fffbeb',   // amber-50
    purpBg:  '#f5f3ff',   // violet-50
    goldBg:  '#fffbeb',
    tealBg:  '#f0fdfa',   // teal-50
    shadow:  'rgba(17, 24, 39, 0.08)',
  },
  night: {
    bg:      '#0b1120',   // slate-950
    surf:    '#111827',   // gray-900
    card:    '#151e30',
    card2:   '#1d2840',
    brd:     '#283449',
    brd2:    '#384761',
    txt:     '#f1f5f9',
    txt2:    '#aab6cf',
    muted:   '#8693b4',   // muted body — WCAG AA (≥4.5:1) on bg/surf/card2 (roadmap 0.4; was #6c7a99 = 4.12:1 on surf)
    dim:     '#414e69',   // faint (decorative only — not used for body text)
    acc:     '#818cf8',   // indigo-400 — primary in dark
    acc2:    '#6366f1',   // indigo-500
    accText: '#0b1020',
    gold:    '#d8ab6e',
    teal:    '#37cdbb',
    grn:     '#48d597',
    grn2:    '#1fa36b',
    red:     '#f37e7e',
    yel:     '#ecbb4e',
    purp:    '#a98ef7',
    accBg:   '#1e2547',
    grnBg:   '#0b2b20',
    redBg:   '#331316',
    yelBg:   '#2e2310',
    purpBg:  '#1e1538',
    goldBg:  '#2c2113',
    tealBg:  '#0b2a27',
    shadow:  'rgba(2, 6, 16, 0.55)',
  },
};

/* ─── Color-blind-safe palette (roadmap 0.4) ──────────────────────────
 * The Okabe–Ito 8-colour qualitative palette: maximally distinguishable
 * under deuteranopia, protanopia and tritanopia. These are ABSOLUTE hex
 * values (theme-independent) because they are consumed by forest/funnel
 * plots and screening labels that export to SVG/PDF — never bake var(--t-*)
 * into exports. Use these for *categorical series* (one colour per group),
 * NOT as text-on-background: several (e.g. yellow) are light by design, so
 * when used as text, pick an accessible foreground via contrast.js.
 *
 * Ref: Okabe & Ito (2008), "Color Universal Design".
 */
export const OKABE_ITO = {
  orange:       '#e69f00',
  skyBlue:      '#56b4e9',
  bluishGreen:  '#009e73',
  yellow:       '#f0e442',
  blue:         '#0072b2',
  vermillion:   '#d55e00',
  reddishPurple:'#cc79a7',
  black:        '#000000',
};

/** Ordered series for plots (skips near-white yellow so points/lines stay visible). */
export const CB_SERIES = [
  OKABE_ITO.blue, OKABE_ITO.vermillion, OKABE_ITO.bluishGreen,
  OKABE_ITO.orange, OKABE_ITO.reddishPurple, OKABE_ITO.skyBlue, OKABE_ITO.black,
];

/* Screening-decision colours on the blue↔orange axis instead of green↔red,
 * the canonical CVD-safe substitution. Each carries an accessible text `fg`
 * (≥4.5:1 on a white chip) and a light `bg` tint for chips. Consumed by the
 * screening labels in Phase 1. */
export const SCREEN_STATUS_CB = {
  include: { base: OKABE_ITO.blue,       fg: '#005b8f', bg: '#e7f1f8', label: 'Include' },
  exclude: { base: OKABE_ITO.vermillion, fg: '#a8490a', bg: '#fcede3', label: 'Exclude' },
  maybe:   { base: OKABE_ITO.orange,     fg: '#8a6300', bg: '#fdf3e0', label: 'Maybe' },
};

/* CSS variable name for a token key: acc → --t-acc, accBg → --t-acc-bg */
const varName = (key) => '--t-' + key.replace(/([A-Z])/g, '-$1').toLowerCase();

/* ─── The palette components import ───────────────────────────────── */
/* Union of every key spelling the legacy palettes used (yel/ylw,      */
/* card2/cardHover) so adoption is a mechanical import swap.           */

const v = (key) => `var(${varName(key)})`;

export const C = {
  bg: v('bg'), surf: v('surf'), card: v('card'), card2: v('card2'), cardHover: v('card2'),
  brd: v('brd'), brd2: v('brd2'),
  txt: v('txt'), txt2: v('txt2'), muted: v('muted'), dim: v('dim'),
  acc: v('acc'), acc2: v('acc2'), accText: v('accText'),
  gold: v('gold'), teal: v('teal'),
  grn: v('grn'), grn2: v('grn2'), red: v('red'),
  yel: v('yel'), ylw: v('yel'),
  purp: v('purp'),
  accBg: v('accBg'), grnBg: v('grnBg'), redBg: v('redBg'), yelBg: v('yelBg'),
  purpBg: v('purpBg'), goldBg: v('goldBg'), tealBg: v('tealBg'),
  shadow: v('shadow'),
};

// prompt16 — Inter is the Nextly template font; IBM Plex Sans kept as a fallback.
// Monospace stays IBM Plex Mono for statistical numbers / code (reads cleanly in tables).
const FONT_STACK = "'Inter', 'IBM Plex Sans', system-ui, sans-serif";
// 57.md (recs) — FONT now resolves through the `--t-font` token (defined on :root in
// buildThemeCss = Inter; remapped to Manrope under the Stitch theme in stitchTokens.js
// legacyRemap), with the literal stack as a FOUC-safe fallback. Every existing
// `fontFamily: FONT` therefore auto-harmonizes: Inter in the legacy theme, Manrope in
// the Stitch theme — so embedded engine pages match the Stitch shell typography. The
// legacy theme is byte-identical (the var resolves to the same Inter stack).
export const FONT = `var(--t-font, ${FONT_STACK})`;
export const MONO = "'IBM Plex Mono', ui-monospace, monospace";

/* ─── Alpha helper ────────────────────────────────────────────────── */
/**
 * Theme-aware translucency.
 *   alpha(C.acc, 0.27)  → color-mix(in srgb, var(--t-acc) 27%, transparent)
 *   alpha(C.acc, '44')  → same (legacy two-hex-digit suffix, 0x44/255)
 *   alpha('#5b9cf6', 0.27) → '#5b9cf644' (plain hex passthrough)
 */
export function alpha(color, a) {
  let frac = a;
  if (typeof a === 'string') frac = parseInt(a, 16) / 255;
  frac = Math.min(1, Math.max(0, frac));
  if (typeof color === 'string' && (color.startsWith('var(') || color.startsWith('color-mix('))) {
    return `color-mix(in srgb, ${color} ${Math.round(frac * 100)}%, transparent)`;
  }
  const byte = Math.round(frac * 255).toString(16).padStart(2, '0');
  return `${color}${byte}`;
}

/* ─── CSS generation ──────────────────────────────────────────────── */

function cssBlock(values) {
  return Object.entries(values).map(([k, val]) => `${varName(k)}: ${val};`).join(' ');
}

/**
 * Theme variable definitions + theme-aware base rules.
 * Injected once at the app root by <ThemeStyles/> (see ThemeContext.jsx).
 */
export function buildThemeCss() {
  return `
:root, :root[data-theme="day"] { ${cssBlock(THEMES.day)} --t-font: ${FONT_STACK}; color-scheme: light; }
:root[data-theme="night"] { ${cssBlock(THEMES.night)} color-scheme: dark; }
body { background: var(--t-bg); color: var(--t-txt); font-family: ${FONT}; }
html { transition: background 0.2s ease; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--t-brd); border-radius: 99px; }
::-webkit-scrollbar-thumb:hover { background: var(--t-dim); }
input, textarea, select { transition: border-color 0.15s ease, box-shadow 0.15s ease; }
input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--t-acc) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--t-acc) 12%, transparent) !important;
}
button:focus-visible, [role="button"]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--t-acc) 28%, transparent);
}
.t-min0 { min-width: 0; }
.t-truncate { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-wrap { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
`;
}

/* ─── Persistence + application ───────────────────────────────────── */

const STORAGE_KEY = 'metalab_theme';
export const THEME_NAMES = ['night', 'day'];

export function getSavedTheme() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return THEME_NAMES.includes(t) ? t : null;
  } catch { return null; }
}

export function applyTheme(theme) {
  const t = THEME_NAMES.includes(theme) ? theme : 'day';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode */ }
  // Let any listener (ThemeProvider) know about out-of-band changes.
  window.dispatchEvent(new CustomEvent('metalab:theme-change', { detail: t }));
  return t;
}

/**
 * Called by AuthContext after login/getMe: adopt the server-side
 * preference only when this browser has no explicit local choice yet.
 */
export function adoptServerTheme(themePreference) {
  if (!THEME_NAMES.includes(themePreference)) return;
  if (getSavedTheme()) return; // local choice wins
  applyTheme(themePreference);
}
