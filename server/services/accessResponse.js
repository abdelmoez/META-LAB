/**
 * server/services/accessResponse.js — 91.md "Backend Enforcement" + structured
 * authorization responses. The backend stays the final authority; this helper lets a
 * controller enforce a capability with the SAME rule the frontend rendered and return
 * a STRUCTURED body the client translates into a clear message (never a bare 403).
 *
 * Mirrors the existing sendTierLimit(res, err) idiom (entitlementService.js) but for
 * the whole access-state vocabulary. It does NOT change the deliberate 404 existence-
 * hiding for feature flags / non-member project access — those stay hidden; this is
 * for VISIBLE features restricted by role / tier / project state.
 */
import { resolveCapability, buildAccessDenied, deny, ctxFromProjectAccess } from '../../src/shared/access/index.js';

/** Typed error carrying an AccessDecision. Controllers translate it via sendAccessDenied. */
export class AccessError extends Error {
  constructor(decision) {
    super((decision && decision.message) || 'Access restricted');
    this.name = 'AccessError';
    this.status = 403;
    this.code = decision && decision.restrictionType === 'tier' ? 'TIER_LIMIT_EXCEEDED' : 'ACCESS_RESTRICTED';
    this.decision = decision;
    this.body = buildAccessDenied(decision);
  }
}

/** Build a resolver ctx from an express req.user + a getProjectAccess result. */
export function accessCtx(user, access, extra = {}) {
  return ctxFromProjectAccess(access, {
    isAdmin: user && user.role === 'admin',
    tierId: extra.tierId || null,
    hasEntitlement: extra.hasEntitlement,
    requiredTierFor: extra.requiredTierFor,
    project: extra.project,
  });
}

/**
 * requireProjectCapability(user, access, capability, extra) — enforce a capability.
 * Returns the AccessDecision when allowed; THROWS AccessError when denied. `access`
 * is the getProjectAccess result (caller already handled null → 404 for non-members).
 */
export function requireProjectCapability(user, access, capability, extra = {}) {
  const decision = resolveCapability(capability, accessCtx(user, access, extra));
  if (!decision.allowed) throw new AccessError(decision);
  return decision;
}

/**
 * denyCapability(capability, ctx) — resolve + return {allowed} without throwing, so a
 * handler can branch (e.g. strip fields) instead of aborting.
 */
export function checkCapability(user, access, capability, extra = {}) {
  return resolveCapability(capability, accessCtx(user, access, extra));
}

/**
 * sendAccessDenied(res, errOrDecision) — if it is an AccessError (or a denied
 * decision), respond with the structured body + status and return true; else false.
 * Drop-in for `catch (e) { if (sendAccessDenied(res, e)) return; ... }`.
 */
export function sendAccessDenied(res, errOrDecision) {
  if (errOrDecision instanceof AccessError) {
    res.status(errOrDecision.status || 403).json(errOrDecision.body);
    return true;
  }
  if (errOrDecision && errOrDecision.allowed === false && errOrDecision.restrictionType) {
    res.status(403).json(buildAccessDenied(errOrDecision));
    return true;
  }
  return false;
}

/** Directly send a structured denial for an ad-hoc restriction (e.g. project state). */
export function sendRestriction(res, restrictionType, opts = {}) {
  const decision = deny(restrictionType, opts);
  res.status(opts.status || 403).json(buildAccessDenied(decision));
  return decision;
}

export default { AccessError, requireProjectCapability, checkCapability, sendAccessDenied, sendRestriction, accessCtx };
