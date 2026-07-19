/**
 * users/badges.jsx — 95.md — status / auth-method / role / tier badges for the
 * Ops user-management redesign. All derivations come from the shared, pure
 * src/shared/adminUsers.js so the client and server can never disagree, and the
 * auth-method label is NEVER inferred from the email domain (95.md Phase 10).
 */
import { C, alpha } from '../../../theme/tokens.js';
import { deriveAuthMethods, authMethodLabel, STATUS_LABELS, REGISTRATION_METHOD_LABELS } from '../../../../shared/adminUsers.js';
import { Badge } from './primitives.jsx';

/* Account status — suspension reads strongest; pending verification is a quiet
   amber warning; active is a quiet green. Text is always present (Phase 11). */
export function StatusBadge({ status }) {
  if (status === 'suspended') return <Badge text="Suspended" color={C.red} strong title="Account suspended — cannot sign in" />;
  if (status === 'pending_verification') return <Badge text="Pending verification" color={C.yel} title="Email address was never verified" />;
  return <Badge text={STATUS_LABELS[status] || 'Active'} color={C.grn} />;
}

/**
 * Sign-in method badge from ACTUAL credential state (hasPassword + provider
 * rows), never the email domain. 'No login method' is an administrative warning.
 */
export function AuthBadge({ hasPassword, authProviders, invited }) {
  const methods = deriveAuthMethods({ hasPassword, providers: authProviders });
  const label = authMethodLabel(methods);
  const color = label === 'No login method' ? C.red
    : label === 'Google + Email' ? C.acc
    : label === 'Google' ? C.teal
    : C.txt2; // Email
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Badge text={label} color={color} title={label === 'No login method' ? 'This account has no usable sign-in method' : `Current sign-in methods: ${label}`} />
      {invited && <Badge text="Invited" color={C.purp} title="Account was created from an invitation" />}
    </span>
  );
}

const ROLE_COLORS = { admin: C.red, mod: C.grn, user: C.muted };
export function RoleBadge({ role }) {
  return <Badge text={role || 'user'} color={ROLE_COLORS[role] || C.muted} />;
}

/* Subscription/access tier — separate axis from role. tierId null = site default. */
export function TierBadge({ tierId, tierName }) {
  const label = tierId ? (tierName || 'Tier') : 'Default';
  return <Badge text={label} color={tierId ? C.gold : C.muted} title={tierId ? `Tier: ${label}` : 'On the site default tier'} />;
}

/* Registration method label (immutable original method) — for the detail view. */
export function regMethodLabel(method) {
  return REGISTRATION_METHOD_LABELS[method] || REGISTRATION_METHOD_LABELS.unknown;
}
