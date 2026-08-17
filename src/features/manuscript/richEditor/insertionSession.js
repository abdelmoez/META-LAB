/**
 * features/manuscript/richEditor/insertionSession.js — 121.md §4:168, "If citations,
 * cross-references and symbols currently use different insertion logic, create or
 * strengthen a shared, editor-safe insertion utility that preserves and restores the
 * active selection consistently. Do not duplicate fragile caret-handling logic across
 * separate features."
 *
 * This is the PURE half of that utility, in the caretBookmark.js/mdDom.js tradition:
 * no React, no DOM, Node-testable. It owns two things that were previously spelled
 * out again at every call site:
 *
 *   1. THE SESSION LIFECYCLE — begin (bookmark the caret before a popover can take
 *      focus) / end (a cancel clears the bookmark and touches nothing) /
 *      withBookmarkedCaret (route the insert to the BOOKMARKED section's editor, and
 *      refuse honestly when the position cannot be re-found). The workspace keeps
 *      only the ref that holds the session and the callbacks that know the app.
 *
 *   2. THE PAYLOAD POLICY — what an insertion IS, per kind. This is the reason the
 *      utility exists rather than a shared function name: a citation chip and a
 *      symbol are inserted at the same caret by the same transaction but must NOT
 *      carry the same payload.
 *
 *        {kind:'chip'}  an ELEMENT. It gets the sacrificial <span> wrapper (Blink's
 *                       execCommand('insertHTML') unwraps the outermost element of
 *                       the fragment inside an <li>, and the chip arrived as literal
 *                       text — 120.md §5) plus a configurable trailing separator,
 *                       `&nbsp;` by default, which is the gap the NEXT citation
 *                       groups into (adjacentCiteChip).
 *
 *        {kind:'text'}  ORDINARY CHARACTERS. No wrapper — an element around a symbol
 *                       cannot round-trip through htmlToMd, which serializes only
 *                       known constructs and would drop it — and NO trailing nbsp:
 *                       the serializer folds nbsp to a space and trims it at a block
 *                       end, so a symbol that inherited the chip convention would
 *                       inherit its post-remount refusal bug with it. The plan is
 *                       carried out with execCommand('insertText') (see
 *                       insertPlainText), which takes the string verbatim — HTML
 *                       escaping belongs to the html transport and never to this one.
 *
 * The DOM half — focus, the caret normalisations, execCommand — stays in
 * RichSectionEditor.jsx, which is the only place allowed to touch the editing host.
 */

/** The `&nbsp;` a chip leaves behind, so the next citation has a gap to group into. */
export const CHIP_SEPARATOR = '&nbsp;';

/** 120.md §5 — the sacrificial wrapper that keeps an inline chip an ELEMENT through
    Blink's insertHTML-inside-a-list-item unwrap. ONE definition, so the insert path
    and the three chip-mutation paths (group, remove one id, relink) can never drift. */
export const wrapInlineChipHtml = (chipHtml) => `<span>${chipHtml}</span>`;

/**
 * Turn a payload into the ONE transaction the editor should run.
 *
 * @param {{kind:'chip', html:string, separator?:string}
 *        |{kind:'text', text:string}} payload
 * @returns {{via:'html', html:string}|{via:'text', text:string}|null}  Pure.
 */
export function insertionPlan(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.kind === 'chip') {
    const html = String(payload.html == null ? '' : payload.html);
    if (!html) return null;
    const sep = payload.separator == null ? CHIP_SEPARATOR : String(payload.separator);
    return { via: 'html', html: `${wrapInlineChipHtml(html)}${sep}` };
  }
  if (payload.kind === 'text') {
    const text = String(payload.text == null ? '' : payload.text);
    if (!text) return null;
    return { via: 'text', text };
  }
  return null;
}

/**
 * 121.md §4 — the DEV-ONLY POSTCONDITION. "Insert the citation or cross-reference at
 * the precise I-beam cursor position … Do not automatically move the insertion to the
 * beginning or end of the section."
 *
 * After the transaction, the inserted node's LINE BLOCK must be the line block the
 * bookmark named. Everything that made §4's family of defects invisible was that the
 * insertion succeeded — in the wrong block — and nothing anywhere checked. This is
 * the check, expressed purely so the caller only has to hand in the two elements it
 * already has. Returns a message when the invariant broke, or null.
 */
export function insertionPostconditionProblem(bookmarkedLine, insertedLine) {
  if (!bookmarkedLine || !insertedLine) return null;      // nothing to compare — silent
  if (bookmarkedLine === insertedLine) return null;
  return '121.md §4 — insertion landed in a DIFFERENT line block than the bookmarked caret';
}

/**
 * The session state machine. `store` is the caller's own mutable holder (a React ref
 * in the workspace), so this module keeps no module-level state and one page can hold
 * as many independent sessions as it has editors.
 *
 * @param {object} deps
 *   store          {current:{sectionId,bm}|null} — the live session holder
 *   caretSectionId ()=>string          which section the caret is in RIGHT NOW
 *   apiFor         (sectionId)=>api    that section's editor handle
 *   getApi         ()=>api             the no-session fallback (a caller that inserts
 *                                      without opening a picker)
 *   isLocked       (sectionId)=>bool   the bookmarked section's lock
 *   targetLocked   ()=>bool            the no-session lock check
 *   onRefusal      ()=>void            the honest notice (§5: never insert elsewhere)
 *   onBegin        ()=>void            clear any stale notice
 */
export function createInsertionSession(deps) {
  const d = deps || {};
  const store = d.store || { current: null };
  const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : undefined);

  /** A picker is opening: bookmark the caret NOW, before the popover, its list or its
      autoFocus'd search input can take focus (WebKit drops the document selection the
      moment focus reaches a control). */
  const begin = () => {
    call(d.onBegin);
    const sectionId = call(d.caretSectionId);
    const api = call(d.apiFor, sectionId) || call(d.getApi);
    const bm = api && api.saveCaretBookmark ? api.saveCaretBookmark() : null;
    store.current = bm ? { sectionId, bm } : null;
    return store.current;
  };

  /** The picker closed without inserting: clear the bookmark and touch nothing else
      (§5 "Canceling the picker must clear the saved bookmark without modifying the
      manuscript"). */
  const end = () => {
    const s = store.current;
    store.current = null;
    if (!s) return;
    const api = call(d.apiFor, s.sectionId);
    if (api && api.clearCaretBookmark) api.clearCaretBookmark();
  };

  /** An item was chosen: route to the BOOKMARKED SECTION's editor — never through the
      scroll-driven active handle — and insert only if that editor can put the caret
      back. When it cannot, NOTHING is inserted anywhere and the notice says so. */
  const withBookmarkedCaret = (run) => {
    const s = store.current;
    store.current = null;
    if (s) {
      // The bookmark names the section, so the lock check names it too.
      if (call(d.isLocked, s.sectionId)) return;
      const api = call(d.apiFor, s.sectionId);
      if (api && api.restoreCaretBookmark && api.restoreCaretBookmark(s.bm)) { run(api); return; }
      call(d.onRefusal);
      return;
    }
    /* No session at all — a caller that inserts without opening a picker. The
       pre-120 behaviour is exactly right there: the caret's own editor, guarded on
       the section the insert will LAND in rather than on whatever is scrolled into
       view. */
    if (call(d.targetLocked)) return;
    const api = call(d.getApi);
    if (api) run(api);
  };

  return { begin, end, withBookmarkedCaret, peek: () => store.current };
}

export default {
  CHIP_SEPARATOR,
  wrapInlineChipHtml,
  insertionPlan,
  insertionPostconditionProblem,
  createInsertionSession,
};
