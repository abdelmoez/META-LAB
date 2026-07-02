/**
 * DesignRoute.jsx — per-route presentation selector.
 *
 * The clean "select the shell + page once" mechanism design.md §"NEW DESIGN
 * ARCHITECTURE" asks for: each app route declares its LEGACY element and an
 * optional lazy STITCH element. Domain logic, data loaders, and permissions live
 * BELOW both — only the presentation differs.
 *
 *   <DesignRoute legacy={<AppWorkspace />} stitch={<StitchWorkspace />} />
 *
 * Resolution: render `stitch` when the resolved design mode is Stitch (65.md: the
 * product default for everyone) AND a Stitch presentation was provided; otherwise
 * render `legacy` (Ops-enabled fallback / admin preference / routes without a
 * Stitch page yet). Anything the Stitch subtree throws is caught by
 * StitchErrorBoundary (reload / back to dashboard; classic-UI escape is
 * admin-only). The Stitch element is a lazily-imported component, so legacy
 * sessions never download the Stitch bundle.
 */
import { Suspense } from 'react';
import { useDesignMode } from './DesignModeContext.jsx';
import StitchErrorBoundary from './StitchErrorBoundary.jsx';

/** Minimal Stitch-toned chunk-loading state (no dependency on the Stitch bundle). */
function StitchRouteFallback() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f7f9ff',
      }}
    >
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        border: '3px solid #e5e8ef', borderTopColor: '#5d509b',
        animation: 'stitchRouteSpin 0.7s linear infinite',
      }} />
      <style>{`@keyframes stitchRouteSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { [aria-busy="true"] > div { animation: none; } }`}</style>
    </div>
  );
}

export default function DesignRoute({ legacy, stitch }) {
  const { isStitch } = useDesignMode();

  if (isStitch && stitch) {
    return (
      <StitchErrorBoundary>
        <Suspense fallback={<StitchRouteFallback />}>
          {stitch}
        </Suspense>
      </StitchErrorBoundary>
    );
  }

  return legacy;
}
