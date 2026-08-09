/**
 * duplicateJobState.js — 107.md §1. Out-of-order protection for the duplicate
 * detection job row.
 *
 * The Duplicates tab learns the job state from FOUR independent network paths
 * (reconnect-on-mount fetch, 1.5 s active poll, 10 s idle status poll, and the
 * detect/cancel responses). Nothing ordered them, so a slow response could land
 * after a fresher one and move a job BACKWARD — the exact `completed → pending`
 * regression 107.md forbids.
 *
 * `pickNewerJob(prev, next)` is the single arbiter: it is pure, has no notion of
 * React, and answers one question — which of these two observations of the job
 * state is authoritative?
 *
 *   · SAME job id → status may only advance. Terminal (completed/failed/
 *     cancelled) outranks processing outranks queued; a lower-ranked response is
 *     a stale read and is dropped. At equal rank the newer `updatedAt` wins, and
 *     an IDENTICAL observation returns the previous object unchanged so a poll
 *     of a settled job never triggers a re-render.
 *   · DIFFERENT job id → the NEWER row wins (by `createdAt`, id as the
 *     deterministic tiebreak). This is what lets a fresh retry job (queued)
 *     legitimately supersede yesterday's completed run, while a status response
 *     describing an older job can never displace the run the user just started.
 *
 * Every timestamp is optional: rows may arrive without `updatedAt` (older API
 * projections) or without `createdAt` at all, so each comparison degrades to the
 * next available signal rather than throwing or guessing.
 */

// Terminal states share rank 2 — none of them may be replaced by an in-flight
// state for the SAME job id.
const STATUS_RANK = Object.freeze({
  queued: 0,
  processing: 1,
  completed: 2,
  failed: 2,
  cancelled: 2,
});

/** A usable job observation: an object carrying an id. Anything else is noise. */
function isJob(j) {
  return !!j && typeof j === 'object' && (typeof j.id === 'string' || typeof j.id === 'number') && String(j.id) !== '';
}

/** Rank of a job's status; -1 for an unknown/absent status (always outranked). */
function rankOf(job) {
  const r = STATUS_RANK[job && job.status];
  return typeof r === 'number' ? r : -1;
}

/** Parse a timestamp field into epoch ms, or null when absent/garbage. */
function timeOf(job, field) {
  const v = job ? job[field] : null;
  if (v == null || v === '') return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Decide which job observation is authoritative.
 *
 * @param {object|null} prev — the job currently held in state (may be null).
 * @param {object|null} next — a job just received from the server (may be null).
 * @returns {object|null} whichever observation wins; `prev` by reference when
 *   nothing moved, so callers can cheaply skip a state write.
 */
export function pickNewerJob(prev, next) {
  if (!isJob(next)) return isJob(prev) ? prev : (prev ?? null);
  if (!isJob(prev)) return next;
  if (prev === next) return prev;

  if (String(prev.id) === String(next.id)) {
    const rPrev = rankOf(prev);
    const rNext = rankOf(next);
    if (rNext > rPrev) return next;      // advanced — always accept
    if (rNext < rPrev) return prev;      // stale read — never regress
    const uPrev = timeOf(prev, 'updatedAt');
    const uNext = timeOf(next, 'updatedAt');
    if (uPrev != null && uNext != null) {
      if (uNext < uPrev) return prev;    // an older snapshot of the same state
      // Byte-stability: an identical observation keeps the existing object so
      // the idle poll of a settled job does not re-render the tab every tick.
      if (uNext === uPrev && prev.status === next.status) return prev;
    }
    return next;                         // no usable clock — the newest response wins
  }

  // Different rows: only a genuinely NEWER job may take over.
  const cPrev = timeOf(prev, 'createdAt');
  const cNext = timeOf(next, 'createdAt');
  if (cPrev != null && cNext != null) {
    if (cNext > cPrev) return next;
    if (cNext < cPrev) return prev;
    return String(next.id) > String(prev.id) ? next : prev; // deterministic tiebreak
  }
  if (cNext != null) return next;        // a timestamped row beats an untimestamped one
  if (cPrev != null) return prev;
  return String(next.id) > String(prev.id) ? next : prev;
}

export default pickNewerJob;
