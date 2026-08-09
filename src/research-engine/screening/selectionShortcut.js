/**
 * selectionShortcut.js — "add the selected abstract text as a keyword" shortcut
 * logic (107.md §3). Pure functions, no DOM, no React — the hook
 * (src/frontend/screening/hooks/useAbstractSelectionShortcuts.js) reads the DOM and
 * hands the facts to these two functions, which are what the tests exercise.
 *
 * Shortcuts:  Cmd/Ctrl + I → inclusion keyword     Cmd/Ctrl + E → exclusion keyword
 *
 * `preventDefault()` is the caller's job and MUST happen only after
 * shouldHandleSelectionShortcut returns handled:true — 107.md §3 is explicit that
 * PecanRev must not globally hijack browser shortcuts.
 */
import { normalizeSelectedPhrase } from './keywordNormalize.js';

/** Why a shortcut press was ignored (useful in tests + for future telemetry). */
export const SHORTCUT_REJECT = Object.freeze({
  NO_SHORTCUT: 'no-shortcut',
  MODAL_OPEN: 'modal-open',
  EDITABLE_CONTEXT: 'editable-context',
  OUTSIDE_ABSTRACT: 'selection-outside-abstract',
  EMPTY_SELECTION: 'empty-selection',
});

/**
 * matchesShortcut — which keyword list (if any) this keydown asks for.
 *
 * Cross-browser (107.md §3 "Browser Support"): Safari/macOS reports Cmd as
 * `metaKey`, Windows/Linux report Ctrl as `ctrlKey`, so EITHER satisfies the
 * modifier. `altKey` is rejected outright (Alt+Cmd+I is the browser's own inspector
 * / accent-composition territory). `shiftKey` is ignored — Cmd+Shift+I is a devtools
 * binding on some platforms, but the browser handles that before the page sees it,
 * and rejecting Shift would break selections extended with Shift on a sticky keyboard.
 *
 * @param {{key?:string, metaKey?:boolean, ctrlKey?:boolean, altKey?:boolean}} e
 * @returns {'include'|'exclude'|null}
 */
export function matchesShortcut(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.altKey) return null;
  if (!e.metaKey && !e.ctrlKey) return null;
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  if (key === 'i') return 'include';
  if (key === 'e') return 'exclude';
  return null;
}

/**
 * shouldHandleSelectionShortcut — the full guard chain (107.md §3 "Selection Scope").
 *
 * @param {object} evtLike — anything with key/metaKey/ctrlKey/altKey
 * @param {object} ctx
 * @param {string}  ctx.selectedText            raw window selection text
 * @param {boolean} ctx.selectionInsideAbstract anchor AND focus nodes are inside the abstract element
 * @param {boolean} ctx.editableContext         focus is in an input/textarea/select/contenteditable/.sift-in
 * @param {boolean} ctx.modalOpen               a screening modal/dialog is open
 * @returns {{handled:boolean, list:('include'|'exclude'|null), phrase:string, reason:string}}
 */
export function shouldHandleSelectionShortcut(evtLike, ctx = {}) {
  const list = matchesShortcut(evtLike);
  const miss = reason => ({ handled: false, list: null, phrase: '', reason });
  if (!list) return miss(SHORTCUT_REJECT.NO_SHORTCUT);
  // Order matters: the cheapest, most global guards first, so a shortcut pressed in
  // a dialog or a text field is never even considered for preventDefault().
  if (ctx.modalOpen) return miss(SHORTCUT_REJECT.MODAL_OPEN);
  if (ctx.editableContext) return miss(SHORTCUT_REJECT.EDITABLE_CONTEXT);
  if (!ctx.selectionInsideAbstract) return miss(SHORTCUT_REJECT.OUTSIDE_ABSTRACT);
  const phrase = normalizeSelectedPhrase(ctx.selectedText);
  if (!phrase) return miss(SHORTCUT_REJECT.EMPTY_SELECTION);
  return { handled: true, list, phrase, reason: 'ok' };
}
