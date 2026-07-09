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

/**
 * 79.md §2 — business-metadata fields on a ProductTier row, with safe defaults so a
 * default-definition tier (no DB row) and older rows still resolve every field.
 */
export function tierMetaFields(row, defaults = {}) {
  return {
    isPaid: row?.isPaid ?? defaults.isPaid ?? false,
    publiclyAvailable: row?.publiclyAvailable ?? defaults.publiclyAvailable ?? true,
    manualAssignAllowed: row?.manualAssignAllowed ?? defaults.manualAssignAllowed ?? true,
    priceMonthlyCents: row?.priceMonthlyCents ?? defaults.priceMonthlyCents ?? null,
    priceAnnualCents: row?.priceAnnualCents ?? defaults.priceAnnualCents ?? null,
    currency: row?.currency ?? defaults.currency ?? 'usd',
    trialDays: row?.trialDays ?? defaults.trialDays ?? 0,
    gracePeriodDays: row?.gracePeriodDays ?? defaults.gracePeriodDays ?? 0,
    archivedAt: row?.archivedAt ?? null,
  };
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
      // 'free' is the canonical free tier; the others default to paid=false until an
      // admin sets pricing (business model is not final — 67.md).
      ...tierMetaFields(row, { isPaid: false }),
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
      ...tierMetaFields(row),
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
  const byId = new Map(tiers.map(t => [t.id, t]));
  const activeById = new Map(tiers.filter(t => t.isActive).map(t => [t.id, t]));
  const assigned = assignedTierId ? byId.get(assignedTierId) : null;
  // An explicitly-assigned tier that is ACTIVE, or that has been soft-ARCHIVED, still
  // governs the user — an archive must NEVER silently change an assigned user's
  // entitlements (79.md §6: "archived tiers do not break users already assigned to
  // them"). Only a plain (non-archived) deactivation or an unknown/deleted tier falls
  // through to the site default.
  let tierId;
  if (assigned && (activeById.has(assigned.id) || assigned.archivedAt)) tierId = assigned.id;
  else tierId = await getDefaultTierId(settings);
  const tier = byId.get(tierId) || null;
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

// ═══════════════════════════════════════════════════════════════════════════
// 72.md — tier ASSIGNMENT HISTORY + analytics + backfill.
//
// The authoritative "current tier" stays on User.tierId (67.md read-time
// resolution is unchanged). UserTierAssignment is the append-only audit trail:
// exactly one row per user is `isCurrent = true`. recordTierAssignment writes the
// history row AND (by default) the User.tier* fields in ONE transaction, so the
// two never drift. Every admin mutation + the boot backfill funnels through here.
// ═══════════════════════════════════════════════════════════════════════════

const VALID_CHANGE_TYPES = Object.freeze([
  'manual', 'promotion', 'downgrade', 'trial_start', 'trial_end', 'beta_access',
  'institution', 'payment', 'support_override', 'correction', 'backfill', 'other',
]);
export function isValidChangeType(t) { return VALID_CHANGE_TYPES.includes(t); }
export function coerceChangeType(t) { return VALID_CHANGE_TYPES.includes(t) ? t : 'manual'; }

const MS_PER_DAY = 86400000;

/** Direction of a tier move by sortOrder. Pure. `orderById` = Map<tierId, sortOrder>. */
export function tierMoveDirection(prevTierId, nextTierId, orderById) {
  if (!prevTierId) return 'initial';
  if (prevTierId === nextTierId) return 'lateral';
  const a = orderById?.get?.(prevTierId);
  const b = orderById?.get?.(nextTierId);
  if (typeof a === 'number' && typeof b === 'number') {
    if (b > a) return 'promotion';
    if (b < a) return 'downgrade';
  }
  return 'lateral';
}

/** Whole days elapsed since `effectiveFrom` (>= 0). Pure. */
export function daysInTier(effectiveFrom, now = new Date()) {
  if (!effectiveFrom) return 0;
  const from = new Date(effectiveFrom).getTime();
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((t - from) / MS_PER_DAY));
}

/** Percentage (one decimal place). Pure. */
export function pctOf(count, total) {
  if (!total || total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

/** Whether `effectiveUntil` falls within the next `withinDays` (and not already past). Pure. */
export function isExpiringSoon(effectiveUntil, now = new Date(), withinDays = 30) {
  if (!effectiveUntil) return false;
  const until = new Date(effectiveUntil).getTime();
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(until)) return false;
  return until >= t && until <= t + withinDays * MS_PER_DAY;
}

function parseDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * recordTierAssignment — the ONE writer for a tier change.
 * Flips any prior `isCurrent` rows to false, inserts a new current
 * UserTierAssignment, and (when touchUser) updates the User.tier* fields — all in
 * a single transaction. Reused by the admin controller, the revert path and the
 * boot backfill.
 *
 * @param {object} o
 * @param {string} o.userId
 * @param {string} o.tierId            concrete tier stored ON the assignment (required)
 * @param {string|null} [o.userTierId] what to write to User.tierId (default = tierId;
 *                                     pass null to keep the user on read-time default)
 * @param {string|null} [o.previousTierId]
 * @param {string} [o.changeType]
 * @param {string} [o.reason]
 * @param {string} [o.notes]
 * @param {Date|string|null} [o.effectiveFrom]
 * @param {Date|string|null} [o.effectiveUntil]
 * @param {string|null} [o.assignedById]
 * @param {string|null} [o.assignedByName]
 * @param {object|null} [o.meta]
 * @param {boolean} [o.touchUser]      also update the User.tier* fields (default true)
 * @returns {Promise<object>} the created assignment row
 */
export async function recordTierAssignment(o) {
  const {
    userId, tierId, previousTierId = null, changeType = 'manual',
    reason = '', notes = '', effectiveFrom = null, effectiveUntil = null,
    assignedById = null, assignedByName = null, meta = null, touchUser = true,
  } = o || {};
  if (!userId) throw new Error('recordTierAssignment: userId required');
  if (!tierId) throw new Error('recordTierAssignment: tierId required');
  const userTierId = o.userTierId === undefined ? tierId : o.userTierId;
  const effFrom = parseDateOrNull(effectiveFrom) || new Date();
  const effUntil = parseDateOrNull(effectiveUntil);
  const data = {
    userId,
    tierId: String(tierId),
    previousTierId: previousTierId ?? null,
    assignedById: assignedById ?? null,
    assignedByName: assignedByName ? String(assignedByName).slice(0, 200) : null,
    changeType: coerceChangeType(changeType),
    reason: reason ? String(reason).slice(0, 500) : '',
    notes: notes ? String(notes).slice(0, 2000) : '',
    effectiveFrom: effFrom,
    effectiveUntil: effUntil,
    isCurrent: true,
    metaJson: JSON.stringify(meta && typeof meta === 'object' ? meta : {}),
  };
  return prisma.$transaction(async (tx) => {
    await tx.userTierAssignment.updateMany({ where: { userId, isCurrent: true }, data: { isCurrent: false } });
    const row = await tx.userTierAssignment.create({ data });
    if (touchUser) {
      await tx.user.update({
        where: { id: userId },
        data: {
          tierId: userTierId ?? null,
          tierAssignedAt: effFrom,
          tierAssignedBy: assignedById ?? null,
          tierOverrideReason: reason ? String(reason).slice(0, 500) : null,
        },
      });
    }
    return row;
  });
}

/**
 * revertTierAssignment — undo a prior assignment: mark it reverted and restore its
 * `previousTierId` as the new current tier (writes a fresh 'correction' history
 * row). Returns { reverted, current }.
 */
export async function revertTierAssignment(userId, assignmentId, admin = null) {
  const target = await prisma.userTierAssignment.findUnique({ where: { id: String(assignmentId || '') } });
  if (!target || target.userId !== userId) { const e = new Error('Assignment not found for this user'); e.code = 'NOT_FOUND'; throw e; }
  if (target.reverted) { const e = new Error('This assignment has already been reverted'); e.code = 'ALREADY_REVERTED'; throw e; }

  const restoredTierId = target.previousTierId; // may be null → follow read-time default
  const defaultId = await getDefaultTierId();
  const now = new Date();
  await prisma.userTierAssignment.update({
    where: { id: target.id },
    data: { reverted: true, revertedAt: now, revertedById: admin?.id || null, isCurrent: false },
  });
  const current = await recordTierAssignment({
    userId,
    tierId: restoredTierId || defaultId,
    userTierId: restoredTierId ?? null,
    previousTierId: target.tierId,
    changeType: 'correction',
    reason: `Reverted assignment ${target.id}`,
    assignedById: admin?.id || null,
    assignedByName: admin?.name || admin?.email || null,
    meta: { revertOf: target.id },
  });
  return { reverted: { id: target.id, revertedAt: now }, current };
}

/**
 * planRecordLimitFor — the tier record-cap that governs a project's capacity,
 * resolved from the OWNER's tier `screening.maxRecordsPerProject` entitlement.
 * Returns a positive integer, or null when there is no cap to apply (owner
 * missing, admin/mod or enforcement-off bypass, or an UNLIMITED grant) so the
 * layered upload resolver simply falls through to the global Ops default.
 */
export async function planRecordLimitFor(ownerUserId) {
  try {
    const owner = await loadUserForTier(ownerUserId);
    if (!owner) return null;
    const ctx = await resolveUserEntitlements(owner);
    if (ctx.bypass) return null;
    const v = ctx.entitlements?.['screening.maxRecordsPerProject'];
    if (v === UNLIMITED || v == null) return null;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  } catch { return null; }
}

/**
 * backfillUserTiers — one-time idempotent boot hook: give every user WITHOUT any
 * assignment history an initial 'backfill' row + a concrete User.tierId. A user
 * who already carries an explicit User.tierId KEEPS it (the row just documents
 * the status quo — 73.md Part 10: the old behaviour overwrote it with the site
 * default and wrote previousTierId = the old tier, which both silently changed
 * the user's tier AND made every legacy assignment look like a promotion/
 * downgrade in analytics). Only users with NO tierId get the site default;
 * admins/mods get an internal tier if one exists (none by default → they get the
 * default too, and bypass tiers regardless).
 * Idempotent: a user that already has ANY assignment row is skipped. Returns the
 * number of users backfilled.
 */
export async function backfillUserTiers() {
  const settings = await getTierSettings();
  const defaultId = await getDefaultTierId(settings);
  const tiers = await listTiers();
  const activeIds = new Set(tiers.filter(t => t.isActive).map(t => t.id));
  const internalTierId = ['internal', 'staff', 'admin'].find(id => activeIds.has(id)) || null;

  let withHistory = [];
  try { withHistory = await prisma.userTierAssignment.findMany({ select: { userId: true }, distinct: ['userId'] }); }
  catch { withHistory = []; }
  const has = new Set(withHistory.map(r => r.userId));

  let users = [];
  try { users = await prisma.user.findMany({ select: { id: true, role: true, tierId: true } }); }
  catch { return 0; }

  let n = 0;
  for (const u of users) {
    if (has.has(u.id)) continue;
    // Explicit tier wins: preserve it verbatim. previousTierId stays null so the
    // backfill reads as an 'initial' assignment, never a fake promotion/downgrade.
    const explicitTierId = (typeof u.tierId === 'string' && u.tierId) ? u.tierId : null;
    const targetTier = explicitTierId
      || ((isSystemBypassUser(u) && internalTierId) ? internalTierId : defaultId);
    try {
      await recordTierAssignment({
        userId: u.id,
        tierId: targetTier,
        userTierId: targetTier,
        previousTierId: null,
        changeType: 'backfill',
        reason: 'Initial tier backfill',
        assignedByName: 'system',
        meta: { system: true },
      });
      n++;
    } catch (e) { console.error('[tiers] backfill failed for', u.id, e?.message); }
  }
  return n;
}

export { VALID_CHANGE_TYPES };
export { UNLIMITED, hasEntitlement, limitOf, withinLimit, requiredTierFor, tierDisplayName };
