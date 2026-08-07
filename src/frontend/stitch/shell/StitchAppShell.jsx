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
 */
import { useState } from 'react';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import StitchStyle from '../theme/StitchStyle.jsx';
import { S } from '../theme/stitchTokens.js';
import { StitchToastProvider } from '../primitives/overlay.jsx';
import { StitchDrawer } from '../primitives/overlay.jsx';
import { StitchPrimaryRail, StitchTopHeader } from './shellParts.jsx';
import { useFocusSurface, FocusSurface } from '../../focus/FocusModeContext.jsx';
import { FocusToggle } from '../../focus/FocusControls.jsx';

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
      <FocusToggle size="sm" />
      <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: S.textSecondary, fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        {breadcrumb}
      </div>
    </div>
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
  const [navOpen, setNavOpen] = useState(false);
  const { focus } = useFocusSurface(focusable);
  const focused = focusable && focus;

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
          <StitchDrawer open={navOpen} onClose={() => setNavOpen(false)} side="left" width={288} label="Navigation">
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <div style={{ flexShrink: 0, background: '#5d509c' }}>{rail('mobile')}</div>
              {mobileContext ? <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{mobileContext}</div> : null}
            </div>
          </StitchDrawer>
        )}

        {/* Main column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {focused
            ? (focusBar || <DefaultFocusBar breadcrumb={breadcrumb} />)
            : <StitchTopHeader onOpenNav={() => setNavOpen(true)} breadcrumb={breadcrumb} topPresence={topPresence} chatContext={chatContext} headerProgress={headerProgress} />}
          <main className="stitch-scope" data-testid="stitch-main-content" style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}>
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
