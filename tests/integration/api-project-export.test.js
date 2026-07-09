/**
 * api-project-export.test.js — 79.md §3. Service-level tests of the project-export
 * tier gate against the real dev DB (no HTTP server; same direct-prisma pattern as
 * screening export-columns.test.js). The ProjectExportUsage ledger has no FKs, so
 * synthetic user objects (with an explicit tierId) exercise the guard directly.
 *
 * Proves:
 *  - FREE tier is blocked (TierLimitError, 403) — the fixed requirement;
 *  - PRO tier (unlimited allowance) succeeds and records a counted ledger row;
 *  - a finite monthly allowance is enforced (Nth+1 export throws) and cannot be
 *    exceeded by concurrent reservations;
 *  - a FAILED export is refunded (counted=false) and does not consume the allowance;
 *  - admin/mod BYPASS the gate without consuming allowance (uncounted audit row).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import {
  requireProjectExport, settleProjectExport, currentPeriod, EXPORT_TYPES,
} from '../../server/services/projectExportGuard.js';
import { TIER_SETTINGS_KEY } from '../../server/services/entitlementService.js';

const tag = `pex79_${Date.now()}`;
const LIMITED_TIER = `${tag}-limited`;
const period = currentPeriod();
let prevSettings = null;

const mkUser = (suffix, tierId, role = 'user') => ({ id: `${tag}-${suffix}`, email: `${tag}-${suffix}@x.io`, role, tierId });
const args = (user) => ({ user, opts: { exportType: EXPORT_TYPES.PROJECT_JSON, projectId: `${tag}-proj`, format: 'json' } });

beforeAll(async () => {
  // Force enforcement ON for a deterministic run (an admin may have toggled it off
  // in the dev DB); remember + restore the prior value in afterAll.
  prevSettings = await prisma.siteSetting.findUnique({ where: { key: TIER_SETTINGS_KEY } }).catch(() => null);
  await prisma.siteSetting.upsert({
    where: { key: TIER_SETTINGS_KEY },
    create: { key: TIER_SETTINGS_KEY, value: JSON.stringify({ enforcementEnabled: true, defaultTierId: null }) },
    update: { value: JSON.stringify({ enforcementEnabled: true, defaultTierId: null }) },
  });
  // A custom active tier that CAN export but with a small monthly allowance (2).
  await prisma.productTier.create({
    data: {
      id: LIMITED_TIER, name: LIMITED_TIER, displayName: 'Limited (test)', isActive: true, sortOrder: 999,
      entitlements: JSON.stringify({ 'projects.export': true, 'exports.maxPerMonth': 2 }),
    },
  });
});

afterAll(async () => {
  await prisma.projectExportUsage.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => {});
  await prisma.productTier.delete({ where: { id: LIMITED_TIER } }).catch(() => {});
  if (prevSettings) {
    await prisma.siteSetting.update({ where: { key: TIER_SETTINGS_KEY }, data: { value: prevSettings.value } }).catch(() => {});
  } else {
    await prisma.siteSetting.delete({ where: { key: TIER_SETTINGS_KEY } }).catch(() => {});
  }
});

describe('project-export tier gate (79.md §3)', () => {
  it('FREE tier cannot export any project (403 TierLimitError)', async () => {
    const { user, opts } = args(mkUser('free', 'free'));
    await expect(requireProjectExport(user, opts)).rejects.toMatchObject({
      status: 403, code: 'TIER_LIMIT_EXCEEDED',
    });
    // Nothing counted for a blocked user.
    const n = await prisma.projectExportUsage.count({ where: { userId: user.id, counted: true } });
    expect(n).toBe(0);
  });

  it('PRO tier (unlimited) succeeds and records a counted ledger row', async () => {
    const { user, opts } = args(mkUser('pro', 'pro'));
    const r = await requireProjectExport(user, opts);
    expect(r.bypass).toBe(false);
    expect(r.reservationId).toBeTruthy();
    expect(r.tierId).toBe('pro');
    await settleProjectExport(r.reservationId, { status: 'succeeded', fileSize: 1234 });
    const row = await prisma.projectExportUsage.findUnique({ where: { id: r.reservationId } });
    expect(row.status).toBe('succeeded');
    expect(row.counted).toBe(true);
    expect(row.fileSize).toBe(1234);
  });

  it('enforces a finite monthly allowance (3rd export over a cap of 2 throws)', async () => {
    const user = mkUser('limited', LIMITED_TIER);
    const opts = args(user).opts;
    const r1 = await requireProjectExport(user, opts); await settleProjectExport(r1.reservationId, { status: 'succeeded' });
    const r2 = await requireProjectExport(user, opts); await settleProjectExport(r2.reservationId, { status: 'succeeded' });
    await expect(requireProjectExport(user, opts)).rejects.toMatchObject({ status: 403 });
    const counted = await prisma.projectExportUsage.count({ where: { userId: user.id, period, counted: true } });
    expect(counted).toBe(2);
  });

  it('a FAILED export is refunded and does not consume the allowance', async () => {
    const user = mkUser('refund', LIMITED_TIER);
    const opts = args(user).opts;
    const r1 = await requireProjectExport(user, opts);
    await settleProjectExport(r1.reservationId, { status: 'failed', failureReason: 'boom' });
    // Refunded → both remaining slots still available.
    const r2 = await requireProjectExport(user, opts); await settleProjectExport(r2.reservationId, { status: 'succeeded' });
    const r3 = await requireProjectExport(user, opts); await settleProjectExport(r3.reservationId, { status: 'succeeded' });
    await expect(requireProjectExport(user, opts)).rejects.toMatchObject({ status: 403 });
    const counted = await prisma.projectExportUsage.count({ where: { userId: user.id, period, counted: true } });
    expect(counted).toBe(2); // the failed one did not count
  });

  it('concurrent reservations cannot exceed the allowance', async () => {
    const user = mkUser('race', LIMITED_TIER);
    const opts = args(user).opts;
    const results = await Promise.allSettled([
      requireProjectExport(user, opts),
      requireProjectExport(user, opts),
      requireProjectExport(user, opts),
      requireProjectExport(user, opts),
    ]);
    const ok = results.filter(r => r.status === 'fulfilled');
    const counted = await prisma.projectExportUsage.count({ where: { userId: user.id, period, counted: true } });
    expect(ok.length).toBeLessThanOrEqual(2);
    expect(counted).toBeLessThanOrEqual(2);
  });

  it('admin bypasses the gate without consuming allowance, even after settle', async () => {
    const { user, opts } = args(mkUser('admin', 'free', 'admin'));
    const r = await requireProjectExport(user, opts);
    expect(r.bypass).toBe(true);
    // The controller calls settle('succeeded') on EVERY reservation, including bypass
    // audit rows — settling must NOT flip a bypass row to counted (regression guard for
    // the kill-switch lockout bug: a success only finalises status, never counts).
    await settleProjectExport(r.reservationId, { status: 'succeeded' });
    const counted = await prisma.projectExportUsage.count({ where: { userId: user.id, counted: true } });
    expect(counted).toBe(0); // bypass rows stay uncounted audit entries after settle
    const row = await prisma.projectExportUsage.findUnique({ where: { id: r.reservationId } });
    expect(row.status).toBe('succeeded');
    expect(row.counted).toBe(false);
  });
});
