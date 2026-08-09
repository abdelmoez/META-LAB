/**
 * history/ProjectInteractionProvider.jsx — 108.md §§2-3, §16-17, §22-24. The ONE
 * mount point every project shell uses to switch the interaction layer on.
 *
 * Three shells host project engines and all three need the identical stack, so the
 * stack is assembled once, here, instead of three times:
 *   - `stitch/pages/StitchProjectWorkspace.jsx`   — /app/project/:id, scope from `?tab=`
 *   - `screening/pages/SiftProject.jsx`           — the standalone /sift-beta route
 *                                                   (embedded mounts inherit the host's)
 *   - `workspace/Workspace.jsx`                   — the legacy monolith, scope from its
 *                                                   React `tab` state
 *
 * ── THE NESTING, AND WHY IT IS THIS ORDER ────────────────────────────────────
 *   UndoFeedbackProvider          the snackbar queue. OUTERMOST because
 *     └ HistoryHost               HistoryProvider needs `notify` as a prop, and a
 *        └ HistoryProvider        provider cannot consume its own context.
 *           └ ShortcutProvider    one window keydown listener for the shell
 *              ├ HistoryGlobals   the Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z bindings — the
 *              │                  only component inside BOTH providers, which is
 *              │                  exactly what registering them requires
 *              ├ HistoryConflictWatch   autosave-409 → clear the blob-backed scopes
 *              └ children         every engine
 *
 * ── WHY THE BINDINGS READ `hist.canUndo` AND NOT `ctx.canUndo` ───────────────
 * ShortcutProvider's `getContext` prop is evaluated by the shell that MOUNTS it,
 * which is above HistoryProvider and therefore cannot call useProjectHistory. So
 * the availability term lives in the binding's own closure instead: `useShortcut`
 * reads `when`/`run` through a render-assigned ref, so an inline closure over the
 * freshly-rendered `hist` is safe and always current. The requirement 108.md §26
 * states — never claim Ctrl+Z when there is nothing to undo — is satisfied
 * identically either way.
 *
 * ── SCOPE, AND WHAT IT DOES NOT DO ───────────────────────────────────────────
 * `scope` selects which stack Ctrl+Z reads. It does NOT own the storage: one
 * history object lives here for the whole project, so leaving Screening for
 * Extraction and coming back continues the Screening stack (108.md §16). Only a
 * projectId change wipes everything, which HistoryProvider does on its own.
 */
import { useEffect, useRef } from 'react';
import HistoryProvider, { useProjectHistory } from './HistoryContext.jsx';
import UndoFeedbackProvider, { useUndoFeedback } from './useUndoFeedback.jsx';
import ShortcutProvider, { useShortcut, TIER } from '../shortcuts/ShortcutProvider.jsx';
import { isEditableDomTarget } from '../shortcuts/domTarget.js';
import { isAnyModalOpen } from '../../research-engine/interaction/modalSignal.js';
import { isBlobScope } from '../../research-engine/interaction/projectScopes.js';
import {
  isUndoChord, isRedoChord, historyShortcutAllowed,
} from '../../research-engine/interaction/undoChords.js';

/**
 * HistoryGlobals — the two global bindings (108.md §2). Tier 5: any engine or
 * component binding for the same chord (the Search Builder's own undo, tier 4)
 * wins, and a focused editor wins before either because the adapter skips events a
 * nearer React handler already cancelled.
 */
function HistoryGlobals() {
  const hist = useProjectHistory();

  useShortcut({
    id: 'history.undo',
    tier: TIER.GLOBAL,
    match: isUndoChord,
    // `hist.canUndo` is false while an undo is already in flight (the per-scope
    // pending slot), so holding the chord cannot stack two undos on one entry.
    when: (ctx) => historyShortcutAllowed(ctx) && hist.canUndo,
    run: () => { hist.undo(); return true; },
  }, []);

  useShortcut({
    id: 'history.redo',
    tier: TIER.GLOBAL,
    match: isRedoChord,
    when: (ctx) => historyShortcutAllowed(ctx) && hist.canRedo,
    run: () => { hist.redo(); return true; },
  }, []);

  return null;
}

/**
 * conflictTargetsProject(detail, projectId) — 108 review, [minor] "an autosave 409
 * for ANY project wipes the active project's blob-backed undo stacks".
 *
 * `serverStorage.saveAll` PUTs EVERY writable project in one batch and dispatches one
 * `metalab:autosave-conflict` per 409'd project, carrying `{detail:{id,name}}`
 * (serverStorage.js). The legacy monolith already filters its own banner by that id
 * (Workspace.jsx `onConflict`); the history watcher did not, so a collaborator's save
 * of an unrelated project dropped the stacks of the one on screen.
 *
 * Pure so the rule is unit-tested rather than buried in a listener. An event with no
 * id (or a provider with no project) is treated as OURS: the conservative direction
 * is to clear a stack we might not have needed to, never to keep a stack that now
 * describes a blob the shell has already thrown away.
 */
export function conflictTargetsProject(detail, projectId) {
  const id = detail && detail.id != null ? String(detail.id) : '';
  const mine = projectId == null ? '' : String(projectId);
  if (!id || !mine) return true;
  return id === mine;
}

/**
 * HistoryConflictWatch — 108.md §15/§16. An autosave compare-and-set refusal means
 * the shell threw away the local blob and adopted the server's copy, so every entry
 * describing the local blob is now a lie. The legacy monolith announces it with the
 * `metalab:autosave-conflict` window event (batched across projects, hence the id
 * filter above); the Stitch doc flips `saveStatus` — see HistorySaveStatusWatch.
 *
 * Only BLOB-backed scopes are cleared — the relational screening stack and the
 * Search Builder's own stack are untouched by a blob conflict.
 */
function HistoryConflictWatch({ projectId }) {
  const { clearScopes } = useProjectHistory();
  // The mounted project behind a render-assigned ref (the repo's hook convention),
  // so switching projects re-targets the filter without re-binding the listener.
  const pid = useRef(projectId);
  pid.current = projectId;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onConflict = (e) => {
      if (!conflictTargetsProject(e && e.detail, pid.current)) return;
      clearScopes(isBlobScope);
    };
    window.addEventListener('metalab:autosave-conflict', onConflict);
    return () => window.removeEventListener('metalab:autosave-conflict', onConflict);
  }, [clearScopes]);

  return null;
}

/**
 * HistorySaveStatusWatch — the OTHER channel of the same §15 rule, for shells whose
 * autosave state is a React value rather than a window event (useStitchProjectDoc's
 * `saveStatus`).
 *
 * Exported and separately mountable because the Stitch shell now mounts the provider
 * ABOVE the overview/deep-tool branch (108 review, [minor] "the shell destroys every
 * page-scoped undo stack when the user visits the project overview"), while the doc —
 * and therefore `saveStatus` — is loaded by the deep-tool page BELOW it. The deep
 * tool renders this one line inside the provider instead of passing a prop upwards.
 */
export function HistorySaveStatusWatch({ saveStatus }) {
  const { clearScopes } = useProjectHistory();
  useEffect(() => {
    if (saveStatus === 'conflict') clearScopes(isBlobScope);
  }, [saveStatus, clearScopes]);
  return null;
}

function HistoryHost({ projectId, scope, saveStatus, idFn, now, children }) {
  const { notify } = useUndoFeedback();
  return (
    <HistoryProvider projectId={projectId} scope={scope} onFeedback={notify} idFn={idFn} now={now}>
      <ShortcutProvider
        getScope={() => scope}
        isModalOpen={isAnyModalOpen}
        isEditable={isEditableDomTarget}
      >
        <HistoryGlobals />
        <HistoryConflictWatch projectId={projectId} />
        <HistorySaveStatusWatch saveStatus={saveStatus} />
        {children}
      </ShortcutProvider>
    </HistoryProvider>
  );
}

/**
 * @param {object}   props
 * @param {string}   props.projectId    clearing key (108.md §16) — the id whose
 *                                      change wipes every stack.
 * @param {string}   props.scope        current page/engine key (projectScopes.js).
 * @param {string}   [props.saveStatus] the Stitch doc's autosave state; 'conflict'
 *                                      clears the blob-backed scopes.
 * @param {Function} [props.idFn]       injectable id source (tests / StrictMode rule).
 * @param {Function} [props.now]        injectable clock.
 * @param {Array}    [props.initialNotes] seed the feedback queue (SSR test seam).
 */
export function ProjectInteractionProvider({
  projectId, scope, saveStatus, idFn, now, initialNotes, children,
}) {
  return (
    <UndoFeedbackProvider idFn={idFn} initialNotes={initialNotes}>
      <HistoryHost projectId={projectId} scope={scope} saveStatus={saveStatus} idFn={idFn} now={now}>
        {children}
      </HistoryHost>
    </UndoFeedbackProvider>
  );
}

export default ProjectInteractionProvider;
