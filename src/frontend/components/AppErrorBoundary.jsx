/**
 * AppErrorBoundary.jsx — 65.md UX-1: the single app-level render-crash net.
 *
 * Wraps the WHOLE app (mounted in main.jsx above the router/providers), so any
 * route without a closer boundary — legacy workspace, auth pages, RoB, Sift,
 * Ops — recovers to a calm panel instead of a white screen. Inner boundaries
 * (StitchErrorBoundary, OpsErrorBoundary) still catch first for their trees.
 *
 * CONSTRAINT: this can catch before any stylesheet/provider is usable, so the
 * panel is fully inline-styled, brand-neutral, and uses no hooks/router — the
 * actions are plain location navigations that always work.
 */
import { Component } from 'react';

const S = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f6f7f9', color: '#1f2937', padding: 24,
    fontFamily: "'Inter','IBM Plex Sans',system-ui,sans-serif",
  },
  card: {
    maxWidth: 460, width: '100%', background: '#ffffff', border: '1px solid #e2e5ec',
    borderRadius: 14, padding: '30px 32px', boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
    textAlign: 'center',
  },
  title: { margin: '0 0 8px', fontSize: 19, fontWeight: 700 },
  body: { margin: '0 0 20px', fontSize: 13.5, lineHeight: 1.65, color: '#4b5563' },
  row: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  primary: {
    appearance: 'none', border: 'none', cursor: 'pointer', borderRadius: 9,
    padding: '9px 18px', fontSize: 13, fontWeight: 600, color: '#ffffff',
    background: '#4f46a5', fontFamily: 'inherit',
  },
  ghost: {
    appearance: 'none', cursor: 'pointer', borderRadius: 9, padding: '9px 18px',
    fontSize: 13, fontWeight: 600, color: '#374151', background: '#ffffff',
    border: '1px solid #d1d5db', fontFamily: 'inherit',
  },
};

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Detail stays in the console — users never see a stack trace.
    console.error('[app] render crash caught by AppErrorBoundary:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={S.wrap} role="alert">
        <div style={S.card}>
          <h1 style={S.title}>Something went wrong</h1>
          <p style={S.body}>
            The page hit an unexpected error. Your work is saved on the server —
            reloading usually fixes this.
          </p>
          <div style={S.row}>
            <button type="button" style={S.primary} onClick={() => window.location.reload()}>
              Reload page
            </button>
            <button type="button" style={S.ghost} onClick={() => window.location.assign('/app')}>
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
