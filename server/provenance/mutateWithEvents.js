/**
 * server/provenance/mutateWithEvents.js — 88.md Part VIII "Reliability" + AC-20.
 * The ATOMIC blob writer: a scientific state change and its provenance events commit
 * together or not at all. Mirrors store.mutateProjectBlob's autosaveRev compare-and-
 * swap, but wraps the CAS write + event inserts in ONE interactive transaction, so
 * the ledger can never say "the data changed" while the write rolled back, and the
 * data can never change without its events. The generic emitter (diffProjectEvents)
 * derives the events from before→after automatically, so no methodological change
 * slips through unlogged (AC-25).
 *
 * If the ledger table is unavailable (pre-migration), it degrades to a plain CAS
 * write with no events — never breaking the mutation.
 */
import { prisma } from '../db/client.js';
import { diffProjectEvents } from '../../src/research-engine/provenance/index.js';
import { buildEventRow, ledgerAvailable } from './recordEvent.js';

function rowToProject(row) {
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  return { id: row.id, name: row.name, autosaveRev: Number(row.autosaveRev || 0), ...data };
}

/**
 * mutateProjectBlobWithEvents(projectId, mutate, ctx) — CAS-safe blob mutation that
 * atomically appends the derived provenance events.
 *
 * @param {string} projectId
 * @param {(data:object)=>({result?:any, commit?:boolean, drafts?:Array})} mutate
 *        mutates the parsed blob IN PLACE; may run more than once (side-effect free).
 *        Optional `drafts` in the return are EXTRA hand-built event drafts (e.g. a
 *        typed SEARCH_MODE_CHANGED with a reason) merged with the generic diff.
 * @param {object} ctx  { actorUserId, actorName, actorRole, origin, reason,
 *                        correlationId, sessionId, maxAttempts, numericChange }
 * @returns {Promise<null|{project:object, result:any, committed:boolean, eventsWritten:number}>}
 */
export async function mutateProjectBlobWithEvents(projectId, mutate, ctx = {}) {
  const maxAttempts = ctx.maxAttempts || 6;
  const hasLedger = ledgerAvailable();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const existing = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!existing) return null;

    const baseRev = Number(existing.autosaveRev || 0);
    let before = {};
    try { before = JSON.parse(existing.data || '{}'); } catch { before = {}; }
    // Independent working copy so `before` stays the pristine pre-image for the diff.
    let working = {};
    try { working = JSON.parse(existing.data || '{}'); } catch { working = {}; }

    const out = mutate(working) || {};
    if (out.commit === false) {
      return { project: rowToProject(existing), result: out.result, committed: false, eventsWritten: 0 };
    }

    // Derive events (generic diff + any explicit drafts the mutator returned).
    const drafts = [
      ...diffProjectEvents(before, working, { origin: ctx.origin, reason: ctx.reason, correlationId: ctx.correlationId }),
      ...(Array.isArray(out.drafts) ? out.drafts : []),
    ];
    const eventCtx = { ...ctx, projectId, projectRev: baseRev + 1 };
    const rows = hasLedger
      ? drafts.map((d) => buildEventRow(d, eventCtx)).filter((r) => ctx.keepOperational || r.significance > 0)
      : [];

    const now = new Date();
    const dataStr = JSON.stringify(working);

    let committed = false;
    let eventsWritten = 0;
    try {
      await prisma.$transaction(async (tx) => {
        const res = await tx.project.updateMany({
          where: { id: projectId, autosaveRev: baseRev },
          data: { data: dataStr, autosaveRev: { increment: 1 }, lastActivityAt: now, lastSavedAt: now },
        });
        if (!res || res.count !== 1) {
          const err = new Error('CAS_RETRY');
          err.__casRetry = true;
          throw err; // rolls the whole tx back — no orphan events
        }
        committed = true;
        if (rows.length) {
          const created = await tx.projectEvent.createMany({ data: rows });
          eventsWritten = (created && created.count) || 0;
        }
      });
    } catch (e) {
      if (e && e.__casRetry) continue; // lost the CAS — re-read and re-apply
      // If the ledger insert is what failed (e.g. table vanished mid-flight), fall
      // back to a plain CAS state write so the scientific action is not lost.
      const res = await prisma.project.updateMany({
        where: { id: projectId, autosaveRev: baseRev },
        data: { data: dataStr, autosaveRev: { increment: 1 }, lastActivityAt: now, lastSavedAt: now },
      });
      if (!res || res.count !== 1) continue;
      committed = true;
      eventsWritten = 0;
      console.error('[provenance] atomic event write failed, state committed without events', e?.message || e);
    }

    const row = await prisma.project.findFirst({ where: { id: projectId } });
    return { project: rowToProject(row), result: out.result, committed, eventsWritten };
  }
  const err = new Error('mutateProjectBlobWithEvents: exceeded retry attempts under contention');
  err.code = 'BLOB_CONTENTION';
  throw err;
}

/**
 * recordBlobDiff(projectId, before, after, ctx) — best-effort (NON-atomic) capture
 * for the client-autosave path (store.save): the blob already committed, so we just
 * diff before→after and append events. Matches the never-throw audit convention.
 * Returns count written.
 */
export async function recordBlobDiff(projectId, before, after, ctx = {}) {
  if (!ledgerAvailable()) return 0;
  try {
    const drafts = diffProjectEvents(before || {}, after || {}, { origin: ctx.origin || 'user_action', reason: ctx.reason, correlationId: ctx.correlationId });
    if (!drafts.length) return 0;
    const { recordEvents } = await import('./recordEvent.js');
    return await recordEvents(drafts, { ...ctx, projectId });
  } catch (e) {
    console.error('[provenance] recordBlobDiff failed', e?.message || e);
    return 0;
  }
}

export default { mutateProjectBlobWithEvents, recordBlobDiff };
