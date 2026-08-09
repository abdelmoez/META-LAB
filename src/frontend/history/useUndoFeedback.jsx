/**
 * history/useUndoFeedback.jsx — 108.md §17 "provide subtle undo/redo feedback".
 *
 * Generalises the 107 keyword snackbar into a QUEUED, scope-aware notification
 * surface that any engine can post to, and that the history provider posts to
 * automatically on every undo/redo.
 *
 * WHY A QUEUE. `ScreeningTab`'s `kwNote` is a single state slot: a rapid
 * delete → undo → redo sequence silently overwrites the previous note, and with
 * it the Undo button the user was reaching for. A queue makes the affordance
 * survivable. But a naive FIFO is also wrong — three "…undone" confirmations in a
 * row would take 24 s to drain — so the rule is:
 *
 *   • A note WITH an undo action always queues. Losing an Undo button is losing
 *     functionality (108.md §20 makes it the safety net for keyword deletion).
 *   • A note WITHOUT an undo action supersedes the visible note when that one is
 *     also plain. Consecutive confirmations read as one live status line.
 *
 * WHAT AN UNDO-CARRYING NOTE MUST CARRY (108 review). Because undo-carrying notes
 * QUEUE, the note on screen is frequently NOT the newest recorded action — so its
 * button may not be pressed for several seconds, by which time the scope's stack
 * has moved on. A bare `history.undo()` would then reverse a different action than
 * the note names. The contract:
 *
 *     const stamped = history.record(entry);            // or history.coalesce(…)
 *     feedback.notify({
 *       message: 'Keyword deleted', scope: 'screening',
 *       entryId: stamped.id,                            // ← the action this note names
 *       undo: () => history.undoEntry(stamped.id),      // ← NOT history.undo()
 *     });
 *
 * `undoEntry(id)` runs that entry only while it is still the top of its scope's undo
 * stack; otherwise it resolves `{ ok:false, reason:'superseded' }` without touching
 * the stack and the provider posts "That action can no longer be undone directly —
 * press Ctrl+Z to step back." So the caller does not have to handle the failure: it
 * just must not fall back to an untargeted undo. `entryId` itself is carried on the
 * note (and rendered as `data-entry-id`) so the surface can be asserted and so a
 * future dismiss-on-supersede can find the note.
 *
 * WHY IT REUSES KeywordSnackbar. 108.md §17 says reuse the existing surface, and
 * screening/components/KeywordSnackbar.jsx already is one: fixed bottom-left,
 * role=status aria-live=polite, an optional Undo button, an 8 s auto-dismiss, and
 * the `screening-keyword-snackbar` / `screening-keyword-undo` testids the 107 unit
 * tests and page objects pin. That component is rendered here UNMODIFIED. The
 * alternative — the Stitch toast — stacks but has no action slot and silently
 * no-ops on the shell-less /sift-beta route.
 *
 * TIMER NOTE (the 107 trap): KeywordSnackbar's auto-dismiss effect depends on
 * `[message, onDismiss]`, so an unstable `onDismiss` identity restarts the 8 s
 * countdown on every render — forever. The callbacks below are created ONCE and
 * read the current note from a ref, and the snackbar is keyed by note id so each
 * note gets its own fresh timer even when two notes share the same text.
 *
 * NOT MOUNTED YET — Wave 2 mounts one provider per shell (StitchProjectWorkspace,
 * the standalone SiftProject route, the legacy Workspace) and wires
 * HistoryProvider's `onFeedback` to `notify`.
 */
import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import KeywordSnackbar from '../screening/components/KeywordSnackbar.jsx';

/** How many notes may wait behind the visible one. */
export const FEEDBACK_LIMIT = 4;

const DEFAULT_ID_FN = () => `n_${Math.random().toString(36).slice(2, 10)}`;

const UndoFeedbackContext = createContext(null);

/** Keep the visible note plus the newest ones; a flood drops the middle. */
function trimQueue(queue) {
  if (queue.length <= FEEDBACK_LIMIT) return queue;
  return [queue[0], ...queue.slice(queue.length - (FEEDBACK_LIMIT - 1))];
}

/**
 * stampNote — fill id/scope/tone/entryId. Pure, and called OUTSIDE the state
 * updater so StrictMode's double-invoke cannot mint two ids for one note.
 *
 * `entryId` is the history entry this note describes (see the header contract) —
 * '' for the provider's own undo/redo confirmations, which describe an operation
 * that has already happened and offer no button.
 */
export function stampNote(note, { idFn } = {}) {
  const n = note && typeof note === 'object' && !Array.isArray(note) ? note : null;
  if (!n) return null;
  const mkId = typeof idFn === 'function' ? idFn : DEFAULT_ID_FN;
  const tone = (n.tone === 'warn' || n.tone === 'error') ? n.tone : 'info';
  return {
    ...n,
    id: typeof n.id === 'string' && n.id ? n.id : String(mkId() || ''),
    scope: n.scope == null ? '' : String(n.scope),
    entryId: typeof n.entryId === 'string' ? n.entryId : '',
    message: typeof n.message === 'string' ? n.message : '',
    tone,
  };
}

/** Enqueue a note. Pure; returns the same array when the note is unusable. */
export function feedbackPush(queue, note) {
  const q = Array.isArray(queue) ? queue : [];
  if (!note || typeof note !== 'object') return q;
  if (typeof note.id !== 'string' || !note.id) return q;
  if (typeof note.message !== 'string' || !note.message) return q;
  const head = q[0];
  if (head && !head.undo && !note.undo) return [note, ...q.slice(1)];
  return trimQueue([...q, note]);
}

/** Remove one note by id. Pure; referentially stable when the id is absent. */
export function feedbackDismiss(queue, id) {
  const q = Array.isArray(queue) ? queue : [];
  if (typeof id !== 'string' || !id) return q;
  const next = q.filter((n) => !n || n.id !== id);
  return next.length === q.length ? q : next;
}

/** Drop every note belonging to a scope (used when that scope's history clears). */
export function feedbackClearScope(queue, scope) {
  const q = Array.isArray(queue) ? queue : [];
  const target = String(scope == null ? '' : scope);
  const next = q.filter((n) => !n || String(n.scope || '') !== target);
  return next.length === q.length ? q : next;
}

/**
 * @param {object} props
 * @param {() => string} [props.idFn]         injectable note-id source (tests)
 * @param {Array} [props.initialNotes]        seed queue. Mirrors FocusModeProvider's
 *   `initial` prop: the seam that lets a static-markup test render the surface,
 *   since effects and clicks do not run under renderToStaticMarkup.
 */
export function UndoFeedbackProvider({ children, idFn, initialNotes }) {
  const [queue, setQueue] = useState(() => (
    Array.isArray(initialNotes)
      ? initialNotes.map((n) => stampNote(n, { idFn })).filter((n) => n && n.message)
      : []
  ));
  const live = useRef({});
  live.current = { idFn };

  const head = queue.length ? queue[0] : null;
  const headRef = useRef(null);
  headRef.current = head;

  /**
   * notify(note) → the note id. `note.undo` is an optional callback; when present
   * it MUST be entry-targeted (`() => history.undoEntry(note.entryId)`), never a
   * bare `history.undo()` — see the header contract.
   */
  const notify = useCallback((note) => {
    const stamped = stampNote(note, { idFn: live.current.idFn });
    if (!stamped || !stamped.message) return '';
    setQueue((q) => feedbackPush(q, stamped));
    return stamped.id;
  }, []);

  const dismiss = useCallback((id) => {
    setQueue((q) => feedbackDismiss(q, id));
  }, []);

  const clearScope = useCallback((scope) => {
    setQueue((q) => feedbackClearScope(q, scope));
  }, []);

  const clear = useCallback(() => {
    setQueue((q) => (q.length ? [] : q));
  }, []);

  // Created once. See the TIMER NOTE in the header — identity churn here would
  // reset the snackbar's 8 s countdown on every parent render.
  const onDismiss = useCallback(() => {
    const note = headRef.current;
    if (!note) return;
    setQueue((q) => feedbackDismiss(q, note.id));
  }, []);

  const onUndo = useCallback(() => {
    const note = headRef.current;
    if (!note) return;
    setQueue((q) => feedbackDismiss(q, note.id));
    if (typeof note.undo === 'function') {
      try {
        note.undo();
      } catch { /* the action reports its own failure through its own note */ }
    }
  }, []);

  const value = useMemo(() => ({
    notify, dismiss, clearScope, clear, current: head, queued: queue.length,
  }), [notify, dismiss, clearScope, clear, head, queue.length]);

  return (
    <UndoFeedbackContext.Provider value={value}>
      {children}
      {head && (
        <div
          data-testid="history-feedback"
          data-scope={head.scope || ''}
          data-entry-id={head.entryId || undefined}
          data-queued={queue.length}
        >
          <KeywordSnackbar
            key={head.id}
            message={head.message}
            tone={head.tone}
            onUndo={head.undo ? onUndo : undefined}
            onDismiss={onDismiss}
          />
        </div>
      )}
    </UndoFeedbackContext.Provider>
  );
}

const noop = () => {};
const NO_FEEDBACK = Object.freeze({
  notify: () => '',
  dismiss: noop,
  clearScope: noop,
  clear: noop,
  current: null,
  queued: 0,
});

/** Safe outside the provider (no-ops), like useProjectHistory / useFocusMode. */
export function useUndoFeedback() {
  return useContext(UndoFeedbackContext) || NO_FEEDBACK;
}

export default UndoFeedbackProvider;
