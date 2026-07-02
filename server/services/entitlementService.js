/**
 * entitlementService.js — server-side product-tier resolution + enforcement (67.md).
 *
 * The SINGLE source of truth for tier checks: no endpoint ever writes
 * `if (user.tier === 'free')` — they call requireEntitlement / requireLimit and
 * surface the structured error. Resolution order:
 *
 *   1. admin/mod → BYPASS (full access; product tiers govern NORMAL users only);
 *   2. enforcement kill-switch off → bypass (emergency/rollout safety);
 *   3. user.tierId → the assigned ProductTier row (unknown/inactive → default);
 *   4. null tierId → the site default tier (tierSettings.defaultTierId ←
 *      DEFAULT_USER_TIER env ← 'pro'), resolved at READ time so existing users
 *      never need a backfill and flipping the default is instant;
 *   5. entitlement values = code defaults for the tier merged UNDER the row's
 *      stored JSON (new keys ship without migrations).
 *
 * Project roles are a SEPARATE axis: endpoints keep their project-permission
 * checks; a tier check passing never grants project access (and vice versa).
 */
import { prisma } from '../db/client.js';
import {
  DEFAULT_TIERS, resolveEntitlements, hasEntitlement, limitOf, withinLimit,
  requiredTierFor, tierDisplayName, buildTierLimitError, ENTITLEMENT_KEY_SET, UNLIMITED,
} from '../../src/shared/entitlements.js';

export const TIER_SETTINGS_KEY = 'tierSettings';
export const TIER_SETTINGS_DEFAULTS = Object.freeze({
  enforcementEnabled: true,     // emergency off-switch: everyone bypasses when false
  defaultTierId: null,          // null → DEFAULT_USER_TIER env → 'pro'
});

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}

export async function getTierSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: TIER_SETTINGS_KEY } });
    return { ...TIER_SETTINGS_DEFAULTS, ...safeParse(row?.value, {}) };
  } catch { return { ...TIER_SETTINGS_DEFAULTS }; }
}

/** The site default tier id (settings → env → 'pro'; validated against known tiers). */
export async function getDefaultTierId(settings = null) {
  const s = settings || await getTierSettings();
  const candidates = [s.defaultTierId, process.env.DEFAULT_USER_TIER, 'pro'];
  const known = await listTiers();
  const knownIds = new Set(known.filter(t => t.isActive).map(t => t.id));
  for (const c of candidates) if (c && knownIds.has(c)) return c;
  return 'pro';
}

/**
 * seedProductTiers — boot hook: create the default tier rows if missing (never
 * overwrites an existing row — admin edits are durable). Idempotent.
 */
export async function seedProductTiers() {
  for (const t of DEFAULT_TIERS) {
    try {
      await prisma.productTier.upsert({
        where: { id: t.id },
        create: {
          id: t.id, name: t.name, displayName: t.displayName, description: t.description,
          sortOrder: t.sortOrder, isActive: true, entitlements: JSON.stringify(t.entitlements),
        },
        update: {}, // existing rows are admin-owned — never clobbered at boot
      });
    } catch (e) { console.error('[tiers] seed failed for', t.id, e?.message); }
  }
}

/** All tiers: DB rows (admin-edited) merged over code defaults; sorted. */
export async function listTiers() {
  let rows = [];
  try { rows = await prisma.productTier.findMany({ orderBy: { sortOrder: 'asc' } }); }
  catch { rows = []; }
  const byId = new Map(rows.map(r => [r.id, r]));
  const out = [];
  for (const t of DEFAULT_TIERS) {
    const row = byId.get(t.id);
    byId.delete(t.id);
    out.push({
      id: t.id,
      name: row?.name || t.name,
      displayName: row?.displayName || t.displayName,
      description: row?.description ?? t.description,
      isActive: row ? row.isActive : true,
      sortOrder: row?.sortOrder ?? t.sortOrder,
      entitlements: resolveEntitlements(t.id, row ? safeParse(row.entitlements, {}) : null),
      storedOverrides: row ? safeParse(row.entitlements, {}) : {},
      isDefaultDefinition: true,
    });
  }
  // Custom admin-created tiers (beyond the three defaults).
  for (const row of byId.values()) {
    out.push({
      id: row.id, name: row.name, displayName: row.displayName, description: row.description,
      isActive: row.isActive, sortOrder: row.sortOrder,
      entitlements: resolveEntitlements(row.id, safeParse(row.entitlements, {})),
      storedOverrides: safeParse(row.entitlements, {}),
      isDefaultDefinition: false,
    });
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return out;
}

/** Whether the user's SYSTEM role bypasses product tiers (admins + mods). */
export function isSystemBypassUser(user) {
  return user?.role === 'admin' || user?.role === 'mod';
}

/**
 * resolveUserEntitlements — the full entitlement context for a user.
 * @returns {{ bypass:boolean, bypassReason:string|null, tierId:string|null,
 *            tierDisplayName:string, enforcementEnabled:boolean,
 *            entitlements:Record<string,boolean|number> }}
 */
export async function resolveUserEntitlements(user) {
  const settings = await getTierSettings();
  if (isSystemBypassUser(user)) {
    return {
      bypass: true, bypassReason: user.role, tierId: null,
      tierDisplayName: user.role === 'admin' ? 'Administrator' : 'Moderator',
      enforcementEnabled: settings.enforcementEnabled !== false,
      entitlements: {},
    };
  }
  if (settings.enforcementEnabled === false) {
    return {
      bypass: true, bypassReason: 'enforcement_disabled', tierId: null,
      tierDisplayName: 'Unrestricted', enforcementEnabled: false, entitlements: {},
    };
  }
  // req.user from the auth middleware is a lean {id, email, role} — it does NOT
  // carry tierId. When the property is absent (vs explicitly null), load it so
  // per-user assignments actually take effect on every gated endpoint.
  let assignedTierId = user?.tierId;
  if (assignedTierId === undefined && user?.id) {
    try {
      const row = await prisma.user.findUnique({ where: { id: user.id }, select: { tierId: true } });
      assignedTierId = row?.tierId ?? null;
    } catch { assignedTierId = null; }
  }
  const tiers = await listTiers();
  const activeById = new Map(tiers.filter(t => t.isActive).map(t => [t.id, t]));
  let tierId = assignedTierId && activeById.has(assignedTierId) ? assignedTierId : null;
  if (!tierId) tierId = await getDefaultTierId(settings);
  const tier = activeById.get(tierId) || tiers.find(t => t.id === tierId) || null;
  return {
    bypass: false, bypassReason: null,
    tierId,
    tierDisplayName: tier?.displayName || tierDisplayName(tierId),
    enforcementEnabled: true,
    entitlements: tier?.entitlements || resolveEntitlements(tierId),
  };
}

/** Typed error the require* helpers throw; controllers surface `.body` with `.status`. */
export class TierLimitError extends Error {
  constructor(body) {
    super(body.message);
    this.status = 403;
    this.code = 'TIER_LIMIT_EXCEEDED';
    this.body = body;
  }
}

/**
 * requireEntitlement — throw TierLimitError unless the user's tier grants the
 * boolean feature (admin/mod and kill-switch bypass first). Returns the resolved
 * context so callers can reuse it.
 */
export async function requireEntitlement(user, key, { message } = {}) {
  const ctx = await resolveUserEntitlements(user);
  if (ctx.bypass) return ctx;
  if (!ENTITLEMENT_KEY_SET.has(key) || hasEntitlement(ctx.entitlements, key)) return ctx;
  const required = requiredTierFor(key);
  throw new TierLimitError(buildTierLimitError({
    feature: key,
    currentTier: ctx.tierId,
    requiredTier: required,
    message: message || `This feature is available on the ${tierDisplayName(required) || 'a higher'} plan and above.`,
  }));
}

/**
 * requireLimit — throw TierLimitError when `value` would exceed the tier's
 * numeric limit for `key`. Pass the WOULD-BE total (current + incoming).
 */
export async function requireLimit(user, key, value, { message } = {}) {
  const ctx = await resolveUserEntitlements(user);
  if (ctx.bypass) return ctx;
  if (!ENTITLEMENT_KEY_SET.has(key) || withinLimit(ctx.entitlements, key, value)) return ctx;
  const cap = limitOf(ctx.entitlements, key);
  const required = requiredTierFor(key, value);
  throw new TierLimitError(buildTierLimitError({
    feature: key,
    currentTier: ctx.tierId,
    requiredTier: required,
    message: message || `Your current plan allows up to ${cap === Infinity ? 'unlimited' : cap.toLocaleString()} for this. ${required ? `The ${tierDisplayName(required)} plan raises this limit.` : 'Contact an administrator to raise this limit.'}`,
  }));
}

/**
 * loadUserForTier — minimal user row for tier resolution by id (used when the
 * governing tier belongs to someone other than the caller, e.g. the PROJECT
 * OWNER's tier governs project capacity limits regardless of which leader acts).
 * Returns null when the user does not exist (callers then skip the tier check
 * rather than failing the action on a missing owner row).
 */
export async function loadUserForTier(userId) {
  if (!userId) return null;
  try {
    return await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, tierId: true } });
  } catch { return null; }
}

/**
 * sendTierLimit — helper for controllers: if `err` is a TierLimitError respond
 * with the structured 403 body and return true; otherwise return false.
 */
export function sendTierLimit(res, err) {
  if (err instanceof TierLimitError || err?.code === 'TIER_LIMIT_EXCEEDED') {
    res.status(err.status || 403).json(err.body || buildTierLimitError({ feature: null, message: err.message }));
    return true;
  }
  return false;
}

export { UNLIMITED, hasEntitlement, limitOf, withinLimit, requiredTierFor, tierDisplayName };
