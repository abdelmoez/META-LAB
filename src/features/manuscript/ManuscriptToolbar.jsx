/**
 * features/manuscript/ManuscriptToolbar.jsx — 118.md §3-§9, §41-§44, §51-§54, §57-§58, §70.
 *
 * THE dedicated Manuscript Editor header. Everything that used to float in the
 * workspace as loose buttons (New draft · Template · Citation style · Saved ·
 * the auto-draft banner · the eight sub-tab buttons) now lives here, in two levels:
 *
 *   Level A — document controls: workspace identity, draft selection, the two
 *             semantic dropdowns ("Template: X ▾", "Citation style: X ▾" — 118.md
 *             §53/§54), the condensed auto-draft notice (§5) and the save pill (§44).
 *   Level B — workspace navigation: the eight destinations as an UNDERLINE TAB LIST
 *             (role=tablist — 118.md §6/§9: navigation must not read as eight CTA
 *             buttons), with the real Updates badge.
 *
 * Hierarchy (118.md §1/§8): this bar belongs to the Manuscript ENGINE. It is sticky
 * inside the engine's own scroller, never fixed to the viewport, and it never
 * imitates or replaces the global PecanRev rail.
 *
 * Styling: LEGACY tokens only (C/btnS + var(--t-*)) — this component renders in
 * BOTH shells and Stitch remaps the same custom properties. No Stitch S-token import.
 * 120.md §2 — the bar's own SURFACE is the one exception, and it is still a legacy
 * token: `C.pecan` (--t-pecan) is the brand purple, emitted identically in day and
 * night and never rewritten by an admin brand. Everything painted on it reads from
 * the `TB` palette below.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { C, btnS } from '../../frontend/workspace/ui/styles.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { alpha } from '../../frontend/theme/tokens.js';
import Tooltip from '../../frontend/components/Tooltip.jsx';
// 117.md §44 — an overlay that consumes Escape must CLAIM the fullscreen exit that
// Escape also causes, or dismissing a popover drops the whole Focus-Mode layout.
import { markOverlayEscape } from '../../frontend/focus/overlayEscapeLatch.js';
import { CITATION_STYLES, JOURNAL_TEMPLATES, draftStructure } from '../../research-engine/manuscript/index.js';
import { SaveStatusPill } from './manuscriptPanels.jsx';

/* ── the eight workspace destinations (118.md §6) ───────────────────────────── */
export const MANUSCRIPT_TABS = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  { id: 'updates', label: 'Updates', icon: 'refresh' },
  { id: 'editor', label: 'Editor', icon: 'pencil' },
  /* 120.md §8 — "PDF View" is the ninth destination, directly after Editor. It is an
     ALIAS over the existing split-view state machine (ManuscriptWorkspace's
     `splitOpen`), never a second PDF viewer: selecting it opens the SAME pane the
     119.md §4 toggle opened, and the Editor destination closes it. Everything that
     reads MANUSCRIPT_TABS/MANUSCRIPT_TAB_IDS — the roving tabindex, the sliding
     indicator, the loading skeleton and `?ms=` validity — therefore picks it up with
     no further wiring. */
  { id: 'pdfview', label: 'PDF View', icon: 'fileText' },
  { id: 'tables', label: 'Tables', icon: 'table' },
  { id: 'figures', label: 'Figures', icon: 'barChart' },
  { id: 'references', label: 'References', icon: 'bookOpen' },
  { id: 'prisma', label: 'PRISMA', icon: 'flow' },
  { id: 'export', label: 'Export', icon: 'download' },
];

export const MANUSCRIPT_TAB_IDS = MANUSCRIPT_TABS.map((t) => t.id);

/* Stable DOM ids for the tablist ↔ tabpanel wiring (118.md §42). One manuscript
   workspace renders per page, so a fixed prefix keeps the SSR contract pinnable. */
export const MS_PANEL_ID = 'ms-workspace-panel';
export const msTabDomId = (id) => `ms-workspace-tab-${id}`;

/* 118.md §5 — the warning stays, but it stops owning a whole banner. The chip
   carries the SHORT form ("Auto-draft · Verify generated content before submission",
   assembled in AutoDraftNotice so the two halves can condense independently); the
   full sentence lives on the info trigger (tooltip + aria-label + title), so it is
   reachable by pointer, keyboard AND screen reader. */
export const AUTO_DRAFT_FULL = 'Auto-draft — verify all content and numbers against your extracted data before submission.';

/* ── responsive density (118.md §41) ────────────────────────────────────────────
   Driven by the toolbar's OWN width via ResizeObserver, not the viewport. The
   manuscript column keeps a fixed 1440px cap while the shell around it does not —
   the rails, the pinned focus drawer and Focus Mode itself all change the bar's real
   width without changing the viewport, so a viewport media query would condense the
   wrong bar. Primary navigation and the save pill are NEVER moved out of sight — only
   Level-A secondary controls overflow, and they overflow into a menu that holds the
   real controls (§41: "do not hide core actions without another access route").

   The numbers are the layouts' own measured budgets, not round guesses. Measured in
   the real shell: the project rails cost ~594px, so a 1280px laptop gives this bar
   ~686px and a 1600px desktop ~1006px — which is why the condensation is graded
   rather than a single cliff, and why the whole of Level A only leaves the bar on
   genuinely small surfaces (phones, a split window).
     ≥1100  'full'     roomy selects + the spelled-out auto-draft sentence
     ≥700   'compact'  everything still inline, tightened
     ≥520   'overflow' the two selects stay (they are what a writer changes);
                       Draft / New draft / the auto-draft notice move to '⋯'
     <520   'minimal'  all of Level A moves to '⋯'
   Nothing is ever DROPPED — every tier below 'compact' renders the same live
   controls inside the menu (§41). */
export const TOOLBAR_BREAKPOINTS = { compact: 1100, overflow: 700, minimal: 520 };

/* Horizontal padding of the bar, in px per side. The breakpoints above are measured
   against the CONTENT width (the room the controls actually get), so this constant is
   what converts a padding-box measurement into the quantity the density switch uses —
   the initial synchronous read and the ResizeObserver must agree, or the bar lands one
   density off at exactly the boundary. Exported for the e2e width assertions. */
export const TOOLBAR_PAD_X = 14;

/* ── 120.md §2 — the on-purple palette ──────────────────────────────────────────
   The bar is now ONE solid brand purple (`C.pecan` → `--t-pecan`, the same constant
   the Stitch rail paints itself with — theme/tokens.js PECAN_PRIMARY). Deliberately
   NOT `--t-acc`: the accent is admin-brand-overridable at runtime and flips between
   indigo-600 and indigo-400 with the theme, and a brand SURFACE must do neither.

   Every colour the bar puts on that surface reads from this one object, so the
   toolbar has no scattered literals and a future brand change is a single edit.
   The values are measured, not guessed (WCAG 2.1, sRGB, contrast.js):

     ink        #ffffff                    on the bar 6.79:1 · on a chip 8.28:1
     inkMuted   rgba(255,255,255,0.82)     on the bar 5.21:1 · on a chip 6.35:1
     inkFaint   rgba(255,255,255,0.72)     4.42:1 — decorative glyphs/icons only (≥3:1)
     chipBg     rgba(0,0,0,0.14)           an INSET well; a darker chip RAISES the
                                           contrast of the light text it carries,
                                           where a white-tinted one would lower it
     amber      #ffdca0                    5.17:1 on the bar · 6.31:1 on a chip
     rose       #ffc9c0                    4.65:1 · 5.66:1   (critical / save failure)
     mint       #a7f3d0                    5.29:1 · 6.46:1   (saved)

   Menus that OPEN from the bar (the '⋯' menu, the New-draft popover, a native
   <select>'s own dropdown) keep the design system's LIGHT surface — 120.md §2 allows
   exactly that — so every control carries an explicit `onDark` flag rather than
   assuming its background from its class. */
export const TB = {
  bg: C.pecan,
  ink: '#ffffff',
  inkMuted: 'rgba(255,255,255,0.82)',
  inkFaint: 'rgba(255,255,255,0.72)',
  chipBg: 'rgba(0,0,0,0.14)',
  chipBrd: 'rgba(255,255,255,0.26)',
  chipBrdStrong: 'rgba(255,255,255,0.55)',
  activeBg: 'rgba(0,0,0,0.24)',
  hoverBg: 'rgba(255,255,255,0.10)',
  divider: 'rgba(255,255,255,0.24)',
  hairline: 'rgba(0,0,0,0.22)',
  ring: 'rgba(255,255,255,0.92)',
  amber: '#ffdca0',
  rose: '#ffc9c0',
  mint: '#a7f3d0',
};

export function toolbarDensity(width) {
  const w = Number(width);
  if (!(w > 0)) return 'full'; // unmeasured (SSR / first paint) → the roomy layout
  if (w < TOOLBAR_BREAKPOINTS.minimal) return 'minimal';
  if (w < TOOLBAR_BREAKPOINTS.overflow) return 'overflow';
  if (w < TOOLBAR_BREAKPOINTS.compact) return 'compact';
  return 'full';
}

/** Every Level-A control, in the order a writer reaches for them. */
/* 119.md §7 — 'structure' joins Level A as its OWN control. Structure, journal
   profile and citation style are three dimensions (§7's first ask), so they are
   three controls; 'template' keeps its id, its testid and its meaning (the JOURNAL
   profile it always was) so nothing that drives it has to change. */
export const LEVEL_A_CONTROLS = ['draft', 'newDraft', 'structure', 'template', 'citation', 'autoDraft'];

/**
 * 118.md §41 — which Level-A controls stay in the bar at a given density. Whatever is
 * not in this list renders inside the '⋯' menu, live and complete; the workspace
 * identity, the navigation and the save pill are not in this set at all because they
 * never move.
 */
export function levelAInline(density) {
  if (density === 'minimal') return [];
  if (density === 'overflow') return ['template', 'citation'];
  return LEVEL_A_CONTROLS;
}

/**
 * 118.md §6/§69 — the Updates badge, derived from REAL sync state. Never a constant.
 * `freshness.counts.outdated` is the live rollup; `outdatedCount` is the eager light
 * count the hook always has. Returns null when there is genuinely nothing to review
 * (0 updates renders NO badge rather than a "0" chip).
 */
export function updatesBadge(freshness, outdatedCount) {
  const status = (freshness && freshness.status) || '';
  if (status !== 'updates' && status !== 'critical') return null;
  const counts = (freshness && freshness.counts) || {};
  const n = Number(counts.outdated != null ? counts.outdated : outdatedCount) || 0;
  if (!(n > 0)) return null;
  // 1-9 and larger numbers both render; past 99 the chip caps its TEXT but the
  // accessible name keeps the true number (§6 "support larger numbers").
  return { count: n, text: n > 99 ? '99+' : String(n), tone: status === 'critical' ? 'red' : 'yellow' };
}

/* ── the toolbar's own stylesheet ───────────────────────────────────────────────
   Inline styles cannot express :hover / :focus-visible / :focus-within, and 118.md
   §42 asks for real focus states while §4 asks for real hover/active states. Injected
   once inside the bar (the RICH_EDITOR_CSS precedent) and scoped to `.ms-toolbar`, so
   nothing here can reach the document below.

   The one rule that genuinely needs CSS rather than markup is `:focus-within` on the
   semantic selects: the control is a LABEL + a native <select> welded into one chip,
   so the app-wide `select:focus` ring would draw around the select alone, half-inside
   the chip. Focus has to ring the thing the user perceives as the control. */
/* 120.md §2 — two variants of every interactive rule, because the same components
   render BOTH on the purple bar and inside the light menus that open from it. The
   `[data-on-dark="true"]` overrides follow their light siblings so specificity and
   order both favour them. The app-wide focus ring is a `--t-acc` colour-mix, which is
   effectively invisible on purple, so on-bar controls get a WHITE ring instead — the
   precedent is the Stitch rail's own ring (stitchTokens.js). Every rule stays scoped
   to `.ms-toolbar` so nothing here can reach the document below. */
export const MANUSCRIPT_TOOLBAR_CSS = `
.ms-toolbar .ms-tb-select:focus-within{border-color:var(--t-acc);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--t-acc) 20%, transparent);}
.ms-toolbar .ms-tb-select select:focus{box-shadow:none !important;}
.ms-toolbar .ms-tb-select:hover{border-color:var(--t-brd2);}
.ms-toolbar .ms-tb-select[data-on-dark="true"]:hover{border-color:${TB.chipBrdStrong};}
.ms-toolbar .ms-tb-select[data-on-dark="true"]:focus-within{border-color:${TB.ink};
  box-shadow:0 0 0 3px ${TB.ring};}
.ms-toolbar .ms-nav-tab:hover{color:${TB.ink};background:${TB.hoverBg};}
.ms-toolbar .ms-nav-tab[data-active="true"]:hover{color:${TB.ink};}
.ms-toolbar .ms-tb-action:hover{border-color:var(--t-brd2);color:var(--t-txt);background:var(--t-card2);}
.ms-toolbar .ms-tb-action[data-on-dark="true"]:hover{border-color:${TB.chipBrdStrong};color:${TB.ink};background:${TB.activeBg};}
.ms-toolbar .ms-view-btn:hover{color:${TB.ink};}
.ms-toolbar .ms-view-btn[data-active="true"]:hover{color:${TB.ink};}
.ms-toolbar .ms-tb-dark:focus-visible{outline:none;box-shadow:0 0 0 3px ${TB.ring};}
`;

/* ── local hooks ────────────────────────────────────────────────────────────── */

// useLayoutEffect warns during SSR; the SSR contract tests render this component.
const useIsoLayout = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** 118.md §58 — every transition in this file is opt-out-able. */
function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    let mq = null;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return undefined; }
    const sync = () => setReduce(!!mq.matches);
    sync();
    if (mq.addEventListener) { mq.addEventListener('change', sync); return () => mq.removeEventListener('change', sync); }
    if (mq.addListener) { mq.addListener(sync); return () => mq.removeListener(sync); }
    return undefined;
  }, []);
  return reduce;
}

/** CONTENT width of `ref`, tracked with ResizeObserver (118.md §41). */
function useContainerWidth(ref) {
  const [width, setWidth] = useState(0);
  useIsoLayout(() => {
    const el = ref.current;
    if (!el) return undefined;
    // clientWidth is the PADDING box; contentRect below is the CONTENT box. Subtract
    // the bar's own padding here so both paths report the same quantity.
    const set = () => setWidth(Math.max(0, Math.round((el.clientWidth || 0) - TOOLBAR_PAD_X * 2)));
    set();
    if (typeof ResizeObserver === 'undefined') {
      if (typeof window === 'undefined') return undefined;
      window.addEventListener('resize', set);
      return () => window.removeEventListener('resize', set);
    }
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(0, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * Escape-to-close for the two popovers (118.md §51 — popovers, not modals).
 *
 * 117.md §44 — the Escape is CLAIMED before it is consumed: inside real fullscreen
 * the browser leaves fullscreen regardless of what the page does with the key, so an
 * unmarked dismissal here would eject the writer from Focus Mode for closing a
 * popover. Only the `keydown` phase is intercepted, and only for Escape — Ctrl/Cmd+Z
 * and every editor chord pass straight through (§43).
 */
function useEscape(open, onClose) {
  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      markOverlayEscape();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
}

/* ── small presentational primitives ────────────────────────────────────────── */

const CATCHER_Z = 5;   // click-outside catcher (repo convention)
const POPOVER_Z = 6;   // the popover itself, above its own catcher

const popoverCard = {
  position: 'absolute', zIndex: POPOVER_Z, background: C.card,
  border: `1px solid ${C.brd}`, borderRadius: 10,
  boxShadow: '0 10px 30px var(--t-shadow)',
};

/** Breathing room between a clamped popover and the window edge, in px. */
export const POPOVER_VIEWPORT_MARGIN = 8;

/**
 * r2 (118.md §41/§51) — keep an anchored popover inside the VIEWPORT.
 *
 * These popovers are absolutely positioned against their own trigger, and the
 * trigger's position in the bar changes with the responsive density. The '⋯' menu
 * used `right: 0` — correct for a right-aligned trigger, wrong for this one, which
 * sits at the LEFT end of Level A: at the overflow and minimal densities the 268px
 * menu (and the 288px New-draft popover nested inside it) hung off the left edge of
 * the window, measured at x = -75 on a 480px viewport. Every Level-A control lives
 * in that menu at those widths, so they were simply unreachable.
 *
 * Static CSS cannot express "align left, but slide back in if that overflows" — the
 * correction depends on the trigger's live x and the popover's live width. So it is
 * measured once per open (and on resize) and applied as a translateX. The base
 * position stays declarative, the clamp is a nudge on top of it, and with no
 * measurement (SSR, no layout) the offset is 0 — the popover simply renders at its
 * declared anchor.
 *
 * @param {boolean} open  measurement only happens while the popover exists.
 * @returns {[object, number]} [ref to attach to the popover, px to shift it by]
 */
function useViewportClamp(open) {
  const ref = useRef(null);
  const [dx, setDx] = useState(0);
  useIsoLayout(() => {
    if (!open) { setDx(0); return undefined; }
    if (typeof window === 'undefined') return undefined;
    const measure = () => {
      const el = ref.current;
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
      if (!vw || !rect.width) return;
      setDx((cur) => {
        // Un-apply the shift already in effect, so the correction is computed from
        // the DECLARED anchor and can never compound across measurements.
        const left = rect.left - cur;
        const right = rect.right - cur;
        const M = POPOVER_VIEWPORT_MARGIN;
        let shift = 0;
        if (right > vw - M) shift = (vw - M) - right;   // pull left off the right edge
        if (left + shift < M) shift = M - left;         // …but never past the left edge
        return Math.round(shift);
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  return [ref, dx];
}

/** A subtle text action — 118.md §9: reserve real buttons for real primary actions. */
/* 120.md §2 — `onDark` is the on-purple variant (the control is IN the bar); without
   it the same control is rendering inside the light '⋯' menu and keeps its legacy
   tokens. Pressed/active state stays a filled well in both, so "open" never has to be
   read from colour alone. */
const subtleAction = (active, onDark = false) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
  background: onDark
    ? (active ? TB.activeBg : 'transparent')
    : (active ? alpha(C.acc, '14') : 'transparent'),
  border: `1px solid ${onDark
    ? (active ? TB.chipBrdStrong : TB.chipBrd)
    : (active ? alpha(C.acc, '38') : C.brd)}`,
  color: onDark ? (active ? TB.ink : TB.inkMuted) : (active ? C.acc : C.txt2),
  borderRadius: 8, padding: '0 10px', height: 28,
  fontSize: 11.5, fontWeight: 600, fontFamily: "'IBM Plex Sans',sans-serif",
  cursor: 'pointer', letterSpacing: 0.1,
});

/**
 * 118.md §53/§54 — ONE semantic control. The label and the value read as a single
 * sentence ("Template: Generic biomedical journal ▾") but the value is still a
 * NATIVE <select>: keyboard behaviour, mobile pickers, `selectOption` in e2e and
 * screen-reader semantics all stay exactly what the platform gives for free.
 */
/**
 * 119.md §7 — the same visual control as ToolbarSelect, but a BUTTON: it opens a
 * surface instead of committing a value. Used for Structure, whose change is a
 * document rewrite and therefore needs a preview + diff + mapping step (§7) — a
 * native <select> that applied on change could not offer any of them.
 */
/* 120.md §2 — the chip's two skins. `onDark` is the on-purple one (an inset well with
   light type); without it the chip is inside a light menu and keeps the legacy tokens. */
const chipSkin = (onDark) => ({
  background: onDark ? TB.chipBg : C.card2,
  border: `1px solid ${onDark ? TB.chipBrd : C.brd}`,
});
const chipLabelColor = (onDark) => (onDark ? TB.inkMuted : C.muted);
const chipValueColor = (onDark) => (onDark ? TB.ink : C.txt);
const chipGlyphColor = (onDark) => (onDark ? TB.inkFaint : C.muted);

export function ToolbarButton({ label, value, onClick, testid, condensed, title, onDark = false }) {
  return (
    <button
      type="button"
      data-testid={testid}
      className={onDark ? 'ms-tb-select ms-tb-dark' : 'ms-tb-select'}
      data-on-dark={onDark ? 'true' : undefined}
      onClick={onClick}
      title={title || undefined}
      aria-label={`${label}: ${value}`}
      style={{
        display: 'inline-flex', alignItems: 'center', height: 28, maxWidth: condensed ? 210 : 300,
        ...chipSkin(onDark), borderRadius: 8,
        flexShrink: 1, minWidth: 0, cursor: 'pointer', padding: 0,
        fontFamily: "'IBM Plex Sans',sans-serif",
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <span style={{
        padding: '0 1px 0 10px', fontSize: 10.5, fontWeight: 700, color: chipLabelColor(onDark),
        letterSpacing: 0.3, whiteSpace: 'nowrap', flexShrink: 0,
      }}>{label}:</span>
      <span style={{
        color: chipValueColor(onDark), fontSize: 11.5, fontWeight: 600, padding: '0 3px 0 5px',
        textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0,
      }}>{value}</span>
      <span aria-hidden="true" style={{
        marginRight: 6, pointerEvents: 'none', color: chipGlyphColor(onDark),
        display: 'inline-flex', alignItems: 'center',
      }}>
        <Icon name="chevronDown" size={11} />
      </span>
    </button>
  );
}

export function ToolbarSelect({ label, value, onChange, options, testid, condensed, onDark = false }) {
  return (
    <span
      data-testid={testid}
      className="ms-tb-select"
      data-on-dark={onDark ? 'true' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', height: 28, maxWidth: condensed ? 210 : 300,
        ...chipSkin(onDark), borderRadius: 8,
        flexShrink: 1, minWidth: 0,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <span style={{
        padding: '0 1px 0 10px', fontSize: 10.5, fontWeight: 700, color: chipLabelColor(onDark),
        letterSpacing: 0.3, whiteSpace: 'nowrap', flexShrink: 0,
      }}>{label}:</span>
      <select
        aria-label={label}
        value={value}
        onChange={onChange}
        style={{
          appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
          background: 'transparent', border: 'none', outline: 'none',
          color: chipValueColor(onDark), fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 11.5, fontWeight: 600,
          padding: '0 20px 0 5px', height: 26, cursor: 'pointer',
          textOverflow: 'ellipsis', minWidth: 0, maxWidth: '100%',
        }}
      >
        {/* 120.md §2 — the CLOSED face of the select sits on the purple bar, but its
            dropdown list is drawn by the OS from the option's own colours. Without
            these two the near-white value colour is inherited by the options and the
            list renders white-on-white (reproducible in Chrome/Edge on Windows).
            Stated in legacy tokens, so the list is correct in day AND night. */}
        {options.map((o) => (
          <option key={o.id} value={o.id} style={{ color: C.txt, background: C.card }}>{o.label}</option>
        ))}
      </select>
      <span aria-hidden="true" style={{
        marginLeft: -17, marginRight: 6, pointerEvents: 'none', color: chipGlyphColor(onDark),
        display: 'inline-flex', alignItems: 'center',
      }}>
        <Icon name="chevronDown" size={11} />
      </span>
    </span>
  );
}

/**
 * 118.md §5 — the auto-draft notice. The chip is calm and condensed; the ⓘ trigger
 * carries the FULL sentence three ways (tooltip on hover AND keyboard focus — §42,
 * `title` for the native fallback, `aria-label` so assistive tech never depends on
 * the tooltip firing at all).
 */
export function AutoDraftNotice({ condensed, onDark = false }) {
  /* 120.md §2 — the notice keeps its AMBER identity on the purple bar; only the
     specific amber changes, to one that reads on it (#ffdca0 = 5.17:1 on the bar,
     6.31:1 on the chip; the legacy --t-yel would be 2.13:1 there). */
  const amber = onDark ? TB.amber : C.yel;
  const body = onDark ? TB.inkMuted : C.txt2;
  return (
    <span
      data-testid="stitch-manuscript-autodraft"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        height: 24, padding: '0 8px 0 7px', borderRadius: 7,
        background: onDark ? TB.chipBg : alpha(C.yel, '12'),
        border: `1px solid ${onDark ? 'rgba(255,220,160,0.42)' : alpha(C.yel, '30')}`,
        color: body, fontSize: 11, minWidth: 0,
      }}
    >
      <Icon name="alertTriangle" size={12} style={{ color: amber, flexShrink: 0 }} />
      <span style={{ color: amber, fontWeight: 700 }}>Auto-draft</span>
      {!condensed && (
        <span style={{ color: body, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          · Verify generated content before submission
        </span>
      )}
      <Tooltip content={AUTO_DRAFT_FULL} placement="bottom">
        <button
          type="button"
          data-testid="stitch-manuscript-autodraft-info"
          aria-label={AUTO_DRAFT_FULL}
          title={AUTO_DRAFT_FULL}
          className={onDark ? 'ms-tb-dark' : undefined}
          style={{
            width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
            border: `1px solid ${onDark ? 'rgba(255,220,160,0.6)' : alpha(C.yel, '44')}`,
            background: 'transparent', color: amber,
            fontSize: 9, fontWeight: 700, lineHeight: '13px', padding: 0, cursor: 'help',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'IBM Plex Sans',sans-serif",
          }}
        >i</button>
      </Tooltip>
    </span>
  );
}

/**
 * 118.md §52 — "New draft" is prominent now, so it gets a confirmation that also
 * ANSWERS the safety question instead of just asking one. `addDraft` is additive
 * (research-engine upsertDraft appends), so the honest copy says exactly that: the
 * current draft is untouched and still selectable. A popover, not a modal (§51).
 */
export function NewDraftConfirm({ currentTitle, onCancel, onConfirm }) {
  // r2 — 288px, and it can be nested INSIDE the 268px overflow menu at narrow
  // densities, so it needs the same viewport clamp the menu itself needs.
  const [ref, dx] = useViewportClamp(true);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Start a new draft"
      data-testid="stitch-manuscript-new-draft-popover"
      style={{
        ...popoverCard, top: 'calc(100% + 7px)', left: 0, width: 288, padding: 12,
        transform: dx ? `translateX(${dx}px)` : undefined,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 6 }}>Start a new draft?</div>
      <p style={{ margin: '0 0 11px', fontSize: 11.5, lineHeight: 1.6, color: C.txt2 }}>
        This <strong>adds</strong> an empty draft alongside{currentTitle ? ' “' : ' '}
        {currentTitle || 'the current draft'}{currentTitle ? '”' : ''}. Nothing is
        overwritten or deleted — switch back at any time from the Draft menu.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" data-testid="stitch-manuscript-new-draft-cancel" onClick={onCancel}
          style={{ ...btnS('ghost'), fontSize: 11, padding: '5px 12px' }}>Cancel</button>
        <button type="button" data-testid="stitch-manuscript-new-draft-confirm" onClick={onConfirm}
          style={{ ...btnS('primary'), fontSize: 11, padding: '5px 12px' }}>Create draft</button>
      </div>
    </div>
  );
}

function NewDraftAction({ currentTitle, onCreate, condensed, onDark = false }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEscape(open, close);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-testid="stitch-manuscript-new-draft"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={onDark ? 'ms-tb-action ms-tb-dark' : 'ms-tb-action'}
        data-on-dark={onDark ? 'true' : undefined}
        style={subtleAction(open, onDark)}
      >
        <Icon name="plus" size={12} />{condensed ? 'New' : 'New draft'}
      </button>
      {open && (
        <>
          <div data-testid="stitch-manuscript-new-draft-catcher" onClick={close}
            style={{ position: 'fixed', inset: 0, zIndex: CATCHER_Z, background: 'transparent' }} />
          <NewDraftConfirm currentTitle={currentTitle} onCancel={close}
            onConfirm={() => { close(); onCreate(); }} />
        </>
      )}
    </span>
  );
}

/** 118.md §41 — the overflow menu holds the REAL Level-A controls, never stubs. */
function OverflowMenu({ children }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEscape(open, close);
  const [menuRef, menuDx] = useViewportClamp(open);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-testid="stitch-manuscript-toolbar-overflow"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More document controls"
        title="More document controls"
        onClick={() => setOpen((o) => !o)}
        /* 120.md §2 — the '⋯' trigger is ALWAYS on the bar (only what it holds moves),
           so it is unconditionally the on-purple variant. */
        className="ms-tb-action ms-tb-dark"
        data-on-dark="true"
        style={{ ...subtleAction(open, true), padding: '0 9px', fontSize: 14, lineHeight: '26px' }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <>
          <div data-testid="stitch-manuscript-toolbar-overflow-catcher" onClick={close}
            style={{ position: 'fixed', inset: 0, zIndex: CATCHER_Z, background: 'transparent' }} />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Document controls"
            data-testid="stitch-manuscript-toolbar-overflow-menu"
            /* r2 — anchored to the trigger's LEFT edge, because this trigger sits at
               the left end of Level A. `right: 0` pinned the menu's right edge to the
               trigger's right edge and pushed its 268px of width off the left of the
               window (measured x = -75 at a 480px viewport), taking every Level-A
               control with it. The clamp then handles the opposite case on a trigger
               that has drifted right. */
            style={{
              ...popoverCard, top: 'calc(100% + 7px)', left: 0, width: 268, padding: 12,
              transform: menuDx ? `translateX(${menuDx}px)` : undefined,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
              {children}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

/* ── 118.md §12: the view switcher ───────────────────────────────────────────── */

/**
 * 118.md §12 — the two editing views, in the words a non-technical researcher
 * would use ("Section View" / "Continuous View" are the prompt's own preferred
 * terms). The tooltip says what each one DOES, because the label alone cannot.
 */
export const MANUSCRIPT_VIEWS = [
  {
    id: 'sections',
    label: 'Section View',
    short: 'Sections',
    icon: 'layers',
    title: 'Section View — write one section at a time, with its own tools and status',
  },
  {
    id: 'continuous',
    label: 'Continuous View',
    short: 'Continuous',
    icon: 'fileText',
    title: 'Continuous View — read and edit the whole manuscript as one scrolling document',
  },
];

export const MANUSCRIPT_VIEW_IDS = MANUSCRIPT_VIEWS.map((v) => v.id);
/**
 * 119.md §3 — the default view is the CONTINUOUS document.
 *
 * A manuscript is one document, and this is the view that shows it as one: new
 * users and new projects open reading the paper they are writing, not one section
 * of it. This is the only constant that decides it — the URL builder omits the
 * default and the reconcile effect resolves an absent `?msv=` to it, so both sides
 * of the deep-link contract follow this line automatically.
 *
 * §3 is equally explicit about what does NOT change: a researcher who has ever
 * chosen a view has that choice in localStorage, it still wins over this default,
 * and nothing is written for anyone who never chose (the flip is a default, not a
 * migration). Someone who has always used Section View WITHOUT touching the
 * switcher has no stored preference and will land in Continuous View — the switch
 * is right there, and using it stores their choice for good.
 */
export const DEFAULT_MANUSCRIPT_VIEW = 'continuous';

/** 118.md §12/§47 — an unknown stored/URL value resolves to the default view. */
export function normalizeManuscriptView(id) {
  return MANUSCRIPT_VIEW_IDS.includes(id) ? id : DEFAULT_MANUSCRIPT_VIEW;
}

/**
 * A segmented control, not two toggle buttons: the two views are mutually
 * exclusive states of ONE setting, which is what `radiogroup`/`radio` means to a
 * screen reader (a pair of `aria-pressed` buttons would announce two independent
 * toggles that can both be off). APG's roving tabindex + arrow keys come with that
 * role, and are implemented here rather than left as a promise — no modifier
 * chords, so nothing the editor binds is intercepted (§43).
 */
export function ManuscriptViewSwitcher({ view, onChange, condensed = false, onDark = false }) {
  const current = normalizeManuscriptView(view);
  const btnRefs = useRef({});
  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const i = MANUSCRIPT_VIEW_IDS.indexOf(current);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % MANUSCRIPT_VIEW_IDS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + MANUSCRIPT_VIEW_IDS.length) % MANUSCRIPT_VIEW_IDS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = MANUSCRIPT_VIEW_IDS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = MANUSCRIPT_VIEW_IDS[next];
    onChange(id);
    const el = btnRefs.current[id];
    if (el && el.focus) el.focus();
  };
  return (
    <span
      role="radiogroup"
      aria-label="Manuscript view"
      data-testid="stitch-manuscript-view-switcher"
      onKeyDown={onKeyDown}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0,
        // 120.md §2 — the segmented control on the purple bar: an inset well with a
        // lifted white-tinted "selected" segment (never colour alone — the selected
        // one is also bolder, and `aria-checked` carries it to assistive tech).
        background: onDark ? TB.chipBg : C.card2,
        border: `1px solid ${onDark ? TB.chipBrd : C.brd}`, borderRadius: 8, padding: 2,
      }}
    >
      {MANUSCRIPT_VIEWS.map((v) => {
        const active = v.id === current;
        return (
          <Tooltip key={v.id} content={v.title} placement="bottom">
            <button
              type="button"
              ref={(el) => { btnRefs.current[v.id] = el; }}
              role="radio"
              aria-checked={active ? 'true' : 'false'}
              tabIndex={active ? 0 : -1}
              aria-label={v.label}
              title={v.title}
              data-testid={`stitch-manuscript-view-${v.id}`}
              data-active={active ? 'true' : undefined}
              onClick={() => { if (!active) onChange(v.id); }}
              className={onDark ? 'ms-view-btn ms-tb-dark' : 'ms-view-btn'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                background: onDark
                  ? (active ? 'rgba(255,255,255,0.18)' : 'transparent')
                  : (active ? C.card : 'transparent'),
                border: `1px solid ${onDark
                  ? (active ? TB.chipBrdStrong : 'transparent')
                  : (active ? alpha(C.acc, '38') : 'transparent')}`,
                color: onDark ? (active ? TB.ink : TB.inkMuted) : (active ? C.acc : C.txt2),
                borderRadius: 6, padding: condensed ? '0 7px' : '0 9px', height: 24,
                fontSize: 11, fontWeight: active ? 700 : 600, fontFamily: "'IBM Plex Sans',sans-serif",
                cursor: 'pointer', letterSpacing: 0.1,
              }}
            >
              <Icon name={v.icon} size={12} />
              {condensed ? v.short : v.label}
            </button>
          </Tooltip>
        );
      })}
    </span>
  );
}

/* ── Level B: the underline tab list ─────────────────────────────────────────── */

export function ManuscriptWorkspaceNav({ tab, onTabChange, badge, density = 'full', reduceMotion = false }) {
  const listRef = useRef(null);
  const tabRefs = useRef({});
  const [ind, setInd] = useState(null);
  const condensed = density !== 'full';

  const measure = useCallback(() => {
    const list = listRef.current;
    const el = tabRefs.current[tab];
    if (!list || !el || typeof el.getBoundingClientRect !== 'function') { setInd(null); return; }
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (!er.width) { setInd(null); return; }
    setInd({
      left: Math.round(er.left - lr.left + (list.scrollLeft || 0)),
      width: Math.round(er.width),
      // `top`, not `bottom: 0`: at narrow widths the tab row WRAPS, and an indicator
      // pinned to the list's bottom would underline the wrong row.
      top: Math.round(er.bottom - lr.top - 2),
    });
  }, [tab]);

  useIsoLayout(() => { measure(); }, [measure, density]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    if (listRef.current) ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [measure]);

  /* 118.md §42 — APG tablist keyboard model (roving tabindex + arrows/Home/End),
     with MANUAL activation (r2).

     APG offers two variants and is explicit about when to choose which: automatic
     activation ("selection follows focus") only when showing a panel is cheap.
     These panels are not. Arrowing past Updates mounted the Updates destination,
     which fires `refreshSyncPlan` — the deliberately lazy heavy sync plan — and
     arrowing across the row pushed one `?ms=` history entry PER TAB, so a keyboard
     user who walked from Overview to Export had to press Back seven times to undo
     one glance. Arrow/Home/End therefore move FOCUS only; Enter and Space activate,
     which native <button> gives us for free through onClick.

     Deliberately NO modifier chords here: Ctrl/Cmd+Z and friends must reach the
     editor untouched (§43). */
  const [focusId, setFocusId] = useState(null);
  // The roving tabIndex follows the FOCUSED tab while the list has focus, and the
  // SELECTED tab otherwise — so tabbing back into the list always lands on the
  // destination actually on screen.
  const roving = (focusId && MANUSCRIPT_TAB_IDS.includes(focusId)) ? focusId : tab;

  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const i = MANUSCRIPT_TAB_IDS.indexOf(roving);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % MANUSCRIPT_TAB_IDS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + MANUSCRIPT_TAB_IDS.length) % MANUSCRIPT_TAB_IDS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = MANUSCRIPT_TAB_IDS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = MANUSCRIPT_TAB_IDS[next];
    setFocusId(id);
    const el = tabRefs.current[id];
    if (el && el.focus) el.focus();
  };

  // Leaving the list entirely hands the roving tabIndex back to the active tab.
  const onBlur = (e) => {
    const list = listRef.current;
    if (list && e.relatedTarget && typeof list.contains === 'function' && list.contains(e.relatedTarget)) return;
    setFocusId(null);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Manuscript workspace"
      aria-orientation="horizontal"
      data-testid="stitch-manuscript-nav"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      style={{ position: 'relative', display: 'flex', alignItems: 'stretch', gap: condensed ? 1 : 3, minWidth: 0, flexWrap: 'wrap' }}
    >
      {MANUSCRIPT_TABS.map((s) => {
        const active = tab === s.id;
        const b = s.id === 'updates' ? badge : null;
        return (
          <button
            key={s.id}
            ref={(el) => { tabRefs.current[s.id] = el; }}
            type="button"
            role="tab"
            id={msTabDomId(s.id)}
            aria-selected={active ? 'true' : 'false'}
            aria-controls={MS_PANEL_ID}
            tabIndex={s.id === roving ? 0 : -1}
            data-testid={`stitch-manuscript-subtab-${s.id}`}
            data-active={active ? 'true' : undefined}
            onClick={() => { setFocusId(s.id); onTabChange(s.id); }}
            className="ms-nav-tab ms-tb-dark"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: condensed ? 0 : 6,
              background: 'transparent', border: 'none',
              // The active underline is drawn by the sliding indicator once it has
              // measured; until then (SSR / no-JS / no-ResizeObserver) the tab paints
              // its own, so the active destination is NEVER ambiguous (§6).
              // 120.md §2 — white on the purple bar, matching the sliding indicator.
              borderBottom: `2px solid ${active && !ind ? TB.ink : 'transparent'}`,
              padding: condensed ? '8px 9px' : '9px 13px',
              margin: 0, cursor: 'pointer',
              fontFamily: "'IBM Plex Sans',sans-serif",
              fontSize: condensed ? 11.5 : 12.5,
              fontWeight: active ? 700 : 600,
              letterSpacing: 0.1,
              /* 120.md §2 — active vs inactive is carried by THREE things, not colour
                 alone: the white underline, the bolder weight, and full-strength white
                 (6.79:1) against the muted 82% white of the others (5.21:1 — still AA
                 for normal text, so an inactive destination is never hard to read). */
              color: active ? TB.ink : TB.inkMuted,
              whiteSpace: 'nowrap',
              transition: reduceMotion ? 'none' : 'color 0.16s ease',
              borderRadius: '6px 6px 0 0',
            }}
          >
            {!condensed && <Icon name={s.icon} size={13} />}
            {s.label}
            {b && (
              <span
                data-testid="stitch-manuscript-updates-badge"
                aria-label={`${b.count} update${b.count === 1 ? '' : 's'} to review`}
                title={`${b.count} update${b.count === 1 ? '' : 's'} to review`}
                /* 120.md §2 — the badge keeps its two TONES (amber = updates, rose =
                   critical) but at values that read on purple: the legacy --t-yel /
                   --t-red chips measured 2.13:1 and 2.8:1 here. Amber 5.93:1, rose
                   5.04:1 on the badge's own well. The count itself, and the accessible
                   name, carry the meaning where colour cannot. */
                style={{
                  display: 'inline-flex', alignItems: 'center', borderRadius: 99,
                  background: TB.chipBg,
                  border: `1px solid ${b.tone === 'red' ? 'rgba(255,201,192,0.55)' : 'rgba(255,220,160,0.55)'}`,
                  color: b.tone === 'red' ? TB.rose : TB.amber,
                  fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap',
                  marginLeft: 6, padding: '0 6px',
                  fontSize: 10, lineHeight: '15px', minWidth: 15, justifyContent: 'center',
                }}
              >{b.text}</span>
            )}
          </button>
        );
      })}
      {/* 118.md §58 — the underline SLIDES between destinations; reduced motion
          snaps it instead. aria-hidden: the state it depicts is already on the tab. */}
      <span
        aria-hidden="true"
        data-testid="stitch-manuscript-nav-indicator"
        style={{
          // 120.md §2 — the indicator is the bar's one white accent on purple.
          position: 'absolute', height: 2, borderRadius: 2, background: TB.ink,
          top: ind ? ind.top : 0, left: ind ? ind.left : 0,
          width: ind ? ind.width : 0, opacity: ind ? 1 : 0,
          transition: reduceMotion
            ? 'none'
            : 'left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1), top 0.16s ease',
        }}
      />
    </div>
  );
}

/* ── the toolbar ─────────────────────────────────────────────────────────────── */

/**
 * @param {object}   m             the useManuscript handle (the ONE state source).
 * @param {string}   tab           active destination id.
 * @param {function} onTabChange   (id) => void — the workspace owns refreshSyncPlan +
 *                                 the ?ms= URL round-trip, so this only reports.
 * @param {number}   stickyTop     sticky offset inside the ENGINE's scroller.
 *
 *   The plan called for `focusMode ? FOCUS_BAR_H : 0`. Verified against both shells,
 *   the correct value is 0 in BOTH modes, and the e2e Focus-Mode case pins it: the
 *   focus bar is a flex SIBLING of the scroller (StitchAppShell renders it before
 *   `<main>`; the legacy workspace renders its header above its own scroll div), so
 *   the scroller's top edge is already below the bar. Adding FOCUS_BAR_H would open a
 *   40px gap between the pinned toolbar and the chrome above it. The prop stays as
 *   the seam a host with in-scroller chrome would need.
 *
 * @param {node}     viewSwitcher  118.md §12 slot (Wave 2). Absent → nothing renders;
 *                                 §69 forbids shipping the control before it works.
 * @param {node|function} splitToggle  119.md §4 slot — "a clear toggle in the
 *                                 Manuscript Editor that allows the user to open a PDF
 *                                 from an included study beside the manuscript". It
 *                                 sits beside the save pill because it is a WORKSPACE
 *                                 layout control, not a document control: it stays
 *                                 visible at every density (like the pill and the
 *                                 navigation) instead of overflowing into '⋯', and it
 *                                 is not tab-scoped, because the pane is the layout of
 *                                 the whole workspace. Takes a node or a function of
 *                                 the bar's own density, exactly like `viewSwitcher`.
 */
export function ManuscriptToolbar({
  m, tab, onTabChange, stickyTop = 0, viewSwitcher = null, splitToggle = null,
  /* 119.md §7 — the structure control OPENS a dialog rather than committing a
     dropdown change: §7 requires a preview, a diff and a mapping step before any
     write, so the bar reports the intent and the workspace owns the surface. */
  onOpenStructure = null,
}) {
  const rootRef = useRef(null);
  const width = useContainerWidth(rootRef);
  const density = toolbarDensity(width);
  const reduceMotion = usePrefersReducedMotion();

  const draft = m.activeDraft || {};
  const drafts = m.drafts || [];
  const structure = useMemo(() => draftStructure(draft), [draft]);
  const structureLabel = structure.label || 'Generic biomedical IMRAD';
  const customizedStructure = !!(draft.structure && draft.structure.sections
    && draft.structure.sections.some((s) => s.retained));
  const badge = useMemo(() => updatesBadge(m.freshness, m.outdatedCount), [m.freshness, m.outdatedCount]);
  const draftTitle = draft.title || (drafts.length ? `Draft ${drafts.findIndex((d) => d.id === draft.id) + 1}` : '');

  // ARCH-118 non-negotiable — pending patches are flushed before the ACTIVE draft
  // changes (addDraft flushes itself inside the hook).
  const switchDraft = useCallback((id) => {
    if (m.flush) m.flush();
    m.setActiveId(id);
  }, [m]);

  const draftOptions = useMemo(
    () => drafts.map((d, i) => ({ id: d.id, label: d.title || `Draft ${i + 1}` })),
    [drafts],
  );

  const condensed = density !== 'full';
  const inline = levelAInline(density);
  const inMenu = LEVEL_A_CONTROLS.filter((k) => !inline.includes(k));

  /* Each Level-A control is built ONCE and then placed either in the bar or in the
     '⋯' menu (118.md §41) — the menu never renders a stand-in.
     120.md §2 — and each is told WHICH SURFACE it landed on: inline means the purple
     bar, overflowed means the menu's light card. The flag is derived from the same
     `inline` list that decides the placement, so the two can never disagree. */
  const onBar = (k) => inline.includes(k);
  const controls = {
    draft: drafts.length > 1 ? (
      <ToolbarSelect key="draft" label="Draft" testid="stitch-manuscript-draft-select" condensed={condensed}
        onDark={onBar('draft')}
        value={m.activeId || ''} onChange={(e) => switchDraft(e.target.value)} options={draftOptions} />
    ) : null,
    newDraft: (
      <NewDraftAction key="newDraft" currentTitle={draftTitle} condensed={condensed && inline.includes('newDraft')}
        onDark={onBar('newDraft')}
        onCreate={() => m.addDraft({})} />
    ),
    structure: (
      <ToolbarButton key="structure" label="Structure" testid="stitch-manuscript-structure-select" condensed={condensed}
        onDark={onBar('structure')}
        value={structureLabel} onClick={onOpenStructure}
        title={`Manuscript structure: ${structureLabel}${customizedStructure ? ' (customized)' : ''} — preview and switch reporting structures`} />
    ),
    template: (
      <ToolbarSelect key="template" label="Template" testid="stitch-manuscript-template-select" condensed={condensed}
        onDark={onBar('template')}
        value={draft.templateId} onChange={(e) => m.setMeta({ templateId: e.target.value })}
        options={JOURNAL_TEMPLATES} />
    ),
    citation: (
      <ToolbarSelect key="citation" label="Citation style" testid="stitch-manuscript-citation-select" condensed={condensed}
        onDark={onBar('citation')}
        value={draft.citationStyle} onChange={(e) => m.setMeta({ citationStyle: e.target.value })}
        options={CITATION_STYLES} />
    ),
    autoDraft: <AutoDraftNotice key="autoDraft" condensed={condensed} onDark={onBar('autoDraft')} />,
  };

  return (
    <div
      ref={rootRef}
      className="ms-toolbar"
      data-testid="stitch-manuscript-header"
      data-density={density}
      style={{
        // 118.md §7 — sticky INSIDE the manuscript engine. `top` is the engine
        // scroller's own edge; z stays under the shell (30) and every modal (60).
        position: 'sticky', top: stickyTop, zIndex: 20,
        /* 120.md §2 — ONE solid Pecan purple, in every mode: normal, sticky, each
           responsive density and Focus Mode (the bar has no separate full-screen
           variant — Focus Mode renders this same element, so there is nothing else to
           keep in step). It replaces the two-layer brand-tint gradient, and §7's
           original requirement is satisfied more simply than before: an opaque colour
           cannot let the document scroll visibly through the bar. */
        background: TB.bg,
        borderBottom: `1px solid ${TB.hairline}`,
        boxShadow: '0 8px 16px -14px var(--t-shadow)',
        // Bleed to the hosting card's edges so the bar reads as engine chrome rather
        // than another card floating in the content column. 14px is inside BOTH
        // shells' body padding (Stitch 20px, legacy ≥20px), so it never clips.
        margin: '-4px -14px 18px', padding: '9px 14px 0',
      }}
    >
      <style>{MANUSCRIPT_TOOLBAR_CSS}</style>

      {/* ── Level A — document controls (118.md §5) ── */}
      <div
        data-testid="stitch-manuscript-header-level-a"
        style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'nowrap', minWidth: 0, paddingBottom: 9 }}
      >
        {/* §4 — workspace identity. 120.md §2 — the bar itself is now the brand
            surface, so the chip stops being a purple-on-white badge and becomes a
            white-on-purple one: full-strength white type (6.79:1) inside a lightly
            lifted well, which is the strongest thing on the bar and therefore still
            reads as the identity rather than as another control. */}
        <span
          data-testid="stitch-manuscript-wordmark"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
            height: 26, padding: '0 10px 0 8px', borderRadius: 7,
            background: 'rgba(255,255,255,0.14)', border: `1px solid ${TB.chipBrd}`,
            color: TB.ink, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.2, whiteSpace: 'nowrap',
          }}
        >
          <Icon name="pencil" size={13} /> Manuscript
        </span>

        {/* §41 — whatever does not fit moves into the overflow menu, which renders
            the SAME live controls: nothing becomes unreachable, and nothing is
            duplicated (each control has exactly one home at any width). */}
        {inMenu.length > 0 && (
          <OverflowMenu>{inMenu.map((k) => controls[k])}</OverflowMenu>
        )}
        {inline.includes('draft') && controls.draft}
        {inline.includes('newDraft') && controls.newDraft}
        {(inline.includes('structure') || inline.includes('template')) && (
          // 120.md §2 — a white-tinted hairline; the legacy border token disappears
          // into the purple.
          <span aria-hidden="true" style={{ width: 1, height: 18, background: TB.divider, flexShrink: 0 }} />
        )}
        {/* 119.md §7 — the three format dimensions, left to right in the order they
            matter: which sections exist · how the journal wants them · how a
            citation reads. Three controls because they are three things. */}
        {inline.includes('structure') && controls.structure}
        {inline.includes('template') && controls.template}
        {inline.includes('citation') && controls.citation}
        {inline.includes('autoDraft') && (
          <span style={{ minWidth: 0, overflow: 'hidden', display: 'flex' }}>{controls.autoDraft}</span>
        )}

        {/* §44 — the save state, always visible, at the density the bar can afford.
            119.md §4 — the PDF-view toggle shares this right-hand group: both are
            workspace state rather than document controls, and both stay reachable at
            every width (§41 keeps only Level-A DOCUMENT controls in the '⋯' menu). */}
        <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {splitToggle && (typeof splitToggle === 'function' ? splitToggle({ condensed, density, onDark: true }) : splitToggle)}
          {/* 120.md §2 — the save pill is ALWAYS on the bar, so it always gets the
              on-purple skin (its legacy green/amber/red chips measured 1.8-2.8:1
              against the brand purple). */}
          <SaveStatusPill saveState={m.saveState} lastError={m.lastError} onRetry={m.retry} onDark />
        </span>
      </div>

      {/* ── Level B — workspace navigation (118.md §6) ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, minWidth: 0 }}>
        <ManuscriptWorkspaceNav tab={tab} onTabChange={onTabChange} badge={badge}
          density={density} reduceMotion={reduceMotion} />
        {/* 118.md §12 — RIGHT SLOT: the Section ⇄ Continuous view switcher belongs
            here and only on the Editor destination (it means nothing on the other
            seven). Wave 1 left the slot EMPTY rather than shipping a toggle with one
            working value (§69); Wave 2 fills it. The slot takes a NODE or a function
            of the bar's own density, so the switcher can condense with everything
            else (§41) without the workspace having to measure the toolbar. */}
        {/* 120.md §8 — 'PDF View' IS the Editor destination with the PDF pane open, so
            the view switcher belongs to it exactly as much as to 'editor'. Anything
            else here would make the Section/Continuous choice vanish the moment a
            researcher opened a PDF beside the text they are editing. */}
        {viewSwitcher && (tab === 'editor' || tab === 'pdfview') && (
          <span style={{ marginLeft: 'auto', paddingBottom: 6, flexShrink: 0 }}>
            {typeof viewSwitcher === 'function' ? viewSwitcher({ condensed, density, onDark: true }) : viewSwitcher}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 118.md §49 — while the manuscript is still resolving, the toolbar's SPACE is
 * reserved so the workspace does not jump when the real bar arrives. Nothing here
 * claims a value it does not have (no "Saved", no counts — §69).
 */
export function ManuscriptToolbarSkeleton() {
  // 120.md §2 — "any loading state that reproduces the toolbar" must carry the SAME
  // solid purple, or the bar visibly changes colour the moment the manuscript lands.
  const ghost = (w) => (
    <span aria-hidden="true" style={{ display: 'inline-block', width: w, height: 20, borderRadius: 6, background: TB.chipBg }} />
  );
  return (
    <div
      data-testid="stitch-manuscript-header-skeleton"
      aria-hidden="true"
      style={{
        background: TB.bg,
        borderBottom: `1px solid ${TB.hairline}`,
        boxShadow: '0 8px 16px -14px var(--t-shadow)',
        margin: '-4px -14px 18px', padding: '9px 14px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 9 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px 0 8px',
          borderRadius: 7, background: 'rgba(255,255,255,0.14)', border: `1px solid ${TB.chipBrd}`,
          color: TB.ink, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.2,
        }}>
          <Icon name="pencil" size={13} /> Manuscript
        </span>
        {ghost(150)}{ghost(120)}
      </div>
      <div style={{ display: 'flex', gap: 3, height: 37, alignItems: 'center' }}>
        {MANUSCRIPT_TABS.map((s) => <span key={s.id} style={{ display: 'inline-block', width: 12 + s.label.length * 7, height: 12, borderRadius: 6, background: TB.chipBg }} />)}
      </div>
    </div>
  );
}

export default ManuscriptToolbar;
