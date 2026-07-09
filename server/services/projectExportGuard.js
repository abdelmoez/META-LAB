/**
 * projectExportGuard.js — 79.md §3. The SINGLE authority for "may this user export
 * a project, and does it fit their monthly allowance?".
 *
 * Two entitlements govern a project export:
 *   1. `projects.export` (boolean) — the master gate. Free tier = false → blocked
 *      entirely. admin/mod and the enforcement kill-switch bypass (like every other
 *      tier check).
 *   2. `exports.maxPerMonth` (numeric, UNLIMITED = ∞) — the per-calendar-month
 *      allowance for tiers that CAN export.
 *
 * Enforcement is RESERVE → SETTLE so it is race-safe and honest about failures:
 *   - requireProjectExport() resolves the tier, throws TierLimitError when the gate
 *     or the allowance is exceeded, and otherwise INSERTS a `started` ledger row
 *     inside the SAME transaction that counts prior counted rows — so two concurrent
 *     exports cannot both slip past the limit (SQLite serialises writers; the
 *     transactional count+insert is the Postgres-safe shape too).
 *   - settleProjectExport() flips the row to `succeeded` (keeps counted) or `failed`
 *     (counted=false → the allowance is refunded; a failed/validation-failed export
 *     never consumes usage, per 79.md §3).
 *
 * The ledger (ProjectExportUsage) doubles as the Ops export-usage view + audit trail
 * (who / which project / type / tier-at-the-time / period / counted / status / size).
 */
import { prisma } from '../db/client.js';
import { resolveUserEntitlements, TierLimitError } from './entitlementService.js';
import {
  hasEntitlement, limitOf, buildTierLimitError, requiredTierFor, tierDisplayName,
} from '../../src/shared/entitlements.js';

/** Canonical export-type identifiers written to the ledger. */
export const EXPORT_TYPES = Object.freeze({
  PROJECT_JSON: 'project_json',
  JOURNAL_ZIP: 'journal_zip',
  SCREENING_RECORDS: 'screening_records',
  ROB_ASSESSMENT: 'rob_assessment',
  PECAN_REPORT: 'pecan_report',
});
const EXPORT_TYPE_SET = new Set(Object.values(EXPORT_TYPES));

const PROJECT_EXPORT_KEY = 'projects.export';
const EXPORT_LIMIT_KEY = 'exports.maxPerMonth';

/** Current allowance window as 'YYYY-MM' (UTC). Pure given `now`. */
export function currentPeriod(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Build the structured 403 body for a blocked-because-disabled project export. */
function exportDisabledError(ctx) {
  const required = requiredTierFor(PROJECT_EXPORT_KEY);
  return new TierLimitError(buildTierLimitError({
    feature: PROJECT_EXPORT_KEY,
    currentTier: ctx.tierId,
    requiredTier: required,
    message: required
      ? `Exporting projects is not included in your current plan. It is available on the ${tierDisplayName(required)} plan and above.`
      : 'Exporting projects is not included in your current plan.',
  }));
}

/** Build the structured 403 body for an exhausted monthly export allowance. */
function exportLimitError(ctx, cap) {
  return new TierLimitError(buildTierLimitError({
    feature: EXPORT_LIMIT_KEY,
    currentTier: ctx.tierId,
    requiredTier: requiredTierFor(EXPORT_LIMIT_KEY, cap + 1),
    message: `You have reached your plan's limit of ${cap.toLocaleString()} project export${cap === 1 ? '' : 's'} this month. The limit resets at the start of next month, or an administrator can raise it.`,
  }));
}

/**
 * requireProjectExport — throw TierLimitError unless the user may export now, and
 * RESERVE one unit of the monthly allowance. Returns a reservation handle to pass to
 * settleProjectExport once the export has (or has not) produced a file.
 *
 * @param {object} user  req.user ({ id, role, tierId? } — tierId is loaded if absent)
 * @param {object} o
 * @param {string} o.exportType  one of EXPORT_TYPES
 * @param {string|null} [o.projectId]
 * @param {string|null} [o.format]
 * @returns {Promise<{reservationId:string|null, bypass:boolean, tierId:string|null, period:string}>}
 */
export async function requireProjectExport(user, { exportType, projectId = null, format = null } = {}) {
  const type = EXPORT_TYPE_SET.has(exportType) ? exportType : EXPORT_TYPES.PROJECT_JSON;
  const ctx = await resolveUserEntitlements(user);
  const period = currentPeriod();

  // admin/mod or the enforcement kill-switch → allow WITHOUT consuming allowance,
  // but still record an (uncounted) audit row so Ops sees the action.
  if (ctx.bypass) {
    const row = await safeCreate({
      userId: user?.id || null, projectId, exportType: type, format,
      tierId: null, period, counted: false, status: 'started',
    });
    return { reservationId: row?.id || null, bypass: true, tierId: null, period };
  }

  // Master gate — Free tier (and any tier without the entitlement) is blocked here.
  if (!hasEntitlement(ctx.entitlements, PROJECT_EXPORT_KEY)) {
    throw exportDisabledError(ctx);
  }

  const cap = limitOf(ctx.entitlements, EXPORT_LIMIT_KEY); // Infinity when UNLIMITED
  const finite = Number.isFinite(cap);

  // Reserve inside a transaction so concurrent exports can't both pass the limit.
  const row = await prisma.$transaction(async (tx) => {
    if (finite) {
      const used = await tx.projectExportUsage.count({
        where: { userId: user.id, period, counted: true },
      });
      if (used >= cap) throw exportLimitError(ctx, cap);
    }
    return tx.projectExportUsage.create({
      data: {
        userId: user.id, projectId, exportType: type, format,
        tierId: ctx.tierId || null, period, counted: true, status: 'started',
      },
    });
  });

  return { reservationId: row.id, bypass: false, tierId: ctx.tierId || null, period };
}

/**
 * requireProjectExportEnabled — boolean-only gate (NO allowance consumption, NO
 * ledger row). Use on endpoints that are hit repeatedly for the SAME export (e.g.
 * polling an async job or downloading its file) so they still verify the tier gate
 * without decrementing the allowance on every call. Throws TierLimitError when the
 * user's tier lacks `projects.export` (admin/mod + kill-switch bypass).
 */
export async function requireProjectExportEnabled(user) {
  const ctx = await resolveUserEntitlements(user);
  if (ctx.bypass) return ctx;
  if (!hasEntitlement(ctx.entitlements, PROJECT_EXPORT_KEY)) throw exportDisabledError(ctx);
  return ctx;
}

/**
 * settleProjectExport — record the outcome of a reserved export. On `failed` the
 * row is marked counted=false so the allowance is refunded (failed/validation-failed
 * exports never consume usage). Best-effort: a ledger write never fails the request.
 */
export async function settleProjectExport(reservationId, { status = 'succeeded', fileSize = null, failureReason = null } = {}) {
  if (!reservationId) return;
  const ok = status === 'succeeded';
  try {
    await prisma.projectExportUsage.update({
      where: { id: reservationId },
      data: {
        status: ok ? 'succeeded' : 'failed',
        counted: ok, // a failed export is refunded
        settledAt: new Date(),
        fileSize: Number.isFinite(fileSize) ? Math.max(0, Math.round(fileSize)) : null,
        failureReason: failureReason ? String(failureReason).slice(0, 500) : null,
      },
    });
  } catch { /* ledger is a side-effect, never a failure mode */ }
}

/** Insert a ledger row, swallowing errors (used for the bypass audit path). */
async function safeCreate(data) {
  try { return await prisma.projectExportUsage.create({ data }); }
  catch { return null; }
}

/**
 * projectExportUsageSummary — Ops view: per-user and per-tier export counts for a
 * period, plus the most recent rows. Counts only `counted` rows toward usage; lists
 * all statuses for the audit trail.
 */
export async function projectExportUsageSummary({ period = currentPeriod(), take = 100 } = {}) {
  const [byUser, recent, byTier] = await Promise.all([
    prisma.projectExportUsage.groupBy({
      by: ['userId'], where: { period, counted: true }, _count: { _all: true },
    }).catch(() => []),
    prisma.projectExportUsage.findMany({
      orderBy: { createdAt: 'desc' }, take: Math.min(500, Math.max(1, take)),
    }).catch(() => []),
    prisma.projectExportUsage.groupBy({
      by: ['tierId'], where: { period, counted: true }, _count: { _all: true },
    }).catch(() => []),
  ]);
  return {
    period,
    totalCounted: byUser.reduce((s, r) => s + (r._count?._all || 0), 0),
    byTier: byTier.map((r) => ({ tierId: r.tierId, count: r._count?._all || 0 })),
    topUsers: [...byUser].sort((a, b) => (b._count?._all || 0) - (a._count?._all || 0)).slice(0, 50)
      .map((r) => ({ userId: r.userId, count: r._count?._all || 0 })),
    recent: recent.map((r) => ({
      id: r.id, userId: r.userId, projectId: r.projectId, exportType: r.exportType,
      format: r.format, tierId: r.tierId, period: r.period, counted: r.counted,
      status: r.status, fileSize: r.fileSize, createdAt: r.createdAt, settledAt: r.settledAt,
    })),
  };
}
