/**
 * routes/entitlements.js — the signed-in user's product-tier context (67.md).
 * Own mount at /api/entitlements (requireAuth only — NEVER under the rate-limited
 * /api/auth: the client hook fetches this on shell mount).
 */
import { Router } from 'express';
import { resolveUserEntitlements, listTiers } from '../services/entitlementService.js';

const router = Router();

/** GET /api/entitlements — the caller's resolved tier + entitlement map. */
router.get('/', async (req, res) => {
  try {
    const ctx = await resolveUserEntitlements(req.user);
    res.json(ctx);
  } catch (e) {
    console.error('getEntitlements', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /api/entitlements/tiers — active plans for upgrade messaging (secret-free). */
router.get('/tiers', async (req, res) => {
  try {
    const tiers = await listTiers();
    res.json({
      tiers: tiers.filter(t => t.isActive).map(t => ({
        id: t.id, displayName: t.displayName, description: t.description,
        sortOrder: t.sortOrder, entitlements: t.entitlements,
      })),
    });
  } catch (e) {
    console.error('getEntitlementTiers', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
