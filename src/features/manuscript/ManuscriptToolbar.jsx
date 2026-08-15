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
 * Styling: LEGACY tokens only (C/btnS/tagS + var(--t-*)) — this component renders in
 * BOTH shells and Stitch remaps the same custom properties. No Stitch S-token import.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { C, btnS, tagS } from '../../frontend/workspace/ui/styles.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { alpha } from '../../frontend/theme/tokens.js';
import Tooltip from '../../frontend/components/Tooltip.jsx';
// 117.md §44 — an overlay that consumes Escape must CLAIM the fullscreen exit that
// Escape also causes, or dismissing a popover drops the whole Focus-Mode layout.
import { markOverlayEscape } from '../../frontend/focus/overlayEscapeLatch.js';
import { CITATION_STYLES, JOURNAL_TEMPLATES } from '../../research-engine/manuscript/index.js';
import { SaveStatusPill } from './manuscriptPanels.jsx';

/* ── the eight workspace destinations (118.md §6) ───────────────────────────── */
export const MANUSCRIPT_TABS = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  { id: 'updates', label: 'Updates', icon: 'refresh' },
  { id: 'editor', label: 'Editor', icon: 'pencil' },
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

export function toolbarDensity(width) {
  const w = Number(width);
  if (!(w > 0)) return 'full'; // unmeasured (SSR / first paint) → the roomy layout
  if (w < TOOLBAR_BREAKPOINTS.minimal) return 'minimal';
  if (w < TOOLBAR_BREAKPOINTS.overflow) return 'overflow';
  if (w < TOOLBAR_BREAKPOINTS.compact) return 'compact';
  return 'full';
}

/** Every Level-A control, in the order a writer reaches for them. */
export const LEVEL_A_CONTROLS = ['draft', 'newDraft', 'template', 'citation', 'autoDraft'];

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
export const MANUSCRIPT_TOOLBAR_CSS = `
.ms-toolbar .ms-tb-select:focus-within{border-color:var(--t-acc);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--t-acc) 20%, transparent);}
.ms-toolbar .ms-tb-select select:focus{box-shadow:none !important;}
.ms-toolbar .ms-tb-select:hover{border-color:var(--t-brd2);}
.ms-toolbar .ms-nav-tab:hover{color:var(--t-txt);}
.ms-toolbar .ms-nav-tab[data-active="true"]:hover{color:var(--t-acc);}
.ms-toolbar .ms-tb-action:hover{border-color:var(--t-brd2);color:var(--t-txt);background:var(--t-card2);}
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

/** A subtle text action — 118.md §9: reserve real buttons for real primary actions. */
const subtleAction = (active) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
  background: active ? alpha(C.acc, '14') : 'transparent',
  border: `1px solid ${active ? alpha(C.acc, '38') : C.brd}`,
  color: active ? C.acc : C.txt2,
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
export function ToolbarSelect({ label, value, onChange, options, testid, condensed }) {
  return (
    <span
      data-testid={testid}
      className="ms-tb-select"
      style={{
        display: 'inline-flex', alignItems: 'center', height: 28, maxWidth: condensed ? 210 : 300,
        background: C.card2, border: `1px solid ${C.brd}`, borderRadius: 8,
        flexShrink: 1, minWidth: 0,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <span style={{
        padding: '0 1px 0 10px', fontSize: 10.5, fontWeight: 700, color: C.muted,
        letterSpacing: 0.3, whiteSpace: 'nowrap', flexShrink: 0,
      }}>{label}:</span>
      <select
        aria-label={label}
        value={value}
        onChange={onChange}
        style={{
          appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
          background: 'transparent', border: 'none', outline: 'none',
          color: C.txt, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 11.5, fontWeight: 600,
          padding: '0 20px 0 5px', height: 26, cursor: 'pointer',
          textOverflow: 'ellipsis', minWidth: 0, maxWidth: '100%',
        }}
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <span aria-hidden="true" style={{
        marginLeft: -17, marginRight: 6, pointerEvents: 'none', color: C.muted,
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
export function AutoDraftNotice({ condensed }) {
  return (
    <span
      data-testid="stitch-manuscript-autodraft"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        height: 24, padding: '0 8px 0 7px', borderRadius: 7,
        background: alpha(C.yel, '12'), border: `1px solid ${alpha(C.yel, '30')}`,
        color: C.txt2, fontSize: 11, minWidth: 0,
      }}
    >
      <Icon name="alertTriangle" size={12} style={{ color: C.yel, flexShrink: 0 }} />
      <span style={{ color: C.yel, fontWeight: 700 }}>Auto-draft</span>
      {!condensed && (
        <span style={{ color: C.txt2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          · Verify generated content before submission
        </span>
      )}
      <Tooltip content={AUTO_DRAFT_FULL} placement="bottom">
        <button
          type="button"
          data-testid="stitch-manuscript-autodraft-info"
          aria-label={AUTO_DRAFT_FULL}
          title={AUTO_DRAFT_FULL}
          style={{
            width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
            border: `1px solid ${alpha(C.yel, '44')}`, background: 'transparent', color: C.yel,
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
  return (
    <div
      role="dialog"
      aria-label="Start a new draft"
      data-testid="stitch-manuscript-new-draft-popover"
      style={{ ...popoverCard, top: 'calc(100% + 7px)', left: 0, width: 288, padding: 12 }}
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

function NewDraftAction({ currentTitle, onCreate, condensed }) {
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
        className="ms-tb-action"
        style={subtleAction(open)}
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
        className="ms-tb-action"
        style={{ ...subtleAction(open), padding: '0 9px', fontSize: 14, lineHeight: '26px' }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <>
          <div data-testid="stitch-manuscript-toolbar-overflow-catcher" onClick={close}
            style={{ position: 'fixed', inset: 0, zIndex: CATCHER_Z, background: 'transparent' }} />
          <div
            role="menu"
            aria-label="Document controls"
            data-testid="stitch-manuscript-toolbar-overflow-menu"
            style={{ ...popoverCard, top: 'calc(100% + 7px)', right: 0, width: 268, padding: 12 }}
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

  // 118.md §42 — APG tablist keyboard model (roving tabindex + arrows/Home/End).
  // Deliberately NO modifier chords here: Ctrl/Cmd+Z and friends must reach the
  // editor untouched (§43).
  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const i = MANUSCRIPT_TAB_IDS.indexOf(tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % MANUSCRIPT_TAB_IDS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + MANUSCRIPT_TAB_IDS.length) % MANUSCRIPT_TAB_IDS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = MANUSCRIPT_TAB_IDS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = MANUSCRIPT_TAB_IDS[next];
    onTabChange(id);
    const el = tabRefs.current[id];
    if (el && el.focus) el.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Manuscript workspace"
      aria-orientation="horizontal"
      data-testid="stitch-manuscript-nav"
      onKeyDown={onKeyDown}
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
            tabIndex={active ? 0 : -1}
            data-testid={`stitch-manuscript-subtab-${s.id}`}
            data-active={active ? 'true' : undefined}
            onClick={() => onTabChange(s.id)}
            className="ms-nav-tab"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: condensed ? 0 : 6,
              background: 'transparent', border: 'none',
              // The active underline is drawn by the sliding indicator once it has
              // measured; until then (SSR / no-JS / no-ResizeObserver) the tab paints
              // its own, so the active destination is NEVER ambiguous (§6).
              borderBottom: `2px solid ${active && !ind ? C.acc : 'transparent'}`,
              padding: condensed ? '8px 9px' : '9px 13px',
              margin: 0, cursor: 'pointer',
              fontFamily: "'IBM Plex Sans',sans-serif",
              fontSize: condensed ? 11.5 : 12.5,
              fontWeight: active ? 700 : 600,
              letterSpacing: 0.1,
              color: active ? C.acc : C.txt2,
              whiteSpace: 'nowrap',
              transition: reduceMotion ? 'none' : 'color 0.16s ease',
            }}
          >
            {!condensed && <Icon name={s.icon} size={13} />}
            {s.label}
            {b && (
              <span
                data-testid="stitch-manuscript-updates-badge"
                aria-label={`${b.count} update${b.count === 1 ? '' : 's'} to review`}
                title={`${b.count} update${b.count === 1 ? '' : 's'} to review`}
                style={{
                  ...tagS(b.tone), marginLeft: 6, padding: '0 6px',
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
          position: 'absolute', height: 2, borderRadius: 2, background: C.acc,
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
 */
export function ManuscriptToolbar({ m, tab, onTabChange, stickyTop = 0, viewSwitcher = null }) {
  const rootRef = useRef(null);
  const width = useContainerWidth(rootRef);
  const density = toolbarDensity(width);
  const reduceMotion = usePrefersReducedMotion();

  const draft = m.activeDraft || {};
  const drafts = m.drafts || [];
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
     '⋯' menu (118.md §41) — the menu never renders a stand-in. */
  const controls = {
    draft: drafts.length > 1 ? (
      <ToolbarSelect key="draft" label="Draft" testid="stitch-manuscript-draft-select" condensed={condensed}
        value={m.activeId || ''} onChange={(e) => switchDraft(e.target.value)} options={draftOptions} />
    ) : null,
    newDraft: (
      <NewDraftAction key="newDraft" currentTitle={draftTitle} condensed={condensed && inline.includes('newDraft')}
        onCreate={() => m.addDraft({})} />
    ),
    template: (
      <ToolbarSelect key="template" label="Template" testid="stitch-manuscript-template-select" condensed={condensed}
        value={draft.templateId} onChange={(e) => m.setMeta({ templateId: e.target.value })}
        options={JOURNAL_TEMPLATES} />
    ),
    citation: (
      <ToolbarSelect key="citation" label="Citation style" testid="stitch-manuscript-citation-select" condensed={condensed}
        value={draft.citationStyle} onChange={(e) => m.setMeta({ citationStyle: e.target.value })}
        options={CITATION_STYLES} />
    ),
    autoDraft: <AutoDraftNotice key="autoDraft" condensed={condensed} />,
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
        // §7 — a SOLID surface, or the document scrolls visibly through the bar.
        // The brand tint is two near-transparent layers over an opaque token, so
        // the composite is still fully opaque (§4: distinguish, do not repaint).
        background: `linear-gradient(180deg, ${alpha(C.acc, '0d')}, ${alpha(C.acc, '05')}), ${C.card}`,
        borderBottom: `1px solid ${alpha(C.acc, '2b')}`,
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
        {/* §4 — workspace identity. Brand colour is spent in exactly three places —
            this chip, the active-destination underline and the bar's own hairline
            tint — so the toolbar reads as a hierarchy rather than a wall of purple
            controls ("do not simply make every control purple"). */}
        <span
          data-testid="stitch-manuscript-wordmark"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
            height: 26, padding: '0 10px 0 8px', borderRadius: 7,
            background: alpha(C.acc, '12'), border: `1px solid ${alpha(C.acc, '30')}`,
            color: C.acc, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.2, whiteSpace: 'nowrap',
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
        {inline.includes('template') && (
          <span aria-hidden="true" style={{ width: 1, height: 18, background: C.brd, flexShrink: 0 }} />
        )}
        {inline.includes('template') && controls.template}
        {inline.includes('citation') && controls.citation}
        {inline.includes('autoDraft') && (
          <span style={{ minWidth: 0, overflow: 'hidden', display: 'flex' }}>{controls.autoDraft}</span>
        )}

        {/* §44 — the save state, always visible, at the density the bar can afford. */}
        <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
          <SaveStatusPill saveState={m.saveState} lastError={m.lastError} onRetry={m.retry} />
        </span>
      </div>

      {/* ── Level B — workspace navigation (118.md §6) ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, minWidth: 0 }}>
        <ManuscriptWorkspaceNav tab={tab} onTabChange={onTabChange} badge={badge}
          density={density} reduceMotion={reduceMotion} />
        {/* 118.md §12 — RIGHT SLOT: the Section ⇄ Continuous view switcher belongs
            here and only on the Editor destination. Wave 1 deliberately leaves the
            slot EMPTY rather than shipping a toggle with one working value — §69
            ("do not create fake controls"). Wave 2 passes `viewSwitcher`. */}
        {viewSwitcher && tab === 'editor' && (
          <span style={{ marginLeft: 'auto', paddingBottom: 6, flexShrink: 0 }}>{viewSwitcher}</span>
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
  const ghost = (w) => (
    <span aria-hidden="true" style={{ display: 'inline-block', width: w, height: 20, borderRadius: 6, background: C.card2 }} />
  );
  return (
    <div
      data-testid="stitch-manuscript-header-skeleton"
      aria-hidden="true"
      style={{
        background: `linear-gradient(180deg, ${alpha(C.acc, '0d')}, ${alpha(C.acc, '05')}), ${C.card}`,
        borderBottom: `1px solid ${alpha(C.acc, '2b')}`,
        boxShadow: '0 8px 16px -14px var(--t-shadow)',
        margin: '-4px -14px 18px', padding: '9px 14px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 9 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px 0 8px',
          borderRadius: 7, background: alpha(C.acc, '12'), border: `1px solid ${alpha(C.acc, '30')}`,
          color: C.acc, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.2,
        }}>
          <Icon name="pencil" size={13} /> Manuscript
        </span>
        {ghost(150)}{ghost(120)}
      </div>
      <div style={{ display: 'flex', gap: 3, height: 37, alignItems: 'center' }}>
        {MANUSCRIPT_TABS.map((s) => <span key={s.id} style={{ display: 'inline-block', width: 12 + s.label.length * 7, height: 12, borderRadius: 6, background: C.card2 }} />)}
      </div>
    </div>
  );
}

export default ManuscriptToolbar;
