/**
 * StitchAppShell.jsx — the Stitch application shell.
 *
 * Desktop: fixed 72px primary rail + (optional) 280px contextual rail + a fluid
 * main workspace with a slim utility header. Below ~1024px the rails move into an
 * off-canvas drawer opened from the header hamburger (design.md responsive rules:
 * "no important content permanently off-screen", "no horizontal page overflow").
 *
 * The shell mounts StitchStyle (scoped tokens) and the toast provider so it's the
 * single place the Stitch CSS/cost is paid — and only when an admin actually
 * renders the Stitch UI. The shared domain logic lives in the page passed as
 * children; the shell only provides chrome.
 */
import { useState } from 'react';
import StitchStyle from '../theme/StitchStyle.jsx';
import { S } from '../theme/stitchTokens.js';
import { StitchToastProvider } from '../primitives/overlay.jsx';
import { StitchDrawer } from '../primitives/overlay.jsx';
import { StitchPrimaryRail, StitchTopHeader } from './shellParts.jsx';

const RESPONSIVE_CSS = `
@media (max-width: 1023px) {
  html[data-ui-design="stitch"] .stitch-desktop-nav { display: none !important; }
  html[data-ui-design="stitch"] .stitch-mobile-only { display: inline-flex !important; }
}
@media (min-width: 1024px) {
  html[data-ui-design="stitch"] .stitch-mobile-only { display: none !important; }
}
@media (max-width: 1279px) {
  html[data-ui-design="stitch"] .stitch-context-rail { display: none !important; }
}
`;

export default function StitchAppShell({
  activeKey, contextRail, breadcrumb, children, maxWidth = 1320, contentPad = true,
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <StitchToastProvider>
      <StitchStyle />
      <style>{RESPONSIVE_CSS}</style>
      <div className="stitch-scope" style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: S.surface, fontFamily: S.font, color: S.textPrimary }}>
        {/* Desktop rails */}
        <div className="stitch-desktop-nav" style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
          <StitchPrimaryRail activeKey={activeKey} />
          {contextRail ? <div className="stitch-context-rail" style={{ display: 'flex', height: '100%' }}>{contextRail}</div> : null}
        </div>

        {/* Mobile off-canvas nav (primary + context stacked) */}
        <StitchDrawer open={navOpen} onClose={() => setNavOpen(false)} side="left" width={352} label="Navigation">
          <div style={{ display: 'flex', height: '100%' }}>
            <StitchPrimaryRail activeKey={activeKey} />
            {contextRail ? <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex' }}>{contextRail}</div> : null}
          </div>
        </StitchDrawer>

        {/* Main column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <StitchTopHeader onOpenNav={() => setNavOpen(true)} breadcrumb={breadcrumb} />
          <main className="stitch-scope" style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            <div style={{ maxWidth, margin: '0 auto', padding: contentPad ? '24px' : 0, width: '100%' }}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </StitchToastProvider>
  );
}
