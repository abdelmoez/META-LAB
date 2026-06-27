/**
 * stitchTokens.js — the "Vivid Enterprise" design tokens (design.md / DESIGN.md).
 *
 * Mirrors the app's existing token architecture (theme/tokens.js): colors live as
 * CSS custom properties; components import an `S` object whose values are
 * `var(--stitch-*)` strings and style with plain inline objects. The Stitch
 * variables are defined ONLY under the design-mode root (`html[data-ui-design=
 * "stitch"]`), so nothing here can leak into the legacy UI.
 *
 * TWO responsibilities:
 *   1. Define `--stitch-*` semantic tokens consumed by the Stitch component family.
 *   2. Re-map the legacy `--t-*` tokens (only under the Stitch root) to Stitch-tuned
 *      values, so the SHARED functional widgets we embed (workflow tabs, the
 *      screening engine, the PDF viewer, RoB, extraction) — which already consume
 *      `var(--t-*)` — visually harmonize with Stitch instead of looking like
 *      legacy islands. (When an admin has set a custom brand, its inline `--t-acc`
 *      on <html> still wins, so the brand engine keeps working.)
 *
 * Specificity note: the legacy palette is defined at `:root[data-theme="day|night"]`
 * (0,2,0). Our blocks are theme-qualified on `html[data-ui-design="stitch"]`
 * (0,2,1) so they reliably win for BOTH day and night without !important.
 */

/* ─── Light identity (the canonical Stitch look) ──────────────────────────── */
export const STITCH_LIGHT = {
  // surfaces
  surface:           '#f7f9ff',
  surfaceLow:        '#f1f4fb',
  surfaceContainer:  '#ebeef5',
  surfaceHigh:       '#e5e8ef',
  surfaceHighest:    '#dfe2e9',
  surfaceDim:        '#d7dae1',
  card:              '#ffffff',
  // text
  textPrimary:       '#181c21',
  textSecondary:     '#464555',
  textMuted:         '#5d5b6b',
  outline:           '#777587',
  outlineVariant:    '#c7c4d8',
  // brand (deep purple)
  brand:             '#5d509b',
  brandStrong:       '#4b3f88',
  brandContainer:    '#7669b6',
  onBrand:           '#ffffff',
  brandSoft:         '#e6deff',
  onBrandSoft:       '#1c0858',
  // success / accept / included
  success:           '#016e1c',
  successStrong:     '#015416',
  onSuccess:         '#ffffff',
  successSoft:       '#cdf3c7',
  onSuccessSoft:     '#0b3d12',
  // danger / exclude / error
  danger:            '#ba1a1a',
  dangerStrong:      '#8c1313',
  onDanger:          '#ffffff',
  dangerSoft:        '#ffdad6',
  onDangerSoft:      '#5b0a0a',
  // warning / maybe / pending
  warn:              '#8a6300',
  onWarn:            '#ffffff',
  warnSoft:          '#fdf0d5',
  onWarnSoft:        '#5a4000',
  // info accent (links / informational)
  info:             '#3b5bd9',
  infoSoft:         '#e3e8fd',
  // inverse (tooltips, toasts)
  inverse:           '#2d3136',
  onInverse:         '#eef1f8',
  // effects
  shadowSm:          '0 1px 2px rgba(16,18,30,0.06)',
  shadow1:           '0 4px 20px rgba(16,18,30,0.06)',
  shadow2:           '0 15px 35px rgba(16,18,30,0.12)',
  ring:              'rgba(93,80,155,0.30)',
};

/* ─── Dark adaptation (honors the app's per-user night toggle) ─────────────── */
export const STITCH_DARK = {
  surface:           '#11131a',
  surfaceLow:        '#171a22',
  surfaceContainer:  '#1c1f29',
  surfaceHigh:       '#222632',
  surfaceHighest:    '#2a2f3d',
  surfaceDim:        '#0c0e14',
  card:              '#1a1d26',
  textPrimary:       '#eef1f8',
  textSecondary:     '#c2c4d4',
  textMuted:         '#9b9db2',
  outline:           '#8a88a0',
  outlineVariant:    '#3a3950',
  brand:             '#cabeff',
  brandStrong:       '#b9a9ff',
  brandContainer:    '#7669b6',
  onBrand:           '#1c0858',
  brandSoft:         '#322a52',
  onBrandSoft:       '#e6deff',
  success:           '#7edb7b',
  successStrong:     '#96f591',
  onSuccess:         '#002204',
  successSoft:       '#13321a',
  onSuccessSoft:     '#cdf3c7',
  danger:            '#ffb4ab',
  dangerStrong:      '#ffdad6',
  onDanger:          '#690005',
  dangerSoft:        '#3a1513',
  onDangerSoft:      '#ffdad6',
  warn:              '#ecbb4e',
  onWarn:            '#3a2a00',
  warnSoft:          '#332600',
  onWarnSoft:        '#fdf0d5',
  info:             '#aec0ff',
  infoSoft:         '#22263a',
  inverse:           '#eef1f8',
  onInverse:         '#2d3136',
  shadowSm:          '0 1px 2px rgba(0,0,0,0.4)',
  shadow1:           '0 4px 20px rgba(0,0,0,0.45)',
  shadow2:           '0 15px 35px rgba(0,0,0,0.55)',
  ring:              'rgba(202,190,255,0.40)',
};

/* ─── Non-color tokens (shared across themes) ─────────────────────────────── */
export const STITCH_SHAPE = {
  railPrimary:  '72px',
  railExpanded: '248px',  // hover/focus-expanded width of the project workflow rail
  railContext:  '280px',  // contextual white column (design2.md Part 6: 240–300px)
  gutter:       '24px',
  cardPad:      '20px',
  radiusControl: '8px',
  radiusCardSm:  '12px',
  radiusCard:    '16px',
  radiusModal:   '16px',
  radiusPill:    '9999px',
};

/* ─── Fixed deep-purple rail palette (brand anchor — does NOT flip day/night) ───
   Aligned to the Stitch design source (vivid_enterprise/DESIGN.md): primary
   #5d509c, primary-container #7669b6 (hover/active fill), and the green
   secondary-container #96f591 as the active indicator bar. One tokenized purple —
   design2.md Part 9: "no multiple competing shades of purple without tokens". */
export const STITCH_RAIL = {
  bg:        '#5d509c',
  bgHover:   '#7669b6',
  active:    'rgba(255,255,255,0.16)',
  indicator: '#96f591',
  text:      '#ffffff',
  idle:      0.64,
  expandedWidth: 248,
  collapsedWidth: 72,
  transition: '180ms cubic-bezier(0.4, 0, 0.2, 1)',
};

export const STITCH_FONT = "'Manrope', 'Inter', system-ui, sans-serif";
export const STITCH_MONO = "'IBM Plex Mono', ui-monospace, monospace";

/* ─── Type scale (from DESIGN.md typography) ───────────────────────────────── */
export const STITCH_TYPE = {
  display: { fontSize: '32px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em' },
  headline:{ fontSize: '20px', fontWeight: 600, lineHeight: 1.4 },
  title:   { fontSize: '16px', fontWeight: 600, lineHeight: 1.5 },
  body:    { fontSize: '14px', fontWeight: 400, lineHeight: 1.6 },
  label:   { fontSize: '12px', fontWeight: 500, lineHeight: 1.4, letterSpacing: '0.01em' },
  labelXs: { fontSize: '11px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '0.02em' },
};

/* ─── var() accessor (mirrors `C` in tokens.js) ───────────────────────────── */
const varName = (key) => '--stitch-' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
const v = (key) => `var(${varName(key)})`;

/** The token object Stitch components import: every value is a theme-aware var(). */
export const S = Object.keys(STITCH_LIGHT).reduce((acc, key) => {
  acc[key] = v(key);
  return acc;
}, {});

// Static (non-var) helpers also exposed on S for convenience.
S.font = STITCH_FONT;
S.mono = STITCH_MONO;
S.railPrimary = STITCH_SHAPE.railPrimary;
S.railContext = STITCH_SHAPE.railContext;
S.gutter = STITCH_SHAPE.gutter;
S.cardPad = STITCH_SHAPE.cardPad;
S.radiusControl = STITCH_SHAPE.radiusControl;
S.radiusCardSm = STITCH_SHAPE.radiusCardSm;
S.radiusCard = STITCH_SHAPE.radiusCard;
S.radiusModal = STITCH_SHAPE.radiusModal;
S.radiusPill = STITCH_SHAPE.radiusPill;
S.railExpanded = STITCH_SHAPE.railExpanded;

/** Theme-aware translucency, same contract as tokens.js `alpha`. */
export function salpha(color, a) {
  let frac = typeof a === 'string' ? parseInt(a, 16) / 255 : a;
  frac = Math.min(1, Math.max(0, frac));
  if (typeof color === 'string' && (color.startsWith('var(') || color.startsWith('color-mix('))) {
    return `color-mix(in srgb, ${color} ${Math.round(frac * 100)}%, transparent)`;
  }
  const byte = Math.round(frac * 255).toString(16).padStart(2, '0');
  return `${color}${byte}`;
}

/* ─── CSS generation ──────────────────────────────────────────────────────── */

function declBlock(map) {
  return Object.entries(map).map(([k, val]) => `${varName(k)}: ${val};`).join(' ');
}

/**
 * Map a Stitch palette to legacy `--t-*` values so embedded shared widgets
 * harmonize. Conservative — keeps the legacy token meanings, just re-tuned.
 */
function legacyRemap(p) {
  return {
    '--t-bg': p.surface,
    '--t-surf': p.card,
    '--t-card': p.card,
    '--t-card2': p.surfaceLow,
    '--t-brd': p.surfaceHigh,
    '--t-brd2': p.outlineVariant,
    '--t-txt': p.textPrimary,
    '--t-txt2': p.textSecondary,
    '--t-muted': p.textMuted,
    '--t-dim': p.outline,
    '--t-acc': p.brand,
    '--t-acc2': p.brandStrong,
    '--t-acc-text': p.onBrand,
    '--t-acc-bg': p.brandSoft,
    '--t-grn': p.success,
    '--t-grn2': p.successStrong,
    '--t-grn-bg': p.successSoft,
    '--t-red': p.danger,
    '--t-red-bg': p.dangerSoft,
    '--t-yel': p.warn,
    '--t-yel-bg': p.warnSoft,
    '--t-purp': p.brand,
    '--t-purp-bg': p.brandSoft,
    '--t-teal': p.info,
    '--t-teal-bg': p.infoSoft,
    '--t-gold': p.warn,
    '--t-gold-bg': p.warnSoft,
    '--t-shadow': p.shadow1,
  };
}

const remapBlock = (p) => Object.entries(legacyRemap(p)).map(([k, val]) => `${k}: ${val};`).join(' ');

/**
 * Full Stitch stylesheet. Injected once (StitchStyle) while the Stitch shell is
 * mounted. Every selector is rooted at `html[data-ui-design="stitch"]` so it is
 * inert in legacy mode. Scoped base rules only — NO bare global resets.
 */
export function buildStitchCss() {
  const LIGHT = 'html[data-ui-design="stitch"]:not([data-theme="night"])';
  const DARK  = 'html[data-ui-design="stitch"][data-theme="night"]';
  return `
${LIGHT} { ${declBlock(STITCH_LIGHT)} ${remapBlock(STITCH_LIGHT)} color-scheme: light; }
${DARK} { ${declBlock(STITCH_DARK)} ${remapBlock(STITCH_DARK)} color-scheme: dark; }

html[data-ui-design="stitch"] body {
  background: var(--stitch-surface);
  color: var(--stitch-text-primary);
  font-family: ${STITCH_FONT};
  font-size: 14px;
  line-height: 1.6;
}
/* Manrope across the WHOLE Stitch theme — including portaled overlays (modals,
   menus, dropdowns, tooltips, toasts, drawers) which mount on document.body but
   inside the design-mode root and carry the .stitch-scope class. Set on the SCOPE
   container only (not every descendant) so explicitly monospaced technical fields
   keep their monospace font (design2.md Part 2). */
html[data-ui-design="stitch"] .stitch-scope { font-family: ${STITCH_FONT}; }
/* 57.md §8 — native form controls do NOT inherit font-family by default, so an
   ad-hoc <button>/<input> in the Stitch UI that forgets to set it falls back to the
   UA serif font (the "Recently updated" articles bug). Make every native control in
   the Stitch scope inherit the app font; any element that sets its own inline
   font-family (e.g. embedded engine controls, monospace fields) still wins. */
html[data-ui-design="stitch"] .stitch-scope button,
html[data-ui-design="stitch"] .stitch-scope input,
html[data-ui-design="stitch"] .stitch-scope select,
html[data-ui-design="stitch"] .stitch-scope textarea { font-family: inherit; }
html[data-ui-design="stitch"] ::selection { background: color-mix(in srgb, var(--stitch-brand) 24%, transparent); }
html[data-ui-design="stitch"] .stitch-scope ::-webkit-scrollbar { width: 10px; height: 10px; }
html[data-ui-design="stitch"] .stitch-scope ::-webkit-scrollbar-track { background: transparent; }
html[data-ui-design="stitch"] .stitch-scope ::-webkit-scrollbar-thumb { background: var(--stitch-surface-highest); border-radius: 9999px; border: 2px solid transparent; background-clip: padding-box; }
html[data-ui-design="stitch"] .stitch-scope ::-webkit-scrollbar-thumb:hover { background: var(--stitch-outline-variant); }

/* Accessible focus ring for Stitch interactive elements. */
html[data-ui-design="stitch"] .stitch-focusable:focus-visible,
html[data-ui-design="stitch"] button.stitch-btn:focus-visible,
html[data-ui-design="stitch"] a.stitch-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--stitch-ring);
}
/* 56.md review fix (WCAG 2.4.7) — the brand ring is purple, which is invisible on
   the deep-purple rail. Rail controls get a high-contrast WHITE ring so keyboard
   focus is always clearly visible against the purple background. */
html[data-ui-design="stitch"] .stitch-prail .stitch-focusable:focus-visible,
html[data-ui-design="stitch"] .stitch-wsnav-rail .stitch-focusable:focus-visible {
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.92);
}

/* Subtle, professional entrance + transitions (respect reduced motion). */
@keyframes stitchFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes stitchScaleIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
html[data-ui-design="stitch"] .stitch-fade-in { animation: stitchFadeIn 0.22s ease-out both; }
html[data-ui-design="stitch"] .stitch-scale-in { animation: stitchScaleIn 0.16s ease-out both; }

/* ── 56.md §2/§3/§6 — the COORDINATED workspace navigation shell ──────────────
   The purple rail and the white submenu are ONE coordinated region driven by a
   single width variable (--prail-w). The submenu is positioned at
   left:var(--prail-w) so it ALWAYS sits immediately beside the rail and animates
   WITH it (it can never be covered or clipped — acceptance #9/#11/#12).
     · Collapsed (default, no saved preference): rail 72px; submenu attached at 72.
     · Hover / keyboard focus-within (unpinned): the rail expands to 248px as an
       OVERLAY — the reserved in-flow width stays collapsed, so heavy page content
       does NOT reflow on a mouse graze — and the submenu slides right WITH it.
     · Pinned (user preference): the rail stays 248px AND the reserved in-flow
       width grows, so the main content adjusts once (persisted, cross-device).
   The submenu width (--subnav-w) is 0 when the active category has no submenu
   (Overview / Project Control / Reference reclaim the full width — 55/56.md §1). */
html[data-ui-design="stitch"] .stitch-wsnav {
  position: relative; height: 100%; flex-shrink: 0;
  --prail-w: ${STITCH_RAIL.collapsedWidth}px; --subnav-w: 0px;
  /* RESERVED in-flow width is FIXED while unpinned (collapsed) so a hover that grows
     --prail-w expands the rail as an overlay WITHOUT reflowing page content. Only the
     pinned rules below grow the reserved width. */
  width: ${STITCH_RAIL.collapsedWidth}px;
}
html[data-ui-design="stitch"] .stitch-wsnav[data-has-submenu="true"] {
  --subnav-w: ${STITCH_SHAPE.railContext};
  width: calc(${STITCH_RAIL.collapsedWidth}px + var(--subnav-w));
}
html[data-ui-design="stitch"] .stitch-wsnav[data-pinned="true"] { --prail-w: ${STITCH_RAIL.expandedWidth}px; width: var(--prail-w); }
html[data-ui-design="stitch"] .stitch-wsnav[data-pinned="true"][data-has-submenu="true"] {
  width: calc(${STITCH_RAIL.expandedWidth}px + var(--subnav-w));
}
/* 57.md §1/§2 — the purple rail expands ONLY when the PURPLE RAIL itself is
   hovered or keyboard-focused (scoped via :has(.stitch-wsnav-rail:hover|:focus-
   within)), NEVER when the white submenu is hovered / scrolled / focused — even
   though the submenu is a sibling inside the same .stitch-wsnav group. Pinned
   keeps it open regardless. The reserved in-flow width stays constant (overlay). */
html[data-ui-design="stitch"] .stitch-wsnav:not([data-pinned="true"]):has(.stitch-wsnav-rail:hover),
html[data-ui-design="stitch"] .stitch-wsnav:not([data-pinned="true"]):has(.stitch-wsnav-rail:focus-within) { --prail-w: ${STITCH_RAIL.expandedWidth}px; }
html[data-ui-design="stitch"] .stitch-wsnav-rail {
  position: absolute; left: 0; top: 0; bottom: 0; width: var(--prail-w); overflow: hidden;
  background: ${STITCH_RAIL.bg}; z-index: 46;
  transition: width ${STITCH_RAIL.transition}, box-shadow ${STITCH_RAIL.transition};
}
html[data-ui-design="stitch"] .stitch-wsnav:not([data-pinned="true"]):has(.stitch-wsnav-rail:hover) .stitch-wsnav-rail,
html[data-ui-design="stitch"] .stitch-wsnav:not([data-pinned="true"]):has(.stitch-wsnav-rail:focus-within) .stitch-wsnav-rail {
  box-shadow: 14px 0 36px rgba(16,18,30,0.22);
}
html[data-ui-design="stitch"] .stitch-wsnav-sub {
  position: absolute; left: var(--prail-w); top: 0; bottom: 0; width: var(--subnav-w); z-index: 45; overflow: hidden;
  transition: left ${STITCH_RAIL.transition};
}
/* labels + step text reveal exactly when the rail is wide (rail hover / focus / pinned) */
html[data-ui-design="stitch"] .stitch-prail-label { opacity: 0; transition: opacity 120ms ease; white-space: nowrap; }
html[data-ui-design="stitch"] .stitch-wsnav[data-pinned="true"] .stitch-prail-label,
html[data-ui-design="stitch"] .stitch-wsnav:has(.stitch-wsnav-rail:hover) .stitch-prail-label,
html[data-ui-design="stitch"] .stitch-wsnav:has(.stitch-wsnav-rail:focus-within) .stitch-prail-label { opacity: 1; }
/* the mobile drawer rail is always fully expanded (not inside .stitch-wsnav) so its
   labels + group headers must stay visible regardless of hover/pin state */
html[data-ui-design="stitch"] .stitch-prail-static .stitch-prail-label { opacity: 1; }
html[data-ui-design="stitch"] .stitch-prail-static .stitch-prail-group { max-height: 34px; opacity: 1; }
/* group headers collapse to nothing while the rail is narrow (no empty gaps) */
html[data-ui-design="stitch"] .stitch-prail-group { max-height: 0; opacity: 0; overflow: hidden; transition: max-height 140ms ease, opacity 140ms ease; }
html[data-ui-design="stitch"] .stitch-wsnav[data-pinned="true"] .stitch-prail-group,
html[data-ui-design="stitch"] .stitch-wsnav:has(.stitch-wsnav-rail:hover) .stitch-prail-group,
html[data-ui-design="stitch"] .stitch-wsnav:has(.stitch-wsnav-rail:focus-within) .stitch-prail-group { max-height: 34px; opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  html[data-ui-design="stitch"] .stitch-fade-in,
  html[data-ui-design="stitch"] .stitch-scale-in { animation: none; }
  html[data-ui-design="stitch"] .stitch-wsnav-rail,
  html[data-ui-design="stitch"] .stitch-wsnav-sub,
  html[data-ui-design="stitch"] .stitch-prail-group,
  html[data-ui-design="stitch"] .stitch-prail-label { transition: none !important; }
  html[data-ui-design="stitch"] * { scroll-behavior: auto !important; }
}
`;
}
