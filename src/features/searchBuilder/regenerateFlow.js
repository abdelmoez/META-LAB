/**
 * regenerateFlow.js — 97.md Phase 4 (QA M4/M5/M28/M31). The snapshot-then-
 * regenerate TRANSITION extracted out of the React component so its ordering
 * guarantees are functionally testable (house style — no jsdom, injected deps):
 *
 *   1. FLUSH the pending debounced autosave and await its ack, so the server-side
 *      "Before regeneration" snapshot (which freezes the server's saved strategy,
 *      not the client workspace) includes every edit made inside the debounce
 *      window (QA M4/M28). A failed flush ABORTS — nothing is regenerated.
 *   2. Snapshot via the versions API — but ONLY when the server actually holds a
 *      saved strategy (revision > 0 after the flush). A never-saved workspace has
 *      no work to protect: the snapshot is SKIPPED instead of dead-ending on the
 *      server's `no_strategy` 400 (QA M5); a 400 answered anyway (races) is
 *      tolerated as "nothing to snapshot". Any OTHER snapshot failure ABORTS with
 *      no state change (Phase 4: "Regeneration must not proceed if the snapshot
 *      cannot be saved reliably") — pinned functionally in
 *      tests/unit/searchRegenerateFlow.test.js (QA M31).
 *   3. Only then does the caller-supplied `applyRegenerated` run (the state swap,
 *      undo entry, immediate audited save).
 *
 * All dependencies are injected; the module is pure orchestration (no fetch, no
 * Date, no React).
 */

export const REGENERATE_FLUSH_ERROR = 'Your latest edits could not be saved, so nothing was regenerated. '
  + 'Retry the save first, then regenerate.';
export const REGENERATE_SNAPSHOT_ERROR = 'The backup snapshot could not be saved, so nothing was regenerated. '
  + 'Try again, or save a version manually first.';

/** The server's "nothing saved yet" snapshot refusal (versions POST → 400). */
export function isNoStrategyError(e) {
  return !!e && e.status === 400;
}

/**
 * performRegenerate({ flushPendingSave, hasSavedStrategy, saveSnapshot,
 *                     applyRegenerated })
 *   flushPendingSave  async () => boolean — flush + await any pending debounced
 *                     save; true when nothing was pending or the flush ACKED.
 *   hasSavedStrategy  () => boolean — does the server hold a saved strategy
 *                     (revision > 0) AFTER the flush?
 *   saveSnapshot      async () => void — POST the "Before regeneration" version;
 *                     throws on failure (err.status === 400 = no_strategy).
 *   applyRegenerated  ({ snapshotted }) => void — the state transition; runs
 *                     ONLY when every protective step above succeeded.
 * → { ok:true, snapshotted } | { ok:false, error }
 */
export async function performRegenerate({
  flushPendingSave, hasSavedStrategy, saveSnapshot, applyRegenerated,
} = {}) {
  let flushed = true;
  if (typeof flushPendingSave === 'function') {
    try { flushed = await flushPendingSave() !== false; }
    catch { flushed = false; }
  }
  if (!flushed) return { ok: false, error: REGENERATE_FLUSH_ERROR };

  let snapshotted = false;
  const hasSaved = typeof hasSavedStrategy === 'function' ? hasSavedStrategy() !== false : true;
  if (hasSaved && typeof saveSnapshot === 'function') {
    try {
      await saveSnapshot();
      snapshotted = true;
    } catch (e) {
      // `no_strategy` (400) = an empty never-saved server doc raced us — there is
      // nothing to protect, proceed without a snapshot. Everything else ABORTS.
      if (!isNoStrategyError(e)) return { ok: false, error: REGENERATE_SNAPSHOT_ERROR };
      snapshotted = false;
    }
  }

  if (typeof applyRegenerated === 'function') applyRegenerated({ snapshotted });
  return { ok: true, snapshotted };
}
