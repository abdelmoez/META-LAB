/**
 * theme.js — single source of truth for the META·SIFT design system.
 * (Previously these tokens were duplicated in all 6 page files.)
 */
export const C = {
  bg:    '#080c15', surf:  '#0c1322', card:  '#101929', cardHover: '#121f30',
  brd:   '#1a2b42', brd2:  '#213452',
  acc:   '#5b9cf6', acc2:  '#3b7ef4',
  gold:  '#dba96a', teal:  '#2dd4bf',
  txt:   '#ecf0fb', txt2:  '#8b9ec6', muted: '#4a5e82',
  grn:   '#4ade80', red:   '#f87171', ylw:   '#fbbf24',
};

export const FONT = "'IBM Plex Sans', system-ui, sans-serif";
export const MONO = "'IBM Plex Mono', monospace";

export const DECISION_COLORS = {
  include:   { bg: '#14532d', border: '#4ade80', txt: '#4ade80' },
  exclude:   { bg: '#450a0a', border: '#f87171', txt: '#f87171' },
  maybe:     { bg: '#451a03', border: '#fbbf24', txt: '#fbbf24' },
  undecided: { bg: '#1a2235', border: '#1a2b42', txt: '#4a5e82' },
};

export const DECISION_GLYPH = { include: '✓', exclude: '✗', maybe: '?', undecided: '·' };
export const DECISION_LABEL = { include: 'Include', exclude: 'Exclude', maybe: 'Maybe', undecided: 'Undecided' };

// Highlight tints for PICO inclusion (green) / exclusion (red) terms.
export const HILITE = {
  inclusion: { bg: 'rgba(74,222,128,0.18)', border: 'rgba(74,222,128,0.5)', txt: '#bbf7d0' },
  exclusion: { bg: 'rgba(248,113,113,0.18)', border: 'rgba(248,113,113,0.5)', txt: '#fecaca' },
};

export const GLOBAL_CSS = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes sift-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
* { box-sizing: border-box; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #213452; border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: #2c4565; }
::-webkit-scrollbar-track { background: transparent; }`;
