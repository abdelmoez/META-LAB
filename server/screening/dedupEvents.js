/**
 * screening/dedupEvents.js — 119.md §1. The ONE writer for the deduplication audit
 * trail (ScreenDedupEvent).
 *
 * ── AUDIT ONLY. NEVER A COUNTER SOURCE. ─────────────────────────────────────
 * PRISMA keeps deriving every number from the live records, batches and runs
 * (prismaFlowService → src/research-engine/prisma). Nothing in this file is ever
 * summed into a figure, and that is deliberate:
 *
 *   • derived counts SELF-HEAL — delete a batch, roll back a run or restore a record
 *     and the numbers move with the data. An event log accumulates history, so it
 *     would keep counting a removal whose record no longer exists.
 *   • every writer below is best-effort and retryable. A retried page or a re-run
 *     worker plan may append a second row for the same removal; that is harmless for
 *     an audit trail and fatal for a counter.
 *
 * What the events give is the thing counts cannot: for one specific record, WHY it
 * was removed, on what basis, by whom, when, and whether it was put back. 119.md §1
 * asks for exactly that model (project / record / canonical record / group / method /
 * automatic-or-manual / match basis / confidence / timestamp / actor / reversal /
 * source batch or run).
 *
 * Write points (all four wired):
 *   import landing   → 'import-exact'      (screeningImportService)
 *   pecan pipeline   → 'pecan-exact' | 'pecan-fuzzy' (pecanSearch/pipeline)
 *   duplicate worker → 'worker-suggestion' (screeningDuplicateWorker)
 *   human resolution → 'human-confirm' | 'human-keepall' (screeningController)
 *
 * Every function swallows its own errors: an audit write must never fail an import,
 * a search page, a worker plan or a reviewer's click.
 */
import { prisma } from '../db/client.js';

/** 119.md §1 — the closed method vocabulary. */
export const DEDUP_METHODS = Object.freeze([
  'import-exact', 'pecan-exact', 'pecan-fuzzy', 'worker-suggestion',
  'human-confirm', 'human-keepall',
]);

/** 119.md §1 — the closed match-basis vocabulary. */
export const DEDUP_BASES = Object.freeze([
  'doi', 'pmid', 'title', 'title-year', 'registry', 'identity', 'fuzzy', '',
]);

/** System actors, so an automatic event is never attributed to a person. */
export const DEDUP_ACTORS = Object.freeze({
  import: 'system:import',
  pecan: 'system:pecan',
  worker: 'system:worker',
});

const MAX_ROWS_PER_CALL = 2000;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

function available() {
  return !!(prisma && prisma.screenDedupEvent && typeof prisma.screenDedupEvent.createMany === 'function');
}

/**
 * Normalize one draft into a storable row. Unknown methods/bases are stored as-is
 * only when they are in the vocabulary; anything else is blanked rather than
 * inventing a category (the same honesty rule the PRISMA breakdowns follow).
 * Pure.
 */
export function normalizeDedupEvent(draft) {
  const d = draft || {};
  const method = DEDUP_METHODS.includes(d.method) ? d.method : '';
  const basis = DEDUP_BASES.includes(d.basis) ? d.basis : '';
  const classification = d.classification === 'manual' ? 'manual' : 'automatic';
  const confidence = Math.min(100, Math.max(0, Math.trunc(Number(d.confidence) || 0)));
  return {
    projectId: str(d.projectId, 60),
    recordId: str(d.recordId, 60),
    canonicalRecordId: str(d.canonicalRecordId, 60),
    groupId: str(d.groupId, 60),
    batchId: str(d.batchId, 60),
    runId: str(d.runId, 60),
    method,
    basis,
    classification,
    confidence,
    actor: str(d.actor, 100),
    actorName: str(d.actorName, 200),
    reversed: !!d.reversed,
    restoredAt: d.restoredAt ? new Date(d.restoredAt) : null,
    detail: str(typeof d.detail === 'string' ? d.detail : (d.detail ? JSON.stringify(d.detail) : ''), 1000),
  };
}

/**
 * recordDedupEvents(drafts) — append audit rows. Best-effort, chunked, never throws.
 * @returns {Promise<number>} rows attempted (0 when the table/client is unavailable)
 */
export async function recordDedupEvents(drafts) {
  if (!available()) return 0;
  const rows = (Array.isArray(drafts) ? drafts : [drafts])
    .filter(Boolean)
    .map(normalizeDedupEvent)
    .filter((r) => r.projectId && r.method);
  if (!rows.length) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_CALL) {
    const slice = rows.slice(i, i + MAX_ROWS_PER_CALL);
    try {
      await prisma.screenDedupEvent.createMany({ data: slice });
      written += slice.length;
    } catch {
      // 119.md §1 — the audit trail is additive; losing a row must never fail the
      // operation that produced it (and never changes a count, by construction).
    }
  }
  return written;
}

/**
 * markDedupEventsReversed({ projectId, recordIds }) — stamp the open removal events
 * for these records as reversed.
 *
 * The original rows are NEVER rewritten in meaning: `reversed`/`restoredAt` record
 * that the removal was undone, and the restoration itself is appended as its own
 * 'human-keepall' event. That mirrors the 108.md audit rule (undo APPENDS, never
 * rewrites) while keeping "is this removal still in force?" answerable in one read.
 */
export async function markDedupEventsReversed({ projectId, recordIds, at = new Date() } = {}) {
  if (!available() || !projectId) return 0;
  const ids = (Array.isArray(recordIds) ? recordIds : [recordIds]).filter(Boolean).map((v) => String(v));
  if (!ids.length) return 0;
  try {
    const res = await prisma.screenDedupEvent.updateMany({
      where: { projectId: String(projectId), recordId: { in: ids }, reversed: false },
      data: { reversed: true, restoredAt: at },
    });
    return (res && res.count) || 0;
  } catch { return 0; }
}

export default { recordDedupEvents, markDedupEventsReversed, normalizeDedupEvent, DEDUP_METHODS, DEDUP_BASES, DEDUP_ACTORS };
