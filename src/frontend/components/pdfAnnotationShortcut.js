/**
 * pdfAnnotationShortcut.js — 116.md §86 (decision D9). CONTEXTUAL undo/redo for the
 * PDF annotation layer.
 *
 * THE PROBLEM §86 states: "Do not let annotation undo unexpectedly undo an unrelated
 * Screening decision." The viewer is mounted INSIDE the screening stage, so the
 * TIER.GLOBAL Ctrl/Cmd+Z binding (ProjectInteractionProvider → HistoryGlobals) reads
 * the STAGE's scope and would pop a screening decision.
 *
 * THE FIX, in the shape the interaction layer already supports:
 *   - annotations record into their OWN history scope (`pdf`, projectScopes.js), which
 *     no URL stage maps to, so the global chord can never reach those entries;
 *   - this hook registers a TIER.COMPONENT binding for the same chord. Lower tier wins
 *     in shortcutRouter.js, so while the PDF pane is the active surface the component
 *     binding takes Ctrl+Z and targets the `pdf` scope through `undoScope`;
 *   - when the pane is NOT active the binding declines in `when()`, the router falls
 *     through to the global binding, and the stage's own undo behaves exactly as before.
 *     Nothing is preventDefault-ed on the way, so native text undo is untouched (108.md §7).
 *
 * "ACTIVE SURFACE" is the recipe the autosave/undo investigation prescribes: focus-within
 * the pane, OR the pane was the target of the last pointerdown anywhere in the document.
 * The second term is what keeps "highlight, then Ctrl+Z" working — committing a highlight
 * unmounts the little control the user just clicked, which drops focus back to <body>.
 *
 * SSR/test-safe: `useShortcut` and `useProjectHistory` both degrade to no-ops outside
 * their providers, and every DOM read happens inside an effect or a keydown-time
 * predicate. A viewer with `active:false` registers bindings that always decline —
 * which is what keeps AppPdfViewer inert for every caller that passes no annotations.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useProjectHistory } from '../history/HistoryContext.jsx';
import { useShortcut, TIER } from '../shortcuts/ShortcutProvider.jsx';
import { SCOPE_PDF } from '../../research-engine/interaction/projectScopes.js';
import { isUndoChord, isRedoChord, historyShortcutAllowed } from '../../research-engine/interaction/undoChords.js';

/**
 * usePdfAnnotationUndoShortcut({ active, paneRef })
 * @param {boolean} active   annotations are enabled on this viewer
 * @param {{current: HTMLElement|null}} paneRef  the viewer shell
 */
export function usePdfAnnotationUndoShortcut({ active = false, paneRef = null } = {}) {
  const history = useProjectHistory();
  const pointerInsideRef = useRef(false);
  const live = useRef({});
  live.current = { active, paneRef, history };

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    // Capture phase + pointerdown: we only OBSERVE which surface the user last touched.
    // Nothing is prevented, nothing is stopped — §75 "do not interfere".
    const onDown = (e) => {
      const el = live.current.paneRef && live.current.paneRef.current;
      pointerInsideRef.current = !!(el && e.target && el.contains(e.target));
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [active]);

  const paneActive = useCallback(() => {
    const { active: on, paneRef: ref } = live.current;
    if (!on) return false;
    const el = ref && ref.current;
    if (!el) return false;
    if (typeof document !== 'undefined' && document.activeElement && el.contains(document.activeElement)) return true;
    return pointerInsideRef.current;
  }, []);

  const canRun = useCallback((dir) => {
    if (!paneActive()) return false;
    const h = live.current.history;
    if (!h || typeof h.scopeAvailability !== 'function') return false;
    const avail = h.scopeAvailability(SCOPE_PDF);
    return dir === 'undo' ? !!avail.canUndo : !!avail.canRedo;
  }, [paneActive]);

  useShortcut({
    id: 'pdf.annotation.undo',
    tier: TIER.COMPONENT,
    chord: 'Ctrl/Cmd + Z', label: 'Undo the last highlight change', scopeLabel: 'PDF viewer',
    match: isUndoChord,
    when: (ctx) => historyShortcutAllowed(ctx) && canRun('undo'),
    run: () => { live.current.history.undoScope(SCOPE_PDF); return true; },
  }, []);

  useShortcut({
    id: 'pdf.annotation.redo',
    tier: TIER.COMPONENT,
    chord: 'Ctrl/Cmd + Shift + Z', label: 'Redo the last undone highlight change', scopeLabel: 'PDF viewer',
    // The Ctrl+Y alias uses the pure default (ON), which is also the shipped catalogue
    // default for `interaction.ctrlYRedoAlias`. An operator who turns the alias off
    // turns it off for the stage chord; this pane keeps accepting it, which is the
    // conservative direction (a redo the user asked for, in the scope they are in).
    match: (e) => isRedoChord(e),
    when: (ctx) => historyShortcutAllowed(ctx) && canRun('redo'),
    run: () => { live.current.history.redoScope(SCOPE_PDF); return true; },
  }, []);
}

export default usePdfAnnotationUndoShortcut;
