/**
 * storage/unloadFlush.js — 117.md §J.19. "Edit, then reload immediately" must not
 * lose the edit.
 *
 * ── THE LOSS WINDOW, MEASURED ────────────────────────────────────────────────
 * A keystroke reaches the server through TWO debounces stacked on each other:
 *
 *   RichSectionEditor → useManuscript.queueEdit   600 ms   (field patches)
 *      → upd → useStitchProjectDoc.scheduleSave   800 ms   (whole-blob PUT)
 *      → the PUT itself                           ~1 RTT
 *
 * Neither timer had an unload path. `useStitchProjectDoc` flushed on UNMOUNT and
 * `useManuscript` flushed on unmount too — but a reload never unmounts anything, so
 * up to ~1.4 s of typing died with the document. That is real data loss, not a
 * cosmetic gap, and it is what §J.19 records.
 *
 * ── WHY NOT THE `keepalive` FETCH OPTION ─────────────────────────────────────
 * keepalive is the usual answer and it is the WRONG one here. Its body is capped at
 * 64 KB per origin across all in-flight keepalive requests, and the payload is the
 * ENTIRE project blob — studies, records, every manuscript draft, plus each
 * `draft.snapshots` entry (a full copy of the sections). Blob size is unbounded and
 * grows with the review. Measured on this machine's dev database (n = 8 328
 * projects): median 789 B, max 13.4 KB, none over 64 KB — but every one of those is
 * a synthetic fixture, so that measurement CANNOT rule the cap out for a real review
 * with extraction rows and snapshots. A transport that silently drops the write once
 * the project gets big is a worse failure than the one we are fixing: it would look
 * saved and be gone. So keepalive is not used, and there is no blocking sync XHR
 * either (it freezes the tab and is deprecated everywhere).
 *
 * ── WHAT IS DONE INSTEAD ─────────────────────────────────────────────────────
 * Three triggers on the page-lifecycle events that ARE reliable, in the order the
 * browser fires them when a page goes away (beforeunload → pagehide →
 * visibilitychange:hidden → unload):
 *
 *   beforeunload      pending? → flush AND `preventDefault()`. The browser then
 *                     shows its own "Leave site? / Reload site?" prompt, and the
 *                     flush runs while that prompt is up — a normal fetch, no size
 *                     cap, with as long as the dialog stands to complete. Stay →
 *                     the write definitely landed. Leave → it very probably did.
 *                     The prompt appears ONLY when a save is genuinely pending, so
 *                     an idle page still reloads without friction.
 *   pagehide          last-chance flush; also the bfcache path (Safari, where
 *                     beforeunload is unreliable — the same reason
 *                     SearchBuilderTab already hangs its flush there).
 *   visibilitychange  → hidden: flush. This one is not about reloads at all — it is
 *                     the tab-switch / minimise / phone-locked case, where the page
 *                     STAYS ALIVE and the flush is an ordinary, fully reliable
 *                     request. In practice it is the trigger that fires most.
 *
 * ── THE RESIDUAL WINDOW (honest) ─────────────────────────────────────────────
 *   1. If the user answers the prompt with "Leave"/"Reload", the tab tears down and
 *      an unfinished PUT is cancelled. The window is one RTT, and the user was
 *      explicitly warned — no longer SILENT loss, which was the actual defect.
 *   2. A browser with no sticky user activation suppresses the beforeunload prompt.
 *      Typing IS an activation, so the data-loss case always has one; a programmatic
 *      navigation (and Playwright's page.reload(), verified) skips the dialog by
 *      design and falls back to window 1.
 *   3. A crash / forced tab kill fires nothing. Nothing client-side can cover that.
 *
 * ── ORDERING, AND WHY THERE IS A REGISTRY ────────────────────────────────────
 * Two layers must flush, in order: the EDITOR's field-patch buffer (which calls
 * `upd`) and only THEN the SHELL's blob debounce (which the `upd` just re-armed).
 * Two independent `addEventListener` calls would run in mount order — the shell
 * mounts first, so it would flush an empty queue and the editor's patch would be
 * left armed and lost. So participants register here and are drained by TIER.
 */
import { useEffect, useRef } from 'react';

/**
 * Drain order. BUFFER writes INTO the shell (its flush calls `upd`), so it must run
 * first; SHELL then sees the freshly-armed debounce and sends it.
 */
export const FLUSH_TIER = Object.freeze({ BUFFER: 0, SHELL: 1 });

/**
 * True when ANY participant has unsent work. A throwing `hasPending` is treated as
 * pending: over-warning is recoverable, under-warning loses data. Pure.
 * @param {Array} list participants
 */
export function anyPending(list) {
  for (const p of (Array.isArray(list) ? list : [])) {
    if (!p) continue;
    try {
      if (typeof p.hasPending !== 'function' || p.hasPending()) return true;
    } catch { return true; }
  }
  return false;
}

/**
 * Flush every participant that reports pending work, LOWEST tier first.
 *
 * `hasPending` is re-read as we walk, never snapshotted: that is exactly what lets
 * the SHELL tier see the debounce the BUFFER tier just armed. Each flush is
 * individually guarded — one engine throwing on teardown must not stop the others
 * from saving.
 *
 * @param {Array} list participants
 * @returns {string[]} the ids that were flushed, in the order they ran. Pure apart
 *          from the participants' own side effects (that is the point).
 */
export function drainPending(list) {
  const arr = (Array.isArray(list) ? list : []).filter(Boolean)
    .slice()
    .sort((a, b) => ((a.tier | 0) - (b.tier | 0)));
  const done = [];
  for (const p of arr) {
    try {
      if (typeof p.hasPending === 'function' && !p.hasPending()) continue;
      if (typeof p.flush === 'function') p.flush();
      done.push(p.id || '');
    } catch { /* best effort — teardown must never throw */ }
  }
  return done;
}

/* ── the live registry + the ONE set of window listeners ─────────────────── */

const participants = new Set();
let installed = false;

function onVisibility() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return;
  drainPending([...participants]);
}

function onPageHide() {
  drainPending([...participants]);
}

function onBeforeUnload(e) {
  if (!anyPending([...participants])) return;
  // Fire the writes FIRST: with the prompt below they get the whole dialog to land.
  drainPending([...participants]);
  e.preventDefault();
  // Legacy support (Chrome/Edge < 119, older Firefox) — the modern spec is
  // preventDefault() alone.
  e.returnValue = true;
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
}

function uninstall() {
  if (!installed || typeof window === 'undefined') return;
  installed = false;
  window.removeEventListener('beforeunload', onBeforeUnload);
  window.removeEventListener('pagehide', onPageHide);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
}

/**
 * Register one flush participant. Listeners are installed with the first and
 * removed with the last, so a page that mounts none costs nothing.
 * @param {{id:string, tier:number, hasPending:Function, flush:Function}} p
 * @returns {() => void} unregister
 */
export function registerFlushParticipant(p) {
  if (!p || typeof p.flush !== 'function') return () => {};
  participants.add(p);
  install();
  return () => {
    participants.delete(p);
    if (participants.size === 0) uninstall();
  };
}

/** Test seam: the live participant list (read-only snapshot). */
export function currentFlushParticipants() {
  return [...participants];
}

/**
 * Hook form. `hasPending`/`flush` are read through a render-assigned ref (the repo's
 * hook convention), so the participant registers ONCE per mount and still calls the
 * current closures — no re-registration churn on every render of a callback.
 *
 * @param {object} args { id, tier, hasPending, flush }
 */
export function useUnloadFlush({ id, tier, hasPending, flush }) {
  const live = useRef({ hasPending, flush });
  live.current = { hasPending, flush };
  useEffect(() => {
    const participant = {
      id: id || '',
      tier: typeof tier === 'number' ? tier : FLUSH_TIER.SHELL,
      hasPending: () => {
        const f = live.current.hasPending;
        return typeof f === 'function' ? !!f() : true;
      },
      flush: () => {
        const f = live.current.flush;
        if (typeof f === 'function') f();
      },
    };
    return registerFlushParticipant(participant);
  }, [id, tier]);
}

export default useUnloadFlush;
