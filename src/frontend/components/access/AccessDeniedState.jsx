/**
 * AccessDeniedState — 91.md §"Restricted Route Page" + "Inline Message". Renders a
 * clear, accessible access-denied panel from an AccessDecision: title, specific
 * message, the user's current-vs-required role/tier, a real "what next" action, and
 * an optional collapsed technical detail. Two variants:
 *   - inline  a card inside a section (default)
 *   - page    a centered full restricted-route state (for protected direct URLs)
 *
 * Never shows raw "403"/"Access denied" as the primary message; the technical status
 * lives in a secondary <details>. Theme-aware via S tokens; screen-reader friendly.
 */
import { S, salpha, StitchBadge, StitchButton } from '../../stitch/primitives';

function RoleLine({ decision }) {
  const rows = [];
  if (decision.currentRole || decision.requiredRole) {
    rows.push(['Your role', titleCase(decision.currentRole) || '—', 'Required', titleCase(decision.requiredRole) || '—']);
  }
  if (decision.currentTier || decision.requiredTier) {
    rows.push(['Your plan', titleCase(decision.currentTier) || 'Current plan', 'Required', titleCase(decision.requiredTier) || 'A higher plan']);
  }
  if (!rows.length) return null;
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: '10px 0 0', fontSize: 12.5 }}>
      {rows.flatMap(([k1, v1, k2, v2], i) => [
        <div key={`a${i}`} style={{ color: S.textSecondary }}>{k1}: <strong style={{ color: S.textPrimary }}>{v1}</strong></div>,
        <div key={`b${i}`} style={{ color: S.textSecondary }}>{k2}: <strong style={{ color: S.textPrimary }}>{v2}</strong></div>,
      ])}
    </dl>
  );
}

const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

export default function AccessDeniedState({ decision, variant = 'inline', title, onAction, actions = [], style }) {
  if (!decision || decision.allowed) return null;
  const isPage = variant === 'page';
  const heading = title || decision.title || 'This is unavailable';
  const na = decision.nextAction && decision.nextAction.type !== 'none' ? decision.nextAction : null;

  const panel = (
    <div
      role="status"
      aria-live="polite"
      style={{
        maxWidth: isPage ? 560 : '100%',
        margin: isPage ? '48px auto 0' : 0,
        textAlign: isPage ? 'center' : 'left',
        padding: isPage ? '32px 28px' : '18px 18px',
        background: S.card,
        border: `1px solid ${salpha(S.outlineVariant, 0.5)}`,
        borderRadius: 16,
        ...style,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: isPage ? 'center' : 'flex-start', marginBottom: 8 }}>
        {/* The badge already carries the restriction icon — no separate standalone icon. */}
        <StitchBadge tone={decision.tone || 'warn'} icon={decision.icon || 'lock'}>{decision.badge || 'Restricted'}</StitchBadge>
      </div>
      <h2 style={{ fontSize: isPage ? 19 : 15.5, fontWeight: 700, color: S.textPrimary, margin: '0 0 6px' }}>{heading}</h2>
      <p style={{ fontSize: 13.5, lineHeight: 1.6, color: S.textSecondary, margin: 0 }}>{decision.message}</p>
      <RoleLine decision={decision} />

      {(na || actions.length) ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: isPage ? 'center' : 'flex-start', marginTop: 16 }}>
          {na && onAction ? (
            <StitchButton size="sm" variant={na.type === 'upgrade' ? 'primary' : 'ghost'} onClick={() => onAction(na)}>{na.label}</StitchButton>
          ) : null}
          {actions.map((a, i) => (
            <StitchButton key={i} size="sm" variant={a.variant || 'ghost'} onClick={a.onClick}>{a.label}</StitchButton>
          ))}
        </div>
      ) : null}

      {decision.technical ? (
        <details style={{ marginTop: 14 }}>
          <summary style={{ fontSize: 11.5, color: S.textMuted || S.textSecondary, cursor: 'pointer' }}>Technical details</summary>
          <code style={{ fontSize: 11.5, color: S.textMuted || S.textSecondary }}>{decision.technical}{decision.capability ? ` · ${decision.capability}` : ''}</code>
        </details>
      ) : null}
    </div>
  );

  if (!isPage) return panel;
  return <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '0 16px' }}>{panel}</div>;
}
