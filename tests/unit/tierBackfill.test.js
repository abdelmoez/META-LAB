/**
 * tierBackfill.test.js — backfillUserTiers preservation semantics (73.md Part 10).
 *
 * The v3.67 boot backfill used to set every history-less user's tier to the site
 * DEFAULT with previousTierId = their old tier — for a legacy 'free' user that is
 * a silent tier overwrite AND a promotion-shaped analytics row (default 'pro' >
 * 'free'), which is exactly what fed the Ops → Tiers dashboard crash data.
 *
 * Pinned here (prisma mocked — no DB, no server):
 *   - a user with an explicit User.tierId KEEPS it (row tierId = their tier,
 *     previousTierId = null, changeType 'backfill'; User.tierId not defaulted);
 *   - a user with NO tierId gets the site default;
 *   - users with existing assignment history are skipped (idempotent).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  users: [],        // prisma.user.findMany result
  assignments: [],  // existing UserTierAssignment rows ({ userId })
  created: [],      // rows written via tx.userTierAssignment.create
  userUpdates: [],  // args of tx.user.update calls
}));

vi.mock('../../server/db/client.js', () => {
  const tx = {
    userTierAssignment: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => { state.created.push(data); return { id: `a${state.created.length}`, ...data }; },
    },
    user: {
      update: async (args) => { state.userUpdates.push(args); return {}; },
    },
  };
  return {
    prisma: {
      // tierSettings row → deterministic site default 'plus' (a real default-tier
      // id, distinct from the preserved tiers below so mix-ups are visible).
      siteSetting: { findUnique: async () => ({ key: 'tierSettings', value: JSON.stringify({ enforcementEnabled: true, defaultTierId: 'plus' }) }) },
      productTier: { findMany: async () => [] }, // code-default tiers only
      userTierAssignment: { findMany: async () => state.assignments },
      user: { findMany: async () => state.users },
      $transaction: async (fn) => fn(tx),
    },
  };
});

const { backfillUserTiers } = await import('../../server/services/entitlementService.js');

beforeEach(() => {
  state.users = [];
  state.assignments = [];
  state.created = [];
  state.userUpdates = [];
});

describe('backfillUserTiers — explicit tiers are preserved', () => {
  it('a user with an explicit tierId keeps it: no default overwrite, no fake promotion', async () => {
    state.users = [{ id: 'u-legacy', role: 'user', tierId: 'free' }];
    const n = await backfillUserTiers();
    expect(n).toBe(1);
    expect(state.created).toHaveLength(1);
    const row = state.created[0];
    expect(row.userId).toBe('u-legacy');
    expect(row.tierId).toBe('free');            // NOT the 'plus' site default
    expect(row.previousTierId).toBeNull();      // reads as 'initial' — never promotion-shaped
    expect(row.changeType).toBe('backfill');
    expect(row.isCurrent).toBe(true);
    // User.tierId is written back unchanged — never silently defaulted.
    expect(state.userUpdates).toHaveLength(1);
    expect(state.userUpdates[0].where).toEqual({ id: 'u-legacy' });
    expect(state.userUpdates[0].data.tierId).toBe('free');
  });

  it('a user with NO tierId gets the site default', async () => {
    state.users = [{ id: 'u-new', role: 'user', tierId: null }];
    const n = await backfillUserTiers();
    expect(n).toBe(1);
    expect(state.created[0].tierId).toBe('plus');
    expect(state.created[0].previousTierId).toBeNull();
    expect(state.created[0].changeType).toBe('backfill');
    expect(state.userUpdates[0].data.tierId).toBe('plus');
  });

  it('mixed population: each user resolved independently', async () => {
    state.users = [
      { id: 'u-a', role: 'user', tierId: 'pro' },
      { id: 'u-b', role: 'user', tierId: null },
      { id: 'u-c', role: 'user', tierId: '' },   // empty string counts as "no tier"
    ];
    const n = await backfillUserTiers();
    expect(n).toBe(3);
    const byUser = Object.fromEntries(state.created.map(r => [r.userId, r]));
    expect(byUser['u-a'].tierId).toBe('pro');    // preserved
    expect(byUser['u-b'].tierId).toBe('plus');   // defaulted
    expect(byUser['u-c'].tierId).toBe('plus');   // defaulted
    for (const r of state.created) expect(r.previousTierId).toBeNull();
  });

  it('is idempotent: users with any assignment history are skipped', async () => {
    state.users = [{ id: 'u-hist', role: 'user', tierId: 'free' }];
    state.assignments = [{ userId: 'u-hist' }];
    const n = await backfillUserTiers();
    expect(n).toBe(0);
    expect(state.created).toHaveLength(0);
    expect(state.userUpdates).toHaveLength(0);
  });
});
