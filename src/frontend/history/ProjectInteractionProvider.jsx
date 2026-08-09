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
import { useEffect } from 'react';
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
 * HistoryConflictWatch — 108.md §15/§16. An autosave compare-and-set refusal means
 * the shell threw away the local blob and adopted the server's copy, so every entry
 * describing the local blob is now a lie. Both shells announce it differently:
 * the legacy monolith dispatches `metalab:autosave-conflict` on window;
 * useStitchProjectDoc flips `saveStatus` to 'conflict'. Both land here.
 *
 * Only BLOB-backed scopes are cleared — the relational screening stack and the
 * Search Builder's own stack are untouched by a blob conflict.
 */
function HistoryConflictWatch({ saveStatus }) {
  const { clearScopes } = useProjectHistory();

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onConflict = () => clearScopes(isBlobScope);
    window.addEventListener('metalab:autosave-conflict', onConflict);
    return () => window.removeEventListener('metalab:autosave-conflict', onConflict);
  }, [clearScopes]);

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
        <HistoryConflictWatch saveStatus={saveStatus} />
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
