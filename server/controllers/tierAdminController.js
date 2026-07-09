/**
 * tierAdminController.js — Ops/admin management of product tiers (67.md).
 * Admin-only (mounted behind requireAdmin). Product tiers are a SEPARATE axis
 * from app roles (admin/mod/user) and project roles — this controller only
 * touches the tier system. Every mutation is audited.
 */
import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import {
  listTiers, getTierSettings, getDefaultTierId, TIER_SETTINGS_KEY,
  recordTierAssignment, revertTierAssignment, tierMoveDirection, daysInTier,
  pctOf, isExpiringSoon, coerceChangeType, VALID_CHANGE_TYPES,
} from '../services/entitlementService.js';
import { ENTITLEMENT_KEYS, ENTITLEMENT_KEY_SET, DEFAULT_TIER_IDS, UNLIMITED, tierDisplayName } from '../../src/shared/entitlements.js';

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}

/**
 * 79.md §2 — whitelist-coerce the tier BUSINESS-METADATA fields from a request body
 * (pricing / trial / grace / flags). Only present, well-typed keys are returned so a
 * partial PATCH never clobbers unspecified fields. Prices are non-negative integers
 * in minor units (cents); null clears a price. currency is a 3-letter lower-case code.
 */
export function coerceTierMeta(b) {
  const out = {};
  if (!b || typeof b !== 'object') return out;
  const boolKeys = ['isPaid', 'publiclyAvailable', 'manualAssignAllowed'];
  for (const k of boolKeys) if (typeof b[k] === 'boolean') out[k] = b[k];
  for (const k of ['priceMonthlyCents', 'priceAnnualCents']) {
    if (k in b) {
      if (b[k] === null || b[k] === '') out[k] = null;
      else if (Number.isFinite(Number(b[k]))) out[k] = Math.max(0, Math.round(Number(b[k])));
    }
  }
  for (const k of ['trialDays', 'gracePeriodDays']) {
    if (k in b && Number.isFinite(Number(b[k]))) out[k] = Math.min(3650, Math.max(0, Math.round(Number(b[k]))));
  }
  if (typeof b.currency === 'string' && b.currency.trim()) {
    out.currency = b.currency.trim().toLowerCase().slice(0, 8);
  }
  return out;
}

/** Whitelist-coerce an entitlement override map (junk keys/types dropped). */
export function coerceEntitlementOverrides(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  const metaByKey = new Map(ENTITLEMENT_KEYS.map(e => [e.key, e]));
  for (const [k, v] of Object.entries(patch)) {
    const meta = metaByKey.get(k);
    if (!meta) continue;
    if (meta.kind === 'boolean' && typeof v === 'boolean') out[k] = v;
    else if (meta.kind === 'limit' && typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v === UNLIMITED ? UNLIMITED : Math.max(0, Math.round(v));
    }
  }
  return out;
}

/** GET /api/admin/tiers — tiers + settings + the key registry for the editor. */
export async function getTiersAdmin(req, res) {
  try {
    const [tiers, settings] = await Promise.all([listTiers(), getTierSettings()]);
    const defaultTierId = await getDefaultTierId(settings);
    const counts = await prisma.user.groupBy({ by: ['tierId'], _count: { _all: true } }).catch(() => []);
    const countByTier = Object.fromEntries(counts.map(c => [c.tierId ?? '__default__', c._count._all]));
    res.json({
      tiers: tiers.map(t => ({ ...t, assignedUsers: countByTier[t.id] || 0 })),
      unassignedUsers: countByTier.__default__ || 0,
      settings,
      defaultTierId,
      keys: ENTITLEMENT_KEYS,
      // 72.md — vocabularies the tier-management UI needs (change-type dropdown +
      // subscription status options for the billing placeholder).
      changeTypes: VALID_CHANGE_TYPES,
      subscriptionStatuses: ['none', 'trialing', 'active', 'past_due', 'canceled'],
      note: 'Product tiers govern NORMAL users only — admins and mods always bypass. Tiers are separate from project roles (Owner/Leader/Reviewer/Viewer).',
    });
  } catch (e) { console.error('getTiersAdmin', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** PUT /api/admin/tiers/:id — edit a tier's display fields + entitlement overrides. */
export async function updateTierAdmin(req, res) {
  try {
    const id = String(req.params.id || '');
    const b = req.body || {};
    const isDefaultDef = DEFAULT_TIER_IDS.includes(id);
    const existing = await prisma.productTier.findUnique({ where: { id } });
    if (!existing && !isDefaultDef) return res.status(404).json({ error: 'Tier not found' });

    const overrides = b.entitlements !== undefined ? coerceEntitlementOverrides(b.entitlements) : null;
    const defaultTierId = await getDefaultTierId();
    if (b.isActive === false && id === defaultTierId) {
      return res.status(400).json({ error: 'The site default tier cannot be deactivated. Change the default tier first.' });
    }

    const data = { ...coerceTierMeta(b) };
    if (typeof b.displayName === 'string' && b.displayName.trim()) data.displayName = b.displayName.trim().slice(0, 100);
    if (typeof b.description === 'string') data.description = b.description.slice(0, 500);
    if (typeof b.isActive === 'boolean') data.isActive = b.isActive;
    if (Number.isFinite(b.sortOrder)) data.sortOrder = Math.round(b.sortOrder);
    if (overrides !== null) data.entitlements = JSON.stringify(overrides);
    // Keep archivedAt consistent with isActive: reactivating clears the archive stamp;
    // an explicit archive is handled by the dedicated archive endpoint.
    if (data.isActive === true) data.archivedAt = null;

    const row = existing
      ? await prisma.productTier.update({ where: { id }, data })
      : await prisma.productTier.create({
          data: { id, name: id, displayName: id, ...data, entitlements: data.entitlements || '{}' },
        });
    await logAdminAction(req, 'UPDATE_PRODUCT_TIER', 'ProductTier', id, {
      changed: Object.keys(data),
      entitlements: overrides !== null ? overrides : undefined,
    });
    const tiers = await listTiers();
    res.json({ ok: true, tier: tiers.find(t => t.id === row.id) || null });
  } catch (e) { console.error('updateTierAdmin', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** A valid custom tier id: lowercase slug, not colliding with a reserved word. */
const TIER_ID_RE = /^[a-z][a-z0-9_-]{1,40}$/;
const RESERVED_TIER_IDS = new Set(['__default__', 'default', 'admin', 'mod', 'user', 'all', 'none']);

/**
 * POST /api/admin/tiers — 79.md §2. Create a NEW custom tier. The id is a stable
 * lowercase slug (immutable once created); everything else is editable afterwards.
 */
export async function createTierAdmin(req, res) {
  try {
    const b = req.body || {};
    const id = String(b.id || '').trim().toLowerCase();
    if (!TIER_ID_RE.test(id) || RESERVED_TIER_IDS.has(id) || DEFAULT_TIER_IDS.includes(id)) {
      return res.status(400).json({ error: 'Tier id must be a unique lowercase slug (a-z, 0-9, -, _) that is not a reserved or built-in tier.' });
    }
    const existing = await prisma.productTier.findUnique({ where: { id } });
    if (existing) return res.status(409).json({ error: 'A tier with that id already exists.' });

    const overrides = coerceEntitlementOverrides(b.entitlements || {});
    const meta = coerceTierMeta(b);
    const displayName = (typeof b.displayName === 'string' && b.displayName.trim()) ? b.displayName.trim().slice(0, 100) : id;
    const tiers = await listTiers();
    const maxSort = tiers.reduce((m, t) => Math.max(m, t.sortOrder || 0), 0);

    const row = await prisma.productTier.create({
      data: {
        id, name: id, displayName,
        description: typeof b.description === 'string' ? b.description.slice(0, 500) : '',
        isActive: b.isActive !== false,
        sortOrder: Number.isFinite(b.sortOrder) ? Math.round(b.sortOrder) : maxSort + 1,
        entitlements: JSON.stringify(overrides),
        ...meta,
      },
    });
    await logAdminAction(req, 'CREATE_PRODUCT_TIER', 'ProductTier', id, { displayName, meta });
    const list = await listTiers();
    res.status(201).json({ ok: true, tier: list.find(t => t.id === row.id) || null });
  } catch (e) { console.error('createTierAdmin', e); res.status(500).json({ error: 'Internal server error' }); }
}

/**
 * POST /api/admin/tiers/:id/duplicate — 79.md §2. Clone an existing tier (default or
 * custom) as a starting template. Body: { id, displayName? }. The clone copies the
 * source's FULLY-RESOLVED entitlements + business metadata; the new id must be free.
 */
export async function duplicateTierAdmin(req, res) {
  try {
    const sourceId = String(req.params.id || '');
    const tiers = await listTiers();
    const source = tiers.find(t => t.id === sourceId);
    if (!source) return res.status(404).json({ error: 'Source tier not found' });

    const b = req.body || {};
    const newId = String(b.id || '').trim().toLowerCase();
    if (!TIER_ID_RE.test(newId) || RESERVED_TIER_IDS.has(newId) || DEFAULT_TIER_IDS.includes(newId)) {
      return res.status(400).json({ error: 'New tier id must be a unique lowercase slug that is not a reserved or built-in tier.' });
    }
    if (await prisma.productTier.findUnique({ where: { id: newId } })) {
      return res.status(409).json({ error: 'A tier with that id already exists.' });
    }
    // Copy the RESOLVED entitlements so the clone is fully explicit (independent of the
    // source's default-merge), then whitelist through the coercer.
    const overrides = coerceEntitlementOverrides(source.entitlements || {});
    const maxSort = tiers.reduce((m, t) => Math.max(m, t.sortOrder || 0), 0);
    const row = await prisma.productTier.create({
      data: {
        id: newId, name: newId,
        displayName: (typeof b.displayName === 'string' && b.displayName.trim()) ? b.displayName.trim().slice(0, 100) : `${source.displayName} (copy)`,
        description: source.description || '',
        isActive: true,
        sortOrder: maxSort + 1,
        entitlements: JSON.stringify(overrides),
        isPaid: source.isPaid, publiclyAvailable: false, // a clone starts unpublished
        manualAssignAllowed: source.manualAssignAllowed,
        priceMonthlyCents: source.priceMonthlyCents ?? null, priceAnnualCents: source.priceAnnualCents ?? null,
        currency: source.currency || 'usd', trialDays: source.trialDays || 0, gracePeriodDays: source.gracePeriodDays || 0,
      },
    });
    await logAdminAction(req, 'DUPLICATE_PRODUCT_TIER', 'ProductTier', newId, { from: sourceId });
    const list = await listTiers();
    res.status(201).json({ ok: true, tier: list.find(t => t.id === row.id) || null });
  } catch (e) { console.error('duplicateTierAdmin', e); res.status(500).json({ error: 'Internal server error' }); }
}

/**
 * POST /api/admin/tiers/:id/archive — 79.md §2. Soft-archive (deactivate + stamp
 * archivedAt) or restore (body { archived:false }). Archiving keeps the row so users
 * already assigned to it never break; the site default tier can never be archived.
 */
export async function archiveTierAdmin(req, res) {
  try {
    const id = String(req.params.id || '');
    const archived = req.body?.archived !== false; // default = archive
    const tiers = await listTiers();
    const tier = tiers.find(t => t.id === id);
    if (!tier) return res.status(404).json({ error: 'Tier not found' });
    const defaultTierId = await getDefaultTierId();
    if (archived && id === defaultTierId) {
      return res.status(400).json({ error: 'The site default tier cannot be archived. Change the default tier first.' });
    }

    // For a default-definition tier without a row yet, create one carrying the archive state.
    const existing = await prisma.productTier.findUnique({ where: { id } });
    const data = archived
      ? { isActive: false, archivedAt: new Date() }
      : { isActive: true, archivedAt: null };
    if (existing) {
      await prisma.productTier.update({ where: { id }, data });
    } else {
      await prisma.productTier.create({
        data: { id, name: id, displayName: tier.displayName || id, description: tier.description || '', entitlements: '{}', ...data },
      });
    }
    await logAdminAction(req, archived ? 'ARCHIVE_PRODUCT_TIER' : 'RESTORE_PRODUCT_TIER', 'ProductTier', id, {
      assignedUsers: await prisma.user.count({ where: { tierId: id } }).catch(() => 0),
    });
    const list = await listTiers();
    res.json({ ok: true, tier: list.find(t => t.id === id) || null });
  } catch (e) { console.error('archiveTierAdmin', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /api/admin/export-usage?period=YYYY-MM — 79.md §3 project-export usage view. */
export async function getProjectExportUsageAdmin(req, res) {
  try {
    const { projectExportUsageSummary, currentPeriod } = await import('../services/projectExportGuard.js');
    const period = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? String(req.query.period) : currentPeriod();
    const summary = await projectExportUsageSummary({ period, take: 100 });
    // Enrich the top-user + recent rows with emails for the Ops table.
    const ids = [...new Set([...summary.topUsers.map(u => u.userId), ...summary.recent.map(r => r.userId)].filter(Boolean))];
    const emailById = await usersEmailMap(ids);
    res.json({
      ...summary,
      topUsers: summary.topUsers.map(u => ({ ...u, email: emailById.get(u.userId) || null })),
      recent: summary.recent.map(r => ({ ...r, email: emailById.get(r.userId) || null })),
    });
  } catch (e) { console.error('getProjectExportUsageAdmin', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** PUT /api/admin/tier-settings — enforcement kill-switch + default tier. */
export async function updateTierSettingsAdmin(req, res) {
  try {
    const current = await getTierSettings();
    const next = { ...current };
    const b = req.body || {};
    if (typeof b.enforcementEnabled === 'boolean') next.enforcementEnabled = b.enforcementEnabled;
    if (b.defaultTierId !== undefined) {
      if (b.defaultTierId === null) next.defaultTierId = null;
      else {
        const tiers = await listTiers();
        if (!tiers.some(t => t.id === b.defaultTierId && t.isActive)) {
          return res.status(400).json({ error: 'Unknown or inactive tier id' });
        }
        next.defaultTierId = String(b.defaultTierId);
      }
    }
    await prisma.siteSetting.upsert({
      where: { key: TIER_SETTINGS_KEY },
      create: { key: TIER_SETTINGS_KEY, value: JSON.stringify(next), updatedBy: req.user?.id || null },
      update: { value: JSON.stringify(next), updatedBy: req.user?.id || null },
    });
    await logAdminAction(req, 'UPDATE_TIER_SETTINGS', 'SiteSetting', TIER_SETTINGS_KEY, { next });
    res.json({ ok: true, settings: next, defaultTierId: await getDefaultTierId(next) });
  } catch (e) { console.error('updateTierSettingsAdmin', e); res.status(500).json({ error: 'Internal server error' }); }
}

/**
 * PATCH /api/admin/users/:id/tier — assign a user to a tier (or null → reset to
 * the site default). Admin-only. Does NOT touch role or project memberships.
 *
 * 72.md — every change now writes a UserTierAssignment history row (who/why/how/
 * when + optional scheduled expiry) via the ONE writer, flips the prior current
 * row, and updates the User.tier* fields in the same transaction.
 * Body: { tierId, changeType, reason, effectiveUntil?, notes? }.
 */
export async function updateUserTierAdmin(req, res) {
  try {
    const userId = String(req.params.id || '');
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, tierId: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const b = req.body || {};
    const tiers = await listTiers();
    const defaultId = await getDefaultTierId();

    // Resolve the target tier. A null/empty tierId means "reset to the site
    // default" → keep User.tierId null (read-time default) but record the concrete
    // default on the history row so analytics/history always show a real tier.
    let concreteTierId;
    let userTierId; // what to persist on User.tierId
    if (b.tierId != null && b.tierId !== '') {
      const chosen = tiers.find(t => t.id === b.tierId);
      if (!chosen) return res.status(400).json({ error: 'Unknown tier id' });
      if (!chosen.isActive) return res.status(400).json({ error: 'Cannot assign an inactive tier' });
      concreteTierId = String(b.tierId);
      userTierId = concreteTierId;
    } else {
      concreteTierId = defaultId;
      userTierId = null;
    }

    const changeType = coerceChangeType(b.changeType);
    const reason = b.reason ? String(b.reason).slice(0, 500) : '';
    const notes = b.notes ? String(b.notes).slice(0, 2000) : '';
    const effectiveUntil = b.effectiveUntil ? new Date(b.effectiveUntil) : null;
    if (effectiveUntil && Number.isNaN(effectiveUntil.getTime())) {
      return res.status(400).json({ error: 'Invalid effectiveUntil date' });
    }

    await recordTierAssignment({
      userId,
      tierId: concreteTierId,
      userTierId,
      previousTierId: target.tierId ?? null,
      changeType,
      reason,
      notes,
      effectiveUntil,
      assignedById: req.user?.id || null,
      assignedByName: req.user?.name || req.user?.email || null,
      meta: userTierId === null ? { followDefault: true } : {},
    });

    const updated = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, tierId: true, tierAssignedAt: true },
    });
    await logAdminAction(req, 'UPDATE_USER_TIER', 'User', userId, {
      from: target.tierId ?? null,
      to: userTierId,
      concreteTier: concreteTierId,
      changeType,
      reason: reason || null,
      effectiveUntil: effectiveUntil ? effectiveUntil.toISOString() : null,
      // Reminder in the audit trail: tier ≠ role; admins/mods bypass tiers anyway.
      targetRole: target.role,
    });
    res.json({ ok: true, user: updated, defaultTierId: defaultId });
  } catch (e) { console.error('updateUserTierAdmin', e); res.status(500).json({ error: 'Internal server error' }); }
}

// ═══════════════════════════════════════════════════════════════════════════
// 72.md — tier analytics, per-user history, users-in-tier (+CSV), revert, and the
// subscription PLACEHOLDER. All admin-only (mounted behind requireAdmin).
// ═══════════════════════════════════════════════════════════════════════════

const RECENT_WINDOW_DAYS = 30;
const clampInt = (v, min, max, dflt) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** GET /api/admin/tiers/analytics — the business dashboard. */
export async function getTierAnalytics(req, res) {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - RECENT_WINDOW_DAYS * 86400000);
    const tiers = await listTiers();
    const orderById = new Map(tiers.map(t => [t.id, t.sortOrder]));
    const nameById = new Map(tiers.map(t => [t.id, t.displayName]));

    const [counts, totalUsers, currentRows, newCounts] = await Promise.all([
      prisma.user.groupBy({ by: ['tierId'], _count: { _all: true } }).catch(() => []),
      prisma.user.count().catch(() => 0),
      prisma.userTierAssignment.findMany({
        where: { isCurrent: true },
        select: { userId: true, tierId: true, previousTierId: true, changeType: true, effectiveFrom: true, effectiveUntil: true },
      }).catch(() => []),
      prisma.user.groupBy({ by: ['tierId'], where: { createdAt: { gte: windowStart } }, _count: { _all: true } }).catch(() => []),
    ]);

    const countByTier = Object.fromEntries(counts.map(c => [c.tierId ?? '__default__', c._count._all]));
    const unassigned = countByTier.__default__ || 0;
    const byTier = tiers.map(t => ({
      tierId: t.id,
      displayName: t.displayName,
      count: countByTier[t.id] || 0,
      pct: pctOf(countByTier[t.id] || 0, totalUsers),
    }));

    // Average days-in-tier across current assignments.
    const avgDaysInCurrentTier = currentRows.length
      ? Math.round((currentRows.reduce((s, r) => s + daysInTier(r.effectiveFrom, now), 0) / currentRows.length) * 10) / 10
      : 0;

    // Trial users: current trial_start assignments that have not expired.
    const trialRows = currentRows.filter(r => r.changeType === 'trial_start'
      && (!r.effectiveUntil || new Date(r.effectiveUntil).getTime() >= now.getTime()));
    const trialUsers = trialRows.length;

    const expiringRows = currentRows
      .filter(r => isExpiringSoon(r.effectiveUntil, now, RECENT_WINDOW_DAYS))
      .sort((a, b) => new Date(a.effectiveUntil) - new Date(b.effectiveUntil))
      .slice(0, 100);

    // Recent changes (last 20) + promotion/downgrade/manual tallies in the window.
    const recentAll = await prisma.userTierAssignment.findMany({
      where: { createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, tierId: true, previousTierId: true, changeType: true, createdAt: true, assignedByName: true },
    }).catch(() => []);

    // The tallies stay NUMBERS (the shipped contract); the *List keys below are
    // the ADDITIVE row arrays the dashboard lists render (73.md Part 10 — the
    // counts were being fed to list components, which .map over rows). recentAll
    // is createdAt-desc, so the first 20 matches are the most recent.
    let recentPromotions = 0, recentDowngrades = 0, manualChanges = 0;
    const promotionRows = [], downgradeRows = [];
    for (const r of recentAll) {
      const dir = tierMoveDirection(r.previousTierId, r.tierId, orderById);
      if (r.changeType === 'promotion' || dir === 'promotion') {
        recentPromotions++;
        if (promotionRows.length < 20) promotionRows.push(r);
      } else if (r.changeType === 'downgrade' || dir === 'downgrade') {
        recentDowngrades++;
        if (downgradeRows.length < 20) downgradeRows.push(r);
      }
      if (r.changeType === 'manual') manualChanges++;
    }

    const recentSlice = recentAll.slice(0, 20);
    const trialSlice = trialRows.slice(0, 100);
    // ONE email join covering every row the dashboard shows a user for
    // (previously only recentChanges — the mini lists fell back to raw userIds).
    const emailById = await usersEmailMap([
      ...recentSlice.map(r => r.userId),
      ...promotionRows.map(r => r.userId),
      ...downgradeRows.map(r => r.userId),
      ...trialSlice.map(r => r.userId),
      ...expiringRows.map(r => r.userId),
    ]);
    const shapeChange = (r) => ({
      userId: r.userId,
      email: emailById.get(r.userId) || null,
      from: r.previousTierId || null,
      to: r.tierId,
      changeType: r.changeType,
      at: r.createdAt,
      byName: r.assignedByName || null,
    });
    const recentChanges = recentSlice.map(shapeChange);
    const recentPromotionsList = promotionRows.map(shapeChange);
    const recentDowngradesList = downgradeRows.map(shapeChange);
    const trialUsersList = trialSlice.map(r => ({
      userId: r.userId,
      email: emailById.get(r.userId) || null,
      tierId: r.tierId,
      effectiveFrom: r.effectiveFrom,
      effectiveUntil: r.effectiveUntil,
    }));
    const expiringSoon = expiringRows.map(r => ({
      userId: r.userId,
      email: emailById.get(r.userId) || null,
      tierId: r.tierId,
      effectiveUntil: r.effectiveUntil,
    }));

    const newByTier = tiers.map(t => {
      const hit = newCounts.find(c => c.tierId === t.id);
      return { tierId: t.id, displayName: t.displayName, count: hit ? hit._count._all : 0 };
    });
    const newUnassigned = (newCounts.find(c => c.tierId === null)?._count._all) || 0;

    res.json({
      totalUsers,
      byTier,
      unassigned,
      avgDaysInCurrentTier,
      recentChanges,
      // Window tallies — NUMBERS, kept exactly as shipped (clients pin on these).
      recentPromotions,
      recentDowngrades,
      manualChanges,
      trialUsers,
      // 73.md Part 10 — additive row arrays for the dashboard lists.
      recentPromotionsList,
      recentDowngradesList,
      trialUsersList,
      expiringSoon,
      newByTier,
      newUnassigned,
      window: { days: RECENT_WINDOW_DAYS },
    });
  } catch (e) { console.error('getTierAnalytics', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** Fetch id→email for a set of user ids (used to enrich history/analytics rows). */
async function usersEmailMap(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, email: true } }).catch(() => []);
  return new Map(rows.map(u => [u.id, u.email]));
}

/** GET /api/admin/users/:id/tier-history — a user's full assignment trail (desc). */
export async function getUserTierHistory(req, res) {
  try {
    const userId = String(req.params.id || '');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true, tierId: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const rows = await prisma.userTierAssignment.findMany({
      where: { userId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const history = rows.map(r => ({
      id: r.id,
      tierId: r.tierId,
      tierDisplayName: tierDisplayName(r.tierId),
      previousTierId: r.previousTierId,
      previousTierDisplayName: r.previousTierId ? tierDisplayName(r.previousTierId) : null,
      changeType: r.changeType,
      reason: r.reason,
      notes: r.notes,
      effectiveFrom: r.effectiveFrom,
      effectiveUntil: r.effectiveUntil,
      isCurrent: r.isCurrent,
      reverted: r.reverted,
      revertedAt: r.revertedAt,
      revertedById: r.revertedById,
      assignedById: r.assignedById,
      assignedByName: r.assignedByName,
      createdAt: r.createdAt,
      meta: safeParse(r.metaJson, {}),
    }));
    res.json({ userId, user: { id: user.id, email: user.email, name: user.name, role: user.role }, currentTierId: user.tierId, history });
  } catch (e) { console.error('getUserTierHistory', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** Build the per-user rows for a tier (current-assignment detail joined onto the user). */
async function usersInTierRows(tierId, { skip = 0, take = 50, q = '' } = {}) {
  const where = { tierId };
  if (q) where.OR = [{ email: { contains: q } }, { name: { contains: q } }];
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { tierAssignedAt: 'desc' },
      skip, take,
      select: { id: true, email: true, name: true, role: true, tierId: true, suspended: true, createdAt: true, lastActive: true },
    }),
  ]);
  const ids = users.map(u => u.id);
  const currents = ids.length
    ? await prisma.userTierAssignment.findMany({ where: { userId: { in: ids }, isCurrent: true } })
    : [];
  const curByUser = new Map(currents.map(c => [c.userId, c]));
  const now = new Date();
  const rows = users.map(u => {
    const c = curByUser.get(u.id) || null;
    return {
      id: u.id,
      email: u.email,
      name: u.name || '',
      role: u.role,
      tierId: u.tierId,
      dateEntered: c?.effectiveFrom || u.tierAssignedAt || null,
      daysInTier: c?.effectiveFrom ? daysInTier(c.effectiveFrom, now) : null,
      previousTierId: c?.previousTierId || null,
      changeType: c?.changeType || null,
      assignedById: c?.assignedById || null,
      assignedByName: c?.assignedByName || null,
      reason: c?.reason || '',
      effectiveUntil: c?.effectiveUntil || null,
      createdAt: u.createdAt,
      lastActive: u.lastActive || null,
      status: u.suspended ? 'suspended' : 'active',
    };
  });
  return { total, rows };
}

/** GET /api/admin/tiers/:id/users?skip&take&q — paginated users currently in a tier. */
export async function getUsersInTier(req, res) {
  try {
    const tierId = String(req.params.id || '');
    const tiers = await listTiers();
    const tier = tiers.find(t => t.id === tierId);
    if (!tier) return res.status(404).json({ error: 'Tier not found' });
    const skip = clampInt(req.query.skip, 0, 1_000_000, 0);
    const take = clampInt(req.query.take, 1, 200, 50);
    const q = req.query.q ? String(req.query.q).slice(0, 200).trim() : '';
    const { total, rows } = await usersInTierRows(tierId, { skip, take, q });
    res.json({ tierId, displayName: tier.displayName, total, skip, take, q, users: rows });
  } catch (e) { console.error('getUsersInTier', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** Pure CSV field escaper (RFC-4180-ish). */
export function csvEscape(v) {
  const s = v == null ? '' : (v instanceof Date ? v.toISOString() : String(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const USERS_CSV_COLUMNS = [
  'id', 'email', 'name', 'role', 'tierId', 'dateEntered', 'daysInTier',
  'previousTierId', 'changeType', 'assignedByName', 'reason', 'effectiveUntil',
  'createdAt', 'lastActive', 'status',
];

/** Pure: users-in-tier rows → CSV text (header + rows). */
export function usersInTierCsv(rows) {
  const lines = [USERS_CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(USERS_CSV_COLUMNS.map(k => csvEscape(r[k])).join(','));
  return lines.join('\r\n');
}

/** GET /api/admin/tiers/:id/users/export — CSV of all users currently in a tier. */
export async function exportUsersInTier(req, res) {
  try {
    const tierId = String(req.params.id || '');
    const tiers = await listTiers();
    const tier = tiers.find(t => t.id === tierId);
    if (!tier) return res.status(404).json({ error: 'Tier not found' });
    const q = req.query.q ? String(req.query.q).slice(0, 200).trim() : '';
    const { rows } = await usersInTierRows(tierId, { skip: 0, take: 50000, q });
    const csv = usersInTierCsv(rows);
    await logAdminAction(req, 'EXPORT_TIER_USERS', 'ProductTier', tierId, { count: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tier-${tierId}-users.csv"`);
    res.send(csv);
  } catch (e) { console.error('exportUsersInTier', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /api/admin/users/:id/tier/revert — body { assignmentId }. */
export async function revertUserTier(req, res) {
  try {
    const userId = String(req.params.id || '');
    const assignmentId = String(req.body?.assignmentId || '');
    if (!assignmentId) return res.status(400).json({ error: 'assignmentId is required' });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    let result;
    try {
      result = await revertTierAssignment(userId, assignmentId, req.user || null);
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
      if (e.code === 'ALREADY_REVERTED') return res.status(409).json({ error: e.message });
      throw e;
    }
    await logAdminAction(req, 'REVERT_USER_TIER', 'User', userId, { assignmentId, restoredTierId: result.current.tierId });
    const updated = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, tierId: true, tierAssignedAt: true } });
    res.json({ ok: true, user: updated, current: result.current, reverted: result.reverted });
  } catch (e) { console.error('revertUserTier', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** Shape a TierSubscription row (or an empty placeholder) for the API. */
function shapeSubscription(userId, row) {
  if (!row) {
    return {
      userId, tierId: null, provider: null, providerCustomerId: null, providerSubscriptionId: null,
      priceId: null, planId: null, status: 'none', currentPeriodStart: null, currentPeriodEnd: null,
      trialStart: null, trialEnd: null, cancelAtPeriodEnd: false, lastPaymentAt: null, nextRenewalAt: null,
      failedPaymentCount: 0, notes: '', createdAt: null, updatedAt: null,
    };
  }
  const { id, ...rest } = row;
  return rest;
}

/** GET /api/admin/users/:id/subscription — billing PLACEHOLDER (no real billing). */
export async function getUserSubscription(req, res) {
  try {
    const userId = String(req.params.id || '');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const row = await prisma.tierSubscription.findUnique({ where: { userId } }).catch(() => null);
    res.json({
      subscription: shapeSubscription(userId, row),
      isPlaceholder: true,
      note: 'Billing is not yet implemented. These fields are a placeholder for a future subscription provider.',
    });
  } catch (e) { console.error('getUserSubscription', e); res.status(500).json({ error: 'Internal server error' }); }
}

const SUB_STATUSES = ['none', 'trialing', 'active', 'past_due', 'canceled'];

/** PUT /api/admin/users/:id/subscription — persist the placeholder fields (no billing). */
export async function updateUserSubscription(req, res) {
  try {
    const userId = String(req.params.id || '');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const b = req.body || {};

    const str = (v, max = 255) => (typeof v === 'string' ? v.slice(0, max) : null);
    const dt = (v) => { if (v == null || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d; };
    const data = {};
    if ('tierId' in b) data.tierId = str(b.tierId, 64);
    if ('provider' in b) data.provider = str(b.provider, 64);
    if ('providerCustomerId' in b) data.providerCustomerId = str(b.providerCustomerId);
    if ('providerSubscriptionId' in b) data.providerSubscriptionId = str(b.providerSubscriptionId);
    if ('priceId' in b) data.priceId = str(b.priceId);
    if ('planId' in b) data.planId = str(b.planId);
    if ('status' in b) {
      if (!SUB_STATUSES.includes(b.status)) return res.status(400).json({ error: `status must be one of ${SUB_STATUSES.join(', ')}` });
      data.status = b.status;
    }
    for (const k of ['currentPeriodStart', 'currentPeriodEnd', 'trialStart', 'trialEnd', 'lastPaymentAt', 'nextRenewalAt']) {
      if (k in b) { const d = dt(b[k]); if (d === undefined) return res.status(400).json({ error: `Invalid date for ${k}` }); data[k] = d; }
    }
    if ('cancelAtPeriodEnd' in b) data.cancelAtPeriodEnd = b.cancelAtPeriodEnd === true;
    if ('failedPaymentCount' in b) data.failedPaymentCount = clampInt(b.failedPaymentCount, 0, 1_000_000, 0);
    if ('notes' in b) data.notes = str(b.notes, 2000) || '';

    const row = await prisma.tierSubscription.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    await logAdminAction(req, 'UPDATE_USER_SUBSCRIPTION', 'TierSubscription', userId, { fields: Object.keys(data) });
    res.json({ subscription: shapeSubscription(userId, row), isPlaceholder: true });
  } catch (e) { console.error('updateUserSubscription', e); res.status(500).json({ error: 'Internal server error' }); }
}
