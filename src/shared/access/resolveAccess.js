/**
 * shared/access/resolveAccess.js — 91.md "single authoritative permission source".
 * resolveCapability(key, ctx) deterministically maps a capability + an access context
 * to an AccessDecision, used identically by the frontend (to render hide/disable/
 * explain states) and the backend (to enforce + serialise the denial). Role/tier/
 * admin/archived rules live here; live project-STATE/DATA gates are layered by the
 * caller with deny('project_state'|'insufficient_data', …) since they need live counts.
 *
 * Pure — no DOM/React/network.
 */

import { allow, deny } from './accessDecision.js';
import { capabilitySpec } from './capabilities.js';

/**
 * @param {string} key capability key (capabilities.js)
 * @param {object} ctx {
 *   isAdmin, isOwner, isLeader, role, active,
 *   perms:{...flags}, tierId,
 *   hasEntitlement?:(entKey)=>boolean, requiredTierFor?:(entKey)=>string|null,
 *   project?:{ archived:boolean }
 * }
 * @returns {import('./accessDecision.js').AccessDecision}
 */
export function resolveCapability(key, ctx = {}) {
  const spec = capabilitySpec(key);
  if (!spec) return allow(key); // untracked capability — not gated by this layer
  const role = ctx.role || null;
  const msg = () => (typeof spec.message === 'function' ? spec.message(role) : spec.message);

  // Archived project → read-only for EDIT capabilities, for EVERYONE incl. the owner
  // (must unarchive first). View/read capabilities are unaffected.
  if (spec.edit && ctx.project && ctx.project.archived) {
    return deny('archived', {
      capability: key, currentRole: role,
      message: 'This project is archived, so it is read-only. Unarchive it from Project Control to make changes.',
    });
  }

  switch (spec.restriction) {
    case 'admin_only':
      if (ctx.isAdmin) return allow(key);
      return deny('admin_only', { capability: key, currentRole: role, requiredRole: 'administrator', message: msg() });

    case 'owner_only':
      if (ctx.isOwner || ctx.isAdmin) return allow(key);
      return deny('owner_only', { capability: key, currentRole: role, requiredRole: 'owner', message: msg() });

    case 'leader_only':
      if (ctx.isOwner || ctx.isLeader || ctx.isAdmin) return allow(key);
      if (spec.perm && ctx.perms && ctx.perms[spec.perm]) return allow(key);
      return deny('leader_only', { capability: key, currentRole: role, requiredRole: 'leader', message: msg() });

    case 'tier': {
      const granted = ctx.isAdmin
        || (typeof ctx.hasEntitlement === 'function' ? !!ctx.hasEntitlement(spec.entitlementKey) : false);
      if (granted) return allow(key);
      const requiredTier = typeof ctx.requiredTierFor === 'function' ? ctx.requiredTierFor(spec.entitlementKey) : null;
      return deny('tier', { capability: key, requiredTier, currentTier: ctx.tierId || null, message: msg() });
    }

    case 'permission':
    default: {
      if (ctx.isOwner || ctx.isLeader || ctx.isAdmin) return allow(key);
      const has = spec.perm ? !!(ctx.perms && ctx.perms[spec.perm]) : true;
      if (has) return allow(key);
      // A view-only member attempting an edit gets the clearer "view only" framing.
      const readOnly = !!(ctx.perms && (ctx.perms.readOnlyMetaLab || ctx.perms.readOnlyMetaSift));
      if (spec.edit && readOnly) {
        return deny('read_only', { capability: key, currentRole: role, message: msg() });
      }
      return deny('permission', { capability: key, currentRole: role, requiredRole: 'reviewer', message: msg() });
    }
  }
}

/** Boolean shortcut. */
export function can(key, ctx) {
  return resolveCapability(key, ctx).allowed;
}

/** Resolve many capabilities at once → { [key]: AccessDecision }. */
export function resolveCapabilities(keys, ctx) {
  const out = {};
  for (const k of (Array.isArray(keys) ? keys : [])) out[k] = resolveCapability(k, ctx);
  return out;
}

/**
 * Build a resolver ctx from a server getProjectAccess result (+ site-admin flag +
 * optional entitlement hooks). Keeps the mapping from the app's access shape → the
 * pure ctx in ONE place.
 */
export function ctxFromProjectAccess(access, { isAdmin = false, tierId = null, hasEntitlement, requiredTierFor, project } = {}) {
  const a = access || {};
  return {
    isAdmin: !!isAdmin,
    isOwner: !!a.isOwner,
    isLeader: !!a.isLeader,
    active: a.active !== false,
    role: a.role || null,
    perms: a.perms || {
      canScreen: a.canScreen, canChat: a.canChat, canResolveConflicts: a.canResolveConflicts,
      canManageMembers: a.canManageMembers, canManageSettings: a.canManageSettings,
    },
    tierId,
    hasEntitlement,
    requiredTierFor,
    project: project || (a.project ? { archived: !!(a.project.archived || a.project._archived) } : null),
  };
}

export default { resolveCapability, can, resolveCapabilities, ctxFromProjectAccess };
