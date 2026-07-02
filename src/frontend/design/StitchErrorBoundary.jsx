/**
 * StitchErrorBoundary.jsx — failure containment for the Stitch presentation layer.
 *
 * design.md §"ERROR BOUNDARIES" + 65.md: if any Stitch page or the Stitch shell
 * throws while rendering, we must NOT show a silent white screen. Every user gets
 * a calm recovery panel — reload the page, or go back to the dashboard. Both are
 * hard navigations, so they work even when React state is wedged, and neither can
 * trigger a destructive backend operation.
 *
 * The "Switch to classic UI" escape is ADMIN-ONLY (Stitch is the sole normal-user
 * experience — sending a non-admin to legacy would strand them somewhere the
 * provider immediately resolves them out of, and the server 403s the persist).
 * For an admin it persists `legacy`, sets the root attr, and hard-navigates with
 * `?ui=legacy` — deliberately low-level so it works independent of React.
 *
 * A presentation crash must never corrupt data or preferences, so the only state
 * this touches is the (admin's) design-mode preference itself.
 */
import { Component } from 'react';
import { saveDesignMode, applyDesignAttr } from './designMode.js';
import { useDesignMode } from './DesignModeContext.jsx';

function escapeToLegacy() {
  try { saveDesignMode('legacy'); } catch { /* ignore */ }
  try { applyDesignAttr('legacy'); } catch { /* ignore */ }
  // Best-effort cross-device persist; never block the escape on the network.
  // (Admin-only path — the server rejects this write for anyone else.)
  try {
    fetch('/api/profile', {
      method: 'PUT', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uiDesignMode: 'legacy' }),
    }).catch(() => {});
  } catch { /* ignore */ }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('ui', 'legacy');
    window.location.assign(url.toString());
  } catch {
    window.location.reload();
  }
}

const primaryBtn = {
  width: '100%', background: '#5d509b', color: '#fff', border: 'none',
  borderRadius: 8, padding: '12px 16px', fontSize: 14, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};

const secondaryBtn = {
  width: '100%', marginTop: 10, background: 'transparent', color: '#464555',
  border: '1px solid #c7c4d8', borderRadius: 8, padding: '10px 16px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

/** The class boundary itself — `isAdmin` arrives as a prop from the wrapper below
 *  (class components cannot read the DesignModeContext hook). Exported for tests. */
export class StitchErrorBoundaryClass extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Route through the project's existing console error channel (no new infra).
    // eslint-disable-next-line no-console
    console.error('[stitch] presentation error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f7f9ff', color: '#181c21', padding: 24,
        fontFamily: "'Manrope', 'Inter', system-ui, sans-serif",
      }}>
        <div style={{
          maxWidth: 440, width: '100%', background: '#ffffff', borderRadius: 16,
          padding: 28, boxShadow: '0 15px 35px rgba(0,0,0,0.1)', textAlign: 'center',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', margin: '0 auto 16px',
            background: '#ffdad6', color: '#93000a', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700,
          }} aria-hidden="true">!</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#464555', margin: '0 0 20px' }}>
            This page could not be displayed. Your work and data are safe — nothing was
            changed. Reload the page to continue, or return to your dashboard.
          </p>
          <button onClick={() => window.location.reload()} style={primaryBtn}>
            Reload page
          </button>
          <button onClick={() => window.location.assign('/app')} style={secondaryBtn}>
            Back to dashboard
          </button>
          {this.props.isAdmin ? (
            <button onClick={escapeToLegacy} style={secondaryBtn}>
              Switch to classic UI
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}

/** Hook-level wrapper: reads isAdmin from the design context and feeds the class.
 *  The wrapper renders OUTSIDE the guarded subtree, so a child crash is still
 *  caught by the class while the admin gate stays live. */
export default function StitchErrorBoundary({ children }) {
  const { isAdmin } = useDesignMode();
  return <StitchErrorBoundaryClass isAdmin={isAdmin}>{children}</StitchErrorBoundaryClass>;
}
