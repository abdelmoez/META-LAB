/**
 * editableTarget.js — 108.md §7 / §23. THE canonical "is the user typing here?"
 * predicate for PecanRev's keyboard layer.
 *
 * Before 108 the repo had FOUR predicates that disagreed:
 *   - screening/hooks/useAbstractSelectionShortcuts.js inEditableContext()  (document.activeElement + `.sift-in`)
 *   - screening/hooks/useScreeningShortcuts.js                              (an inline copy of the same)
 *   - frontend/focus/FocusModeContext.js isTypingTarget()                   (e.target, no ARIA roles)
 *   - searchBuilder/undoStack.js shouldHandleGlobalUndo()                   (tag + contentEditable + ARIA roles)
 * Only the last one recognises `role="textbox"`, which is exactly what the
 * manuscript editor renders (features/manuscript/richEditor/RichSectionEditor.jsx
 * — a contentEditable div with role="textbox" aria-multiline). Ctrl+Z there MUST
 * reach the browser's native undo stack (108.md §7: "if the user is actively
 * typing `epilepsyy` … the expected text-editing undo behavior should generally
 * happen"), so shouldHandleGlobalUndo's semantics are the ones that survive and
 * this module is their new home. undoStack.js re-exports from here, so the two can
 * never drift apart again.
 *
 * SEMANTICS (unchanged from undoStack.js:715-723): a target is editable when it is
 * an INPUT / TEXTAREA / SELECT element, a contentEditable region, or carries an
 * ARIA text-widget role (textbox / searchbox / combobox). Everything else — chips,
 * buttons, list rows, the page body — is not.
 *
 * Pure, null-safe and DOM-free by design: it reads only `tagName`,
 * `isContentEditable` and `role` off whatever it is handed, so it works with a
 * real Element, with `window` (no such properties → not editable), with a plain
 * object in a unit test, and with null/undefined.
 *
 * NOT covered here, deliberately: the screening `.sift-in` container convention,
 * which needs `element.closest()` and therefore a live DOM. That stays in the
 * screening DOM adapters, which combine this predicate with their own container
 * check — this module is the floor, not the ceiling.
 */

/** Form elements whose own key handling owns the keystroke. */
export const EDITABLE_TAGS = Object.freeze(['INPUT', 'TEXTAREA', 'SELECT']);

/** ARIA text widgets — how rich editors and syntax fields announce themselves. */
export const EDITABLE_ROLES = Object.freeze(['textbox', 'searchbox', 'combobox']);

/**
 * isEditableTarget(target) → boolean
 * True when a keystroke on this target belongs to a text-entry surface and an
 * application-level shortcut must keep its hands off.
 * @param {{tagName?:string, isContentEditable?:boolean, role?:string}|null|undefined} target
 */
export function isEditableTarget(target) {
  const t = target && typeof target === 'object' ? target : null;
  if (!t) return false;
  if (t.isContentEditable === true) return true;
  const tag = String(t.tagName || '').toUpperCase();
  if (EDITABLE_TAGS.includes(tag)) return true;
  const role = String(t.role || '').toLowerCase();
  if (EDITABLE_ROLES.includes(role)) return true;
  return false;
}

/**
 * shouldHandleGlobalUndo(target) → boolean — the inverse, kept under its original
 * 97.md name because SearchBuilderTab.jsx and tests/unit/searchUndoStack.test.js
 * read it that way. searchBuilder/undoStack.js re-exports THIS function; there is
 * exactly one implementation in the repo.
 */
export function shouldHandleGlobalUndo(target) {
  return !isEditableTarget(target);
}
