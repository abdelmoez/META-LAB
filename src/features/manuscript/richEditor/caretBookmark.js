/**
 * features/manuscript/richEditor/caretBookmark.js — 120.md §5 (exact-caret
 * citation and cross-reference insertion). The PURE half of the picker-session
 * bookmark: no DOM, no React, so the rule that decides "is this still the same
 * place in the text?" is unit-testable in Node.
 *
 * WHY A BOOKMARK AND NOT A RANGE
 *
 * §5: "Avoid depending on a raw DOM Range if the structured document changes while
 * the picker is open." A DOM Range dies on a remount (the section's mount key
 * carries the generation stamp and the content epoch), on a whole-table
 * replacement, and on a Section-View switch. This editor is a contentEditable over
 * a markdown subset — there is no ProseMirror transaction log to map through — so
 * the stable representation is a LOGICAL one: which top-level block, how far into
 * its text, and what the text immediately either side of that point said.
 *
 * The context strings are what make re-resolution HONEST rather than hopeful. A
 * position that cannot be re-found, or that could be re-found in more than one
 * place, resolves to NOTHING and the caller refuses to insert (§5: "If the original
 * location no longer exists and cannot be resolved safely, show a clear
 * non-destructive message and ask the user to place the caret again. Do not fall
 * back to the beginning of the section.").
 *
 * The DOM half — walking to the block, mapping a character offset through a
 * TreeWalker, installing the selection — lives in RichSectionEditor.jsx and calls
 * these two functions for every decision it makes.
 */

/** How much text either side of the caret is remembered. Long enough to be unique
    inside a paragraph of scientific prose, short enough that an edit a sentence
    away does not invalidate it. */
export const CARET_CONTEXT_CHARS = 24;

/**
 * Snapshot the caret's position inside ONE block's text.
 * @param {string} text   the block's full text content
 * @param {number} offset the caret's character offset within it
 * @returns {{ charOffset:number, before:string, after:string }}  Pure.
 */
export function logicalContext(text, offset, n = CARET_CONTEXT_CHARS) {
  const s = String(text == null ? '' : text);
  const off = Math.max(0, Math.min(Math.floor(Number(offset) || 0), s.length));
  return {
    charOffset: off,
    before: s.slice(Math.max(0, off - n), off),
    after: s.slice(off, off + n),
  };
}

/**
 * Re-resolve a snapshot against the block's CURRENT text.
 *
 * Three outcomes, in falling order of certainty:
 *   1. the remembered offset still has the remembered text either side of it — the
 *      overwhelmingly common case (nothing changed, or everything that changed was
 *      in another block);
 *   2. the surrounding text has MOVED (something was typed earlier in the same
 *      paragraph) but the context appears exactly ONCE — the position maps to it;
 *   3. anything else — gone, or ambiguous — is `null`, and the caller must refuse.
 *
 * Case 3 includes the deliberately unforgiving one: an EMPTY context (the caret sat
 * in an empty block) only ever re-resolves into a block that is still empty.
 * Otherwise every empty context would match every block at offset 0, which is
 * exactly the "insert at position zero" behaviour §5 forbids.
 *
 * @returns {number|null} a character offset in `text`, or null.  Pure.
 */
export function resolveContext(text, logical) {
  if (!logical) return null;
  const s = String(text == null ? '' : text);
  const before = String(logical.before == null ? '' : logical.before);
  const after = String(logical.after == null ? '' : logical.after);
  const want = Math.floor(Number(logical.charOffset) || 0);
  /* The empty context is checked FIRST and on its own. Left to the general rule it
     would "fit" at offset 0 of EVERY block — two empty strings always match — and
     that is literally the position-zero insertion §5 exists to remove. So: a caret
     that sat in an empty block re-resolves only into a block that is still empty. */
  const needle = `${before}${after}`;
  if (!needle) return s.length === 0 ? 0 : null;
  const fits = (i) => i >= 0 && i <= s.length
    && s.slice(Math.max(0, i - before.length), i) === before
    && s.slice(i, i + after.length) === after;
  if (fits(want)) return want;
  const first = s.indexOf(needle);
  if (first < 0) return null;
  if (s.indexOf(needle, first + 1) >= 0) return null;   // ambiguous → refuse, never guess
  return first + before.length;
}

export default { CARET_CONTEXT_CHARS, logicalContext, resolveContext };
