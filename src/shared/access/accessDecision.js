/**
 * shared/access/accessDecision.js — 91.md. The ONE structured access decision every
 * layer speaks: the pure resolver produces it, the server serialises it into an HTTP
 * body, and the client parses that body back into it to render a clear message. This
 * is what keeps frontend + backend permission messaging from drifting.
 *
 * Pure — no DOM/React/network.
 */

import { restrictionMeta, DEFAULT_NEXT_ACTION } from './restrictionTypes.js';

/**
 * @typedef {Object} AccessDecision
 * @property {boolean} allowed
 * @property {string|null} restrictionType
 * @property {string|null} capability
 * @property {string} title
 * @property {string} message      clear, specific, actionable (never "403"/"Access denied")
 * @property {string|null} requiredRole
 * @property {string|null} currentRole
 * @property {string|null} requiredTier
 * @property {string|null} currentTier
 * @property {{type:string,label:string|null,href?:string}|null} nextAction
 * @property {string} tone
 * @property {string} icon
 * @property {string} badge
 * @property {string|null} technical  secondary technical detail (kept out of the primary message)
 */

/** An ALLOWED decision. */
export function allow(capability = null) {
  return {
    allowed: true, restrictionType: null, capability,
    title: '', message: '', requiredRole: null, currentRole: null,
    requiredTier: null, currentTier: null, nextAction: null,
    tone: 'neutral', icon: '', badge: '', technical: null,
  };
}

/**
 * A DENIED decision. `type` is a RESTRICTION_TYPES id; `opts` fills the specifics.
 * `opts.nextAction` overrides the type default (pass `null` to suppress the action).
 */
export function deny(type, opts = {}) {
  const meta = restrictionMeta(type);
  const nextAction = opts.nextAction !== undefined ? opts.nextAction
    : (DEFAULT_NEXT_ACTION[type] || null);
  return {
    allowed: false,
    restrictionType: type,
    capability: opts.capability || null,
    title: opts.title || meta.title,
    message: opts.message || meta.title,
    requiredRole: opts.requiredRole || null,
    currentRole: opts.currentRole || null,
    requiredTier: opts.requiredTier || null,
    currentTier: opts.currentTier || null,
    nextAction,
    tone: meta.tone,
    icon: meta.icon,
    badge: meta.badge,
    technical: opts.technical || null,
  };
}

/**
 * buildAccessDenied(decision) — the HTTP body a denied request returns. Generic
 * `ACCESS_RESTRICTED` for everything; a tier denial ALSO carries the legacy
 * `TIER_LIMIT_EXCEEDED` shape ({error, feature, currentTier, requiredTier}) so the
 * existing entitlements client keeps working unchanged.
 */
export function buildAccessDenied(decision) {
  const d = decision || {};
  const isTier = d.restrictionType === 'tier';
  return {
    error: isTier ? 'TIER_LIMIT_EXCEEDED' : 'ACCESS_RESTRICTED',
    restrictionType: d.restrictionType || 'permission',
    message: d.message || 'This action is not available to you.',
    capability: d.capability || null,
    requiredPermission: d.capability || null,
    requiredRole: d.requiredRole || null,
    currentRole: d.currentRole || null,
    requiredTier: d.requiredTier || null,
    currentTier: d.currentTier || null,
    nextAction: d.nextAction || null,
    // legacy tier fields (only meaningful when isTier) — harmless otherwise:
    feature: d.capability || null,
  };
}

/**
 * parseAccessError(body, status) — client-side: turn an API error body (or a bare
 * status) back into an AccessDecision so a toast/inline message can render. Handles
 * the new ACCESS_RESTRICTED, the legacy TIER_LIMIT_EXCEEDED, and generic 401/403/404.
 */
export function parseAccessError(body, status) {
  const b = body && typeof body === 'object' ? body : {};
  if (b.error === 'TIER_LIMIT_EXCEEDED' || b.restrictionType === 'tier') {
    return deny('tier', {
      capability: b.capability || b.feature || null,
      message: b.message || restrictionMeta('tier').title,
      requiredTier: b.requiredTier || null, currentTier: b.currentTier || null,
      technical: status ? `HTTP ${status}` : null,
    });
  }
  if (b.error === 'ACCESS_RESTRICTED' || b.restrictionType) {
    return deny(b.restrictionType || 'permission', {
      capability: b.capability || b.requiredPermission || null,
      message: b.message || undefined,
      requiredRole: b.requiredRole || null, currentRole: b.currentRole || null,
      requiredTier: b.requiredTier || null, currentTier: b.currentTier || null,
      // Preserve an EXPLICITLY-suppressed action (null) — only fall back to the type
      // default when the field is absent, so a serialized nextAction:null stays suppressed.
      nextAction: ('nextAction' in b) ? b.nextAction : undefined,
      technical: status ? `HTTP ${status}` : null,
    });
  }
  // Generic fallbacks — still specific enough to not read as "broken".
  if (status === 401) return deny('membership', { message: 'Please sign in to continue.', technical: 'HTTP 401' });
  if (status === 403) return deny('permission', { message: b.message || 'You do not have permission to do this.', technical: 'HTTP 403' });
  if (status === 404) return deny('membership', { message: b.message || 'This item is unavailable or you do not have access to it.', technical: 'HTTP 404' });
  if (status === 503) return deny('temporarily_unavailable', { message: b.message || 'This service is temporarily unavailable. Try again shortly.', technical: 'HTTP 503' });
  return deny('temporarily_unavailable', { message: b.message || 'Something prevented this action. Try again.', technical: status ? `HTTP ${status}` : null });
}

/** True when a value looks like a denied access decision. */
export function isDenied(d) {
  return !!(d && d.allowed === false && d.restrictionType);
}

export default { allow, deny, buildAccessDenied, parseAccessError, isDenied };
