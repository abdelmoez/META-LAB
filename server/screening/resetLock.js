/**
 * server/screening/resetLock.js — 96.md Phase 6F: in-process, per-ScreenProject
 * "imported-records reset in progress" coordination.
 *
 * AUTHORITY: the server is a SINGLE Node process — every writer that can touch a
 * screening project's records (HTTP handlers, the import/duplicate/AI workers and
 * the pecan search pipeline all run in-process) shares this module instance, so an
 * in-memory Map is a correct, authoritative mutex here. If the deployment ever
 * becomes multi-process, this must move to a DB advisory lock (the call sites are
 * already funnelled through acquire/release/isLocked, so only this file changes).
 *
 * Used two ways (both sides of the TOCTOU window the QA review found):
 *  - postReset acquires the lock for the whole reset (double-submit → 409) and
 *    releases it in `finally`;
 *  - enqueue/landing paths (startImport, sync import, duplicate-detect enqueue,
 *    pecan startRun, dedupeAndInsertRecords) consult isLocked() and fail fast with
 *    a RESET_IN_PROGRESS conflict instead of racing the delete transaction.
 */

const locks = new Map(); // ScreenProject id -> acquisition timestamp (ms)

/**
 * Try to take the reset lock for a project.
 * @param {string} projectId ScreenProject id
 * @returns {boolean} true when acquired; false when already held (caller → 409)
 */
export function acquireResetLock(projectId) {
  const key = String(projectId || '');
  if (!key || locks.has(key)) return false;
  locks.set(key, Date.now());
  return true;
}

/** Release the reset lock (idempotent — releasing an unheld lock is a no-op). */
export function releaseResetLock(projectId) {
  locks.delete(String(projectId || ''));
}

/** True while a reset holds the lock for this project. */
export function isResetLocked(projectId) {
  return locks.has(String(projectId || ''));
}
