/**
 * utils/jobRetry.js — pure retry-budget policy shared by the durable, DB-backed
 * background workers (screeningImportWorker, pecanSearchWorker).
 *
 * WHY this exists
 * ---------------
 * Both workers re-queue jobs left in `processing` at boot, on the assumption the
 * previous run was interrupted by a crash. That is correct for a transient crash,
 * but a *poison-pill* job — one whose content reliably crashes the process — would
 * otherwise be re-queued on every restart forever (a crash → restart → re-queue →
 * crash loop that can keep a box busy). Capping the number of attempts converts
 * that unbounded loop into a bounded one: after the budget is spent the job is
 * permanently failed instead of re-queued, and the worker moves on.
 *
 * The decision is a PURE function of a job's `attempts` counter (incremented once
 * per claim), so it is deterministic and unit-testable without a database.
 */

/**
 * Default maximum number of times a durable job is claimed/started before it is
 * permanently failed instead of being re-queued after an interrupted run.
 * Five attempts tolerates ordinary transient crashes (deploys, OOM blips) while
 * still bounding a genuine poison pill to a handful of restarts.
 */
export const DEFAULT_MAX_JOB_ATTEMPTS = 5;

/**
 * Has this job spent its retry budget? `attempts` is the number of times the job
 * has been claimed (each claim increments it before processing begins).
 *
 * A missing / non-numeric `attempts` is treated as NOT exhausted (give the job a
 * chance) so legacy rows created before the counter existed still get retried.
 *
 * @param {number|null|undefined} attempts
 * @param {number} [maxAttempts=DEFAULT_MAX_JOB_ATTEMPTS]
 * @returns {boolean}
 */
export function hasExhaustedAttempts(attempts, maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const n = Number(attempts);
  if (!Number.isFinite(n)) return false;
  return n >= maxAttempts;
}

/**
 * Split stuck jobs into those to permanently fail (budget spent) and those to
 * re-queue (budget remaining). Order within each bucket is preserved.
 *
 * @param {Array<{attempts?:number}>} jobs
 * @param {number} [maxAttempts=DEFAULT_MAX_JOB_ATTEMPTS]
 * @returns {{ giveUp: Array<object>, retry: Array<object> }}
 */
export function partitionStuckJobs(jobs, maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const giveUp = [];
  const retry = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (hasExhaustedAttempts(job && job.attempts, maxAttempts)) giveUp.push(job);
    else retry.push(job);
  }
  return { giveUp, retry };
}
