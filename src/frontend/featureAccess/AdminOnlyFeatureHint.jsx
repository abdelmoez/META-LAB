/**
 * AdminOnlyFeatureHint.jsx — 75.md Phase 7 (client).
 *
 * The small inline banner a gated surface renders when featureFlagState(key, user)
 * returns 'adminOnly' — i.e. the feature is globally OFF but the viewer is an admin,
 * so it is shown to them ALONE. Communicates that other users cannot see it, so an
 * admin never assumes the feature is live for the whole team.
 *
 * Deliberately self-contained (inline styles, no shared-token import) so it can be
 * dropped into any surface without coupling to another workstream's theme edits.
 * Wave 2 wires this across the gated surfaces; this file + featureFlagState.js are
 * the clean seam it consumes. Usage:
 *
 *   const state = await featureFlagState('livingReview', user); // in an effect
 *   if (state === 'off') return null;                           // hidden for others
 *   return (<>
 *     {state === 'adminOnly' && <AdminOnlyFeatureHint feature="Living Review" />}
 *     <LivingReviewSurface />
 *   </>);
 */
export default function AdminOnlyFeatureHint({ feature, compact = false, style }) {
  const label = feature ? `${feature} is enabled for admins only` : 'Enabled for admins only';
  return (
    <div
      role="status"
      data-testid="admin-only-feature-hint"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: compact ? '4px 10px' : '8px 14px',
        borderRadius: 8,
        border: '1px solid #d9a441',
        background: 'rgba(217, 164, 65, 0.12)',
        color: '#8a5a00',
        fontSize: compact ? 12 : 13,
        fontWeight: 600,
        lineHeight: 1.35,
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: compact ? 13 : 15 }}>&#128274;</span>
      <span>
        {label} — hidden from other users.
      </span>
    </div>
  );
}
