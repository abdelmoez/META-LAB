/**
 * RestrictedAction — 91.md §"Clickable Restricted Control" + Accessibility. Wraps an
 * action: when the decision ALLOWS it, renders the child control unchanged; when it
 * DENIES it, renders a clearly-locked, focusable control (aria-disabled, lock icon,
 * disabled cursor) that — instead of silently doing nothing — explains on hover/focus
 * (tooltip with the short reason) AND on click/Enter (a toast with the full message).
 *
 * Uses an aria-disabled button, NOT a native `disabled` button, so keyboard + screen-
 * reader users can still focus it and discover WHY it is unavailable (91.md warns that
 * native disabled controls swallow focus + tooltips).
 */
import { S, salpha, StitchTooltip } from '../../stitch/primitives';
import { Icon } from '../icons.jsx';
import { useStitchToast } from '../../stitch/primitives/overlay.jsx';

const toToastTone = (t) => (t === 'danger' ? 'error' : t === 'warn' ? 'warn' : 'info');

export default function RestrictedAction({ decision, label, children, onExplain, size = 'md', style }) {
  const ctx = useStitchToast();
  if (!decision || decision.allowed) return children || null;

  const text = label || (typeof children === 'string' ? children : (children && children.props && children.props.children)) || decision.title;
  const explain = () => {
    if (onExplain) return onExplain(decision);
    if (ctx && ctx.toast) ctx.toast(decision.message, { tone: toToastTone(decision.tone), duration: 6500 });
  };
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); explain(); } };

  const pad = size === 'sm' ? '5px 10px' : '8px 14px';
  const fs = size === 'sm' ? 12.5 : 13.5;

  return (
    <StitchTooltip label={decision.title || 'Restricted'} placement="top">
      <button
        type="button"
        aria-disabled="true"
        onClick={explain}
        onKeyDown={onKey}
        data-testid="restricted-action"
        data-restriction={decision.restrictionType}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: pad, fontSize: fs, fontWeight: 600, borderRadius: 8,
          color: S.textSecondary, background: salpha(S.surfaceHighest || S.outlineVariant, 0.35),
          border: `1px solid ${salpha(S.outlineVariant, 0.6)}`,
          cursor: 'not-allowed', // clearly unavailable, not broken
          ...style,
        }}
      >
        <Icon name={decision.icon || 'lock'} size={size === 'sm' ? 13 : 15} aria-hidden="true" />
        <span>{text}</span>
        {/* Screen-reader-only reason so the lock is never the ONLY signal. */}
        <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>
          — unavailable: {decision.message}
        </span>
      </button>
    </StitchTooltip>
  );
}
