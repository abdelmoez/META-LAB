/**
 * SaveStatusIndicator.jsx — 85.md A2 (fixes audit C2: autosave failure was silent).
 * A tiny, honest save-state pill: "Saved" / "Saving…" / "Save failed — Retry".
 *
 * Presentational leaf: takes plain props, no fetch, SSR-safe (default 'saved' so a
 * static render never claims an in-flight save). The parent owns the autosave state
 * machine and the Retry handler (an immediate saveNow that bypasses the debounce).
 */
import { C, FONT } from '../../../frontend/theme/tokens.js';

export default function SaveStatusIndicator({ state, onRetry }) {
  const s = state === 'saving' || state === 'error' ? state : 'saved';
  const dot = (color) => (
    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
  );
  return (
    <span data-testid="sb-save-status" role="status" aria-live="polite"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: 11, fontWeight: 600 }}>
      {s === 'saved' && (<>
        {dot(C.grn)}
        <span style={{ color: C.grn }}>Saved</span>
      </>)}
      {s === 'saving' && (<>
        {dot(C.yel)}
        <span style={{ color: C.txt2 }}>Saving…</span>
      </>)}
      {s === 'error' && (<>
        {dot(C.red)}
        <span style={{ color: C.red }}>Save failed</span>
        {onRetry && (
          <button type="button" onClick={onRetry}
            style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontSize: 10.5, fontFamily: FONT, fontWeight: 600, padding: '2px 9px' }}>
            Retry
          </button>
        )}
      </>)}
    </span>
  );
}
