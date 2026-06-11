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

export const THEMES = {
  night: {
    bg:      '#070b14',
    surf:    '#0c1322',
    card:    '#101a2c',
    card2:   '#152238',
    brd:     '#1d2d49',
    brd2:    '#283c60',
    txt:     '#eef2fc',
    txt2:    '#9fb0d4',
    muted:   '#5f7195',
    dim:     '#3a4660',
    acc:     '#6ba1f7',
    acc2:    '#3d7bf0',
    accText: '#071124',
    gold:    '#d8ab6e',
    teal:    '#37cdbb',
    grn:     '#48d597',
    grn2:    '#1fa36b',
    red:     '#f37e7e',
    yel:     '#ecbb4e',
    purp:    '#a98ef7',
    accBg:   '#0e2243',
    grnBg:   '#0b2b20',
    redBg:   '#331316',
    yelBg:   '#2e2310',
    purpBg:  '#1e1538',
    goldBg:  '#2c2113',
    tealBg:  '#0b2a27',
    shadow:  'rgba(2, 6, 16, 0.55)',
  },
  day: {
    bg:      '#f2f0ea',
    surf:    '#faf8f4',
    card:    '#ffffff',
    card2:   '#f3f1ea',
    brd:     '#dcd7c9',
    brd2:    '#c4beac',
    txt:     '#1a2233',
    txt2:    '#48556e',
    muted:   '#7a849c',
    dim:     '#b9c0cf',
    acc:     '#1f5dd6',
    acc2:    '#1745a5',
    accText: '#ffffff',
    gold:    '#8a6a35',
    teal:    '#0f766e',
    grn:     '#188047',
    grn2:    '#136539',
    red:     '#bb3a32',
    yel:     '#946800',
    purp:    '#6a3bd1',
    accBg:   '#e8eefb',
    grnBg:   '#e2f2e8',
    redBg:   '#fae8e6',
    yelBg:   '#f7efd9',
    purpBg:  '#efe9fb',
    goldBg:  '#f2ecdb',
    tealBg:  '#e0f1ef',
    shadow:  'rgba(74, 68, 50, 0.18)',
  },
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

export const FONT = "'IBM Plex Sans', system-ui, sans-serif";
export const MONO = "'IBM Plex Mono', monospace";

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
:root, :root[data-theme="night"] { ${cssBlock(THEMES.night)} color-scheme: dark; }
:root[data-theme="day"] { ${cssBlock(THEMES.day)} color-scheme: light; }
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
  const t = THEME_NAMES.includes(theme) ? theme : 'night';
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
