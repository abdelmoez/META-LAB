/**
 * StitchErrorBoundary.jsx — failure containment for the Stitch presentation layer.
 *
 * design.md §"ERROR BOUNDARIES" + §6 (EMERGENCY FALLBACK): if any Stitch page or
 * the Stitch shell throws while rendering, we must NOT show a silent white screen.
 * Instead an admin gets a calm recovery panel whose primary action returns them to
 * the always-working legacy UI — independent of the (possibly broken) header switch.
 *
 * The escape is deliberately low-level: it persists `legacy`, sets the root attr,
 * and hard-navigates to the same route with `?ui=legacy`. That works even if React
 * state is wedged, and it can never trigger a destructive backend operation — it
 * only changes a presentation preference.
 *
 * A presentation crash must never corrupt data or preferences, so the only state
 * this touches is the design-mode preference itself.
 */
import { Component } from 'react';
import { saveDesignMode, applyDesignAttr } from './designMode.js';

function escapeToLegacy() {
  try { saveDesignMode('legacy'); } catch { /* ignore */ }
  try { applyDesignAttr('legacy'); } catch { /* ignore */ }
  // Best-effort cross-device persist; never block the escape on the network.
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

export default class StitchErrorBoundary extends Component {
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
    console.error('[stitch] presentation error — falling back to legacy is available:', error, info?.componentStack);
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
            The new design hit a snag
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#464555', margin: '0 0 20px' }}>
            Something in the Stitch preview failed to render. Your work and data are safe —
            nothing was changed. You can return to the classic interface and keep going.
          </p>
          <button
            onClick={escapeToLegacy}
            style={{
              width: '100%', background: '#5d509b', color: '#fff', border: 'none',
              borderRadius: 8, padding: '12px 16px', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Return to Legacy UI
          </button>
          <button
            onClick={() => { try { this.setState({ error: null }); } catch { window.location.reload(); } }}
            style={{
              width: '100%', marginTop: 10, background: 'transparent', color: '#464555',
              border: '1px solid #c7c4d8', borderRadius: 8, padding: '10px 16px',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
