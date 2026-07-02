/**
 * components.jsx — presentational pieces for the product-tier UX (67.md).
 *
 * Calm and institutional, matching the rest of the app (theme tokens via
 * var(--t-*), no gradients/gimmicks). These never make an authorization
 * decision — they only communicate a locked feature or a limit the SERVER
 * already enforced. Deliberately NO fake checkout / pricing: upgrades are
 * arranged with an administrator, so the copy stays neutral.
 */
import { tierDisplayName } from '../../shared/entitlements.js';

const FONT = 'var(--t-font, Inter, system-ui, sans-serif)';

/**
 * tierErrorMessage — pull the human message out of a blocked-action response.
 * Accepts either a thrown error (with `.body` or `.message`) or a raw response
 * body. Recognizes the structured { error:'TIER_LIMIT_EXCEEDED', message }
 * shape and returns its `message`; returns '' for anything unrelated so callers
 * can fall back to their own generic text.
 */
export function tierErrorMessage(errOrBody) {
  if (!errOrBody) return '';
  // A fetch helper may attach the parsed JSON as err.body; otherwise the value
  // itself may already be the body.
  const body = errOrBody.body && typeof errOrBody.body === 'object' ? errOrBody.body : errOrBody;
  if (body && body.error === 'TIER_LIMIT_EXCEEDED' && typeof body.message === 'string' && body.message) {
    return body.message;
  }
  return '';
}

/** LockIcon — a small inline padlock (no icon-font dependency). */
function LockIcon({ size = 18, color = 'var(--t-muted)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** TierBadge — a compact pill showing the current plan name. */
export function TierBadge({ tierDisplayName: name, style }) {
  const label = name || 'Free';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FONT,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.02em',
      color: 'var(--t-acc)', background: 'color-mix(in srgb, var(--t-acc) 12%, transparent)',
      border: '1px solid color-mix(in srgb, var(--t-acc) 30%, transparent)',
      borderRadius: 999, padding: '2px 10px', ...style,
    }}>
      {label} plan
    </span>
  );
}

/**
 * LockedFeatureCard — the full-panel state shown INSTEAD of a gated feature.
 * Honest upgrade messaging ("Available on the {Tier} plan and above") with a
 * neutral note that upgrades are administrator-managed. Never a checkout.
 */
export function LockedFeatureCard({ title, message, requiredTier, style }) {
  const tierName = requiredTier ? tierDisplayName(requiredTier) : null;
  const line = message
    || (tierName ? `Available on the ${tierName} plan and above.` : 'This feature is not included in your current plan.');
  return (
    <div role="note" style={{
      fontFamily: FONT, maxWidth: 560, margin: '8px 0',
      background: 'var(--t-card)', border: '1px solid var(--t-brd)', borderRadius: 12,
      padding: '24px 26px', display: 'flex', gap: 16, alignItems: 'flex-start', ...style,
    }}>
      <div aria-hidden="true" style={{
        flexShrink: 0, width: 40, height: 40, borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in srgb, var(--t-acc) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--t-acc) 26%, transparent)',
      }}>
        <LockIcon color="var(--t-acc)" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--t-txt)', letterSpacing: '-0.01em' }}>
          {title || 'Feature locked'}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.6, color: 'var(--t-txt2)' }}>{line}</p>
        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--t-muted)' }}>
          Upgrade options are managed by your administrator.
        </p>
      </div>
    </div>
  );
}

/**
 * TierLimitNotice — a compact inline amber banner for a soft, in-place gate
 * (e.g. a disabled Run button). Surfaces the server's human message verbatim.
 */
export function TierLimitNotice({ message, style }) {
  if (!message) return null;
  return (
    <div role="note" style={{
      fontFamily: FONT, display: 'flex', alignItems: 'flex-start', gap: 8,
      fontSize: 12, lineHeight: 1.5, color: 'var(--t-yel)',
      background: 'color-mix(in srgb, var(--t-yel) 12%, transparent)',
      border: '1px solid color-mix(in srgb, var(--t-yel) 38%, transparent)',
      borderRadius: 8, padding: '8px 11px', ...style,
    }}>
      <span aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
        <LockIcon size={14} color="var(--t-yel)" />
      </span>
      <span>{message}</span>
    </div>
  );
}
