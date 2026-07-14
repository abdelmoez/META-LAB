/**
 * UndoSnackbar.jsx — 85.md A2 (fixes audit C4: destructive actions were
 * unconfirmed + unrecoverable). A feature-local snackbar: fixed bottom-left card,
 * polite live region, message + Undo button, auto-dismiss after 8s.
 *
 * Presentational + a single timer effect (SSR-safe: effects never run under
 * renderToStaticMarkup). The parent owns the undo stack (research-engine
 * undoStack.js) — this only renders the latest recorded action.
 */
import { useEffect } from 'react';
import { C, FONT, alpha } from '../../../frontend/theme/tokens.js';

const AUTO_DISMISS_MS = 8000;

export default function UndoSnackbar({ message, onUndo, onDismiss }) {
  useEffect(() => {
    if (!message || typeof onDismiss !== 'function') return undefined;
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div data-testid="sb-undo" role="status" aria-live="polite"
      style={{
        position: 'fixed', left: 18, bottom: 18, zIndex: 300,
        display: 'flex', alignItems: 'center', gap: 12, maxWidth: 420,
        background: C.card, border: `1px solid ${C.brd2}`, borderLeft: `3px solid ${C.acc}`,
        borderRadius: 10, padding: '10px 14px', boxShadow: `0 10px 30px var(--t-shadow)`,
        fontFamily: FONT, fontSize: 12, color: C.txt,
      }}>
      <span style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>{message}</span>
      {onUndo && (
        <button type="button" onClick={onUndo}
          style={{ background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 7, color: C.acc, cursor: 'pointer', fontSize: 11.5, fontFamily: FONT, fontWeight: 700, padding: '4px 12px', flexShrink: 0 }}>
          Undo
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss"
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '4px 6px', flexShrink: 0, minWidth: 24, minHeight: 24 }}>
          ×
        </button>
      )}
    </div>
  );
}
