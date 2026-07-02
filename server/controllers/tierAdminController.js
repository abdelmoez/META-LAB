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
} from '../services/entitlementService.js';
import { ENTITLEMENT_KEYS, ENTITLEMENT_KEY_SET, DEFAULT_TIER_IDS, UNLIMITED } from '../../src/shared/entitlements.js';

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
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

    const data = {};
    if (typeof b.displayName === 'string' && b.displayName.trim()) data.displayName = b.displayName.trim().slice(0, 100);
    if (typeof b.description === 'string') data.description = b.description.slice(0, 500);
    if (typeof b.isActive === 'boolean') data.isActive = b.isActive;
    if (Number.isFinite(b.sortOrder)) data.sortOrder = Math.round(b.sortOrder);
    if (overrides !== null) data.entitlements = JSON.stringify(overrides);

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
 */
export async function updateUserTierAdmin(req, res) {
  try {
    const userId = String(req.params.id || '');
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, tierId: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const b = req.body || {};
    let tierId = null;
    if (b.tierId != null && b.tierId !== '') {
      const tiers = await listTiers();
      if (!tiers.some(t => t.id === b.tierId && t.isActive)) {
        return res.status(400).json({ error: 'Unknown or inactive tier id' });
      }
      tierId = String(b.tierId);
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        tierId,
        tierAssignedAt: new Date(),
        tierAssignedBy: req.user?.id || null,
        tierOverrideReason: b.reason ? String(b.reason).slice(0, 500) : null,
      },
      select: { id: true, email: true, tierId: true, tierAssignedAt: true },
    });
    await logAdminAction(req, 'UPDATE_USER_TIER', 'User', userId, {
      from: target.tierId ?? null,
      to: tierId,
      reason: b.reason ? String(b.reason).slice(0, 500) : null,
      // Reminder in the audit trail: tier ≠ role; admins/mods bypass tiers anyway.
      targetRole: target.role,
    });
    res.json({ ok: true, user: updated, defaultTierId: await getDefaultTierId() });
  } catch (e) { console.error('updateUserTierAdmin', e); res.status(500).json({ error: 'Internal server error' }); }
}
