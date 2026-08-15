/**
 * StitchAppShell.jsx — the Stitch application shell.
 *
 * Desktop: a fixed primary rail + (optional) contextual rail + a fluid main
 * workspace with a slim utility header. Below ~1024px the rails move into an
 * off-canvas drawer opened from the header hamburger (design.md responsive rules:
 * "no important content permanently off-screen", "no horizontal page overflow").
 *
 * 56.md §2 — for the PROJECT workspace the primary (purple) rail and the white
 * contextual submenu are ONE coordinated region (`coordinatedNav`): a single CSS
 * width variable (`--prail-w`) drives the rail width AND the submenu's left offset
 * so the two ALWAYS move together and the submenu can never be covered or clipped.
 * The rail expands on hover / keyboard focus (overlay — content does not reflow) or
 * stays open when `pinned` (content reflows once). Global pages (dashboard, profile,
 * ops) keep the simple side-by-side layout.
 *
 * The shell mounts StitchStyle (scoped tokens) and the toast provider so it's the
 * single place the Stitch CSS/cost is paid — and only when an admin actually
 * renders the Stitch UI. The shared domain logic lives in the page passed as
 * children; the shell only provides chrome.
 *
 * 117.md §42/§43 — in Focus Mode the rails are still UNMOUNTED (that is what makes
 * the mode worth having), but they are no longer unreachable: a left edge hover
 * zone and a hamburger both open ONE overlay drawer that renders those very rails.
 * There are now three nav surfaces in this file and they are deliberately
 * distinct — the desktop rails (>=1024px, in flow), the responsive off-canvas
 * StitchDrawer (<1024px, modal), and the focus drawer (Focus Mode only, non-modal
 * overlay). None of them shares state with another.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import StitchStyle from '../theme/StitchStyle.jsx';
import { S, salpha } from '../theme/stitchTokens.js';
import { StitchToastProvider } from '../primitives/overlay.jsx';
import { StitchDrawer } from '../primitives/overlay.jsx';
import { StitchIconButton } from '../primitives/core.jsx';
import { StitchPrimaryRail, StitchTopHeader } from './shellParts.jsx';
import { useFocusSurface, FocusSurface, useFocusNav } from '../../focus/FocusModeContext.jsx';
import {
  FocusToggle, FocusNavMenuButton, FOCUS_NAV_DRAWER_ID, FOCUS_BAR_H,
} from '../../focus/FocusControls.jsx';
// 108.md §24 — the ONE answer to "is a dialog on screen?". 117.md §42 uses it to
// keep the edge reveal inert behind a modal.
import { isAnyModalOpen } from '../../../research-engine/interaction/modalSignal.js';
// 117.md §44 — the drawer's own Escape is an overlay's Escape.
import { markOverlayEscape } from '../../focus/overlayEscapeLatch.js';

const RESPONSIVE_CSS = `
@media (max-width: 1023px) {
  html[data-ui-design="stitch"] .stitch-desktop-nav { display: none !important; }
  html[data-ui-design="stitch"] .stitch-mobile-only { display: inline-flex !important; }
}
@media (min-width: 1024px) {
  html[data-ui-design="stitch"] .stitch-mobile-only { display: none !important; }
}
/* The contextual column is hidden exactly where the off-canvas drawer takes over
   (< 1024px), so there is never a band where it is hidden with no way to reopen it
   (the drawer's hamburger only appears < 1024px). On small laptops / tablet
   landscape (1024–1279px) it stays visible. */
@media (max-width: 1023px) {
  html[data-ui-design="stitch"] .stitch-context-rail { display: none !important; }
}
/* 117.md §42 — the focus nav drawer slides; under prefers-reduced-motion it just
   appears, which is still correct (the state change is what carries the meaning). */
@media (prefers-reduced-motion: reduce) {
  html[data-ui-design="stitch"] .stitch-focus-nav,
  html[data-ui-design="stitch"] .stitch-focus-main { transition: none !important; }
}
`;

/**
 * The floor: a focused page that supplies no navigation of its own still gets a
 * way out and a sense of place. Never rendered by the project workspace (which
 * passes a real FocusNavBar) — this exists so opting a page into Focus Mode can
 * never strand a user.
 */
function DefaultFocusBar({ breadcrumb }) {
  return (
    <div data-testid="focus-nav-bar" style={{
      display: 'flex', alignItems: 'center', gap: 10, height: 40, flexShrink: 0, padding: '0 14px',
      borderBottom: `1px solid ${S.outlineVariant}`, background: S.surface, position: 'sticky', top: 0, zIndex: 30,
    }}>
      {/* 117.md §43 — parity with the workspace bar. A page focused through the
          default bar (Project Overview) hides exactly the same navigation, so it
          needs exactly the same way back to it. */}
      <FocusNavMenuButton size="sm" />
      <FocusToggle size="sm" />
      <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: S.textSecondary, fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        {breadcrumb}
      </div>
    </div>
  );
}

/* ═══════════════ 117.md §42/§43 — the focus nav drawer ═══════════════ */

/** Width of the revealed drawer — the same as the mobile off-canvas nav, so the
 *  same rail renders at the same size wherever it appears as a drawer. */
const FOCUS_NAV_W = 288;
/** The hover zone. 6px: reachable by throwing the pointer at the screen edge (the
 *  edge is an infinitely tall target) without stealing clicks from the workspace. */
const EDGE_ZONE_W = 6;
/** How long the pointer must REST at the edge before the drawer opens. 117.md §42
 *  — "do not make it irritatingly sensitive". A pointer merely travelling past is
 *  long gone before this elapses. */
const REVEAL_DWELL_MS = 200;
/** Grace after the pointer leaves the drawer — enough to overshoot a menu item or
 *  cross a gap, short enough that it never feels stuck open. */
const AUTO_HIDE_MS = 400;
/** Slide duration, mirrored in the visibility handoff below. */
const SLIDE_MS = 220;

/**
 * The navigation Focus Mode hid, one gesture away.
 *
 * 117.md §42 is explicit that the researcher must still reach the left menu, and
 * §43 that a hamburger must reach the same thing. So there is ONE drawer with
 * three doors (edge dwell, hamburger, restored pin) over one reducer, and it
 * renders the REAL rails — the props the shell was already given — never a second
 * navigation model built for this surface.
 *
 * MOUNTING. The rails run live subscriptions (presence, screening summary
 * polling); that is why Focus Mode unmounts them in the first place. Mounting
 * them on FIRST reveal and then keeping them mounted for the rest of the focused
 * session is the compromise that costs nothing until the drawer is used and does
 * not re-subscribe on every peek. Closed, the panel is translated off-screen and
 * `visibility: hidden` — which, unlike `opacity: 0` or a transform alone, also
 * takes its links out of the tab order and out of the accessibility tree, so a
 * keyboard user never tabs into an invisible menu.
 *
 * INERT BEHIND A DIALOG. A modal's backdrop already sits above the hover zone, so
 * the pointer can't reach it; the explicit isAnyModalOpen() checks cover the rest
 * (a dialog opening DURING the dwell, and Escape ownership).
 */
function FocusNavOverlay({ renderRail, contextRail }) {
  const {
    navOpen, navPinned, navState, revealNav, hideNav, dismissNav, toggleNavPin,
  } = useFocusNav();
  const panelRef = useRef(null);
  const dwellTimer = useRef(null);
  const hideTimer = useRef(null);
  // "Has this drawer ever been opened?" — a ref, not state: it only ever flips on
  // a render that navOpen already caused, so it never needs to schedule one of
  // its own, and it must survive every close for the rest of the session.
  const everRevealed = useRef(false);
  if (navOpen) everRevealed.current = true;

  const clearDwell = useCallback(() => {
    if (dwellTimer.current) { clearTimeout(dwellTimer.current); dwellTimer.current = null; }
  }, []);
  const clearHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);
  useEffect(() => () => { clearDwell(); clearHide(); }, [clearDwell, clearHide]);

  const onZoneEnter = useCallback(() => {
    clearHide();
    if (navOpen || isAnyModalOpen()) return;
    clearDwell();
    dwellTimer.current = setTimeout(() => {
      dwellTimer.current = null;
      if (isAnyModalOpen()) return;      // a dialog went up during the dwell
      revealNav();
    }, REVEAL_DWELL_MS);
  }, [clearDwell, clearHide, navOpen, revealNav]);

  const onPanelEnter = useCallback(() => { clearDwell(); clearHide(); }, [clearDwell, clearHide]);

  const startAutoHide = useCallback(() => {
    clearHide();
    if (navPinned) return;               // pinned is exactly "auto-hide does not apply"
    hideTimer.current = setTimeout(() => { hideTimer.current = null; hideNav(); }, AUTO_HIDE_MS);
  }, [clearHide, hideNav, navPinned]);

  // Leaving the zone arms the auto-hide too, not just leaving the panel: a reveal
  // triggered up in the bar's own row (above the panel) would otherwise stay open
  // forever, because the pointer never entered the panel to leave it. Moving from
  // the zone INTO the panel fires this and then onPanelEnter, which cancels it.
  const onZoneLeave = useCallback(() => {
    clearDwell();
    if (navOpen) startAutoHide();
  }, [clearDwell, navOpen, startAutoHide]);

  // A click anywhere else dismisses a temporarily-open drawer — the behaviour any
  // overlay menu owes. The hamburger is excluded, or the click that closes the
  // drawer would be immediately undone by the toggle it landed on.
  useEffect(() => {
    if (!navOpen || navPinned || typeof document === 'undefined') return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (panelRef.current && t && panelRef.current.contains(t)) return;
      if (t && typeof t.closest === 'function' && t.closest('[data-focus-nav-toggle]')) return;
      clearHide();
      hideNav();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [navOpen, navPinned, hideNav, clearHide]);

  // Escape closes the DRAWER before it closes Focus Mode — the nearest overlay
  // wins, which is the same rule the modals follow (document capture, then
  // stopPropagation so the provider's window listener never sees it).
  //
  // 117.md §44 — and it marks the latch, because in real fullscreen this same
  // press also makes the browser leave fullscreen; without the mark the app would
  // read that as "the researcher left full screen" and drop the whole layout.
  //
  // PINNED IS DIFFERENT ON PURPOSE: a pinned drawer is furniture, not an overlay,
  // so it does not eat the key — Escape still means "get me out of Focus Mode".
  useEffect(() => {
    if (!navOpen || navPinned || typeof document === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (isAnyModalOpen()) return;      // a dialog is nearer than we are
      markOverlayEscape();
      e.stopPropagation();
      clearHide();
      dismissNav();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [navOpen, navPinned, dismissNav, clearHide]);

  return (
    <>
      <div
        data-testid="focus-edge-zone"
        aria-hidden="true"
        onPointerEnter={onZoneEnter}
        onPointerLeave={onZoneLeave}
        style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: EDGE_ZONE_W, zIndex: 44 }}
      />
      <aside
        id={FOCUS_NAV_DRAWER_ID}
        ref={panelRef}
        data-testid="focus-nav-drawer"
        data-state={navState}
        aria-label="Navigation"
        className="stitch-scope stitch-focus-nav"
        onPointerEnter={onPanelEnter}
        onPointerLeave={startAutoHide}
        style={{
          // BELOW the focus bar, not over it. In Focus Mode that bar is the only
          // chrome there is — covering it would bury the hamburger under the very
          // drawer it toggles, and take Previous/Next and the exit with it.
          position: 'fixed', top: FOCUS_BAR_H, bottom: 0, left: 0, width: FOCUS_NAV_W, maxWidth: '88%',
          zIndex: 45, display: 'flex', flexDirection: 'column', background: S.card,
          borderRight: `1px solid ${salpha(S.outlineVariant, 0.5)}`,
          boxShadow: navOpen ? S.shadow2 : 'none',
          transform: navOpen ? 'none' : 'translateX(-100%)',
          visibility: navOpen ? 'visible' : 'hidden',
          // The visibility flip waits for the slide OUT and leads the slide IN, so
          // the panel is never both invisible and on screen.
          transition: navOpen
            ? `transform ${SLIDE_MS}ms ease, visibility 0s`
            : `transform ${SLIDE_MS}ms ease, visibility 0s linear ${SLIDE_MS}ms`,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, height: FOCUS_BAR_H, flexShrink: 0,
          padding: '0 6px 0 14px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.4)}`,
        }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: S.font, fontSize: 12.5, fontWeight: 700, color: S.textSecondary }}>
            Navigation
          </span>
          <StitchIconButton
            icon="pin"
            label={navPinned ? 'Unpin navigation' : 'Pin navigation open'}
            size="sm"
            active={navPinned}
            onClick={toggleNavPin}
            data-testid="focus-nav-pin"
          />
          <StitchIconButton
            icon="x"
            label="Close navigation"
            size="sm"
            onClick={dismissNav}
            data-testid="focus-nav-close"
          />
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {everRevealed.current ? (
            <>
              {/* The `mobile` variant is the always-expanded, in-flow column — the
                  right shape for a drawer, and the same one the off-canvas nav
                  above uses. Its own pin control is suppressed by that variant, so
                  the server-backed rail pin and this session pin never collide. */}
              <div style={{ flexShrink: 0, background: '#5d509c' }}>{renderRail('mobile')}</div>
              {contextRail ? <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{contextRail}</div> : null}
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}

export default function StitchAppShell({
  activeKey, contextRail, contextRailMobile, breadcrumb, children, maxWidth = 1320, contentPad = true,
  renderPrimaryRail, topPresence = null, coordinatedNav = false, pinned = false, chatContext = null,
  docTitle = null, headerProgress = null,
  // 104.md Part 1 — Focus Mode. Opt-in per page: `focusable` declares that this
  // surface has chrome worth hiding AND a way to navigate without it. The
  // dashboard/profile do NOT opt in — stripping their nav would strand the user
  // with no route out. `focusBar` is the minimal navigation the page supplies in
  // place of the hidden chrome; without one, the shell renders a safe default.
  focusable = false, focusBar = null,
}) {
  // The RESPONSIVE off-canvas nav (< 1024px). Renamed away from `navOpen` in
  // 117.md §42/§43 so it is never confused with the focus nav drawer below —
  // different trigger, different lifetime, different state.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { focus } = useFocusSurface(focusable);
  const focused = focusable && focus;
  // 117.md §43 — a PINNED focus drawer is furniture, so the workspace makes room
  // for it instead of sitting underneath (which would also bury the hamburger).
  const { navPinned } = useFocusNav();
  const navReserve = focused && navPinned ? FOCUS_NAV_W : 0;

  // 65.md NAV-2 — per-route tab titles. Pages that know more (project workspace)
  // pass `docTitle`; otherwise a string breadcrumb ("Dashboard · Projects") is a
  // good tab label; the bare suffix is the safe floor.
  const titleParts = docTitle != null
    ? (Array.isArray(docTitle) ? docTitle : [docTitle])
    : (typeof breadcrumb === 'string' ? [breadcrumb] : []);
  useDocumentTitle(...titleParts);

  // The primary rail is pluggable: global pages use the default global rail; the
  // project workspace passes its own collapsible workflow rail. `variant` lets the
  // rail render differently on desktop (collapsible overlay) vs the mobile drawer
  // (a static, always-expanded column).
  const rail = (variant) => (renderPrimaryRail ? renderPrimaryRail(variant) : <StitchPrimaryRail activeKey={activeKey} />);

  // In the mobile drawer the rail (full-label) and the contextual submenu STACK
  // vertically (one scroll column) so a phone never shows two side-by-side
  // sidebars (design2.md). Pages can suppress the mobile submenu with
  // contextRailMobile={null}; otherwise it defaults to the desktop submenu.
  const mobileContext = contextRailMobile !== undefined ? contextRailMobile : contextRail;

  return (
    <FocusSurface enabled={focusable}>
    <StitchToastProvider>
      <StitchStyle />
      <style>{RESPONSIVE_CSS}</style>
      <div className="stitch-scope" data-testid="stitch-app-shell" data-focused={focused ? 'true' : undefined} style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: S.surface, fontFamily: S.font, color: S.textPrimary }}>
        {/* Desktop rails — removed entirely in Focus Mode. `display:none` would be
            cheaper, but the rails run live subscriptions (presence, screening
            summary polling); unmounting them is the honest reading of "remove all
            unnecessary interface chrome". The body is a SIBLING, so its subtree is
            untouched either way and nothing in the workspace remounts. */}
        {focused ? null : coordinatedNav ? (
          // 56.md §2 — the rail + white submenu are ONE coordinated region; the
          // shell CSS (`.stitch-wsnav*`) keeps the submenu attached at left:
          // var(--prail-w) so it moves WITH the rail (never covered/clipped).
          <div className="stitch-desktop-nav stitch-wsnav" data-pinned={pinned ? 'true' : undefined} data-has-submenu={contextRail ? 'true' : undefined}>
            <div className="stitch-wsnav-rail">{rail('desktop')}</div>
            {contextRail ? <div className="stitch-wsnav-sub">{contextRail}</div> : null}
          </div>
        ) : (
          <div className="stitch-desktop-nav" style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
            {rail('desktop')}
            {contextRail ? <div className="stitch-context-rail" style={{ display: 'flex', height: '100%' }}>{contextRail}</div> : null}
          </div>
        )}

        {/* Mobile off-canvas nav (primary + context STACKED vertically) */}
        {focused ? null : (
          <StitchDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} side="left" width={288} label="Navigation">
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <div style={{ flexShrink: 0, background: '#5d509c' }}>{rail('mobile')}</div>
              {mobileContext ? <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{mobileContext}</div> : null}
            </div>
          </StitchDrawer>
        )}

        {/* 117.md §42/§43 — Focus Mode's own way back to the navigation: an edge
            hover zone and an overlay drawer holding the SAME rails the branch
            above unmounted. Only in the focused branch, so the normal layout is
            byte-for-byte what it was. */}
        {focused ? <FocusNavOverlay renderRail={rail} contextRail={mobileContext} /> : null}

        {/* Main column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {focused
            ? (focusBar || <DefaultFocusBar breadcrumb={breadcrumb} />)
            : <StitchTopHeader onOpenNav={() => setMobileNavOpen(true)} breadcrumb={breadcrumb} topPresence={topPresence} chatContext={chatContext} headerProgress={headerProgress} />}
          {/* 117.md §43 — a PINNED focus drawer is furniture, so the workspace
              makes room for it instead of sitting underneath. The reserve is on
              the CONTENT, not the column: the focus bar keeps the full width, so
              the hamburger that unpins stays exactly where it was. Nothing is
              added to the markup outside Focus Mode. */}
          <main
            className={focused ? 'stitch-scope stitch-focus-main' : 'stitch-scope'}
            data-testid="stitch-main-content"
            style={{
              flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden',
              ...(focused ? { marginLeft: navReserve, transition: `margin-left ${SLIDE_MS}ms ease` } : null),
            }}
          >
            {/* Focus Mode reclaims BOTH axes: the rail's width is gone, so the
                content max-width is lifted (pages that need a reading column —
                the manuscript editor, the protocol — already cap themselves) and
                the padding tightens. This is the "avoid large empty margins left
                behind by removed navigation" rule. */}
            <div style={{
              maxWidth: focused ? 100000 : maxWidth,
              margin: '0 auto',
              padding: contentPad ? (focused ? '16px 20px 28px' : '24px') : 0,
              width: '100%',
            }}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </StitchToastProvider>
    </FocusSurface>
  );
}
