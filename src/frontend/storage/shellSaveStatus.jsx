/**
 * storage/shellSaveStatus.jsx — 117.md §J.13. ONE honest answer to "did my write
 * actually reach the server?", for every engine that persists THROUGH a shell.
 *
 * ── THE PROBLEM THIS SEAM CLOSES ─────────────────────────────────────────────
 * The blob-backed engines write with `upd(field, value)`. `upd` is SYNCHRONOUS: it
 * schedules a debounced whole-blob PUT and returns `undefined`. An engine that
 * treats that return as "saved" is not lying on purpose — it simply has no channel
 * to the request that happens ~800 ms later. So the manuscript's own pill could
 * read "Saved" while the real PUT was still in flight, had failed, or had been
 * REFUSED by the autosave compare-and-set (409). The failure was visible, but only
 * in the SHELL's separate indicator, which is a different place on the screen and
 * (in Focus Mode) not on the screen at all.
 *
 * ── THE TWO REAL CHANNELS ────────────────────────────────────────────────────
 * Both shells already publish their true state; neither exposed it to the engines:
 *
 *   Stitch  `useStitchProjectDoc().saveStatus` — a React value
 *           ('idle'|'saving'|'saved'|'error'|'conflict'). Threaded here by
 *           StitchProjectWorkspace through <ShellSaveStatusProvider>.
 *   Legacy  `serverStorage.subscribeToSaveStatus()` — a module pub-sub
 *           ('idle'|'saving'|'saved'|'failed'|'conflict'), plus the per-project
 *           `metalab:autosave-conflict` window event the monolith's "Load latest"
 *           banner listens to. Resolved here WITHOUT a provider, so the legacy
 *           monolith needed no change at all.
 *
 * `useShellSaveStatus()` resolves whichever channel exists and normalises both onto
 * one vocabulary. Neither present (SSR, a unit test, a future shell) → `null`, and
 * every consumer keeps its pre-117 behaviour exactly.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ──────────────────────────────────
 * It does not save anything, retry anything, or change either shell's save logic.
 * It is a READ seam. `composeSaveState` is the whole policy, and it is pure.
 *
 * ── KNOWN FIDELITY LIMIT OF THE LEGACY CHANNEL ───────────────────────────────
 * `serverStorage` PUTs every writable project in ONE batch and publishes ONE status
 * for it, so in the legacy monolith a failure on any project reads as a failure here
 * too. That is exactly the resolution the monolith's own bottom-right indicator has
 * always had (AppWorkspace) — this seam reports it in a second place, it does not
 * make it coarser. The Stitch channel is per-project and has no such limit. Closing
 * it means per-project statuses in serverStorage, which is a change to the SHELL's
 * save logic and therefore out of this seam's scope by design.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/** The one normalised vocabulary. `failed` (serverStorage's word) maps to `error`. */
export const SHELL_SAVE_STATUSES = Object.freeze(['idle', 'saving', 'saved', 'error', 'conflict']);

/**
 * Normalise a shell status onto SHELL_SAVE_STATUSES. Unknown/empty → null, which
 * every consumer reads as "this channel has no opinion". Pure.
 */
export function normalizeShellSaveStatus(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (s === 'failed') return 'error';
  return SHELL_SAVE_STATUSES.includes(s) ? s : null;
}

/**
 * 117.md §J.13 — compose an engine's LOCAL save state with the SHELL's real one.
 *
 * Precedence, highest first — the rule is "the worse truth wins", because every
 * step down the list is a stronger claim about durability:
 *   1. conflict  the compare-and-set REFUSED our write and the shell adopted the
 *                server's copy. Nothing local is on the server, and a retry would
 *                only 409 again — this must never be dressed as an error the user
 *                can retry away, let alone as "Saved".
 *   2. error     either side failed. A local failure (upd threw) is not masked by
 *                a later shell success, and a shell failure is not masked by the
 *                engine's optimistic 'saved'.
 *   3. saving    EITHER the engine has field patches still debounced OR the shell
 *                has a write scheduled/in flight. Both are honest: something the
 *                user typed is not on the server yet.
 *   4. saved     only when both channels agree there is nothing outstanding.
 *
 * A missing shell channel contributes nothing, so `composeSaveState(x, null) === x`
 * for every state the engines use — that IS the pre-117 behaviour.
 *
 * @param {string} local  the engine's own state ('saved'|'saving'|'error')
 * @param {string} shell  the shell's state, or null/undefined when absent
 * @returns {'saved'|'saving'|'error'|'conflict'}  Pure.
 */
export function composeSaveState(local, shell) {
  const l = normalizeShellSaveStatus(local) || 'saved';
  const s = normalizeShellSaveStatus(shell);
  if (s === 'conflict') return 'conflict';
  if (l === 'error' || s === 'error') return 'error';
  if (l === 'saving' || s === 'saving') return 'saving';
  return 'saved';
}

/* `undefined` (not null) is the "no provider above me" sentinel — a provider is
   allowed to publish a null status, and that must be distinguishable. */
const ShellSaveStatusContext = createContext(undefined);

/**
 * Publish a shell's real autosave state to every engine below it.
 * @param {object} props { status, children } — `status` is the shell's own value.
 */
export function ShellSaveStatusProvider({ status, children }) {
  const value = useMemo(
    () => ({ status: normalizeShellSaveStatus(status), source: 'shell' }),
    [status],
  );
  return <ShellSaveStatusContext.Provider value={value}>{children}</ShellSaveStatusContext.Provider>;
}

/**
 * Resolve the shell save channel for the surface this hook is mounted in.
 * @returns {{ status: string|null, source: 'shell'|'legacy'|'none' }}
 *
 * Resolution order is deliberate: a provider is an EXPLICIT statement by the shell
 * that owns this page, so it always wins. The legacy channel is only reached when
 * there is no provider AND the monolith's storage bridge is actually installed
 * (`window.storage`) — the guard keeps this hook from importing serverStorage (a
 * module with a `window.storage = …` load-time side effect) into a page that never
 * had it. Under SSR / in unit tests neither applies and the answer is null.
 */
export function useShellSaveStatus() {
  const ctx = useContext(ShellSaveStatusContext);
  const hasProvider = ctx !== undefined;
  const [legacy, setLegacy] = useState(null);

  useEffect(() => {
    if (hasProvider) return undefined;
    if (typeof window === 'undefined' || !window.storage) return undefined;
    let alive = true;
    let off = null;
    // Dynamic: the module is already evaluated on this page (the `window.storage`
    // guard above proves it), so this resolves in a microtask and installs nothing.
    import('./serverStorage.js')
      .then((m) => {
        if (!alive) return;
        off = m.subscribeToSaveStatus((s) => setLegacy(normalizeShellSaveStatus(s)));
      })
      .catch(() => { /* no legacy channel here — stay silent (source stays 'none') */ });
    // The batch status says WHICH KIND of failure but not which project; the
    // monolith's conflict event is the targeted one, and it is what the "Load
    // latest" banner reacts to. Listening to both means a conflict cannot be
    // missed because the batch also contained a successful project.
    const onConflict = () => setLegacy('conflict');
    window.addEventListener('metalab:autosave-conflict', onConflict);
    return () => {
      alive = false;
      try { if (off) off(); } catch { /* already torn down */ }
      window.removeEventListener('metalab:autosave-conflict', onConflict);
    };
  }, [hasProvider]);

  const fallback = useMemo(
    () => ({ status: legacy, source: legacy == null ? 'none' : 'legacy' }),
    [legacy],
  );
  return hasProvider ? ctx : fallback;
}

export default useShellSaveStatus;
