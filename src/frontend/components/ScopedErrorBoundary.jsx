/**
 * ScopedErrorBoundary.jsx — 77.md §9 (isolate recoverable component failures).
 *
 * A reusable, theme-neutral error boundary for wrapping HIGH-RISK subtrees (PDF viewer,
 * extraction form, converter, manuscript editor, charts, lazy-loaded engines) so that a
 * local render crash is contained to that card instead of blanking the whole workspace.
 *
 * Behaviour:
 *  - Shows a calm, inline message (NOT a full-screen takeover) with a correlation id.
 *  - "Try again" remounts the guarded subtree via a resetKey bump (targeted retry).
 *  - Navigation stays available (the surrounding shell is untouched).
 *  - Never reveals a stack trace to the user; detail goes to reportClientError only.
 *  - `resetKeys` (e.g. the active stage / study id) auto-clear the error when they
 *    change, so switching tabs recovers without a manual retry.
 */
import { Component } from 'react';
import { reportClientError } from './errorReporting.js';

export default class ScopedErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, correlationId: '', retryKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    const correlationId = reportClientError(error, {
      boundary: this.props.name || 'scoped',
      engine: this.props.engine,
      kind: 'render-crash',
    });
    this.setState({ correlationId });
  }

  componentDidUpdate(prevProps) {
    // Auto-recover when a declared reset key changes (e.g. the user navigates to a
    // different stage/study), so a latched error never traps navigation.
    if (this.state.error && this.props.resetKeys !== prevProps.resetKeys) {
      const a = prevProps.resetKeys || [];
      const b = this.props.resetKeys || [];
      const changed = a.length !== b.length || a.some((v, i) => v !== b[i]);
      if (changed) this.reset(); // eslint-disable-line react/no-did-update-set-state
    }
  }

  reset = () => {
    this.setState((s) => ({ error: null, correlationId: '', retryKey: s.retryKey + 1 }));
  };

  render() {
    const { error, correlationId, retryKey } = this.state;
    if (!error) {
      // Keying children on retryKey forces a fresh mount of the guarded subtree on retry.
      return <div key={retryKey} style={{ display: 'contents' }}>{this.props.children}</div>;
    }

    const label = this.props.label || 'This section';
    const S = {
      wrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160, padding: 24, boxSizing: 'border-box' },
      card: {
        maxWidth: 440, width: '100%', textAlign: 'center',
        border: '1px solid var(--pex-brd, #d9dbe3)', borderRadius: 12, padding: '22px 24px',
        background: 'var(--pex-card, rgba(127,127,127,0.05))', color: 'inherit',
        fontFamily: "'Inter','IBM Plex Sans',system-ui,sans-serif",
      },
      title: { margin: '0 0 6px', fontSize: 15, fontWeight: 700 },
      body: { margin: '0 0 14px', fontSize: 12.5, lineHeight: 1.6, opacity: 0.8 },
      id: { fontSize: 10.5, fontFamily: "'IBM Plex Mono',monospace", opacity: 0.6, marginTop: 10 },
      btn: {
        appearance: 'none', border: '1px solid currentColor', cursor: 'pointer',
        borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 600,
        background: 'transparent', color: 'inherit', fontFamily: 'inherit',
      },
    };
    return (
      <div style={S.wrap} role="alert">
        <div style={S.card}>
          <div style={{ fontSize: 22, marginBottom: 8 }} aria-hidden="true">⚠️</div>
          <h2 style={S.title}>{label} hit a problem</h2>
          <p style={S.body}>
            Your work is saved — nothing was lost. You can retry this section, or switch to another
            part of the workspace and come back.
          </p>
          <button type="button" style={S.btn} onClick={this.reset}>Try again</button>
          {correlationId ? <div style={S.id}>Reference: {correlationId}</div> : null}
        </div>
      </div>
    );
  }
}
