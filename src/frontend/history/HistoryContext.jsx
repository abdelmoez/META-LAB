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
 *       //    Pass `detail` when the refusal is NOT the usual collaborator race —
 *       //    e.g. { ok:false, reason:'refused',
 *       //           detail:'This article is completed/locked — reopen it to undo.' }
 *       //    That sentence becomes the note verbatim, so write it for the user.
 *       // 3. Otherwise perform the mutation through THE SAME write path as the
 *       //    forward action (108.md §8 — never a local-state rollback), and let
 *       //    it throw / return { ok:false, reason:'failed' } if persistence fails.
 *     }), [registerExecutor]);
 *
 * Return values: `undefined` / `true` / any other truthy value ⇒ success;
 * `false` or `{ ok:false, reason }` ⇒ refusal; a thrown error ⇒ persistence
 * failure. Only success moves the entry to the opposite stack. A refusal's
 * optional `detail` string REPLACES the generic "changed by a collaborator" note
 * (see historyNote) — the executor is the only code that knows why it said no.
 *
 * ── AVAILABILITY IS EXECUTOR-AWARE (108.md §22) ──────────────────────────────
 * Executors unmount with their pages, and several pages share one scope (all eight
 * screening sub-tabs are scope 'screening'). A non-empty stack is therefore NOT
 * the same thing as "undo works here": `canUndo`/`canRedo` are false when the top
 * entry's `kind` has no registered executor, so the header control is disabled and
 * the Ctrl+Z chord falls through instead of erroring. undo()/redo() called anyway
 * refuse with 'no-executor' WITHOUT taking the entry — the stack survives for when
 * the user returns to the page that owns it.
 *
 * ── A SCOPE MAY DELEGATE ITS UNDO ELSEWHERE (108 review §25) ─────────────────
 * One page owns an undo stack this provider does not: the Search Builder keeps its
 * own inverse-patch stack (research-engine/searchBuilder/undoStack.js) and records
 * nothing here, so `canUndo` for scope 'search' was permanently false and the header
 * control permanently greyed out while Ctrl+Z undid perfectly well. `registerScopeDelegate(scope, {canUndo, canRedo, undo, redo})`
 * lets that page answer for its scope: availability ORs the delegate in, and
 * undo()/redo() call it — but ONLY when the provider's own stack has nothing to hand
 * out in that direction, so a delegate can never jump the queue or reorder real
 * entries. The delegate owns its own feedback (the Search Builder already announces
 * what it undid), so no history note is emitted for a delegated run.
 *
 * ── ENTRY-TARGETED UNDO ──────────────────────────────────────────────────────
 * `record()`/`coalesce()` hand back the stamped entry, and `undoEntry(id)` runs a
 * SPECIFIC entry — only while it is still the top of its scope's undo stack. That
 * is what a snackbar's "Undo" button must call: the note names one action and stays
 * on screen for 8 s, during which newer actions land on the same stack.
 *
 * ── AN ENTRY THAT CANNOT RUN IS EVENTUALLY DROPPED ───────────────────────────
 * A refusal normally puts the entry back (108.md §8.6). An entry whose precondition
 * can never hold again would then jam the scope forever, burying every older valid
 * entry, so REFUSAL_DROP_LIMIT consecutive refusals abandon it — with a note.
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
  completeUndo, completeRedo, restoreFailed, dropPending,
  clearScope as clearScopePure,
  clearScopes as clearScopesPure, clearAll as clearAllPure, counts, isValidEntry,
  isPendingEntry, scopeOfUndoTop, peekUndo, peekRedo, TAKE_REASON,
} from '../../research-engine/interaction/historyStacks.js';

/** Why an undo()/redo() call did not complete. */
export const HISTORY_FAIL = Object.freeze({
  NO_ENTRY: 'no-entry',          // nothing to undo here — 108.md §26 no-op
  BUSY: 'busy',                  // an undo/redo is already running in this scope
  NO_EXECUTOR: 'no-executor',    // the page that knows how to reverse this kind is unmounted
  REFUSED: 'refused',            // executor precondition failed (§14/§15)
  FAILED: 'failed',              // the write threw / did not persist (§8.6)
  SUPERSEDED: 'superseded',      // undoEntry(id): that entry is no longer top-of-stack
  DROPPED: 'dropped',            // refused too often in a row — abandoned to unjam the scope
});

/**
 * How many CONSECUTIVE 'refused' outcomes an entry gets before the history gives
 * up on it and drops it (108 review, [critical] follow-up). An entry whose
 * precondition can never become true again — a stale `expect`, a row a
 * collaborator rewrote — sits at the top of the stack refusing every Ctrl+Z and
 * burying every older, still-valid entry behind it forever. Two tries is enough to
 * distinguish "the world moved while I pressed" from "this can never run".
 */
export const REFUSAL_DROP_LIMIT = 2;

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
 * The one string a snackbar's Undo button shows when the action it names is no
 * longer the newest one — see undoEntry below. It names the escape hatch (Ctrl+Z
 * still walks the stack) instead of pretending nothing happened.
 */
export const SUPERSEDED_MESSAGE = 'That action can no longer be undone directly — press Ctrl+Z to step back.';

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
    // "Changed by a collaborator" is only the MOST COMMON reason a precondition
    // fails. An executor that knows better says so through `detail` (a completed /
    // locked extraction article, say), and that wording wins — the generic line is
    // actively misleading on a surface with no banner to correct it.
    const detail = outcome && typeof outcome.detail === 'string' ? outcome.detail.trim() : '';
    if (detail) return { ...base, tone: 'warn', message: detail };
    return { ...base, tone: 'warn', message: `Could not ${dir} — changed by a collaborator` };
  }
  if (reason === HISTORY_FAIL.FAILED) {
    return { ...base, tone: 'error', message: `Could not ${dir} — the change was not saved` };
  }
  if (reason === HISTORY_FAIL.NO_EXECUTOR) {
    // Not an error — a direction. The stack still holds the entry; the page that
    // knows how to reverse it is simply not mounted (a screening sub-tab, an
    // extraction article the user navigated away from).
    return { ...base, tone: 'warn', message: `Return to the page where the change was made to ${dir} it` };
  }
  if (reason === HISTORY_FAIL.SUPERSEDED) {
    return { ...base, tone: 'warn', message: SUPERSEDED_MESSAGE };
  }
  if (reason === HISTORY_FAIL.DROPPED) {
    return {
      ...base,
      tone: 'warn',
      message: `Could not ${dir} — “${label}” no longer matches the current data and was removed from history`,
    };
  }
  return null;   // NO_ENTRY / BUSY — deliberately silent
}

/** True when a projectId change should wipe the history (108.md §16). */
export function shouldClearForProject(prev, next) {
  return String(prev == null ? '' : prev) !== String(next == null ? '' : next);
}

/**
 * executorSignature(kinds) → a `|a|b|` string, '|' when nothing is registered.
 *
 * The executor MAP is a ref (run() must read it synchronously between awaits), but
 * availability depends on it, and availability must RE-RENDER when a page mounts or
 * unmounts. A sorted string is the cheap reactive mirror: value-equal signatures
 * make React bail out, so the register/unregister churn of an effect whose deps are
 * unstable cannot turn into a render loop.
 */
export function executorSignature(kinds) {
  const list = [];
  for (const k of (kinds || [])) if (typeof k === 'string' && k) list.push(k);
  list.sort();
  return list.length ? `|${list.join('|')}|` : '|';
}

/** Is a handler for this entry kind currently mounted? */
export function hasExecutorKind(signature, kind) {
  if (typeof kind !== 'string' || !kind) return false;
  return String(signature || '').includes(`|${kind}|`);
}

/**
 * delegateSignature(source) → a `|scope:UR|` string, '|' when nothing is registered.
 *
 * The reactive mirror of the scope-delegate registry, exactly as executorSignature
 * mirrors the executor map: the delegate's `undo`/`redo` FUNCTIONS live in a ref
 * (run() reads them synchronously), but its two availability booleans must re-render
 * the header control when the delegating page's own stack empties or fills. Accepts
 * a Map (the live registry) or a plain object (the rendered snapshot) so both sides
 * of the comparison speak the same language.
 */
export function delegateSignature(source) {
  const parts = [];
  const push = (k, d) => {
    if (typeof k !== 'string' || !k) return;
    parts.push(`${k}:${d && d.canUndo ? 1 : 0}${d && d.canRedo ? 1 : 0}`);
  };
  if (source && typeof source.forEach === 'function' && typeof source.get === 'function') {
    source.forEach((d, k) => push(k, d));                    // Map
  } else if (source && typeof source === 'object') {
    for (const k of Object.keys(source)) push(k, source[k]); // plain snapshot
  }
  parts.sort();
  return parts.length ? `|${parts.join('|')}|` : '|';
}

/** Normalise one delegate declaration; null when it cannot answer for anything. */
export function normalizeScopeDelegate(delegate) {
  const d = delegate && typeof delegate === 'object' && !Array.isArray(delegate) ? delegate : null;
  if (!d) return null;
  const undo = typeof d.undo === 'function' ? d.undo : null;
  const redo = typeof d.redo === 'function' ? d.redo : null;
  if (!undo && !redo) return null;
  return {
    canUndo: !!d.canUndo && !!undo,
    canRedo: !!d.canRedo && !!redo,
    undo,
    redo,
  };
}

/**
 * historyAvailability(hist, scope, signature, delegate) → counts() + executor
 * awareness + the current scope's delegate.
 *
 * 108.md §22 wants the Undo/Redo controls to reflect what THIS page can actually
 * do. 108 review, [major] "every screening sub-tab shares the 'screening' scope but
 * unmounts the executors": a non-empty stack whose top entry has no registered
 * executor is NOT available — leaving canUndo true there enables the header button,
 * claims the Ctrl+Z chord, and hands the user an error toast instead of letting the
 * chord fall through. Availability is the provider's job because the provider is
 * what owns the executor registry; historyStacks.counts() stays domain-blind.
 */
export function historyAvailability(hist, scope, signature, delegate) {
  const c = counts(hist, scope);
  const nextUndo = peekUndo(hist, scope);
  const nextRedo = peekRedo(hist, scope);
  // 108 review — a delegating scope (the Search Builder) can undo even with an empty
  // provider stack, but never WHILE one of this provider's own operations is in
  // flight (`pending` disables both directions for the whole scope, §14).
  const d = (!c.pending && delegate && typeof delegate === 'object') ? delegate : null;
  return {
    ...c,
    nextUndo,
    nextRedo,
    canUndo: (c.canUndo && hasExecutorKind(signature, nextUndo && nextUndo.kind)) || !!(d && d.canUndo),
    canRedo: (c.canRedo && hasExecutorKind(signature, nextRedo && nextRedo.kind)) || !!(d && d.canRedo),
  };
}

/**
 * @param {object} props
 * @param {object} [props.initialHistory]    seeded stacks. A test seam, mirroring
 *   UndoFeedbackProvider's `initialNotes`: effects and clicks do not run under
 *   renderToStaticMarkup, so this is the only way an SSR test can assert the
 *   rendered availability of a NON-empty history.
 * @param {Object<string,Function>} [props.initialExecutors] seeded executors, the
 *   same seam for the other half of availability (engines register theirs in an
 *   effect, which SSR never runs).
 * @param {Object<string,object>} [props.initialDelegates] seeded scope delegates —
 *   the same seam again for the Search Builder's externally-owned stack.
 */
export function HistoryProvider({
  projectId, scope, children, onFeedback, idFn, now,
  initialHistory, initialExecutors, initialDelegates,
}) {
  // Rendered copy (drives canUndo/canRedo) + a ref that is the SYNCHRONOUS truth.
  // undo() must read and write the stacks between awaits, where React state has
  // not landed yet; the ref is what keeps a rapid Ctrl+Z Ctrl+Z honest.
  const [hist, setHist] = useState(() => (
    initialHistory && typeof initialHistory === 'object' && !Array.isArray(initialHistory)
      ? initialHistory
      : emptyHistory()
  ));
  const histRef = useRef(hist);

  // Live props behind a ref, assigned during render (the repo's hook convention —
  // see screening/hooks/useAbstractSelectionShortcuts.js) so every callback below
  // can stay referentially stable.
  const live = useRef({});
  live.current = { projectId, scope, onFeedback, idFn, now };

  const executorsRef = useRef(null);
  if (executorsRef.current === null) {
    executorsRef.current = new Map();
    const seed = initialExecutors && typeof initialExecutors === 'object' ? initialExecutors : null;
    if (seed) {
      for (const k of Object.keys(seed)) {
        if (typeof seed[k] === 'function') executorsRef.current.set(k, seed[k]);
      }
    }
  }
  // The reactive mirror of the executor map — see executorSignature. Availability
  // must change when a page mounts or unmounts, and a ref alone never re-renders.
  const [execSig, setExecSig] = useState(() => executorSignature(executorsRef.current.keys()));

  // 108 review §25 — scopes whose undo is owned by the page itself (the Search
  // Builder). Functions in the ref (run() reads them between awaits); the two
  // availability booleans mirrored into state so the header control re-renders.
  const delegatesRef = useRef(null);
  if (delegatesRef.current === null) {
    delegatesRef.current = new Map();
    const seed = initialDelegates && typeof initialDelegates === 'object' ? initialDelegates : null;
    if (seed) {
      for (const k of Object.keys(seed)) {
        const d = normalizeScopeDelegate(seed[k]);
        if (d) delegatesRef.current.set(k, d);
      }
    }
  }
  const [delegateFlags, setDelegateFlags] = useState(() => {
    const snap = {};
    delegatesRef.current.forEach((d, k) => { snap[k] = { canUndo: d.canUndo, canRedo: d.canRedo }; });
    return snap;
  });

  // Consecutive 'refused' outcomes per entry id — the refusal-drop policy's counter.
  const refusalsRef = useRef(null);
  if (refusalsRef.current === null) refusalsRef.current = new Map();

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
    refusalsRef.current.clear();
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
   * coalesce(entry, canMerge, mergeOps) → the entry that is now top-of-stack —
   * 108.md §13. Merges into the scope's top entry when canMerge(top, entry)
   * accepts it (per-field typing), otherwise records normally. `mergeOps` is the
   * optional domain hook that decides the merged entry's undoOp/redoOp (see
   * historyStacks.coalesceOrRecord — extraction uses it to carry the NEWEST
   * precondition across a coalesced chain of keystrokes).
   *
   * RETURN VALUE: on a merge this is the SURVIVING entry (the original id kept by
   * the merge), not the entry that was just handed in — callers that hold on to an
   * id for `undoEntry(id)` need the one that is actually on the stack.
   */
  const coalesce = useCallback((entry, canMerge, mergeOps) => {
    const stamped = stamp(entry);
    if (!isValidEntry(stamped)) return null;
    const next = coalesceOrRecord(histRef.current, stamped, canMerge, mergeOps);
    applyHist(next);
    return peekUndo(next, stamped.scope) || stamped;
  }, [applyHist, stamp]);

  /** Re-publish the registered kinds. Value-equal signature ⇒ React bails out. */
  const syncExecutors = useCallback(() => {
    setExecSig((prev) => {
      const next = executorSignature(executorsRef.current.keys());
      return prev === next ? prev : next;
    });
  }, []);

  const registerExecutor = useCallback((kind, fn) => {
    if (typeof kind !== 'string' || !kind || typeof fn !== 'function') return () => {};
    executorsRef.current.set(kind, fn);
    syncExecutors();
    return () => {
      if (executorsRef.current.get(kind) === fn) {
        executorsRef.current.delete(kind);
        syncExecutors();
      }
    };
  }, [syncExecutors]);

  /** Re-publish the delegates' availability. Value-equal snapshot ⇒ React bails. */
  const syncDelegates = useCallback(() => {
    setDelegateFlags((prev) => {
      const next = {};
      delegatesRef.current.forEach((d, k) => { next[k] = { canUndo: d.canUndo, canRedo: d.canRedo }; });
      return delegateSignature(prev) === delegateSignature(next) ? prev : next;
    });
  }, []);

  /**
   * registerScopeDelegate(scope, { canUndo, canRedo, undo, redo }) → unregister.
   *
   * The declaration is a VALUE, not a subscription: the delegating page re-registers
   * whenever its own availability flips (a one-line effect keyed on that boolean),
   * which is what keeps the header control honest without the provider having to
   * poll anything.
   */
  const registerScopeDelegate = useCallback((scopeKey, delegate) => {
    const key = typeof scopeKey === 'string' ? scopeKey : '';
    const d = normalizeScopeDelegate(delegate);
    if (!key || !d) return () => {};
    delegatesRef.current.set(key, d);
    syncDelegates();
    return () => {
      if (delegatesRef.current.get(key) === d) {
        delegatesRef.current.delete(key);
        syncDelegates();
      }
    };
  }, [syncDelegates]);

  const run = useCallback(async (direction, opts) => {
    const o = opts && typeof opts === 'object' ? opts : null;
    const sc = o && typeof o.scope === 'string' && o.scope
      ? o.scope
      : String(live.current.scope == null ? '' : live.current.scope);

    // 108 review §22 — the page that knows how to reverse this kind is unmounted
    // (a screening sub-tab, an extraction article the user navigated away from).
    // Refuse BEFORE taking: the entry must stay exactly where it is, so going back
    // to that page makes Ctrl+Z work again. Taking-then-restoring would also churn
    // the stack and, on the redo side, reorder it.
    if (!counts(histRef.current, sc).pending) {
      const upNext = direction === 'undo' ? peekUndo(histRef.current, sc) : peekRedo(histRef.current, sc);
      // 108 review §25 — a scope whose undo lives outside this provider (the Search
      // Builder's own inverse-patch stack). Consulted ONLY when this provider has no
      // entry of its own to run in this direction, so real entries always win and the
      // LIFO order of a shared scope can never be jumped.
      if (!upNext) {
        const del = delegatesRef.current.get(sc);
        const able = del && (direction === 'undo' ? del.canUndo : del.canRedo);
        const fn = del && (direction === 'undo' ? del.undo : del.redo);
        if (able && fn) {
          try {
            await fn();
          } catch (err) {
            const failed = {
              ok: false,
              reason: HISTORY_FAIL.FAILED,
              detail: (err && err.message) ? String(err.message) : '',
            };
            emitNote(historyNote({ scope: sc }, direction, failed));
            return { ...failed, entry: null, delegated: true };
          }
          // No note: the delegating page owns its own feedback surface and has
          // already named what it undid (the Search Builder's snackbar).
          return { ok: true, reason: '', entry: null, delegated: true };
        }
      }
      if (upNext && !executorsRef.current.has(upNext.kind)) {
        const blocked = { ok: false, reason: HISTORY_FAIL.NO_EXECUTOR, detail: '' };
        emitNote(historyNote(upNext, direction, blocked));
        return { ...blocked, entry: upNext };
      }
    }

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

    // 108 review — the scope may have been cleared (project switch, autosave 409,
    // adopted remote doc) while the executor was in flight. The pure transitions
    // refuse to resurrect it; the note would name a project the user has left, so
    // it is suppressed too. The entry is gone, whatever the executor reported.
    if (!isPendingEntry(histRef.current, sc, entry.id)) {
      refusalsRef.current.delete(entry.id);
      return {
        ok: !!outcome.ok,
        reason: outcome.ok ? '' : outcome.reason,
        detail: outcome.detail || '',
        entry,
        dropped: true,
      };
    }

    if (!outcome.ok) {
      // 108 review — REFUSAL-DROP POLICY. Normally the entry goes back where it
      // came from (108.md §8.6: never silently lost). But an entry whose
      // precondition can never hold again would be handed back on every press,
      // burying every older valid entry behind it. After REFUSAL_DROP_LIMIT
      // consecutive refusals it is abandoned instead — loudly, with its own note.
      if (outcome.reason === HISTORY_FAIL.REFUSED) {
        const seen = (Number(refusalsRef.current.get(entry.id)) || 0) + 1;
        if (seen >= REFUSAL_DROP_LIMIT) {
          refusalsRef.current.delete(entry.id);
          applyHist(dropPending(histRef.current, sc, entry));
          const dropOutcome = { ok: false, reason: HISTORY_FAIL.DROPPED, detail: outcome.detail };
          emitNote(historyNote(entry, direction, dropOutcome));
          return { ...dropOutcome, entry, dropped: true };
        }
        refusalsRef.current.set(entry.id, seen);
      } else {
        refusalsRef.current.delete(entry.id);   // only CONSECUTIVE refusals count
      }
      applyHist(restoreFailed(histRef.current, sc, entry, direction));
      emitNote(historyNote(entry, direction, outcome));
      return { ok: false, reason: outcome.reason, detail: outcome.detail, entry };
    }

    refusalsRef.current.delete(entry.id);
    applyHist(direction === 'undo'
      ? completeUndo(histRef.current, sc, entry)
      : completeRedo(histRef.current, sc, entry));
    emitNote(historyNote(entry, direction, { ok: true }));
    return { ok: true, reason: '', entry };
  }, [applyHist, emitNote]);

  const undo = useCallback(() => run('undo'), [run]);
  const redo = useCallback(() => run('redo'), [run]);

  /**
   * undoEntry(entryId) → the same result shape as undo() — 108 review, [major]
   * "the snackbar's Undo button undoes the top of the stack, not the noted action".
   *
   * A note that offers "Undo" names ONE action. It must reverse that action or
   * nothing: an undo-carrying note stays visible for 8 s while later actions keep
   * landing on the same scope's stack, so a bare undo() would silently reverse
   * something else. This runs the entry ONLY while it is still the top of its own
   * scope's undo stack (the scope is looked up from the id, so a note posted on one
   * page still works after the user moved to another). Otherwise it returns
   * 'superseded' and touches NOTHING — the stack is not disturbed by a stale button.
   */
  const undoEntry = useCallback(async (entryId) => {
    const id = typeof entryId === 'string' ? entryId : '';
    const sc = id ? scopeOfUndoTop(histRef.current, id) : '';
    if (!sc) {
      const outcome = { ok: false, reason: HISTORY_FAIL.SUPERSEDED, detail: '' };
      emitNote(historyNote({ scope: String(live.current.scope || '') }, 'undo', outcome));
      return { ...outcome, entry: null };
    }
    return run('undo', { scope: sc });
  }, [emitNote, run]);

  const clearScope = useCallback((target) => {
    refusalsRef.current.clear();
    applyHist(clearScopePure(histRef.current, target == null ? live.current.scope : target));
  }, [applyHist]);

  /** Drop every scope matching predicate(scope) — the blob-conflict handler. */
  const clearScopes = useCallback((predicate) => {
    refusalsRef.current.clear();
    applyHist(clearScopesPure(histRef.current, predicate));
  }, [applyHist]);

  const clearAll = useCallback(() => {
    refusalsRef.current.clear();
    applyHist(clearAllPure(histRef.current));
  }, [applyHist]);

  const activeScope = String(scope == null ? '' : scope);
  const avail = historyAvailability(hist, activeScope, execSig, delegateFlags[activeScope]);
  // 108 review §22 — "the stack is not empty, this page just cannot run it" is a
  // different state from "there is nothing to undo", and the header control has to
  // say so rather than looking broken. Exposed as a flag so the view stays pure.
  const undoBlocked = !avail.canUndo && !avail.pending && avail.undo > 0;
  const redoBlocked = !avail.canRedo && !avail.pending && avail.redo > 0;

  const value = useMemo(() => ({
    scope: activeScope,
    projectId,
    canUndo: avail.canUndo,
    canRedo: avail.canRedo,
    pending: avail.pending,
    undoCount: avail.undo,
    redoCount: avail.redo,
    nextUndo: avail.nextUndo,
    nextRedo: avail.nextRedo,
    undoBlocked,
    redoBlocked,
    record,
    coalesce,
    undo,
    redo,
    undoEntry,
    registerExecutor,
    registerScopeDelegate,
    clearScope,
    clearScopes,
    clearAll,
  }), [
    activeScope, projectId, avail.canUndo, avail.canRedo, avail.pending,
    avail.undo, avail.redo, avail.nextUndo, avail.nextRedo, undoBlocked, redoBlocked,
    record, coalesce, undo, redo, undoEntry,
    registerExecutor, registerScopeDelegate, clearScope, clearScopes, clearAll,
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
  undoBlocked: false,
  redoBlocked: false,
  record: () => null,
  coalesce: () => null,
  undo: async () => ({ ok: false, reason: HISTORY_FAIL.NO_ENTRY, entry: null }),
  redo: async () => ({ ok: false, reason: HISTORY_FAIL.NO_ENTRY, entry: null }),
  undoEntry: async () => ({ ok: false, reason: HISTORY_FAIL.SUPERSEDED, entry: null }),
  registerExecutor: () => noop,
  registerScopeDelegate: () => noop,
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
