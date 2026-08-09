/**
 * selectionShortcut.js — "add the selected abstract text as a keyword" shortcut
 * logic (107.md §3, hardened by 108.md §1). Pure functions, no DOM, no React — the
 * hook (src/frontend/screening/hooks/useAbstractSelectionShortcuts.js) reads the DOM
 * and hands the facts to these functions, which are what the tests exercise.
 *
 * Shortcuts:  Cmd/Ctrl + I → inclusion keyword     Cmd/Ctrl + E → exclusion keyword
 *
 * `preventDefault()` is the caller's job and MUST happen only after
 * shouldHandleSelectionShortcut returns handled:true — 107.md §3 / 108.md §1 are
 * explicit that PecanRev must not globally hijack browser shortcuts, and that the
 * browser keeps its normal behaviour whenever PecanRev cannot actually process the
 * press. That is why `canProcess` (108.md §1 condition 5) is a GUARD here rather
 * than a check the caller runs after the event has already been cancelled.
 */
import { normalizeSelectedPhrase } from './keywordNormalize.js';

/** Why a shortcut press was ignored (useful in tests + for future telemetry). */
export const SHORTCUT_REJECT = Object.freeze({
  NO_SHORTCUT: 'no-shortcut',
  ALREADY_HANDLED: 'already-handled',
  KEY_REPEAT: 'key-repeat',
  IME_COMPOSING: 'ime-composing',
  MODAL_OPEN: 'modal-open',
  EDITABLE_CONTEXT: 'editable-context',
  OUTSIDE_ABSTRACT: 'selection-outside-abstract',
  EMPTY_SELECTION: 'empty-selection',
  NOT_PERMITTED: 'not-permitted',
});

/**
 * matchesShortcut — which keyword list (if any) this keydown asks for.
 *
 * Cross-browser (107.md §3 "Browser Support"): Safari/macOS reports Cmd as
 * `metaKey`, Windows/Linux report Ctrl as `ctrlKey`, so EITHER satisfies the
 * modifier. `altKey` is rejected outright (Alt+Cmd+I is the browser's own inspector
 * / accent-composition territory).
 *
 * 108.md §1 — `shiftKey` is now rejected too. The previous comment here claimed the
 * browser handles Cmd/Ctrl+Shift+I "before the page sees it"; that is false. Chrome
 * and Edge DO dispatch a normal, page-visible keydown for Ctrl/Cmd+Shift+I and then
 * ignore `preventDefault()` because DevTools is a RESERVED accelerator — so claiming
 * the chord produced both a keyword and an open DevTools panel. Ctrl+Shift+E is the
 * same class of bug (Firefox's Network Monitor). A chord PecanRev cannot actually
 * own must never be claimed: Shift+chord is simply not our shortcut.
 *
 * @param {{key?:string, metaKey?:boolean, ctrlKey?:boolean, altKey?:boolean, shiftKey?:boolean}} e
 * @returns {'include'|'exclude'|null}
 */
export function matchesShortcut(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.altKey) return null;
  if (e.shiftKey) return null;
  if (!e.metaKey && !e.ctrlKey) return null;
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  if (key === 'i') return 'include';
  if (key === 'e') return 'exclude';
  return null;
}

/**
 * keyEventRejection — 108.md §1: event STATES that disqualify a press regardless of
 * which chord it carries. Pure (every input is a plain property of the event):
 *   - `defaultPrevented` — a nearer handler already claimed this event (the
 *     manuscript editor's Ctrl/Cmd+I italic runs at React-root bubble time, i.e.
 *     BEFORE any window-bubble listener). Two owners must never both act.
 *   - `repeat` — a held chord would otherwise fire one add (and one preventDefault)
 *     per auto-repeat tick.
 *   - `isComposing` / `keyCode === 229` — an IME composition session owns the
 *     keystrokes; the 229 sentinel covers engines that omit `isComposing`.
 *
 * @param {{defaultPrevented?:boolean, repeat?:boolean, isComposing?:boolean, keyCode?:number}} e
 * @returns {string|null} a SHORTCUT_REJECT code, or null when the event is actionable
 */
export function keyEventRejection(e) {
  if (!e || typeof e !== 'object') return SHORTCUT_REJECT.NO_SHORTCUT;
  if (e.defaultPrevented) return SHORTCUT_REJECT.ALREADY_HANDLED;
  if (e.repeat) return SHORTCUT_REJECT.KEY_REPEAT;
  if (e.isComposing || e.keyCode === 229) return SHORTCUT_REJECT.IME_COMPOSING;
  return null;
}

/**
 * canProcess may be a boolean, a zero-arg predicate (evaluated lazily, only once the
 * cheaper guards have passed) or absent. Absent means "permitted": the guard is
 * additive, so a caller that has not wired a permission source keeps the pre-108
 * behaviour instead of silently losing the shortcut. Only an explicit `false` (or a
 * predicate returning `false`) rejects.
 */
function resolveCanProcess(v) {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'function') return v !== false;
  // A throwing predicate must fail CLOSED (browser keeps its default) rather than
  // throw out of a global keydown listener on every press.
  try { return v() !== false; } catch { return false; }
}

/**
 * shouldHandleSelectionShortcut — the full guard chain (107.md §3 "Selection Scope",
 * 108.md §1 conditions 1-5).
 *
 * @param {object} evtLike — anything with key/metaKey/ctrlKey/altKey/shiftKey plus
 *                           the event-state flags read by keyEventRejection
 * @param {object} ctx
 * @param {string}  ctx.selectedText            raw window selection text
 * @param {boolean} ctx.selectionInsideAbstract anchor AND focus nodes are inside the abstract element
 * @param {boolean} ctx.editableContext         focus is in an input/textarea/select/contenteditable/.sift-in
 * @param {boolean} ctx.modalOpen               a screening modal/dialog is open
 * @param {boolean|(()=>boolean)} [ctx.canProcess] 108.md §1 cond. 5 — PecanRev can
 *        actually act on the phrase (keyword editing permitted). Absent ⇒ permitted.
 * @returns {{handled:boolean, list:('include'|'exclude'|null), phrase:string, reason:string}}
 */
export function shouldHandleSelectionShortcut(evtLike, ctx = {}) {
  const list = matchesShortcut(evtLike);
  const miss = reason => ({ handled: false, list: null, phrase: '', reason });
  if (!list) return miss(SHORTCUT_REJECT.NO_SHORTCUT);
  // Order matters: the cheapest, most global guards first, so a shortcut pressed in
  // a dialog or a text field is never even considered for preventDefault().
  const stateReject = keyEventRejection(evtLike);
  if (stateReject) return miss(stateReject);
  if (ctx.modalOpen) return miss(SHORTCUT_REJECT.MODAL_OPEN);
  if (ctx.editableContext) return miss(SHORTCUT_REJECT.EDITABLE_CONTEXT);
  if (!ctx.selectionInsideAbstract) return miss(SHORTCUT_REJECT.OUTSIDE_ABSTRACT);
  const phrase = normalizeSelectedPhrase(ctx.selectedText);
  if (!phrase) return miss(SHORTCUT_REJECT.EMPTY_SELECTION);
  // Last, so the reject code distinguishes "this WAS a valid abstract selection but
  // PecanRev may not act on it" from "this press was never about the abstract".
  // Duplicate terms and cross-list conflicts are deliberately NOT rejected here:
  // PecanRev responds to those (a note / the move dialog), which IS processing.
  if (!resolveCanProcess(ctx.canProcess)) return miss(SHORTCUT_REJECT.NOT_PERMITTED);
  return { handled: true, list, phrase, reason: 'ok' };
}
