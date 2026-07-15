/**
 * LockedFeatureCard — 91.md §"Feature Requires a Higher Tier" / locked section. A
 * prominent card for an entire feature that is unavailable (usually tier- or flag-
 * gated), showing the reason + a real next action (e.g. View plans) only when one
 * exists. Distinct from a small RestrictedAction: this replaces a whole panel.
 */
import { S, salpha, StitchBadge, StitchButton } from '../../stitch/primitives';
import { Icon } from '../icons.jsx';

export default function LockedFeatureCard({ decision, title, children, onAction, style }) {
  if (!decision || decision.allowed) return children ?? null;
  const na = decision.nextAction && decision.nextAction.type !== 'none' ? decision.nextAction : null;
  return (
    <div
      role="status"
      style={{
        display: 'flex', gap: 14, alignItems: 'flex-start',
        padding: '20px 22px', background: salpha(S.brandSoft || S.card, 0.6),
        border: `1px dashed ${salpha(S.brand || S.outlineVariant, 0.5)}`, borderRadius: 16, ...style,
      }}
    >
      <span style={{ color: S.brand || S.textSecondary, display: 'inline-flex', marginTop: 2 }} aria-hidden="true">
        <Icon name={decision.icon || 'lock'} size={22} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 6 }}><StitchBadge tone={decision.tone || 'brand'}>{decision.badge || 'Upgrade'}</StitchBadge></div>
        <h3 style={{ fontSize: 15.5, fontWeight: 700, color: S.textPrimary, margin: '0 0 4px' }}>{title || decision.title}</h3>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: S.textSecondary, margin: 0 }}>{decision.message}</p>
        {na && onAction ? (
          <div style={{ marginTop: 14 }}>
            <StitchButton size="sm" variant="primary" onClick={() => onAction(na)}>{na.label}</StitchButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
