/**
 * history/HistoryContext.jsx — 108.md §§2-3, §8, §11, §14-17. The React face of
 * the project-wide Undo/Redo system.
 *
 * The provider owns ONE scope-keyed history object (research-engine/interaction/
 * historyStacks.js) for the whole project and hands the current page's slice to
 * whoever asks. It is deliberately mounted ABOVE the engines: 108.md §16 requires
 * that leaving Screening for Extraction and coming back continues the Screening
 * stack where it left off, which a page-local useState could never do. `scope`
 * selects which stack Ctrl+Z reads; it does not own the storage.
 *
 * ── THE EXECUTOR CONTRACT (108.md §8, §14, §15) ──────────────────────────────
 * The provider knows nothing about screening decisions, keyword ops or extraction
 * fields. Each engine registers an executor for its entry `kind`:
 *
 *     useEffect(() => registerExecutor('screening.decision', async (op, { direction }) => {
 *       // 1. RE-VALIDATE against the CURRENT state, not the state at record time.
 *       //    Read from a ref/live store — a collaborator's realtime update may
 *       //    have replaced the row since (108.md §15).
 *       // 2. Refuse by returning { ok:false, reason:'refused' } when the world
 *       //    moved on. The entry goes back on its stack and the user is told.
 *       // 3. Otherwise perform the mutation through THE SAME write path as the
 *       //    forward action (108.md §8 — never a local-state rollback), and let
 *       //    it throw / return { ok:false, reason:'failed' } if persistence fails.
 *     }), [registerExecutor]);
 *
 * Return values: `undefined` / `true` / any other truthy value ⇒ success;
 * `false` or `{ ok:false, reason }` ⇒ refusal; a thrown error ⇒ persistence
 * failure. Only success moves the entry to the opposite stack.
 *
 * ── SERIALIZATION (108.md §14) ───────────────────────────────────────────────
 * An undo in flight occupies the scope's pending slot, and takeUndo/takeRedo
 * refuse while it is occupied — so a second Ctrl+Z during an in-flight undo is a
 * silent no-op rather than a double-undo. That is the history layer's half of the
 * race defence; the other half is the executor's own sequence guard (the screening
 * kwSeqRef pattern) and the server's compare-and-set.
 *
 * ── LIFETIME (108.md §16) ────────────────────────────────────────────────────
 * In memory only. Switching projects clears every scope (an entry names a
 * projectId and is meaningless elsewhere). A refresh, a new tab or a sign-out
 * clears it. `clearScopes(predicate)` exists for the blob-conflict case: an
 * autosave 409 invalidates the blob-backed scopes (extraction / analysis /
 * manuscript) without touching the relational screening scope.
 *
 * ── FEEDBACK (108.md §17) ────────────────────────────────────────────────────
 * The provider does not render anything. It calls the injectable `onFeedback`
 * prop with a note; the shell wires that to history/useUndoFeedback.jsx. Keeping
 * it injectable is what makes the provider testable and lets the two screening
 * routes (/app/project/:id and the shell-less /sift-beta) mount their own surface.
 *
 * NOT MOUNTED YET — Wave 2 mounts this in StitchProjectWorkspace / SiftProject /
 * the legacy Workspace adapter. Everything below is written so that mounting it is
 * the only change required.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  emptyHistory, recordAction, coalesceOrRecord, takeUndo, takeRedo,
  completeUndo, completeRedo, restoreFailed, clearScope as clearScopePure,
  clearScopes as clearScopesPure, clearAll as clearAllPure, counts, isValidEntry,
  peekUndo, peekRedo, TAKE_REASON,
} from '../../research-engine/interaction/historyStacks.js';

/** Why an undo()/redo() call did not complete. */
export const HISTORY_FAIL = Object.freeze({
  NO_ENTRY: 'no-entry',          // nothing to undo here — 108.md §26 no-op
  BUSY: 'busy',                  // an undo/redo is already running in this scope
  NO_EXECUTOR: 'no-executor',    // no handler registered for entry.kind (or one-way entry)
  REFUSED: 'refused',            // executor precondition failed (§14/§15)
  FAILED: 'failed',              // the write threw / did not persist (§8.6)
});

const DEFAULT_ID_FN = () => `h_${Math.random().toString(36).slice(2, 10)}`;

const HistoryContext = createContext(null);

/**
 * stampEntry — fill in the bookkeeping fields a caller should not have to repeat.
 *
 * PURE, and called OUTSIDE the state updater on purpose: StrictMode double-invokes
 * updaters and CAS retries re-run mutators, so an id minted inside one would
 * differ between invocations (the repo's idFn rule). `idFn`/`now` are injectable
 * for exactly the same reason tests need them to be.
 */
export function stampEntry(entry, { idFn, now, scope, projectId } = {}) {
  const e = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null;
  if (!e) return null;
  const mkId = typeof idFn === 'function' ? idFn : DEFAULT_ID_FN;
  const clock = typeof now === 'function' ? now : Date.now;
  const pid = e.projectId != null ? String(e.projectId) : String(projectId == null ? '' : projectId);
  const sc = e.scope != null ? String(e.scope) : String(scope == null ? '' : scope);
  return {
    ...e,
    id: typeof e.id === 'string' && e.id ? e.id : String(mkId() || ''),
    scope: sc,
    projectId: pid,
    label: typeof e.label === 'string' ? e.label : '',
    at: e.at !== undefined ? e.at : clock(),
    redoOp: e.redoOp == null ? null : e.redoOp,
  };
}

/**
 * normalizeExecutorResult — the one place the executor return contract is read.
 * Documented above; kept pure so the contract itself is unit-tested.
 */
export function normalizeExecutorResult(res) {
  if (res === false) return { ok: false, reason: HISTORY_FAIL.REFUSED, detail: '' };
  if (res && typeof res === 'object' && res.ok === false) {
    return {
      ok: false,
      reason: typeof res.reason === 'string' && res.reason ? res.reason : HISTORY_FAIL.REFUSED,
      detail: typeof res.detail === 'string' ? res.detail : '',
    };
  }
  return { ok: true, reason: '', detail: '' };
}

/**
 * historyNote — 108.md §17. The subtle feedback line for one undo/redo outcome,
 * or null when the right feedback is silence.
 *
 * Silence matters: "no history → Ctrl+Z does nothing" (§26) must not produce a
 * toast, or every stray Ctrl+Z in a read-only view would nag the user.
 */
export function historyNote(entry, direction, outcome = {}) {
  const dir = direction === 'redo' ? 'redo' : 'undo';
  const verb = dir === 'redo' ? 'redone' : 'undone';
  const label = (entry && typeof entry.label === 'string' && entry.label) ? entry.label : 'Change';
  const base = {
    scope: (entry && entry.scope) || '',
    kind: (entry && entry.kind) || '',
    direction: dir,
  };
  if (outcome && outcome.ok) return { ...base, tone: 'info', message: `${label} ${verb}` };
  const reason = outcome && outcome.reason;
  if (reason === HISTORY_FAIL.REFUSED) {
    return { ...base, tone: 'warn', message: `Could not ${dir} — changed by a collaborator` };
  }
  if (reason === HISTORY_FAIL.FAILED) {
    return { ...base, tone: 'error', message: `Could not ${dir} — the change was not saved` };
  }
  if (reason === HISTORY_FAIL.NO_EXECUTOR) {
    return { ...base, tone: 'error', message: `Could not ${dir} — this action is not reversible here` };
  }
  return null;   // NO_ENTRY / BUSY — deliberately silent
}

/** True when a projectId change should wipe the history (108.md §16). */
export function shouldClearForProject(prev, next) {
  return String(prev == null ? '' : prev) !== String(next == null ? '' : next);
}

export function HistoryProvider({
  projectId, scope, children, onFeedback, idFn, now,
}) {
  // Rendered copy (drives canUndo/canRedo) + a ref that is the SYNCHRONOUS truth.
  // undo() must read and write the stacks between awaits, where React state has
  // not landed yet; the ref is what keeps a rapid Ctrl+Z Ctrl+Z honest.
  const [hist, setHist] = useState(emptyHistory);
  const histRef = useRef(hist);

  // Live props behind a ref, assigned during render (the repo's hook convention —
  // see screening/hooks/useAbstractSelectionShortcuts.js) so every callback below
  // can stay referentially stable.
  const live = useRef({});
  live.current = { projectId, scope, onFeedback, idFn, now };

  const executorsRef = useRef(null);
  if (executorsRef.current === null) executorsRef.current = new Map();

  const applyHist = useCallback((next) => {
    if (next === histRef.current) return;   // referential stability = no re-render
    histRef.current = next;
    setHist(next);
  }, []);

  // 108.md §16 — switching projects clears everything. Uses clearAll (which
  // returns the SAME object when already empty) so mounting does not re-render.
  const projectSeen = useRef(projectId);
  useEffect(() => {
    if (!shouldClearForProject(projectSeen.current, projectId)) return;
    projectSeen.current = projectId;
    applyHist(clearAllPure(histRef.current));
  }, [projectId, applyHist]);

  const emitNote = useCallback((note) => {
    if (!note) return;
    const fn = live.current.onFeedback;
    if (typeof fn !== 'function') return;
    const mkId = typeof live.current.idFn === 'function' ? live.current.idFn : DEFAULT_ID_FN;
    // Note id seeded OUTSIDE any updater, same rule as entry ids.
    fn({ id: String(mkId() || ''), ...note });
  }, []);

  const stamp = useCallback((entry) => stampEntry(entry, {
    idFn: live.current.idFn,
    now: live.current.now,
    scope: live.current.scope,
    projectId: live.current.projectId,
  }), []);

  /** record(entry) → the stamped entry, or null when the entry was malformed. */
  const record = useCallback((entry) => {
    const stamped = stamp(entry);
    if (!isValidEntry(stamped)) return null;
    applyHist(recordAction(histRef.current, stamped));
    return stamped;
  }, [applyHist, stamp]);

  /**
   * coalesce(entry, canMerge) → the stamped entry — 108.md §13. Merges into the
   * scope's top entry when canMerge(top, entry) accepts it (per-field typing),
   * otherwise records normally.
   */
  const coalesce = useCallback((entry, canMerge) => {
    const stamped = stamp(entry);
    if (!isValidEntry(stamped)) return null;
    applyHist(coalesceOrRecord(histRef.current, stamped, canMerge));
    return stamped;
  }, [applyHist, stamp]);

  const registerExecutor = useCallback((kind, fn) => {
    if (typeof kind !== 'string' || !kind || typeof fn !== 'function') return () => {};
    executorsRef.current.set(kind, fn);
    return () => {
      if (executorsRef.current.get(kind) === fn) executorsRef.current.delete(kind);
    };
  }, []);

  const run = useCallback(async (direction) => {
    const sc = String(live.current.scope == null ? '' : live.current.scope);
    const taken = direction === 'undo' ? takeUndo(histRef.current, sc) : takeRedo(histRef.current, sc);
    if (!taken.entry) {
      return {
        ok: false,
        reason: taken.reason === TAKE_REASON.BUSY ? HISTORY_FAIL.BUSY : HISTORY_FAIL.NO_ENTRY,
        entry: null,
      };
    }
    const entry = taken.entry;
    applyHist(taken.hist);

    const op = direction === 'undo' ? entry.undoOp : entry.redoOp;
    const executor = executorsRef.current.get(entry.kind);
    if (!executor || !op) {
      // Unknown kind, or a one-way entry that reached the redo path anyway.
      applyHist(restoreFailed(histRef.current, sc, entry, direction));
      const outcome = { ok: false, reason: HISTORY_FAIL.NO_EXECUTOR };
      emitNote(historyNote(entry, direction, outcome));
      return { ...outcome, entry };
    }

    let outcome;
    try {
      outcome = normalizeExecutorResult(await executor(op, { direction, entry, scope: sc }));
    } catch (err) {
      outcome = {
        ok: false,
        reason: HISTORY_FAIL.FAILED,
        detail: (err && err.message) ? String(err.message) : '',
      };
    }

    if (!outcome.ok) {
      // 108.md §8.6 — the entry goes back where it came from; never silently lost.
      applyHist(restoreFailed(histRef.current, sc, entry, direction));
      emitNote(historyNote(entry, direction, outcome));
      return { ok: false, reason: outcome.reason, detail: outcome.detail, entry };
    }

    applyHist(direction === 'undo'
      ? completeUndo(histRef.current, sc, entry)
      : completeRedo(histRef.current, sc, entry));
    emitNote(historyNote(entry, direction, { ok: true }));
    return { ok: true, reason: '', entry };
  }, [applyHist, emitNote]);

  const undo = useCallback(() => run('undo'), [run]);
  const redo = useCallback(() => run('redo'), [run]);

  const clearScope = useCallback((target) => {
    applyHist(clearScopePure(histRef.current, target == null ? live.current.scope : target));
  }, [applyHist]);

  /** Drop every scope matching predicate(scope) — the blob-conflict handler. */
  const clearScopes = useCallback((predicate) => {
    applyHist(clearScopesPure(histRef.current, predicate));
  }, [applyHist]);

  const clearAll = useCallback(() => {
    applyHist(clearAllPure(histRef.current));
  }, [applyHist]);

  const activeScope = String(scope == null ? '' : scope);
  const avail = counts(hist, activeScope);

  const value = useMemo(() => ({
    scope: activeScope,
    projectId,
    canUndo: avail.canUndo,
    canRedo: avail.canRedo,
    pending: avail.pending,
    undoCount: avail.undo,
    redoCount: avail.redo,
    nextUndo: peekUndo(hist, activeScope),
    nextRedo: peekRedo(hist, activeScope),
    record,
    coalesce,
    undo,
    redo,
    registerExecutor,
    clearScope,
    clearScopes,
    clearAll,
  }), [
    activeScope, projectId, avail.canUndo, avail.canRedo, avail.pending,
    avail.undo, avail.redo, hist, record, coalesce, undo, redo,
    registerExecutor, clearScope, clearScopes, clearAll,
  ]);

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

const noop = () => {};
const NO_HISTORY = Object.freeze({
  scope: '',
  projectId: '',
  canUndo: false,
  canRedo: false,
  pending: false,
  undoCount: 0,
  redoCount: 0,
  nextUndo: null,
  nextRedo: null,
  record: () => null,
  coalesce: () => null,
  undo: async () => ({ ok: false, reason: HISTORY_FAIL.NO_ENTRY, entry: null }),
  redo: async () => ({ ok: false, reason: HISTORY_FAIL.NO_ENTRY, entry: null }),
  registerExecutor: () => noop,
  clearScope: noop,
  clearScopes: noop,
  clearAll: noop,
});

/**
 * useProjectHistory() — the page's slice of the project history.
 *
 * Safe outside a provider: returns a permanently-empty, no-op shape instead of
 * throwing (the useFocusMode convention), so an engine can start recording
 * entries before the shell that mounts the provider has been updated, and so a
 * static-markup unit test of that engine cannot crash.
 */
export function useProjectHistory() {
  return useContext(HistoryContext) || NO_HISTORY;
}

export default HistoryProvider;
