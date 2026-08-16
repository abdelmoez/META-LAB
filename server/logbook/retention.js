/**
 * server/logbook/retention.js — 119.md §8 "Add appropriate indexes, retention
 * strategy, and pagination."
 *
 * THE POLICY, stated plainly:
 *
 *   Tier 0 — NEVER pruned. severity ≥ SENSITIVE (4): membership, permissions,
 *            ownership, project deletion, Logbook exports and denied access
 *            attempts. These are the accountability record of who could see and
 *            change the review; deleting them would defeat the point of an audit
 *            log, so no code path in this module can remove them.
 *
 *   Tier 1 — HIGH-VOLUME OPERATIONAL NOISE, pruned by age. severity ≤ ROUTINE (1)
 *            and older than `noiseRetentionDays` (default 400 — comfortably past
 *            a year, so an annual review still has its full working history).
 *            This is the tier that grows without bound: coalesced edit sessions,
 *            PDF reads, per-run chatter.
 *
 *   Tier 2 — PER-PROJECT CAP, applied only after Tier 1. When a project still
 *            holds more than `maxRowsPerProject` rows, the OLDEST tier-1 rows are
 *            dropped until it fits (ClientErrorReport's bounded-store precedent,
 *            109.md). Tier 0 rows are never counted against nor removed by the cap.
 *
 * NOT SCHEDULED BY DEFAULT. This module exports a function; nothing calls it on a
 * timer. Pruning an audit log is an operator decision, and this repo runs a
 * single Node process against a single SQLite file where a surprise bulk delete
 * would be felt immediately. Wire it to the ops job runner (or a cron) when a
 * deployment actually needs it, and record the run — `pruneProjectLogbook`
 * returns exactly what it removed so the caller can log it honestly.
 */
import { prisma } from '../db/client.js';
import { LOG_SEVERITY } from './vocabulary.js';

export const RETENTION_DEFAULTS = Object.freeze({
  /** Rows at or below this severity are prunable. Everything above is permanent. */
  prunableAtOrBelow: LOG_SEVERITY.ROUTINE,     // 1
  /** Age (days) a prunable row must reach before it may be removed. */
  noiseRetentionDays: 400,
  /** Per-project ceiling on PRUNABLE rows (tier-0 rows are never counted). */
  maxRowsPerProject: 100_000,
  /** Never delete more than this in one call — keeps a prune bounded and observable. */
  maxDeletePerRun: 5_000,
});

/**
 * pruneProjectLogbook(projectId, opts) — apply the policy above to ONE project.
 * Returns { byAge, byCap, kept, dryRun } — always, so a caller can log the effect.
 * Never throws; a failed prune leaves the table untouched.
 */
export async function pruneProjectLogbook(projectId, opts = {}) {
  const cfg = { ...RETENTION_DEFAULTS, ...opts };
  const out = { byAge: 0, byCap: 0, kept: 0, dryRun: !!opts.dryRun };
  const pid = String(projectId || '');
  if (!pid || !prisma.projectLogEvent) return out;

  const prunable = { projectId: pid, severity: { lte: cfg.prunableAtOrBelow } };

  try {
    const cutoff = new Date(Date.now() - cfg.noiseRetentionDays * 24 * 60 * 60 * 1000);

    // ── Tier 1: age ────────────────────────────────────────────────────────
    const agedWhere = { ...prunable, createdAt: { lt: cutoff } };
    const agedIds = await prisma.projectLogEvent.findMany({
      where: agedWhere, orderBy: { id: 'asc' }, take: cfg.maxDeletePerRun, select: { id: true },
    });
    if (agedIds.length && !out.dryRun) {
      const r = await prisma.projectLogEvent.deleteMany({ where: { id: { in: agedIds.map((x) => x.id) } } });
      out.byAge = r?.count || 0;
    } else {
      out.byAge = agedIds.length;
    }

    // ── Tier 2: cap (only if still over budget) ─────────────────────────────
    const remaining = await prisma.projectLogEvent.count({ where: prunable });
    out.kept = remaining;
    const excess = remaining - cfg.maxRowsPerProject;
    if (excess > 0) {
      const budget = Math.min(excess, Math.max(0, cfg.maxDeletePerRun - out.byAge));
      if (budget > 0) {
        const oldest = await prisma.projectLogEvent.findMany({
          where: prunable, orderBy: { id: 'asc' }, take: budget, select: { id: true },
        });
        if (oldest.length && !out.dryRun) {
          const r = await prisma.projectLogEvent.deleteMany({ where: { id: { in: oldest.map((x) => x.id) } } });
          out.byCap = r?.count || 0;
        } else {
          out.byCap = oldest.length;
        }
        out.kept = Math.max(0, remaining - out.byCap);
      }
    }
  } catch (e) {
    console.error('[logbook] prune failed', e?.message || e);
  }
  return out;
}

/**
 * describeRetention() — the policy as data, so an Ops surface can SHOW users what
 * is kept and for how long instead of leaving them to guess (119.md's honesty
 * rule applies to retention too: a log that quietly drops rows is worse than one
 * that says which rows it drops).
 */
export function describeRetention(opts = {}) {
  const cfg = { ...RETENTION_DEFAULTS, ...opts };
  return {
    permanent: 'Membership, permission, ownership, project-deletion and Logbook access/export events are kept for the life of the project.',
    prunedAfterDays: cfg.noiseRetentionDays,
    prunedDescription: `Routine activity (edit sessions, file reads, run chatter) may be removed after ${cfg.noiseRetentionDays} days.`,
    perProjectCap: cfg.maxRowsPerProject,
    scheduled: false,
    scheduleNote: 'No automatic pruning runs today — an operator must invoke pruneProjectLogbook explicitly.',
  };
}

export default { pruneProjectLogbook, describeRetention, RETENTION_DEFAULTS };
