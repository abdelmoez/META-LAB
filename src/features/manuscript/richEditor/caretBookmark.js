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
 * 121.md §4 — NBSP-TOLERANT CONTEXT.
 *
 * The DOM and the markdown disagree about one character. A chip insertion leaves a
 * `&nbsp;` behind (U+00A0), and every serializer pass folds it back to a plain
 * space (mdDom.js `unescapeEntities`, and `walkBlocks`/`emitBlock`'s
 * `.replace(/ /g, ' ')`). So a bookmark taken in the LIVE dom remembered
 * "…intervention. " while the block re-rendered from markdown says
 * "…intervention. " — the same position, spelled differently, and the strict
 * comparison refused it. Post-remount end-of-paragraph bookmarks therefore surfaced
 * as the CARET_LOST notice instead of resolving (audit repro B2).
 *
 * Normalising ONE character is not "over-normalising": nbsp and space are the same
 * text position in this model by definition of the serializer. Everything else —
 * case, punctuation, interior runs of whitespace — is still compared exactly, and
 * the ambiguity scan below still refuses rather than guesses.
 */
const nbspToSpace = (s) => String(s == null ? '' : s).replace(/ /g, ' ');

/**
 * Snapshot the caret's position inside ONE block's text.
 * @param {string} text   the block's full text content
 * @param {number} offset the caret's character offset within it
 * @returns {{ charOffset:number, before:string, after:string }}  Pure.
 */
export function logicalContext(text, offset, n = CARET_CONTEXT_CHARS) {
  const s = nbspToSpace(text);
  const off = Math.max(0, Math.min(Math.floor(Number(offset) || 0), s.length));
  return {
    charOffset: off,
    before: s.slice(Math.max(0, off - n), off),
    after: s.slice(off, off + n),
  };
}

/**
 * 121.md §4 — the NEIGHBOUR half of an EMPTY-block snapshot (closes the documented
 * 120 limitation F17, docs/editor-engine-120.md item 10).
 *
 * An empty context is the one snapshot that says nothing about WHERE it was: every
 * empty block matches it. `resolveContext` already refuses to resolve it into a
 * block that has text, but it cannot tell one empty paragraph from another — so
 * after a remount (which DROPS un-persisted empty paragraphs: a blank markdown line
 * renders nothing) the unique-block scan deterministically found the §3 trailing
 * affordance and the citation landed at the END OF THE SECTION.
 *
 * The repair is to remember the two things that DO distinguish empty blocks: what
 * the previous block's text ends with and what the next block's text starts with.
 * `null` means "there is no such neighbour" and is a real, comparable answer — it is
 * exactly what tells the trailing affordance (nothing after it) apart from an empty
 * paragraph in the middle of a section.
 *
 * The tail/head are trimmed and nbsp-folded for the same reason the main context is:
 * the serializer trims every block (mdDom `walkBlocks`), so an untrimmed tail would
 * refuse every post-remount restore.
 */
export function neighborContext(prevText, nextText, n = CARET_CONTEXT_CHARS) {
  const tail = (s) => nbspToSpace(s).trim().slice(-n);
  const head = (s) => nbspToSpace(s).trim().slice(0, n);
  return {
    prevTail: prevText == null ? null : tail(prevText),
    nextHead: nextText == null ? null : head(nextText),
  };
}

/** Does this snapshot carry the 121 neighbour fields at all? A bookmark taken by an
    older build (held across a hot update, or handed in by the workspace session)
    has neither, and must degrade to the pre-121 behaviour rather than refuse. */
export function hasNeighborContext(logical) {
  if (!logical || typeof logical !== 'object') return false;
  const has = (k) => Object.prototype.hasOwnProperty.call(logical, k);
  return has('prevTail') || has('nextHead');
}

/**
 * Do this block's neighbours still say what they said when the bookmark was taken?
 * TRUE for any snapshot without neighbour fields (nothing to verify — see above).
 * Pure.
 */
export function neighborsMatch(logical, prevText, nextText) {
  if (!hasNeighborContext(logical)) return true;
  const want = neighborContext(prevText, nextText);
  const got = (v) => (v === undefined ? null : v);
  return want.prevTail === got(logical.prevTail) && want.nextHead === got(logical.nextHead);
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
  const s = nbspToSpace(text);
  const before = nbspToSpace(logical.before);
  const after = nbspToSpace(logical.after);
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
  /* 121.md §4 — THE END-OF-BLOCK TRIM. A caret at the very end of a paragraph
     remembers `after:''` and a `before` that may end in whitespace — most often the
     single nbsp a chip insertion leaves behind. The serializer TRIMS every block
     (mdDom `walkBlocks`/`emitBlock`), so after a remount that trailing space is
     simply gone and neither the remembered offset nor the exact needle can be found:
     "cite, then cite again after a reload" refused. Anchored to `endsWith`, so it
     only ever resolves to the ONE position it describes — the end of this block —
     and never becomes a second, looser way to match somewhere in the middle. */
  if (!after && /\s$/.test(before)) {
    const trimmed = before.replace(/\s+$/, '');
    if (trimmed && s.endsWith(trimmed)) return s.length;
  }
  const first = s.indexOf(needle);
  if (first < 0) return null;
  if (s.indexOf(needle, first + 1) >= 0) return null;   // ambiguous → refuse, never guess
  return first + before.length;
}

export default {
  CARET_CONTEXT_CHARS,
  logicalContext,
  resolveContext,
  neighborContext,
  hasNeighborContext,
  neighborsMatch,
};
