/**
 * server/living/scheduler.js — the living-review scheduler (66.md P6.2).
 *
 * The app deliberately had NO recurring scheduler before this (boot-only
 * cleanup). This adds ONE lightweight interval loop (single-process, matching
 * the app's worker architecture) that:
 *   1. finds due, enabled saved searches (nextRunAt <= now) and launches their
 *      update runs through the durable Pecan Search worker (never inline);
 *   2. reconciles searches whose last run just reached a terminal state
 *      (stats → notifications → AI pre-scoring → automatic update snapshot).
 *
 * Safety: gated on the `livingReview` flag + admin schedulerEnabled setting +
 *         LIVING_SCHEDULER_ENABLED env (default on); re-entrancy guarded; every
 *         search is isolated (one failure never stops the loop); the interval is
 *         unref'd so it never keeps the process alive.
 */
import { prisma } from '../db/client.js';
import {
  livingReviewEnabled, getLivingSettings, runSavedSearch, reconcileSearch, notifyLeaders,
} from './livingService.js';
// 67.md — scheduled runs execute on the CREATOR's behalf, so their product tier
// must still include the scheduler at fire time (a downgrade stops the schedule).
import { requireEntitlement, loadUserForTier, TierLimitError } from '../services/entitlementService.js';

const TICK_MS = Number(process.env.LIVING_SCHEDULER_TICK_MS) || 5 * 60 * 1000;

let timer = null;
let ticking = false;

/** One scheduler pass. Exported for tests + the manual "check now" admin path. */
export async function livingSchedulerTick(now = new Date()) {
  if (ticking) return { skipped: true };
  ticking = true;
  const out = { started: 0, reconciled: 0, failed: 0 };
  try {
    if (process.env.LIVING_SCHEDULER_ENABLED === '0') return out;
    if (!(await livingReviewEnabled())) return out;
    const settings = await getLivingSettings();
    if (!settings.schedulerEnabled) return out;

    // 1. Launch due scheduled searches.
    const due = await prisma.livingSavedSearch.findMany({
      where: { enabled: true, cadence: { not: 'manual' }, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: 20, // bound one tick's fan-out; the next tick picks up the rest
    });
    for (const search of due) {
      try {
        // 67.md — verify the creator's plan still includes scheduled re-runs.
        const creator = await loadUserForTier(search.createdById);
        if (creator) await requireEntitlement(creator, 'livingReview.scheduler');
        await runSavedSearch(search, { reason: 'scheduled' });
        out.started++;
      } catch (e) {
        if (e instanceof TierLimitError) {
          // Not a failure — pause the schedule quietly until the plan allows it.
          await prisma.livingSavedSearch.update({
            where: { id: search.id },
            data: { enabled: false, lastError: 'Scheduled re-runs are not included in the creator’s current plan — schedule paused.' },
          }).catch(() => {});
          continue;
        }
        out.failed++;
        await prisma.livingSavedSearch.update({
          where: { id: search.id },
          data: {
            lastError: String(e?.message || e).slice(0, 500),
            // Move the schedule forward so a permanently-failing search does not
            // retry every tick; the failure is surfaced on the dashboard + bell.
            nextRunAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        }).catch(() => {});
        await notifyLeaders(search.metaLabProjectId, {
          type: 'LIVING_RUN_FAILED',
          title: 'Living review search could not start',
          message: `Scheduled search “${search.name}” could not start: ${String(e?.message || e).slice(0, 200)}`,
        });
      }
    }

    // 2. Reconcile searches whose last run may have finished.
    const pending = await prisma.livingSavedSearch.findMany({
      where: { lastRunId: { not: null }, lastRunState: { in: ['queued', 'running'] } },
      take: 50,
    });
    for (const search of pending) {
      try {
        const before = search.lastRunState;
        const after = await reconcileSearch(search);
        if (after.lastRunState !== before && ['completed', 'partial', 'failed', 'cancelled'].includes(after.lastRunState)) out.reconciled++;
      } catch { out.failed++; }
    }
  } catch (e) {
    console.error('[living-scheduler] tick failed:', e?.message);
  } finally {
    ticking = false;
  }
  return out;
}

/** Boot hook (server/index.js). Idempotent. */
export function startLivingScheduler() {
  if (timer) return;
  timer = setInterval(() => { livingSchedulerTick().catch(() => {}); }, TICK_MS);
  if (timer.unref) timer.unref();
  // One pass shortly after boot so restarts don't delay due searches a full tick.
  const kick = setTimeout(() => { livingSchedulerTick().catch(() => {}); }, 15000);
  if (kick.unref) kick.unref();
}

/** Test-only: stop the interval. */
export function stopLivingScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
