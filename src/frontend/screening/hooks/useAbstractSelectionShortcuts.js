/**
 * useAbstractSelectionShortcuts.js — 107.md §3. Highlight text in the abstract and
 * press Cmd/Ctrl+I (inclusion) or Cmd/Ctrl+E (exclusion) to add it to the project's
 * keyword filters.
 *
 * This hook is the DOM adapter only: it reads the live selection, the focused
 * element and whether a screening dialog is open, then hands those facts to the
 * pure `shouldHandleSelectionShortcut` (research-engine/screening/selectionShortcut.js)
 * which owns every rule and is what the unit tests exercise.
 *
 * `preventDefault()` fires ONLY once every guard has passed, so Cmd/Ctrl+I and
 * Cmd/Ctrl+E keep their normal browser meaning everywhere else on the page.
 *
 * 108.md §1 — "everywhere else" now includes the cases where PecanRev cannot
 * process the press: the `canHandle` predicate is part of the guard chain, so a
 * reviewer who may not edit keyword lists never has the chord swallowed. Shift'd
 * chords (Ctrl/Cmd+Shift+I = DevTools) are not ours and are never claimed; repeated,
 * IME-composing and already-claimed events are skipped.
 *
 * Selection ownership is proven structurally: BOTH the selection's anchor and focus
 * nodes must be inside the abstract element (`el.contains(node)`), so a selection
 * that merely starts in the abstract and runs into the decision bar is rejected —
 * `window.getSelection()` alone would not prove ownership (107.md §3).
 */
import { useEffect, useRef } from 'react';
import {
  matchesShortcut, keyEventRejection, shouldHandleSelectionShortcut,
} from '../../../research-engine/screening/selectionShortcut.js';
import { isScreeningModalOpen } from '../ui/components.jsx';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Focus sits in a text-entry / control context where the shortcut must not fire. */
function inEditableContext() {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  // `.sift-in` marks every screening text input (same convention as
  // useScreeningShortcuts) — covers search, notes, chip adders, reason fields.
  if (typeof el.closest === 'function' && el.closest('.sift-in')) return true;
  return false;
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled          — master switch (off ⇒ no listener work)
 * @param {{current: HTMLElement|null}} opts.containerRef — the abstract element
 * @param {(hit:{list:'include'|'exclude', phrase:string}) => void} opts.onTrigger
 * @param {boolean|(()=>boolean)} [opts.canHandle] — 108.md §1 cond. 5: may PecanRev
 *        actually process this press (e.g. `() => canEditKeywords`)? Evaluated
 *        INSIDE the guard chain, so a `false` means the event is never cancelled and
 *        the browser keeps its default. Omitted ⇒ permitted.
 */
export function useAbstractSelectionShortcuts({ enabled, containerRef, onTrigger, canHandle }) {
  // Latest values behind a ref so the window listener is bound exactly once.
  const ref = useRef({});
  ref.current = { enabled, containerRef, onTrigger, canHandle };

  useEffect(() => {
    function onKey(e) {
      const { enabled: on, containerRef: cRef, onTrigger: fire, canHandle: may } = ref.current;
      if (!on) return;
      // Cheap pre-checks: never touch the DOM (or the selection) for other keys, for
      // auto-repeat ticks, mid-IME-composition, or an event someone else already
      // claimed. Same predicates the pure chain re-applies below.
      if (!matchesShortcut(e)) return;
      if (keyEventRejection(e)) return;

      const el = cRef?.current || null;
      const sel = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
      const insideAbstract = !!(
        el && sel && !sel.isCollapsed && sel.anchorNode && sel.focusNode
        && el.contains(sel.anchorNode) && el.contains(sel.focusNode)
      );

      const res = shouldHandleSelectionShortcut(e, {
        selectedText: sel ? String(sel) : '',
        selectionInsideAbstract: insideAbstract,
        editableContext: inEditableContext(),
        modalOpen: isScreeningModalOpen(),
        // Boolean or predicate — the pure chain resolves it last, so the permission
        // source is only consulted for a press that would otherwise be handled.
        canProcess: may,
      });
      if (!res.handled) return;

      e.preventDefault();
      fire?.({ list: res.list, phrase: res.phrase });
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Intentionally empty dep array — the listener is stable and reads via the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
