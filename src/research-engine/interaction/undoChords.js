/**
 * undoChords.js — 108.md §2, §7, §24. The pure key predicates and context gate for
 * the project-wide Undo/Redo chords, kept out of the React layer so the exact
 * modifier matrix is unit-tested without a DOM.
 *
 * THE MATRIX
 *   Undo   Ctrl+Z (Windows/Linux) · Cmd+Z (macOS)          — Shift and Alt EXCLUDED
 *   Redo   Ctrl+Shift+Z · Cmd+Shift+Z                      — the required chord (§2)
 *          Ctrl+Y                                          — preserved as the extra
 *          Windows redo 108.md §2 permits. Cmd+Y is NOT claimed: on macOS ⌘Y is
 *          Safari's History window and nothing in this app binds it.
 *
 * WHY SHIFT IS EXCLUDED FROM THE UNDO CHORD rather than merely ignored: this is the
 * same class of bug 108.md §1 reports for Ctrl+Shift+I. `SearchBuilderTab`'s
 * outgoing listener already rejected Shift for exactly this reason, which is what
 * left Ctrl+Shift+Z free to become redo.
 *
 * ── THE `when` GATE (108.md §7 + §24) ────────────────────────────────────────
 * `historyShortcutAllowed(ctx)` is the shared context half of every history
 * binding's `when`. It refuses:
 *   - an EDITABLE target — native text undo must win while the user is typing
 *     `epilepsyy` into a field (§7). ctx.editableTarget is computed from the
 *     canonical predicate (research-engine/interaction/editableTarget.js), which
 *     covers inputs, textareas, selects, contentEditable AND role=textbox — the
 *     manuscript editor;
 *   - an OPEN MODAL — tier 1 of the §24 precedence model owns the keyboard.
 * It deliberately does NOT check availability: each binding adds its own
 * `canUndo`/`canRedo` term, because "is there anything to undo HERE" is owned by
 * the history provider for most scopes and by the Search Builder's own stack for
 * the search scope. That term is mandatory: ShortcutProvider preventDefaults on a
 * truthy `run()` return, and an async undo returns a Promise (always truthy), so a
 * binding that claimed Ctrl+Z with an empty history would swallow the browser's own
 * undo for nothing — 108.md §26's "no history → native/no-op behaviour".
 *
 * Pure: no DOM, no React, no imports. Every function takes an event-LIKE object.
 */

const isObj = (v) => !!v && typeof v === 'object';

/** Ctrl/Cmd+Z with no Shift and no Alt. */
export function isUndoChord(e) {
  if (!isObj(e)) return false;
  if (e.altKey) return false;
  if (e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  const k = String(e.key || '');
  return k === 'z' || k === 'Z';
}

/**
 * Ctrl/Cmd+Shift+Z, or the legacy Windows Ctrl+Y (108.md §2).
 *
 * 109.md §16 — the Ctrl+Y alias became the `interaction.ctrlYRedoAlias` Ops setting,
 * so it is now an OPTION rather than an unconditional second chord. The option
 * DEFAULTS TO TRUE here, which keeps this pure predicate byte-identical to v4.13.0
 * for every caller that does not pass one; the binding site passes the configured
 * value. Ctrl/Cmd+Shift+Z is unconditional and can never be turned off.
 *
 * @param {object} e
 * @param {{ctrlYAlias?: boolean}} [opts]
 */
export function isRedoChord(e, opts) {
  if (!isObj(e)) return false;
  if (e.altKey) return false;
  const ctrlYAlias = isObj(opts) && opts.ctrlYAlias !== undefined ? !!opts.ctrlYAlias : true;
  const k = String(e.key || '');
  if ((k === 'z' || k === 'Z') && (e.ctrlKey || e.metaKey) && e.shiftKey) return true;
  if (ctrlYAlias && (k === 'y' || k === 'Y') && e.ctrlKey && !e.metaKey && !e.shiftKey) return true;
  return false;
}

/**
 * historyShortcutAllowed(ctx) → boolean — the context half of every history
 * binding's `when`. See the header: editable target and modal state only.
 */
export function historyShortcutAllowed(ctx) {
  if (!isObj(ctx)) return false;
  if (ctx.editableTarget) return false;
  if (ctx.modalOpen) return false;
  return true;
}

/**
 * SEARCH_SCOPE_REDO — 108.md §2, documented limitation.
 *
 * The Search Builder scope delegates undo to searchBuilder/undoStack.js, whose 17
 * entry kinds record INVERSE patches only; the forward patch is never captured, so
 * there is nothing to replay. Redo is therefore NOT offered in the search scope
 * this round: no redo binding is registered for it, the global redo binding finds
 * an empty redo stack for `search` and declines, and Ctrl/Cmd+Shift+Z falls through
 * to the browser untouched instead of silently doing nothing.
 */
export const SEARCH_SCOPE_REDO = false;

export default {
  isUndoChord, isRedoChord, historyShortcutAllowed, SEARCH_SCOPE_REDO,
};
