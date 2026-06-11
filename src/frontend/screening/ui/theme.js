/**
 * theme.js — META·SIFT design-system entry point.
 *
 * As of prompt7 this module re-exports the app-wide theme tokens
 * (src/frontend/theme/tokens.js — CSS-variable backed, night/day aware)
 * so every existing `import { C, FONT, MONO } from '../ui/theme.js'`
 * keeps working unchanged while becoming theme-aware automatically.
 *
 * NOTE: `C.*` values are `var(--t-*)` strings — hex+alpha concatenation
 * (`C.acc + '40'`) no longer works. Use `alpha(C.acc, '40')` /
 * `alpha(C.acc, 0.25)` instead (re-exported below).
 */
import { C, FONT, MONO, alpha } from '../../theme/tokens.js';

export { C, FONT, MONO, alpha };

// Decision palette — theme-aware (tinted bg tokens flip with the theme).
export const DECISION_COLORS = {
  include:   { bg: C.grnBg,  border: C.grn, txt: C.grn },
  exclude:   { bg: C.redBg,  border: C.red, txt: C.red },
  maybe:     { bg: C.yelBg,  border: C.yel, txt: C.yel },
  undecided: { bg: C.card2,  border: C.brd, txt: C.muted },
};

export const DECISION_GLYPH = { include: '✓', exclude: '✗', maybe: '?', undecided: '·' };
export const DECISION_LABEL = { include: 'Include', exclude: 'Exclude', maybe: 'Maybe', undecided: 'Undecided' };

// Highlight tints for PICO inclusion (green) / exclusion (red) terms.
export const HILITE = {
  inclusion: { bg: alpha(C.grn, 0.18), border: alpha(C.grn, 0.5), txt: C.grn },
  exclusion: { bg: alpha(C.red, 0.18), border: alpha(C.red, 0.5), txt: C.red },
};

// Fonts + keyframes only — global scrollbar/focus/body styles are injected
// once by <ThemeProvider/> (src/frontend/theme/ThemeContext.jsx).
export const GLOBAL_CSS = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes sift-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
* { box-sizing: border-box; }`;
