/**
 * KeywordSnackbar.jsx — subtle confirmation for keyword changes made from the
 * abstract (107.md §3 "Feedback"). Modeled on the search-builder UndoSnackbar but
 * styled with the SCREENING design system (ui/theme.js tokens) — the two design
 * systems deliberately do not cross.
 *
 * Presentational + one auto-dismiss timer (SSR-safe: effects never run under
 * renderToStaticMarkup). Undo is a real inverse operation issued by the parent
 * against the server ops endpoint — never a local-state rollback.
 */
import { useEffect } from 'react';
import { C, FONT, alpha } from '../ui/theme.js';

export const AUTO_DISMISS_MS = 8000;
/** 109.md §16 — `interaction.undoToastMs` bounds, mirrored from the catalogue entry. */
const DISMISS_MIN_MS = 2000;
const DISMISS_MAX_MS = 30000;

/**
 * 109.md §16 — `dismissMs` is the Ops-configured auto-dismiss. Absent/invalid falls
 * back to the shipped 8 s, and the value is clamped here too: this component owns a
 * real timer, and a 0 (or a 10-minute) countdown is a UI defect whichever layer
 * produced it.
 */
export function dismissDelayMs(dismissMs) {
  if (dismissMs == null || dismissMs === '') return AUTO_DISMISS_MS;
  const v = Number(dismissMs);
  if (!Number.isFinite(v)) return AUTO_DISMISS_MS;
  return Math.min(DISMISS_MAX_MS, Math.max(DISMISS_MIN_MS, Math.round(v)));
}

export default function KeywordSnackbar({ message, tone = 'info', onUndo, onDismiss, dismissMs }) {
  const delay = dismissDelayMs(dismissMs);
  useEffect(() => {
    if (!message || typeof onDismiss !== 'function') return undefined;
    const t = setTimeout(onDismiss, delay);
    return () => clearTimeout(t);
  }, [message, onDismiss, delay]);
  if (!message) return null;
  const accent = tone === 'warn' ? C.gold : tone === 'error' ? C.red : C.acc;
  return (
    <div
      data-testid="screening-keyword-snackbar"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', left: 18, bottom: 18, zIndex: 1200,
        display: 'flex', alignItems: 'center', gap: 12, maxWidth: 440,
        background: C.card, border: `1px solid ${C.brd2}`, borderLeft: `3px solid ${accent}`,
        borderRadius: 10, padding: '10px 14px', boxShadow: `0 10px 30px ${C.shadow}`,
        fontFamily: FONT, fontSize: 12, color: C.txt,
      }}>
      <span style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>{message}</span>
      {onUndo && (
        <button type="button" onClick={onUndo} data-testid="screening-keyword-undo"
          style={{
            background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '55')}`,
            borderRadius: 7, color: C.acc, cursor: 'pointer', fontSize: 11.5,
            fontFamily: FONT, fontWeight: 700, padding: '4px 12px', flexShrink: 0,
          }}>
          Undo
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss"
          style={{
            background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
            fontSize: 14, lineHeight: 1, padding: '4px 6px', flexShrink: 0, minWidth: 24, minHeight: 24,
          }}>
          ×
        </button>
      )}
    </div>
  );
}
