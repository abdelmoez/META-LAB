/**
 * features/manuscript/richEditor/RichSectionEditor.jsx — 65.md (MS-CORE). The
 * Word-like contentEditable surface over the pure mdDom converters. The user only
 * ever sees FORMATTED content (real headings/bold/lists/tables/citation chips);
 * markdown exists solely as the persistence format.
 *
 * Cursor safety: the DOM is rendered from props exactly ONCE per `key` — the
 * parent remounts the editor (key = section identity + lastGeneratedAt) instead
 * of re-rendering HTML into a surface the user is typing in. Every input event
 * serializes DOM → markdown and hands it to the parent, which debounces through
 * the existing useManuscript queueEdit path.
 *
 * Commands go through document.execCommand (keeps native undo/redo) with a
 * Range-API fallback when a command is unsupported. Paste is sanitized down to
 * the markdown subset (Word/Docs HTML → htmlToMd → mdToHtml).
 *
 * 101.md adds two things on top of that, both deliberately small:
 *   §4/§33  fact chips refresh IN PLACE from `facts`, using the same effect pattern
 *           as cite/asset renumbering. A project change therefore updates the
 *           manuscript without a remount, without touching prose, and without
 *           moving the caret of someone mid-sentence.
 *   §6      `showChanges` sets one attribute on the root. Nothing else. Every
 *           overlay pixel lives in CSS behind [data-show-changes="true"], so the
 *           document is byte-identical in both modes and turning the toggle off
 *           leaves a genuinely clean manuscript.
 */
import { useRef, useState, useEffect, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { C, btnS, inp } from '../../../frontend/workspace/ui/styles.js';
import { alpha } from '../../../frontend/theme/tokens.js';
import {
  mdToHtml, htmlToMd, escapeHtml, citeChipHtml, citeChipLabel, citeChipAria,
  assetChipHtml, assetChipLabel, assetChipAria,
  factChipText, factOf, stripInlineMd,
  // 120.md r2 — the caption↔table pairing the serialize-time repair verifies against.
  captionTablePairs,
  CITE_CHIP_CLASS, ASSET_CHIP_CLASS, FACT_CHIP_CLASS, INPUT_CHIP_CLASS,
  TABLE_CAPTION_CLASS, TABLE_CAPTION_NUM_CLASS, TABLE_CAPTION_TITLE_CLASS,
  // 119.md §5 — the uploaded-figure block.
  FIGURE_BLOCK_CLASS, FIGURE_IMG_CLASS, FIGURE_CAPTION_CLASS,
  FIGURE_CAPTION_NUM_CLASS, FIGURE_CAPTION_TITLE_CLASS,
} from './mdDom.js';
// 117.md §35 — one chip may carry several reference ids; the parser is shared with
// the engine so the editor and the export can never disagree about a token.
import { parseCiteIds } from '../../../research-engine/manuscript/citations.js';
// 116.md §59-§66 — pure structural table ops; the editor only ever applies them
// by whole-table replacement through the execCommand/insertHtml path below.
// 117.md §4 — a new table is inserted WITH its caption marker (identity + title).
import { makeCaptionedTableMd, applyTableOp } from './tableOps.js';
import {
  mintManualTableId, formatCaptionPrefix, tableCaptionLine,
  // 119.md §5 — the uploaded-figure marker grammar.
  figureCaptionLine,
} from '../../../research-engine/manuscript/refTokens.js';
/* 120.md §7 — the PURE half of the Office-table import (identity minting, the Word
   caption harvest, the TSV grid test, the duplicate re-mint and the figure-marker
   rule). It is a separate module so the whole pipeline is unit-testable in Node —
   the editor below only supplies the clipboard and the one insertion call. */
import {
  transformPastedMd, hasPipeTableBlock, tsvToPipeTable,
  // 120.md r2 — the shape gate the HTML rung was missing (a 1×1 table is not a table).
  flattenDegenerateTables,
} from './pasteTransform.js';
/* 120.md §5 — the PURE half of the picker-session caret bookmark: the rule that
   decides whether a remembered position is still the same place in the text.
   121.md §4 — plus the NEIGHBOUR half, which is what finally tells one empty
   paragraph from another (see caretLogicalOf / rangeFromLogical below). */
import {
  logicalContext, resolveContext, neighborContext, neighborsMatch,
} from './caretBookmark.js';
/* 121.md §4:168 — the ONE shared, editor-safe insertion utility. Citations,
   cross-references and symbols converge on it: same session, same caret
   normalisations, same single transaction, different PAYLOAD POLICY. */
import {
  insertionPlan, wrapInlineChipHtml, insertionPostconditionProblem,
} from './insertionSession.js';
// 121.md §1 — the Symbols picker (data-driven catalogue + grid popover).
import { SymbolPicker } from './SymbolPicker.jsx';
import { SHOW_CHANGES_CSS, indexFactChanges, factChipTitle } from '../showChanges.js';
// 117.md §44 — an overlay that consumes an Escape owns the fullscreen exit it causes.
import { markOverlayEscape } from '../../../frontend/focus/overlayEscapeLatch.js';

/* 121.md §4 — the insertion postcondition is a DEVELOPMENT check: it costs two
   Range reads per insertion and its only output is a console warning, so it runs
   where a developer can act on it and never in a researcher's session. Read
   defensively because this module is also imported by Node unit tests. */
const DEV_INSERT_CHECKS = (() => {
  try { return !!(import.meta && import.meta.env && import.meta.env.DEV); } catch { return false; }
})();

/* Page-scoped CSS: the paper is LITERAL white in both themes (a printed page),
   so the ink colors are fixed — theme tokens on purpose only OUTSIDE the page. */
export const RICH_EDITOR_CSS = `
.ms-paper{background:#ffffff;color:#1c2330;border:1px solid rgba(15,23,42,0.10);border-radius:6px;
  box-shadow:0 1px 2px rgba(15,23,42,0.10),0 14px 34px rgba(15,23,42,0.12);}
/* 121.md §1 — "Provide appropriate font fallbacks so symbols render consistently in
   the editor and exported documents." Georgia has no glyph for most of the symbol
   catalogue (∮ ⊆ ⇔ …), so the browser fell through to whatever the platform chose
   and the same manuscript looked different on two machines. The symbol faces are
   APPENDED to the one page font stack: per-glyph fallback means every letter of
   ordinary prose still renders in Georgia, and only the codepoints Georgia cannot
   draw reach the symbol faces. The picker grid uses the same stack (SYMBOL_FONT_STACK
   below) so the preview matches the document. The docx path needs nothing — TextRuns
   carry the characters unfiltered and Word does its own per-glyph fallback — but
   editor-and-Word GLYPH APPEARANCE is not promised to be identical. */
.ms-page-body{font-family:Georgia,'Times New Roman','Segoe UI Symbol','Noto Sans Symbols 2',serif;font-size:14.5px;line-height:1.8;color:#1c2330;}
.ms-rich{outline:none;min-height:340px;caret-color:#1c2330;}
.ms-rich:empty::before{content:attr(data-placeholder);color:#98a1b3;font-style:italic;pointer-events:none;}
.ms-page-body h2{font-size:1.3em;font-weight:700;line-height:1.35;margin:1.05em 0 0.45em;}
.ms-page-body h3{font-size:1.12em;font-weight:700;line-height:1.35;margin:0.95em 0 0.4em;}
.ms-page-body h4{font-size:1em;font-weight:700;font-style:italic;margin:0.85em 0 0.35em;}
.ms-page-body p{margin:0 0 0.85em;}
.ms-page-body ul,.ms-page-body ol{margin:0 0 0.85em;padding-left:1.7em;}
.ms-page-body li{margin:0 0 0.25em;}
.ms-page-body table{border-collapse:collapse;width:100%;margin:0 0 1em;font-size:0.92em;}
.ms-page-body th,.ms-page-body td{border:1px solid #cbd2dc;padding:5px 9px;text-align:left;vertical-align:top;}
.ms-page-body th{background:#f4f6f9;font-weight:700;}
.ms-page-body code{font-family:'IBM Plex Mono',monospace;font-size:0.88em;background:#f4f6f9;
  border:1px solid #e2e6ee;border-radius:4px;padding:0 4px;}
.ms-page-body a{color:#2450b3;text-decoration:underline;}
/* 117.md §38 — the citation chip is INTERACTIVE (hover preview + action menu), so
   it reads as something you can act on: pointer cursor, hover/focus affordances,
   exactly like the cross-reference chip. */
.ms-page-body .${CITE_CHIP_CLASS}{display:inline-block;background:#e8edff;color:#3448c5;border:1px solid #c3cdf5;
  border-radius:10px;padding:0 6px;margin:0 1px;font:600 10.5px/1.7 'IBM Plex Sans',sans-serif;
  vertical-align:baseline;cursor:pointer;white-space:nowrap;}
.ms-page-body .${CITE_CHIP_CLASS}:hover{background:#dae2ff;}
.ms-page-body .${CITE_CHIP_CLASS}:focus-visible{outline:2px solid #3448c5;outline-offset:1px;}
/* 117.md §39 — a citation whose reference is gone. Same never-colour-alone rule as
   the broken cross-reference: the label itself says "?" and the border is dashed. */
.ms-page-body .${CITE_CHIP_CLASS}[data-cite-broken="true"]{background:#fdecec;color:#a32020;
  border:1px dashed #dda0a0;}
.ms-page-body .${CITE_CHIP_CLASS}[data-cite-broken="true"]:hover{background:#fadada;}
.ms-page-body .${CITE_CHIP_CLASS}[data-cite-broken="true"]:focus-visible{outline-color:#a32020;}
.ms-page-body .${ASSET_CHIP_CLASS}{display:inline-block;background:#eaf6ef;color:#1e7a46;border:1px solid #bfe3cd;
  border-radius:10px;padding:0 6px;margin:0 1px;font:600 10.5px/1.7 'IBM Plex Sans',sans-serif;
  vertical-align:baseline;cursor:pointer;white-space:nowrap;}
.ms-page-body .${ASSET_CHIP_CLASS}:hover{background:#dcefe4;}
.ms-page-body .${ASSET_CHIP_CLASS}:focus-visible{outline:2px solid #1e7a46;outline-offset:1px;}
/* 117.md §11 — a reference whose target no longer exists. It must be impossible to
   mistake for a working one, and the signal cannot be colour alone (print, high
   contrast, colour blindness): the label itself says "(deleted)" and the border is
   dashed. Clicking it opens Relink / Remove — the fix is one action away. */
.ms-page-body .${ASSET_CHIP_CLASS}[data-asset-broken="true"]{background:#fdecec;color:#a32020;
  border:1px dashed #dda0a0;}
.ms-page-body .${ASSET_CHIP_CLASS}[data-asset-broken="true"]:hover{background:#fadada;}
.ms-page-body .${ASSET_CHIP_CLASS}[data-asset-broken="true"]:focus-visible{outline-color:#a32020;}

/* 117.md §4/§8 — the manual-table caption. A caption is NOT prose: it uses the UI
   sans face, sits tight above its table, and its number is derived (never typed).
   Only the title region is editable, so the researcher edits meaning and the
   template owns the rest. */
.ms-page-body .${TABLE_CAPTION_CLASS}{font:500 12.5px/1.55 'IBM Plex Sans',sans-serif;color:#1c2330;
  margin:0 0 5px;}
.ms-page-body .${TABLE_CAPTION_NUM_CLASS}{font-weight:700;color:#1e7a46;margin-right:6px;white-space:nowrap;
  user-select:none;}
.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}{outline:none;display:inline;border-radius:3px;padding:0 2px;}
.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}:empty::before{content:attr(data-placeholder);color:#98a1b3;
  font-style:italic;}
/* 119.md §2 — an EMPTY title is a zero-width INLINE editing island nested inside a
   contenteditable="false" caption, and WebKit cannot derive a caret from a click on
   such a box: focus lands on the span, but the typing goes nowhere (reproduced in
   Playwright WebKit; identical steps type fine in Blink and Gecko). Giving the empty
   state real caret geometry is one half of the fix — the delegated caret placement in
   onCaptionMouseDown below is the other half, and neither one sniffs a user agent.
   Scoped to :empty so a title with text keeps display:inline and still wraps inside
   the caption line like the prose it is. */
.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}:empty{display:inline-block;min-width:4px;}
.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}:hover{background:rgba(30,122,70,0.07);}
.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}:focus{background:rgba(30,122,70,0.12);}
.ms-page-body .${TABLE_CAPTION_CLASS}[data-tblcap-current="true"]{box-shadow:0 0 0 2px rgba(30,122,70,0.40);
  border-radius:4px;}

/* 119.md §5 — the uploaded-figure BLOCK. Same island contract as the table
   caption: only the title region is editable, the number is derived, and the
   picture itself can never be typed into. The caption sits UNDER the picture
   (biomedical convention: table titles above, figure captions below). */
.ms-page-body .${FIGURE_BLOCK_CLASS}{margin:14px 0;display:flex;flex-direction:column;gap:5px;}
.ms-page-body .${FIGURE_BLOCK_CLASS}[data-fig-align="center"]{align-items:center;}
.ms-page-body .${FIGURE_BLOCK_CLASS}[data-fig-align="left"]{align-items:flex-start;}
.ms-page-body .${FIGURE_BLOCK_CLASS}[data-fig-align="right"]{align-items:flex-end;}
.ms-page-body .${FIGURE_IMG_CLASS}{max-width:100%;height:auto;display:block;border-radius:3px;
  background:#f4f6f9;}
.ms-page-body .${FIGURE_IMG_CLASS}[data-fig-missing="true"]{display:block;width:100%;padding:22px 12px;
  font:500 12px/1.5 'IBM Plex Sans',sans-serif;color:#a32020;background:#fdf2f2;border:1px dashed #e0a3a3;
  text-align:center;border-radius:4px;}
.ms-page-body .${FIGURE_CAPTION_CLASS}{font:500 12.5px/1.55 'IBM Plex Sans',sans-serif;color:#1c2330;
  width:100%;}
.ms-page-body .${FIGURE_CAPTION_NUM_CLASS}{font-weight:700;color:#1e7a46;margin-right:6px;white-space:nowrap;
  user-select:none;}
.ms-page-body .${FIGURE_CAPTION_TITLE_CLASS}{outline:none;display:inline;border-radius:3px;padding:0 2px;}
.ms-page-body .${FIGURE_CAPTION_TITLE_CLASS}:empty::before{content:attr(data-placeholder);color:#98a1b3;
  font-style:italic;}
/* 119.md §2 (same WebKit caret geometry fix the table title needed). */
.ms-page-body .${FIGURE_CAPTION_TITLE_CLASS}:empty{display:inline-block;min-width:4px;}
.ms-page-body .${FIGURE_CAPTION_TITLE_CLASS}:hover{background:rgba(30,122,70,0.07);}
.ms-page-body .${FIGURE_CAPTION_TITLE_CLASS}:focus{background:rgba(30,122,70,0.12);}
.ms-page-body .${FIGURE_BLOCK_CLASS}[data-figcap-current="true"]{box-shadow:0 0 0 2px rgba(30,122,70,0.40);
  border-radius:4px;}
/* Drag-and-drop target feedback (119.md §5 "Drag and drop"). */
.ms-rich[data-fig-drop="true"]{outline:2px dashed #1e7a46;outline-offset:-4px;background:rgba(30,122,70,0.04);}
/* 101.md §6 — the fact chip is deliberately NOT a chip to look at. It is an element
   only so a project-derived value stays atomic and caret-safe; visually it must be
   indistinguishable from the prose around it, or "turn Show Changes off → completely
   clean manuscript" would be a half-truth. Everything is reset to inherit, so a
   future global chip rule cannot accidentally start decorating facts either. All of
   its paint lives in SHOW_CHANGES_CSS, behind [data-show-changes="true"]. */
.ms-page-body .${FACT_CHIP_CLASS}{background:none;border:0;border-radius:0;padding:0;margin:0;
  color:inherit;font:inherit;letter-spacing:inherit;text-decoration:none;box-shadow:none;
  display:inline;white-space:normal;cursor:inherit;}

/* 102.md §4 — an unresolved manual field must be "noticeable enough that users
   understand they require manual input, but not visually distracting". So: the
   prose font is kept (this is draft manuscript text, not a widget), and the only
   decoration is a soft tint plus a dotted underline. The dotted underline is what
   carries the meaning when colour is unavailable — printouts, high-contrast mode,
   and colour-blind readers all still see "this is unfinished". */
.ms-page-body .${INPUT_CHIP_CLASS}{font:inherit;color:#8a5a00;background:rgba(214,158,46,0.10);
  border-bottom:1px dotted rgba(138,90,0,0.75);border-radius:2px;padding:0 2px;
  cursor:pointer;white-space:normal;}
.ms-page-body .${INPUT_CHIP_CLASS}:hover{background:rgba(214,158,46,0.18);}
/* The current navigation target, so "next field" has somewhere visible to land. */
.ms-page-body .${INPUT_CHIP_CLASS}[data-input-current="true"]{background:rgba(214,158,46,0.28);
  box-shadow:0 0 0 2px rgba(214,158,46,0.45);}
.ms-page-body .${INPUT_CHIP_CLASS}:focus-visible{outline:2px solid #8a5a00;outline-offset:1px;}
/* A field the PROJECT will fill (101.md §17: typing here would fabricate
   methodology). Cool tint + a dashed rule so it reads as "waiting", not "yours to
   write", and the two kinds stay distinguishable without relying on hue alone. */
.ms-page-body .${INPUT_CHIP_CLASS}[data-input-kind="pending"]{color:#1f5673;
  background:rgba(43,122,163,0.10);border-bottom:1px dashed rgba(31,86,115,0.75);}
.ms-page-body .${INPUT_CHIP_CLASS}[data-input-kind="pending"]:hover{background:rgba(43,122,163,0.18);}
@media (prefers-reduced-motion: reduce){
  .ms-page-body .${INPUT_CHIP_CLASS}{transition:none;}
}
${SHOW_CHANGES_CSS}`;

/** Set-or-remove an attribute, writing only when it actually differs (a no-op write
    inside a contentEditable can still cost a style recalculation). */
function setAttr(el, name, val) {
  if (val) { if (el.getAttribute(name) !== val) el.setAttribute(name, val); }
  else if (el.hasAttribute(name)) el.removeAttribute(name);
}

/* ══════════ 120.md §3 — a caret target below trailing media ══════════
 *
 * THE DEFECT, from the model outward. The persisted model is a markdown subset,
 * and it cannot represent an empty paragraph: htmlToMd drops any block whose text
 * trims to '' (mdDom's emitBlock). So every `<p><br></p>` the editor drops beside a
 * new table/figure lives ONLY in the live DOM of the current mount — and mdToHtml
 * never synthesizes one on the way back, because a section whose markdown ends with
 * a table or a figure renders with a contenteditable="false" island as the editing
 * host's LAST child. There is then NO caret position after the media at all: a click
 * below it, an ArrowDown out of the last cell and an Enter from the caption all have
 * nowhere to land, and the researcher cannot write the paragraph that follows their
 * table — least of all when the media is the final node of the section.
 *
 * THE FIX is one synthesized affordance, appended DIRECTLY (never through
 * execCommand). That is the same sacrificial-pad doctrine removeFigureBlock
 * documents, and it is deliberate on both counts:
 *   · it is NOT CONTENT — the serializer drops an empty paragraph, so it can never
 *     duplicate itself across renders or saves, never reach an export, never create
 *     an endless blank page and never be mistaken for part of the media block
 *     (120.md §3's six safety clauses hold BY CONSTRUCTION, not by bookkeeping);
 *   · it is therefore INVISIBLE to the undo stack, which is exactly right: creating
 *     a caret target is not a history action, and undoing the paragraph the
 *     researcher then types must never reach into the media block above it.
 * Idempotent by construction: it appends only when the last significant child IS
 * media, so calling it on every mount and every emit can never stack two of them.
 */

/** A child that carries meaning — whitespace-only text and comments do not, and
    engines sprinkle them freely between blocks. */
function isSignificantNode(n) {
  if (!n) return false;
  if (n.nodeType === 3) return !!String(n.textContent || '').trim();
  return n.nodeType === 1;
}

/** The last meaningful child of `el` — walked backwards, so the cost is O(1) for
    the shapes that matter (Continuous View mounts ~10 of these editors). */
export function lastSignificantChild(el) {
  let n = el && el.lastChild;
  while (n && !isSignificantNode(n)) n = n.previousSibling;
  return n || null;
}

export function nextSignificantSibling(node) {
  let n = node && node.nextSibling;
  while (n && !isSignificantNode(n)) n = n.nextSibling;
  return n || null;
}

export function prevSignificantSibling(node) {
  let n = node && node.previousSibling;
  while (n && !isSignificantNode(n)) n = n.previousSibling;
  return n || null;
}

/** 120.md §3 — a block the caret cannot be placed AFTER by itself: a pipe table,
    the manual-table caption island, or the uploaded-figure island. */
export function isMediaBlockNode(node) {
  if (!node || node.nodeType !== 1) return false;
  if (String(node.tagName || '').toUpperCase() === 'TABLE') return true;
  const cl = node.classList;
  if (!cl || typeof cl.contains !== 'function') return false;
  return cl.contains(TABLE_CAPTION_CLASS) || cl.contains(FIGURE_BLOCK_CLASS);
}

/** The synthesized affordance itself: a paragraph with no text (a lone <br>). */
export function isEmptyParagraph(node) {
  if (!node || node.nodeType !== 1) return false;
  if (String(node.tagName || '').toUpperCase() !== 'P') return false;
  return !String(node.textContent || '').trim();
}

/**
 * Append ONE `<p><br></p>` when the editing host ends in media, so a caret target
 * exists after it. Returns true when it actually appended. Safe to call on any
 * host, in any order, as often as you like.
 */
export function ensureTrailingParagraph(el) {
  if (!el || typeof el.appendChild !== 'function') return false;
  const last = lastSignificantChild(el);
  if (!isMediaBlockNode(last)) return false;
  const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return false;
  const p = doc.createElement('p');
  p.appendChild(doc.createElement('br'));
  el.appendChild(p);
  return true;
}

/** 120.md §7 — the first line of a clipboard payload, for the one-line title
    islands. Pure; exported so the unit suite can pin it. */
export function firstLineOf(s) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').split('\n')[0].trim();
}

/* ══════════ 121.md r2 — THE END-OF-BLOCK PAD IS NOT A POSITION ══════════
 *
 * `endOfBlockPad` (below) appends ONE `&nbsp;` so Blink stops calling the caret
 * "end of block" and inserts the chip inside the paragraph instead of ejecting it.
 * Its own comment promised the pad "cannot accumulate — the gap probe already
 * refuses a second one" and "cannot reach the model — the serializer trims every
 * block". Both were true only for a caret sitting BEFORE the pad. A caret at the
 * true end of the line (End, Ctrl+End, a click past the last glyph) sits AFTER it,
 * and then:
 *   · the probe measured an empty gap and padded AGAIN — one more nbsp per insert;
 *   · the chip landed between the two pads, so a pad became INTERIOR content and
 *     mdDom (which folds nbsp to a space and trims only block EDGES) wrote a
 *     permanent double space into the markdown that round-trips byte-stably into
 *     the autosave and the docx;
 *   · the chip-to-caret gap measured two nbsp, `joinableGap` allows one, and the
 *     citation GROUPING that 120.md §5 requires was refused — "[1] [2]" instead of
 *     "[1,2]".
 *
 * The repair is to make the pad what the comment always claimed it was: transparent.
 * `snapCaretBeforeTrailingPad` moves a caret at-or-after the pad back in front of it
 * (the same visual position — the pad is not content), which restores the gap probe,
 * the grouping gap and the in-place insertion at one stroke; and a pad that has
 * STOPPED being trailing (the researcher typed after it) is dropped as the section is
 * serialized, so it can never reach the model. Pure helpers, module scope, so the
 * unit suite can pin them against the real serializer.
 */
const PAD_CHAR = ' ';
/* Two leading whitespace characters, at least one an nbsp, then something that is not
   whitespace: the chip separator plus the end-of-block pad, in either engine's
   spelling. `\s` covers U+00A0 in JavaScript, so the classes are explicit. */
const SEP_PLUS_PAD_RE = /^(?: [ 	]|[ 	] |  )(?:[^\s]|$)/;
const PAD_ONLY_RE = /^ +$/;

/** Is everything after `n` in its parent nothing but pad/placeholder markup? */
export function padIsTrailing(n) {
  const p = n && n.parentNode;
  if (!p) return false;
  const kids = Array.from(p.childNodes);
  for (let i = kids.indexOf(n) + 1; i < kids.length; i += 1) {
    const k = kids[i];
    if (k.nodeType === 3) {
      const v = k.nodeValue || '';
      if (v.length && !PAD_ONLY_RE.test(v)) return false;
      continue;
    }
    if (k.nodeType === 1 && String(k.tagName || '').toUpperCase() === 'BR') continue;
    return false;
  }
  return true;
}

/** The FIRST node of a block's trailing pad run (text nodes made only of nbsp), or
    null. Empty text nodes and the placeholder `<br>` are skipped, exactly as
    `caretAtEndOfBlock` skips them. */
export function trailingPadNode(block) {
  if (!block || block.nodeType !== 1) return null;
  const kids = Array.from(block.childNodes);
  let first = null;
  for (let i = kids.length - 1; i >= 0; i -= 1) {
    const n = kids[i];
    if (n.nodeType === 1 && String(n.tagName || '').toUpperCase() === 'BR') continue;
    if (n.nodeType !== 3) break;
    const v = n.nodeValue || '';
    if (!v.length) continue;
    if (!PAD_ONLY_RE.test(v)) break;
    first = n;
  }
  return first;
}

/** Every TEXT node under `n`, in document order. A manual walk rather than a
    TreeWalker so the pure pad rules can be exercised in node. */
function textNodesIn(n, out) {
  const kids = (n && n.childNodes) ? Array.from(n.childNodes) : [];
  for (const k of kids) {
    if (k.nodeType === 3) out.push(k);
    else if (k.nodeType === 1) textNodesIn(k, out);
  }
  return out;
}

/** The pads still worth tracking: connected, and still beginning with the character
    this editor appended. Anything else is no longer ours. Pure — no DOM writes. */
export function livePads(root, pads) {
  const list = Array.isArray(pads) ? pads : [];
  if (!root || !list.length) return [];
  return list.filter((n) => n && n.parentNode && root.contains && root.contains(n)
    && String(n.nodeValue || '').charAt(0) === PAD_CHAR);
}

/**
 * The section's DOM with the pads taken out — as a CLONE, never the live tree.
 *
 * A pad that is still trailing costs the model nothing (mdDom trims every block), so
 * it is left alone: removing it from the live DOM would corrupt the engine's un-apply
 * of the very command that appended it, which is the r1 measurement this must not
 * weaken. A pad that has stopped being trailing is different — mdDom trims block
 * EDGES only, so it folds into a permanent double space in the markdown, in the
 * autosave and in the .docx.
 *
 * It is taken out of a CLONE because the researcher's caret is very likely inside the
 * node in question: typing at the end of a line writes INTO the pad's own text node
 * (both engines do), and rewriting the value of the node a caret sits in moves that
 * caret out from under them mid-keystroke. A clone has no caret, no selection and no
 * undo stack, so this is invisible to everything except the serializer.
 *
 * @returns {string|null} html to serialize, or null when there is nothing to strip
 *                        (the overwhelmingly common case — the caller uses innerHTML).
 */
/**
 * The pad node identity cannot follow: WEBKIT's insertHTML rebuilds a block's text
 * nodes, so the chip separator, the pad and the prose typed after them come out as ONE
 * node ("<nbsp><nbsp>and a cohort agreed.", measured under `webkit-manuscript`) and the
 * tracked node is detached. Two adjacent nbsp immediately after an ELEMENT is a shape
 * only this editor produces — exactly one separator from the chip inserter, exactly one
 * pad from the block — so it is recognised structurally instead.
 *
 * @param {Node} node
 * @param {boolean} apply  false → only report whether there is one (no clone needed)
 */
function mergedPads(node, apply) {
  const kids = (node && node.childNodes) ? Array.from(node.childNodes) : [];
  let found = false;
  for (let i = 0; i < kids.length; i += 1) {
    const k = kids[i];
    if (k.nodeType === 1) {
      if (mergedPads(k, apply)) { found = true; if (!apply) return true; }
      continue;
    }
    if (k.nodeType !== 3 || i === 0 || kids[i - 1].nodeType !== 1) continue;
    const v = String(k.nodeValue || '');
    /* EXACTLY two whitespace characters, at least one of them an NBSP — one separator,
       one pad. (Which of the two survives as an nbsp is the engine's business: WebKit
       normalises one of them to a plain space while merging the nodes. Markdown's own
       double space arrives as two PLAIN spaces through mdToHtml and is left alone, and
       so is a longer run — that could only come from a build that let pads accumulate,
       and is not guessed at.) */
    if (!SEP_PLUS_PAD_RE.test(v)) continue;
    found = true;
    if (!apply) return true;
    k.nodeValue = v.slice(1);
  }
  return found;
}

export function padStrippedHtml(root, pads) {
  const list = Array.isArray(pads) ? pads : [];
  if (!root) return null;
  const live = livePads(root, list);
  // The text-node walk is only worth doing when there is a tracked pad to place.
  const texts = live.length ? textNodesIn(root, []) : [];
  const marks = [];
  for (const n of live) {
    const i = texts.indexOf(n);
    if (i < 0) continue;
    const v = String(n.nodeValue || '');
    if (v === PAD_CHAR) { if (!padIsTrailing(n)) marks.push([i, 'drop']); continue; }
    marks.push([i, 'strip']);          // the engine typed into it — the pad is its head
  }
  if (!marks.length && !mergedPads(root, false)) return null;
  const clone = root.cloneNode(true);
  const cloneTexts = textNodesIn(clone, []);
  for (const [i, kind] of marks) {
    const t = cloneTexts[i];
    if (!t) continue;
    if (kind === 'drop') { if (t.parentNode) t.parentNode.removeChild(t); }
    else t.nodeValue = String(t.nodeValue || '').slice(1);
  }
  mergedPads(clone, true);      // …and the shape identity cannot follow (see above)
  return clone.innerHTML;
}

export const RichSectionEditor = forwardRef(function RichSectionEditor({
  value, orderMap, onChange, placeholder, minHeight = 340,
  ariaLabel, testId = 'stitch-manuscript-rich-editor', onActivate,
  // 85.md B2 — asset-chip numbering (resolveNumbering.byId, Map or plain object;
  // absent → chips read 'Table ?'). The workspace gates this on sourcesSettled
  // (pre-settle it passes a '…' lookup) so numbers never flicker.
  assetNumbers = null,
  // 73.md Part 9 — locked sections render read-only: contentEditable off, no
  // emits, no paste rewriting. The parent remounts on lock toggle (resetKey).
  readOnly = false,
  // 101.md §4/§5 — live fact resolution. `facts` is resolveFacts() output,
  // `factOverrides` the §10 pinned wordings, `factChanges` the change log (or key
  // set) that marks a value as recently updated. All three are refreshed IN PLACE
  // by the effect below, never by re-rendering HTML into the surface (§33).
  facts = null,
  factOverrides = null,
  factChanges = null,
  // 101.md §6 — pure visualization switch. It only sets an attribute; the DOM's
  // text content is byte-identical in both modes.
  showChanges = false,
  // 102.md §3 — notified with the placeholder's label when the researcher clicks
  // one, so the workspace can keep its "current field" marker in step.
  onPlaceholderFocus = null,
  // 116.md §61/§62 — notified when the caret enters/leaves a table so the parent
  // can show the floating table controls. Called with {gridRow, col, rows, cols,
  // rect} while inside a table, null on leaving; never called during SSR.
  onTableFocus = null,
  // 117.md §11 — the live registry id set. A token outside it renders BROKEN.
  // Omitted (null) means "the registry is not known here", and every reference is
  // assumed valid — an editor that has not resolved its assets must never accuse
  // an honest reference of being deleted.
  knownAssetIds = null,
  // 117.md §8 — the draft's journal template drives the caption/label formatter.
  templateId = null,
  // 117.md §4(d) — ids used by OTHER sections, so a table pasted across sections
  // still mints a fresh id instead of colliding.
  existingTableIds = null,
  // 117.md §10 — chip interaction. The editor owns the DOM (and the caret); the
  // parent owns the popovers, because rendering React into a contentEditable is
  // how carets get destroyed. Both callbacks are pure notifications.
  onAssetChipMenu = null,     // ({id, label, broken, rect}) on click/Enter
  onAssetChipHover = null,    // ({id, label, broken, rect}) on hover, null on leave
  // 117.md §4 — created/modified stamps for the draft-side table metadata map.
  onTableMeta = null,         // (tableId, patch)
  // 117.md §37 — the draft's citation style drives the CHIP LABEL: numeric styles
  // render "[1,2]"/"[1–4]", Harvard renders "(Smith, 2020)". Absent → vancouver.
  citationStyle = null,
  // 117.md §37/§38/§39 — reference metadata by id (alias keys included). Needed by
  // author-year labels and by the broken-citation check. Absent (null) means "the
  // library is not known here", and every citation is assumed valid — the same rule
  // knownAssetIds follows for cross-references.
  refsById = null,
  // 117.md §K.4 — Harvard year-disambiguation suffixes (id → 'a'|'b'|…), read off the
  // rendered bibliography by the hook. Absent for every numeric style, so those chip
  // labels are byte-identical to what they always were.
  yearSuffixes = null,
  // 117.md §38 — citation chip interaction. Same division of labour as the
  // cross-reference chip: the editor owns the DOM and the caret, the parent owns
  // the popovers.
  onCiteChipMenu = null,      // ({ids, label, broken, rect}) on click/Enter
  onCiteChipHover = null,     // ({ids, label, broken, rect}) on hover, null on leave
  /* 119.md §5 — uploaded figures.
     `figures`: figKey → { src, alt, width, height, displayWidth, align, missing },
     i.e. what the derived registry knows about each placed picture. Absent means
     "the registry is not resolved here" and a placed marker still renders (with no
     src) rather than being painted as deleted — the knownAssetIds doctrine.
     `onImageFiles(files)`: the parent uploads them and returns
     [{figKey, title}] to insert at the caret (or [] when it refused). Absent →
     paste/drop of an image is not intercepted at all and keeps its old behaviour.
     `onFigureFocus(info|null)`: the caret entered/left a figure block. */
  figures = null,
  onImageFiles = null,
  onFigureFocus = null,
  /* 120.md §6 — native browser spellcheck coordination. TRUE (the historical
     behaviour) leaves the browser's own red underline on; FALSE turns it off inside
     THIS editor only, which is what the PecanRev Writing Assistant needs so the two
     underline systems never overlap. §6: "Disable native checking only inside the
     relevant editor surfaces… Do not disable browser spellcheck globally… Restore
     the expected native behavior when the PecanRev engine is turned off." Prop-
     driven, so turning the assistant off restores it on the next render with no
     remount and no caret loss. */
  nativeSpellcheck = true,
  /* 120.md §6 — a callback the editor calls with its live root element on mount and
     with null on unmount. The decoration layer resolves issue offsets against this
     element; it NEVER writes to it (CSS Custom Highlight API only). */
  onRootRef = null,
}, ref) {
  const rootRef = useRef(null);
  const savedRange = useRef(null);
  const orderMapRef = useRef(orderMap);
  const assetNumbersRef = useRef(assetNumbers);
  const onChangeRef = useRef(onChange);
  /* 120.md §6 — read through a ref, because `emit` is a `useCallback([])` and would
     otherwise keep the FIRST render's value for ever (the same reason every other
     callback here is mirrored). */
  const nativeSpellcheckRef = useRef(nativeSpellcheck);
  nativeSpellcheckRef.current = nativeSpellcheck;
  useEffect(() => { orderMapRef.current = orderMap; });
  useEffect(() => { assetNumbersRef.current = assetNumbers; });
  useEffect(() => { onChangeRef.current = onChange; });
  // 117.md — render-context refs so the memoized api closures never go stale.
  const refOptsRef = useRef(null);
  refOptsRef.current = { knownAssetIds, templateId, citationStyle, refsById, yearSuffixes };
  const onAssetChipMenuRef = useRef(onAssetChipMenu);
  const onAssetChipHoverRef = useRef(onAssetChipHover);
  const onCiteChipMenuRef = useRef(onCiteChipMenu);
  const onCiteChipHoverRef = useRef(onCiteChipHover);
  const onTableMetaRef = useRef(onTableMeta);
  const existingTableIdsRef = useRef(existingTableIds);
  useEffect(() => { onAssetChipMenuRef.current = onAssetChipMenu; });
  useEffect(() => { onAssetChipHoverRef.current = onAssetChipHover; });
  useEffect(() => { onCiteChipMenuRef.current = onCiteChipMenu; });
  useEffect(() => { onCiteChipHoverRef.current = onCiteChipHover; });
  useEffect(() => { onTableMetaRef.current = onTableMeta; });
  useEffect(() => { existingTableIdsRef.current = existingTableIds; });
  /** The chip the action menu is currently bound to (never rendered — DOM only). */
  const activeChipRef = useRef(null);
  const hoverChipRef = useRef(null);
  /** 117.md §38 — the same two refs for the CITATION chip surface. */
  const activeCiteRef = useRef(null);
  const hoverCiteRef = useRef(null);
  // One bundle so insertMarkdown()/paste render fact tokens against the SAME
  // snapshot the rest of the section is showing (§16).
  const factOptsRef = useRef(null);
  factOptsRef.current = { facts, factOverrides, factChanges, showChanges };
  // 119.md §5 — the figure registry snapshot every render path resolves against,
  // plus the parent's upload seam. Refs so the memoized api closures never go stale.
  const figuresRef = useRef(figures);
  const onImageFilesRef = useRef(onImageFiles);
  const onFigureFocusRef = useRef(onFigureFocus);
  useEffect(() => { figuresRef.current = figures; });
  useEffect(() => { onImageFilesRef.current = onImageFiles; });
  useEffect(() => { onFigureFocusRef.current = onFigureFocus; });

  // Rendered from props exactly once (per mount/key) — React sees the SAME
  // __html string on every re-render and never touches the live DOM again.
  const html0 = useRef(null);
  if (html0.current == null) {
    html0.current = mdToHtml(value || '', {
      orderMap, assetNumbers, facts, factOverrides, factChanges, showChanges,
      knownAssetIds, templateId, citationStyle, refsById, yearSuffixes, figures,
    });
  }

  /* 120.md r2 — WHICH TABLE EACH CAPTION OWNS, carried from one emit to the next.
     Seeded from the MOUNTED markdown (where every caption is adjacent to its table by
     construction) and rewritten by every emit, so the serialize-time repair can tell a
     caption whose table is one paragraph away from a caption whose table was deleted
     and a stranger's table happens to follow. See mdDom's repairCaptionBlocks. */
  const captionPairsRef = useRef(null);
  /* 121.md r2 — the end-of-block pads this editor has appended, so `emit` can drop the
     ones that stopped being trailing without guessing which nbsp is whose. */
  const padNodesRef = useRef([]);
  if (captionPairsRef.current == null) captionPairsRef.current = captionTablePairs(value || '');

  /* 120.md §3 — THE MOUNT-SIDE half of the trailing caret target.
     A section whose markdown ends with a table or a figure mounts with a
     contenteditable="false" island as the host's last child, so there is no caret
     position after it at all. This runs beside the renumbering effects (same
     pattern: a DOM-only pass over freshly mounted markup, no re-render, no emit)
     and re-establishes the affordance on EVERY mount, which is what makes
     "reopening the document preserves predictable behaviour" true without the
     empty paragraph ever having to be persisted. Mount-once by design — the emit
     path covers every later shape change, including the one a native undo makes. */
  useEffect(() => {
    if (readOnly) return;
    ensureTrailingParagraph(rootRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Chips renumber in place when the order of first appearance changes; chips
  // are contenteditable=false islands, so this never disturbs the caret.
  //
  // 117.md §36/§37/§39 — this IS the renumbering seam for citations, exactly as the
  // asset effect below is for tables/figures: moving a paragraph, deleting a
  // citation, merging two references or changing the citation style all land here,
  // in place, without remounting the editor or touching one character of prose. The
  // label comes from the same `citeChipLabel` the first render used, so a chip can
  // never show a number the export disagrees with, and a citation whose reference
  // has gone flips to the visibly broken state rather than renumbering to whatever
  // now happens to sit at that position.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    if (!orderMap && !refsById) return;
    el.querySelectorAll(`span.${CITE_CHIP_CLASS}[data-cite]`).forEach((chip) => {
      const raw = chip.getAttribute('data-cite') || '';
      const { label, broken } = citeChipLabel(raw, orderMap, citationStyle, refsById, yearSuffixes);
      if (chip.textContent !== label) chip.textContent = label;
      setAttr(chip, 'data-cite-broken', broken ? 'true' : '');
      setAttr(chip, 'aria-label', citeChipAria(label, broken));
    });
  }, [orderMap, citationStyle, refsById, yearSuffixes]);

  // Asset chips renumber the same way ('Table 2' ⇄ 'Table ?') when numbering or
  // availability changes — atomic islands, caret-safe.
  //
  // 117.md §5-§7/§11 — this is now the WHOLE renumbering seam: because numbering is
  // derived per render and applied in place, deleting a table, moving one, or
  // regenerating a section renumbers every chip AND every manual-table caption
  // without remounting the editor or touching a single character of prose. A chip
  // whose target has disappeared flips to the broken state here too, so a deleted
  // table can never leave a confidently-wrong "Table 2" behind.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    if (!assetNumbers && !knownAssetIds) return;
    el.querySelectorAll(`span.${ASSET_CHIP_CLASS}[data-asset]`).forEach((chip) => {
      const id = chip.getAttribute('data-asset') || '';
      const { label, broken } = assetChipLabel(id, assetNumbers, knownAssetIds, templateId);
      if (chip.textContent !== label) chip.textContent = label;
      setAttr(chip, 'data-asset-broken', broken ? 'true' : '');
      setAttr(chip, 'aria-label', assetChipAria(label, broken));
    });
    // 117.md §4 — the caption's number is derived exactly like a chip's.
    el.querySelectorAll(`div.${TABLE_CAPTION_CLASS}[data-tblcap]`).forEach((cap) => {
      const num = cap.querySelector(`span.${TABLE_CAPTION_NUM_CLASS}`);
      if (!num) return;
      const id = `table:${cap.getAttribute('data-tblcap') || ''}`;
      const n = assetNumbers
        ? (typeof assetNumbers.get === 'function' ? assetNumbers.get(id) : assetNumbers[id])
        : null;
      const prefix = formatCaptionPrefix('table', n == null ? null : n, { templateId });
      if (num.textContent !== prefix) num.textContent = prefix;
    });
    // 119.md §5 — an uploaded figure's number is derived exactly the same way, so
    // inserting a picture above another one renumbers it (and every cross-reference
    // to it) in place, without remounting the editor or touching prose.
    el.querySelectorAll(`figure.${FIGURE_BLOCK_CLASS}[data-figcap]`).forEach((fb) => {
      const num = fb.querySelector(`span.${FIGURE_CAPTION_NUM_CLASS}`);
      if (!num) return;
      const id = `figure:${fb.getAttribute('data-figcap') || ''}`;
      const n = assetNumbers
        ? (typeof assetNumbers.get === 'function' ? assetNumbers.get(id) : assetNumbers[id])
        : null;
      const prefix = formatCaptionPrefix('figure', n == null ? null : n, { templateId });
      if (num.textContent !== prefix) num.textContent = prefix;
    });
  }, [assetNumbers, knownAssetIds, templateId]);

  /* 119.md §5 — the live FIGURE seam: when the registry changes (a replace writes
     new bytes, an alt text or a display width is edited, a figure is deleted), the
     existing block's <img> is updated IN PLACE. Same contract as the fact/chip
     effects above: the block is a contenteditable="false" island, so an
     engine-driven update never disturbs the caret of someone typing beside it, and
     the prose is byte-identical before and after. */
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    if (!figures) return;
    el.querySelectorAll(`figure.${FIGURE_BLOCK_CLASS}[data-figcap]`).forEach((fb) => {
      const key = fb.getAttribute('data-figcap') || '';
      const info = (typeof figures.get === 'function' ? figures.get(key) : figures[key]) || null;
      const img = fb.querySelector(`img.${FIGURE_IMG_CLASS}`);
      const align = info && ['left', 'center', 'right'].includes(info.align) ? info.align : 'center';
      const w = info && Number(info.displayWidth);
      const pct = Number.isFinite(w) && w >= 20 && w <= 100 ? Math.round(w) : 100;
      setAttr(fb, 'data-fig-align', align);
      setAttr(fb, 'data-fig-width', String(pct));
      if (!img) return;
      const src = (info && !info.missing && info.src) ? info.src : '';
      if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
      const alt = (info && info.alt) || '';
      if (alt && img.getAttribute('alt') !== alt) img.setAttribute('alt', alt);
      if (img.style && img.style.width !== `${pct}%`) img.style.width = `${pct}%`;
    });
  }, [figures]);

  // 101.md §4/§33 — THE live-synchronization seam. When the project changes, the
  // engine re-resolves the facts and this effect writes the new values into the
  // existing chips. Exactly the cite/asset renumbering pattern above: chips are
  // contenteditable=false islands, so an engine-driven update lands mid-sentence
  // WITHOUT touching the surrounding prose, remounting the editor, or moving the
  // caret of a researcher who is typing three words away. That is what makes §4
  // ("no Refresh manuscript button") and §5 ("do not overwrite human prose")
  // simultaneously true.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    const changed = indexFactChanges(factChanges);
    el.querySelectorAll(`span.${FACT_CHIP_CLASS}[data-fact]`).forEach((chip) => {
      const key = chip.getAttribute('data-fact') || '';
      const f = factOf(facts, key);
      const text = factChipText(key, facts, factOverrides);
      if (chip.textContent !== text) chip.textContent = text;
      // Inert provenance hooks — CSS in showChanges.js is the only thing that reads
      // them, and only while the toggle is on.
      setAttr(chip, 'data-engine', f && f.engine ? f.engine : '');
      setAttr(chip, 'data-changed', changed.has(key) ? 'true' : '');
      setAttr(chip, 'data-missing', f && f.missing ? 'true' : '');
      // §6 — a tooltip is a provenance marker too, so it exists only in the mode
      // that is meant to show provenance.
      setAttr(chip, 'title', showChanges ? factChipTitle(key, f, changed.get(key)) : '');
    });
  }, [facts, factOverrides, factChanges, showChanges]);

  /* ══════════ 102.md §3 — click a placeholder, select ALL of it ══════════
   *
   * "Clicking anywhere inside `[Enter institution name]` should select the entire
   * `[Enter institution name]`" so the researcher can type straight over it.
   *
   * The chip is an atomic contenteditable=false island, so a click lands next to
   * it rather than inside it; selecting the node explicitly is what turns it into
   * the form-field behaviour §85 asks for. Nothing here mutates the document, so
   * undo/redo, autosave and the caret contract (§9) are untouched — this only
   * moves the selection.
   */
  const selectPlaceholderNode = useCallback((node) => {
    if (!node || typeof window === 'undefined' || !window.getSelection) return;
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.selectNode(node);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
  }, []);

  /** The placeholder chip a click/keypress landed on, or null. */
  const placeholderFrom = (target) => {
    if (!target || typeof target.closest !== 'function') return null;
    const el = target.closest(`span.${INPUT_CHIP_CLASS}[data-input]`);
    return el && rootRef.current && rootRef.current.contains(el) ? el : null;
  };

  /**
   * Keyboard parity for §3. The chip carries role="button" and tabindex=0, so it is
   * reachable by Tab; without this it would be focusable but inert, which is worse
   * than not being focusable at all. Enter/Space selects the whole field so the very
   * next keystroke replaces it — the same outcome a click gives.
   */
  const onPlaceholderKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return false;
    // 108 review — the PLAIN chord only. Ctrl/Cmd+Enter is the manuscript's
    // placeholder-STEPPING chord (102.md §26, now `manuscript.stepPlaceholder` in the
    // 108.md §23 router). This handler runs on React's root bubble, i.e. before the
    // window-bubble router, and its preventDefault() sets `defaultPrevented` — which
    // the adapter treats as "a nearer handler already claimed this event"
    // (ShortcutProvider.shouldRouteEvent). Cancelling a modified Enter here therefore
    // killed stepping outright whenever a chip happened to hold focus.
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const chip = placeholderFrom(e.target);
    if (!chip) return false;
    e.preventDefault();
    selectPlaceholderNode(chip);
    onPlaceholderFocusRef.current && onPlaceholderFocusRef.current(chip.getAttribute('data-input') || '');
    return true;
  };

  /* ══════════ 117.md §10/§11 — cross-reference chip interaction ══════════
   *
   * Delegated, DOM-only and caret-neutral. A chip is a contenteditable=false
   * island, so a mousedown on it would otherwise drop a collapsed caret beside it;
   * preventDefault keeps the researcher's caret exactly where it was while the
   * action menu opens. Nothing here mutates the document — the ACTIONS do, and
   * they go through the same execCommand/insertHtml path as every other edit, so
   * native undo and the input→autosave emit still own the history.
   */
  const chipInfo = (chip) => ({
    id: chip.getAttribute('data-asset') || '',
    label: chip.textContent || '',
    broken: chip.getAttribute('data-asset-broken') === 'true',
    rect: typeof chip.getBoundingClientRect === 'function' ? chip.getBoundingClientRect() : null,
  });

  const assetChipFrom = (target) => {
    if (!target || typeof target.closest !== 'function') return null;
    const el = target.closest(`span.${ASSET_CHIP_CLASS}[data-asset]`);
    return el && rootRef.current && rootRef.current.contains(el) ? el : null;
  };

  const openChipMenu = (chip) => {
    activeChipRef.current = chip;
    const cb = onAssetChipMenuRef.current;
    if (cb) cb(chipInfo(chip));
  };

  const onChipMouseOver = (e) => {
    const cb = onAssetChipHoverRef.current;
    if (!cb) return;
    const chip = assetChipFrom(e.target);
    if (!chip) {
      if (hoverChipRef.current) { hoverChipRef.current = null; cb(null); }
      return;
    }
    if (hoverChipRef.current === chip) return;
    hoverChipRef.current = chip;
    cb(chipInfo(chip));
  };

  const onChipMouseLeave = () => {
    const cb = onAssetChipHoverRef.current;
    if (cb && hoverChipRef.current) { hoverChipRef.current = null; cb(null); }
    const cc = onCiteChipHoverRef.current;
    if (cc && hoverCiteRef.current) { hoverCiteRef.current = null; cc(null); }
  };

  /* ══════════ 117.md §38 — citation chip interaction ══════════
   *
   * Structurally identical to the cross-reference surface above (delegated,
   * DOM-only, caret-neutral), on purpose: a researcher should not have to learn two
   * chip idioms, and one mechanism means one place where the caret contract can be
   * got right.
   */
  const citeInfo = (chip) => ({
    ids: parseCiteIds(chip.getAttribute('data-cite') || ''),
    label: chip.textContent || '',
    broken: chip.getAttribute('data-cite-broken') === 'true',
    rect: typeof chip.getBoundingClientRect === 'function' ? chip.getBoundingClientRect() : null,
  });

  const citeChipFrom = (target) => {
    if (!target || typeof target.closest !== 'function') return null;
    const el = target.closest(`span.${CITE_CHIP_CLASS}[data-cite]`);
    return el && rootRef.current && rootRef.current.contains(el) ? el : null;
  };

  const openCiteMenu = (chip) => {
    activeCiteRef.current = chip;
    const cb = onCiteChipMenuRef.current;
    if (cb) cb(citeInfo(chip));
  };

  const onCiteMouseOver = (e) => {
    const cb = onCiteChipHoverRef.current;
    if (!cb) return;
    const chip = citeChipFrom(e.target);
    if (!chip) {
      if (hoverCiteRef.current) { hoverCiteRef.current = null; cb(null); }
      return;
    }
    if (hoverCiteRef.current === chip) return;
    hoverCiteRef.current = chip;
    cb(citeInfo(chip));
  };

  /** Every manual-table id currently visible here, plus the rest of the draft. */
  const usedTableIds = () => {
    const out = new Set();
    for (const id of (existingTableIdsRef.current || [])) out.add(String(id).replace(/^table:/, ''));
    const el = rootRef.current;
    if (el && typeof el.querySelectorAll === 'function') {
      el.querySelectorAll('[data-tblcap]').forEach((n) => out.add(n.getAttribute('data-tblcap') || ''));
    }
    return out;
  };

  const onPlaceholderMouseDown = (e) => {
    const chip = placeholderFrom(e.target);
    if (!chip) return;
    // preventDefault stops the browser placing a collapsed caret beside the chip,
    // which would immediately undo the selection we are about to make.
    e.preventDefault();
    selectPlaceholderNode(chip);
    if (!readOnlyRef.current) rootRef.current && rootRef.current.focus();
    onPlaceholderFocusRef.current && onPlaceholderFocusRef.current(chip.getAttribute('data-input') || '');
  };

  /* ══════════ 119.md §2 — the table-title caret (the "Safari" defect) ══════════
   *
   * The title is an editing ISLAND: `<span contenteditable="true">` inside a
   * `<div contenteditable="false">` caption inside the editable root. Every new
   * table starts with an EMPTY title, and an empty inline island has no caret
   * geometry — WebKit focuses the span on click but never establishes a caret, so
   * the next keystroke is discarded. This is a standards/lifecycle problem, not a
   * browser to detect: when a click lands in a caption and the browser has not put
   * a caret inside the title, we place the collapsed range ourselves. Engines that
   * already got it right never reach the override, because a click inside a
   * NON-empty title is deliberately left to the browser (click-to-position must
   * keep working, and every engine does that part correctly).
   */

  /**
   * The caption island owning a node, scoped to this editor root.
   * 119.md §5 — an uploaded FIGURE block is the same kind of island (a
   * contenteditable="false" wrapper whose only editable region is a title), so it
   * inherits the whole §2 caret fix here rather than growing a second copy of it.
   */
  const captionFromNode = (node) => {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== rootRef.current) {
      if (el.classList && (el.classList.contains(TABLE_CAPTION_CLASS)
        || el.classList.contains(FIGURE_BLOCK_CLASS))) return el;
      el = el.parentElement;
    }
    return null;
  };

  const captionTitleOf = (cap) => (cap
    ? cap.querySelector(`span.${TABLE_CAPTION_TITLE_CLASS}, span.${FIGURE_CAPTION_TITLE_CLASS}`)
    : null);

  /** Place a collapsed caret inside `titleEl`, honouring the click point when the
      title has text to aim at (a rename must be able to click mid-word). */
  const placeCaretInTitle = (titleEl, clientX, clientY) => {
    if (!titleEl || typeof window === 'undefined' || !window.getSelection) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    let r = null;
    const hasText = (titleEl.textContent || '').length > 0;
    if (hasText && typeof clientX === 'number' && typeof clientY === 'number') {
      // Standard two-name API: WebKit/Blink expose caretRangeFromPoint, Gecko
      // caretPositionFromPoint. A point outside the title is discarded rather than
      // trusted, so a click on the number can never drop the caret in the prose.
      if (typeof document.caretRangeFromPoint === 'function') {
        r = document.caretRangeFromPoint(clientX, clientY);
      } else if (typeof document.caretPositionFromPoint === 'function') {
        const p = document.caretPositionFromPoint(clientX, clientY);
        if (p && p.offsetNode) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); }
      }
      if (r && !titleEl.contains(r.startContainer)) r = null;
    }
    if (r) r.collapse(true);
    else { r = document.createRange(); r.selectNodeContents(titleEl); r.collapse(false); }
    titleEl.focus();
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
    return true;
  };

  /* ══════════ 119.md §5 — uploaded-figure blocks ══════════ */

  /** The figure block owning a node, scoped to this editor root. */
  const figureFromNode = (node) => {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== rootRef.current) {
      if (el.classList && el.classList.contains(FIGURE_BLOCK_CLASS)) return el;
      el = el.parentElement;
    }
    return null;
  };

  /**
   * Select the whole figure block (the object, not its parts).
   *
   * setStartBefore/setEndAfter — NOT Range.selectNode. They describe the same
   * region, but WebKit's replacement machinery treats them differently: over a
   * `contenteditable="false"` block parsed from markup (the state after a reload)
   * a selectNode-based replacement swallowed the FOLLOWING paragraph's inline
   * content — the sentence that cross-referenced the picture disappeared with it.
   * This is the same range shape the §2 whole-table deletion uses, for the same
   * reason. Focus is taken FIRST: document.execCommand silently no-ops when the
   * editing host is not focused, and this path is usually reached from a
   * confirmation dialog.
   */
  const selectFigureBlock = (fb) => {
    if (!fb || typeof window === 'undefined' || !window.getSelection) return false;
    if (rootRef.current && !readOnlyRef.current) rootRef.current.focus();
    const sel = window.getSelection();
    if (!sel) return false;
    const r = document.createRange();
    r.setStartBefore(fb);
    r.setEndAfter(fb);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
    notifyFigureFocus(fb);
    return true;
  };

  /**
   * The figure block the current selection fully covers, or null.
   *
   * Same shape (and same conservatism) as fullySelectedTable: EXACTLY one figure
   * touched, its picture and its caption both inside the range, and nothing else
   * of the section straying into it. Anything less specific stays browser-default,
   * because a selection that also covers prose must delete the prose the
   * researcher selected — not silently swallow a figure.
   */
  const fullySelectedFigure = () => {
    const el = rootRef.current;
    if (!el || typeof window === 'undefined' || !window.getSelection) return null;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    if (typeof r.intersectsNode !== 'function') return null;
    if (!el.contains(r.commonAncestorContainer)) return null;
    try {
      const touched = Array.from(el.querySelectorAll(`figure.${FIGURE_BLOCK_CLASS}[data-figcap]`))
        .filter((fb) => r.intersectsNode(fb));
      if (touched.length !== 1) return null;
      const fb = touched[0];
      const caption = fb.querySelector(`figcaption.${FIGURE_CAPTION_CLASS}`);
      if (caption && !r.intersectsNode(caption)) return null;
      const own = topBlockOf(fb);
      const straysOutside = Array.from(el.children).some((n) => n !== own && r.intersectsNode(n));
      return straysOutside ? null : fb;
    } catch { return null; }
  };

  /** Tell the parent which figure the caret owns (floating controls), or null. */
  const lastFigureRef = useRef(null);
  const notifyFigureFocus = (fb) => {
    const cb = onFigureFocusRef.current;
    if (!cb) return;
    if (!fb) {
      if (lastFigureRef.current) { lastFigureRef.current = null; cb(null); }
      return;
    }
    lastFigureRef.current = fb;
    cb({
      figKey: fb.getAttribute('data-figcap') || '',
      align: fb.getAttribute('data-fig-align') || 'center',
      width: Number(fb.getAttribute('data-fig-width')) || 100,
      rect: typeof fb.getBoundingClientRect === 'function' ? fb.getBoundingClientRect() : null,
    });
  };

  /** Every figure key currently placed here (document order). */
  const usedFigureKeys = () => {
    const out = new Set();
    const el = rootRef.current;
    if (el && typeof el.querySelectorAll === 'function') {
      el.querySelectorAll('[data-figcap]').forEach((n) => out.add(n.getAttribute('data-figcap') || ''));
    }
    return out;
  };

  /**
   * 119.md §2/§5 — remove a figure block through the editor's NORMAL mutation path
   * (selection → execCommand), so one native Ctrl+Z restores the picture, its
   * title and its position together, and the emit that follows autosaves it.
   * The bytes are untouched: the server only ever deletes an UNREFERENCED figure,
   * which is precisely what makes the restored marker point at a live file.
   */
  const removeFigureBlock = (fb) => {
    if (readOnlyRef.current || !fb) return false;
    const el = rootRef.current;
    if (!el || !el.contains(fb)) return false;
    /* Routed through replaceNode, NOT through a bare selection + insertHtml.
       replaceNode focuses the editing host FIRST, and that is load-bearing: this
       removal is usually triggered from a CONFIRMATION DIALOG, and
       document.execCommand silently returns false when the host is not focused —
       at which point insertHtml falls back to raw range surgery, which mutates the
       DOM without pushing anything onto the browser's undo stack. The picture
       disappeared and Ctrl+Z could not bring it back: the one guarantee §5
       actually asks for. An empty paragraph replaces it so a caret target remains;
       htmlToMd drops that again, so the persisted markdown stays clean. */
    /* …and the range must not START at offset 0 of the editing host.
       …and it must be neither the FIRST nor the LAST significant child of the host.
       Two Blink behaviours, both reproduced under Playwright chromium:
         · a replacement whose range starts at offset 0 of the editing host is
           APPLIED but never pushed onto the undo stack — the picture vanished and
           Ctrl+Z could not bring it back, which is the one guarantee §5 asks for;
         · a replacement over the host's ONLY child rewrites that element's CONTENTS
           instead of replacing it, leaving an empty <figure> husk (the same shape
           WebKit leaves for captions, 119.md §2).
       An empty throwaway paragraph on each side removes both. It is written
       DIRECTLY rather than through execCommand — at these positions the editing
       commands are the thing that is broken — and being invisible to the undo stack
       is what we want: it is not content (htmlToMd drops an empty paragraph), it
       exists only so the REAL edit records and applies normally.

       r2 — AND THE PADS ARE NOW UNCONDITIONAL, which is the WebKit fix. The known
       limitation this note used to record was: under WebKit the replacement also
       removed a cross-reference CHIP sitting in the paragraph immediately AFTER the
       picture (both are contenteditable="false" islands, and WebKit reaches past the
       range end into the next block). The engine-shaped-range experiments each fixed
       one engine and broke the other, because they were all arguing with the range.
       A SACRIFICIAL EMPTY BLOCK does not argue: whatever WebKit reaches into is an
       empty paragraph that was not content, so the researcher's sentence — and its
       chip — is out of reach by construction. Blink's two behaviours were already
       fixed by exactly this padding, so one shape now serves both engines and the
       figure spec runs under BOTH (playwright.config webkit-manuscript).
       (The pads STAY once the edit has applied — see the note further down for the
       measurement that settled that.) */
    const top = topBlockOf(fb) || fb;
    const pads = [];
    /* `top` is a direct child of the host by construction (topBlockOf climbs to one),
       but the pads are now UNCONDITIONAL, so a shape that broke that assumption would
       turn an insertBefore into a throw and abandon the removal entirely. The parent
       check keeps the worst case "no pad" rather than "no removal". */
    const padAt = (before) => {
      if (top.parentNode !== el) return;
      const pad = document.createElement('p');
      pad.appendChild(document.createElement('br'));
      if (before) el.insertBefore(pad, top);
      else if (top.nextSibling) el.insertBefore(pad, top.nextSibling);
      else el.appendChild(pad);
      pads.push(pad);
    };
    padAt(true);
    padAt(false);
    replaceNode(fb, '<p><br></p>');
    // WebKit treats a contenteditable="false" element at the range start as
    // immovable (the §2 finding). Same retry, same reason.
    if (el.contains(fb)) {
      fb.removeAttribute('contenteditable');
      replaceNode(fb, '<p><br></p>');
    }
    // Last resort: whatever husk an engine left behind goes through the same
    // mutation path (never a removeChild), so the document stays consistent.
    if (el.contains(fb)) replaceNode(fb, null);
    /* THE PADS ARE LEFT WHERE THEY ARE, and that is deliberate (r2, measured).
       Removing them afterwards looks tidier and costs the guarantee: Blink's undo
       entry addresses the position the replacement recorded, and deleting the
       sibling blocks around it made Ctrl+Z a silent no-op — the picture could not be
       brought back, which is the one thing §5 asks of this path (reproduced in
       e2e/manuscript/manuscript-figures-119.spec.ts under chromium). An empty
       paragraph is not content: htmlToMd drops it, so the persisted markdown, the
       export and the next mount are all clean. Undo beats tidiness. */
    void pads; // kept as a named local so the decision above has something to point at.
    // 120.md §3 — the removal can leave ANOTHER media block as the host's last
    // child (two pictures in a row, a figure above a table); re-establish the
    // caret target rather than waiting for the next emit to notice.
    ensureTrailingParagraph(el);
    notifyFigureFocus(null);
    return !el.contains(fb);
  };

  /**
   * 119.md §2 — one delegated entry point for every click inside a caption.
   *
   * Clicking the derived NUMBER (or the caption's padding) is a dead end today: the
   * wrapper is contenteditable="false" and the number is user-select:none, so the
   * click does nothing at all. Routing it to the title makes the whole caption
   * behave like the one editable thing it contains, in every engine.
   */
  const onCaptionMouseDown = (e) => {
    const cap = captionFromNode(e.target);
    if (!cap) return false;
    const titleEl = captionTitleOf(cap);
    if (!titleEl) return false;
    /* 119.md §5 — inside a FIGURE block, a click on the PICTURE is not a request to
       rename it: it selects the whole object, which is what makes Delete/Backspace
       and the floating figure controls work on the thing the researcher pointed at.
       A click in the caption keeps the §2 title-caret behaviour below. */
    const isFigure = cap.classList && cap.classList.contains(FIGURE_BLOCK_CLASS);
    if (isFigure) {
      const capRow = cap.querySelector(`figcaption.${FIGURE_CAPTION_CLASS}`);
      const inCaption = capRow && (capRow === e.target || capRow.contains(e.target));
      if (!inCaption) {
        e.preventDefault();
        selectFigureBlock(cap);
        return true;
      }
    }
    const inTitle = titleEl === e.target || titleEl.contains(e.target);
    const empty = !(titleEl.textContent || '').length;
    // A click inside a title that HAS text is the browser's job — it positions the
    // caret at the glyph, which is exactly what the researcher aimed at.
    if (inTitle && !empty) return false;
    e.preventDefault();
    placeCaretInTitle(titleEl, e.clientX, e.clientY);
    return true;
  };

  /** One mousedown entry point: reference chips, then cross-refs, then placeholders. */
  const onEditorMouseDown = (e) => {
    // 119.md §5 — which figure (if any) the pointer just claimed, so the floating
    // figure controls follow the object the researcher is working on. Fires the
    // leave transition exactly once, like notifyTableFocus.
    if (onFigureFocusRef.current) notifyFigureFocus(figureFromNode(e.target));
    // 117.md §38 — a click on a citation opens its action menu without moving the
    // caret (same preventDefault rule as §10).
    const cite = onCiteChipMenuRef.current ? citeChipFrom(e.target) : null;
    if (cite) { e.preventDefault(); openCiteMenu(cite); return; }
    const chip = assetChipFrom(e.target);
    if (chip) {
      e.preventDefault();  // §10 — "never disturb the caret"
      openChipMenu(chip);
      return;
    }
    if (readOnly) return;
    // 119.md §2 — the caption caret comes before the placeholder pass: a caption
    // never contains a placeholder chip, and the click must not fall through to a
    // handler that would move the caret back out of the island.
    if (onCaptionMouseDown(e)) return;
    onPlaceholderMouseDown(e);
    // 120.md §3 — a click in the empty space BELOW trailing media lands in the
    // paragraph after it (synthesizing that paragraph if this mount has none).
    if (!e.defaultPrevented) onBelowMediaMouseDown(e);
  };

  const readOnlyRef = useRef(readOnly);
  useEffect(() => { readOnlyRef.current = readOnly; });
  const onPlaceholderFocusRef = useRef(onPlaceholderFocus);
  useEffect(() => { onPlaceholderFocusRef.current = onPlaceholderFocus; });
  const onTableFocusRef = useRef(onTableFocus);
  useEffect(() => { onTableFocusRef.current = onTableFocus; });

  /* ══════════ 116.md §59-§66 — native table support ══════════
   *
   * Structural ops NEVER mutate the table DOM directly: a raw insertRow/
   * removeChild would be invisible to the browser's native undo stack AND would
   * not fire an input event, so autosave would miss it until the next keystroke
   * (the two-sided trap of §63/§64). Instead every op is a WHOLE-TABLE
   * replacement routed through the same insertHtml/execCommand path the toolbar
   * uses: serialize the table (htmlToMd), transform it with the pure tableOps
   * module, re-render (mdToHtml) and insertHTML over the selected table node.
   * Native undo records it, emit() autosaves it, and the markdown stays inside
   * the pipe grammar, so nothing here can become a DOM-only table.
   */

  /** The enclosing td/th of a DOM node, or null when outside root/table. */
  const cellFromNode = (node) => {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== rootRef.current) {
      const tag = el.tagName;
      if (tag === 'TD' || tag === 'TH') return el;
      el = el.parentElement;
    }
    return null;
  };

  /** Caret's table context: { table, cell, gridRow, col, rows, cols } | null. */
  const tableDomContext = () => {
    const sel = typeof window !== 'undefined' && window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || !rootRef.current) return null;
    const cell = cellFromNode(sel.getRangeAt(0).startContainer);
    if (!cell || typeof cell.closest !== 'function') return null;
    const table = cell.closest('table');
    if (!table || !rootRef.current.contains(table)) return null;
    const trs = Array.from(table.querySelectorAll('tr'));
    const tr = cell.closest('tr');
    const gridRow = trs.indexOf(tr);
    const rowCells = tr ? Array.from(tr.querySelectorAll('th,td')) : [];
    const col = rowCells.indexOf(cell);
    if (gridRow < 0 || col < 0) return null;
    return { table, cell, gridRow, col, rows: trs.length, cols: rowCells.length };
  };

  /** Word-style cell entry: select the cell's contents so typing replaces them. */
  const selectCellContents = (cell) => {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.selectNodeContents(cell);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
  };

  const focusCellAt = (table, gridRow, col) => {
    const trs = table.querySelectorAll('tr');
    const tr = trs[Math.max(0, Math.min(gridRow, trs.length - 1))];
    if (!tr) return;
    const cells = tr.querySelectorAll('th,td');
    const cell = cells[Math.max(0, Math.min(col, cells.length - 1))];
    if (!cell) return;
    rootRef.current && rootRef.current.focus();
    selectCellContents(cell);
  };

  /** 117.md §4 — the caption element bound to a table (its previous sibling). */
  const captionForTable = (table) => {
    const prev = table && table.previousElementSibling;
    return (prev && prev.classList && prev.classList.contains(TABLE_CAPTION_CLASS)) ? prev : null;
  };

  /**
   * 119.md §2 — a table context built from a KNOWN table element instead of the
   * caret. A whole-table SELECTION has no cell to read a caret out of (its start
   * can sit before the caption), and `deleteTable` ignores gridRow/col anyway.
   */
  const contextForTable = (table) => {
    if (!table || !rootRef.current || !rootRef.current.contains(table)) return null;
    const trs = Array.from(table.querySelectorAll('tr'));
    const rowCells = trs[0] ? Array.from(trs[0].querySelectorAll('th,td')) : [];
    return { table, cell: rowCells[0] || null, gridRow: 0, col: 0, rows: trs.length, cols: rowCells.length };
  };

  /** Children that carry meaning — whitespace-only text nodes do not, and engines
      sprinkle them freely between blocks. */
  const significantChildren = (el) => (el
    ? Array.from(el.childNodes).filter((n) => !(n.nodeType === 3 && !String(n.textContent || '').trim()))
    : []);

  /** The top-level block of this root that contains `node` (climbing out of any
      caption island / cell / list it is nested in). */
  const topBlockOf = (node) => {
    const el = rootRef.current;
    let top = node;
    if (!el || !top || !el.contains(top)) return null;
    while (top.parentElement && top.parentElement !== el) top = top.parentElement;
    return top.parentElement === el ? top : null;
  };

  /**
   * 119.md §2 — HOIST the insertion point out of an editing island before a BLOCK
   * insertion.
   *
   * insertTable deliberately parks the caret inside the new caption's title (§4:
   * the one thing only the researcher can supply is the name). Inserting a second
   * table with the caret still parked there made execCommand('insertHTML') splice
   * the new caption+table INSIDE the previous title span — which the reader sees as
   * "one click inserted two tables", and which htmlToMd then silently DELETES on
   * the next round trip because the pipe grammar cannot express a table nested in a
   * caption. The same trap fires for an insert with the caret inside a TD.
   *
   * The grammar is the model: nothing may create DOM the grammar cannot round-trip.
   * So a block insertion always lands AFTER the whole enclosing object, never inside
   * it. Returns true when the point was moved.
   */
  const hoistInsertionPoint = (opts = {}) => {
    const el = rootRef.current;
    if (!el || typeof window === 'undefined' || !window.getSelection) return false;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.commonAncestorContainer)) return false;
    let anchor = null;
    const cap = captionFromNode(r.commonAncestorContainer);
    if (cap) {
      // A caption belongs to the table that follows it: they are ONE object, so the
      // insertion clears both.
      const next = cap.nextElementSibling;
      anchor = (next && next.tagName === 'TABLE') ? next : cap;
    } else {
      const cell = cellFromNode(r.commonAncestorContainer);
      const table = cell && typeof cell.closest === 'function' ? cell.closest('table') : null;
      if (table && el.contains(table)) anchor = table;
    }
    /* 119.md §5 — a FIGURE is a whole block, not a run of inline content, so it must
       land BETWEEN top-level blocks and never inside one. Chrome's insertHTML, given
       a <figure> at a caret in the middle of a paragraph, wraps the surrounding
       blocks in a <div> — DOM the grammar cannot round-trip and the researcher sees
       as "the picture went somewhere else". Hoisting to the end of the enclosing
       top-level block is also the behaviour a researcher expects from "put the
       picture here": it lands after the paragraph they were in. */
    if (!anchor && opts.blockLevel) anchor = r.commonAncestorContainer;
    const top = anchor ? topBlockOf(anchor) : null;
    if (!top) return false;
    const nr = document.createRange();
    nr.setStartAfter(top);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
    savedRange.current = nr.cloneRange();
    return true;
  };

  /**
   * 119.md §2 — the table the current selection covers ENTIRELY, or null.
   *
   * "Entirely" is deliberately two-sided, and both sides are expressed with
   * `intersectsNode` rather than boundary-point arithmetic: engines normalise a
   * table drag-selection to wildly different boundary containers (a text node, a
   * cell, a row, the table's parent), and a rule written against those would be a
   * rule that works in one browser.
   *
   *  - EVERY cell of the table is touched. A drag that stops short of one cell is a
   *    partial selection, and §2 is explicit that a partial one must do exactly what
   *    it says — so it stays with the browser, untouched.
   *  - NOTHING outside the object is touched. A selection that also covers the
   *    prose around the table is a broader edit the browser owns; deleting only the
   *    table there would be less than the researcher asked for.
   *
   * Exactly one table may be involved — a range across two tables is the browser's.
   */
  const fullySelectedTable = () => {
    const el = rootRef.current;
    if (!el || typeof window === 'undefined' || !window.getSelection) return null;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    if (typeof r.intersectsNode !== 'function') return null;
    if (!el.contains(r.commonAncestorContainer)) return null;
    try {
      const touched = Array.from(el.querySelectorAll('table')).filter((t) => r.intersectsNode(t));
      if (touched.length !== 1) return null;
      const table = touched[0];
      const cells = Array.from(table.querySelectorAll('th,td'));
      if (!cells.length) return null;
      const coversAllCells = cells.every((c) => r.intersectsNode(c));
      if (!coversAllCells) return null;
      const own = new Set([topBlockOf(table), topBlockOf(captionForTable(table))].filter(Boolean));
      const straysOutside = Array.from(el.children).some((n) => !own.has(n) && r.intersectsNode(n));
      return straysOutside ? null : table;
    } catch { return null; }
  };

  // Notify the parent when the caret enters/moves within/leaves a table. Only
  // the leave transition sends null (once), so a caret outside any table costs
  // nothing per keystroke.
  const wasInTable = useRef(false);
  /** 119.md §2 — the last table the caret owned (see notifyTableFocus). */
  const lastTableRef = useRef(null);

  /** The table belonging to a caption id, or null when that object is gone. */
  const tableForCaptionId = (id) => {
    const el = rootRef.current;
    const safe = String(id == null ? '' : id).replace(/[^a-z0-9-]/gi, '');
    if (!el || !safe) return null;
    const cap = el.querySelector(`div.${TABLE_CAPTION_CLASS}[data-tblcap="${safe}"]`);
    const next = cap && cap.nextElementSibling;
    return (next && next.tagName === 'TABLE') ? next : null;
  };

  const notifyTableFocus = () => {
    const cb = onTableFocusRef.current;
    if (!cb) return;
    const ctx = tableDomContext();
    if (!ctx) {
      if (wasInTable.current) { wasInTable.current = false; cb(null); }
      return;
    }
    wasInTable.current = true;
    /* 119.md §2 — remember the table the caret last owned.
       The floating table controls and the §11 delete confirmation are real focus
       targets, and WebKit DROPS the document selection when focus leaves the editing
       host (Blink keeps it). Reading the target off the live selection therefore made
       every table op a no-op in Safari the moment a dialog stood between the click
       and the command — "✕ Table does nothing", reproduced under webkit-manuscript.
       The controls only exist while this ref is fresh (the parent hides them on the
       leave notification), so acting on it is acting on what the researcher sees. */
    lastTableRef.current = { table: ctx.table, gridRow: ctx.gridRow, col: ctx.col };
    const cap = captionForTable(ctx.table);
    cb({
      gridRow: ctx.gridRow,
      col: ctx.col,
      rows: ctx.rows,
      cols: ctx.cols,
      // 117.md §11 — the table's stable id, so the parent can count the
      // cross-references that would break BEFORE it is deleted.
      tableId: cap ? (cap.getAttribute('data-tblcap') || null) : null,
      rect: typeof ctx.table.getBoundingClientRect === 'function' ? ctx.table.getBoundingClientRect() : null,
    });
  };

  /**
   * 119.md §2 — re-stamp the caption island's editability.
   *
   * A native UNDO restores the caption's markup as the engine recorded it, and
   * WebKit drops the `contenteditable` attributes on the way through. A restored
   * caption without them is an editable block whose derived NUMBER the caret can
   * walk into and type over — the one thing 117.md §4 guarantees can never happen.
   * These are attribute writes on non-content structure, so they cost nothing to
   * the undo stack (setAttr writes only on a genuine difference), and they run
   * where every mutation already passes: the emit path, which an undo triggers.
   */
  const repairCaptionIslands = (el) => {
    // 120.md §6 — the caption TITLES are the other two places the browser's native
    // spellchecker runs inside this surface (mdDom renders them with
    // spellcheck="true"). They are re-stamped HERE, beside the editability repair,
    // rather than parameterised in mdDom, for three reasons:
    //   · mdDom's output stays BYTE-IDENTICAL for every caller and every pinned
    //     byte-stability test — the module is not touched at all;
    //   · toggling the assistant would otherwise have to re-render the section's
    //     HTML through mdToHtml, which means a remount: a lost caret, a lost undo
    //     stack and a contentEpoch bump, for an attribute;
    //   · this is already the ONE pass that runs where every shape change passes,
    //     including the ones no command of ours made (a native undo, a drop), so a
    //     caption restored by Ctrl+Z is re-stamped for free.
    // `setAttr` writes only on a genuine difference and the attribute is not
    // content, so htmlToMd ignores it and the undo stack never sees it.
    const spell = nativeSpellcheckRef.current === false ? 'false' : 'true';
    const caps = el.querySelectorAll(`div.${TABLE_CAPTION_CLASS}[data-tblcap]`);
    for (const cap of caps) {
      setAttr(cap, 'contenteditable', 'false');
      const title = cap.querySelector(`span.${TABLE_CAPTION_TITLE_CLASS}`);
      if (title) { setAttr(title, 'contenteditable', 'true'); setAttr(title, 'spellcheck', spell); }
    }
    // 119.md §5 — the uploaded-figure block is the same kind of island and needs
    // the same re-stamp after a native undo restores it.
    const figs = el.querySelectorAll(`figure.${FIGURE_BLOCK_CLASS}[data-figcap]`);
    for (const fb of figs) {
      setAttr(fb, 'contenteditable', 'false');
      const title = fb.querySelector(`span.${FIGURE_CAPTION_TITLE_CLASS}`);
      if (title) { setAttr(title, 'contenteditable', 'true'); setAttr(title, 'spellcheck', spell); }
    }
  };

  const emit = useCallback(() => {
    if (readOnlyRef.current) return;
    const el = rootRef.current;
    if (!el) return;
    repairCaptionIslands(el);
    /* 120.md §3 — and the affordance is re-established here, beside the island
       re-stamp, for exactly the same reason: this is where EVERY shape change
       passes, including the ones no command of ours made (a native undo, a
       browser-default delete, a drop). Running before serialization is harmless by
       construction — htmlToMd drops an empty paragraph, so what the parent receives
       is byte-identical either way, which is what keeps the affordance out of the
       document, out of the autosave and out of the export. */
    ensureTrailingParagraph(el);
    /* 121.md r2 — …and the ONE place a STALE end-of-block pad is kept out of the
       model: one that no longer ends its block is interior whitespace, and mdDom trims
       block EDGES only, so it would otherwise fold into a permanent double space in
       the markdown, the autosave and the .docx. Byte-identical for every pad that is
       still trailing (the serializer trims those already) and for every section that
       has none — `padStrippedHtml` answers null and the live innerHTML is used
       unchanged. It never writes to the live DOM: see the function. */
    const padded = padStrippedHtml(el, padNodesRef.current);
    /* 119.md §2 — the ONE place the orphan-caption repair runs: a caption whose
       table a native selection-delete removed is dropped as the section is
       serialized. Undo-safe by construction (see dropOrphanCaptionBlocks).
       120.md r2 — and the ONE place that can tell the repair which table each caption
       actually owned: the answer from the PREVIOUS emit. Without it, a caption whose
       own table was natively deleted claimed the next caption-less table in the
       section — a legacy or hand-typed pipe table the researcher never captioned —
       and kept its number, title and cross-references, silently and byte-stably.
       The map is derived from the markdown we just produced, so it always describes
       the state the next emit starts from (including after a native undo). */
    const md = htmlToMd(padded == null ? el.innerHTML : padded, {
      dropOrphanCaptions: true, captionPairs: captionPairsRef.current,
    });
    captionPairsRef.current = captionTablePairs(md);
    onChangeRef.current && onChangeRef.current(md);
  }, []);

  /* 120.md §6 — the caption-title spellcheck stamp on the paths `emit` does not
     cover: the FIRST paint (mdDom rendered them with spellcheck="true" and no
     mutation has happened yet) and a later flip of the prop while the section sits
     untouched. Attribute writes only, on non-content structure — nothing here can
     reach htmlToMd, the autosave or the undo stack.

     Also the root-element handout the decoration layer needs. The layer only READS
     this element (TreeWalker + Range); the underlines themselves live in
     CSS.highlights, outside the DOM entirely. */
  useEffect(() => {
    const el = rootRef.current;
    if (el) repairCaptionIslands(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeSpellcheck]);

  useEffect(() => {
    if (!onRootRef) return undefined;
    onRootRef(rootRef.current || null);
    return () => onRootRef(null);
    // `onRootRef` must be a STABLE callback (the panel builds one per section, once)
    // — an inline arrow here would detach and re-attach the root on every render.
  }, [onRootRef]);

  const selectionInRoot = () => {
    const sel = typeof window !== 'undefined' && window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || !rootRef.current) return false;
    return rootRef.current.contains(sel.getRangeAt(0).commonAncestorContainer);
  };

  const apiRef = useRef(null);
  /* 119.md §2 — applied table-insertion operation ids (opId → minted table id).
     See api.insertTable for why this is idempotency rather than debouncing. */
  const insertOpIds = useRef(new Map());

  /* ══════════ 120.md §5 — the "citation lands at the start of the section" bug ══
   *
   * `rememberSelection` is wired to the root's onFocus. `focusWithSelection` calls
   * el.focus() to bring DOM focus back after a toolbar button or a picker took it —
   * and that focus() fires onFocus SYNCHRONOUSLY, AFTER the browser has installed
   * its own default caret for a newly-focused contentEditable, which is position 0.
   * So the very act of restoring focus overwrote `savedRange.current` with a
   * position-0 caret BEFORE the restore could read it: every insertion whose live
   * selection had been lost landed at the beginning of the section, and the
   * intended caret-at-END fallback below was dead code that could never run.
   *
   * The flag makes restoration ATOMIC: while it is set, the passive refreshers
   * (focus/keyup/mouseup/input) do not touch the saved caret. It is set and cleared
   * synchronously around the focus() call, so nothing else can observe it.
   */
  const restoringRef = useRef(false);

  const rememberSelection = () => {
    if (restoringRef.current) return;
    const sel = typeof window !== 'undefined' && window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || !rootRef.current) return;
    const r = sel.getRangeAt(0);
    if (rootRef.current.contains(r.commonAncestorContainer)) {
      savedRange.current = r.cloneRange();
      // hand THIS editor's api to the parent — one shared toolbar can then act on
      // whichever field last held the caret (abstract subsections, MS-5)
      onActivate && onActivate(apiRef.current);
      // 116.md §61 — keep the parent's floating table controls in step with the
      // caret (runs on keyup/mouseup/focus/input, so the anchor rect stays fresh
      // while the table grows).
      notifyTableFocus();
    }
  };

  // Refocus the editor and restore the last known caret (toolbar buttons and the
  // citation picker steal focus). Falls back to caret-at-end.
  const focusWithSelection = () => {
    const el = rootRef.current;
    if (!el) return false;
    /* 119.md §2 — the caret can be inside this root while DOM FOCUS sits on a
       toolbar control the researcher reached with the KEYBOARD (the mouse path
       preventDefaults its mousedown and never moves focus, but Tab/Enter genuinely
       does). execCommand acts on the focused editing host, so "the selection is in
       root" is not on its own enough: restore focus too, carrying the live range
       across so the insertion still lands where the researcher left the caret. */
    const inside = typeof document !== 'undefined' && document.activeElement
      && (document.activeElement === el || el.contains(document.activeElement));
    const live = selectionInRoot();
    if (inside && live) return true;
    const sel0 = typeof window !== 'undefined' && window.getSelection && window.getSelection();
    const keep = (live && sel0 && sel0.rangeCount) ? sel0.getRangeAt(0).cloneRange() : null;
    /* 120.md §5 — read the saved caret into a LOCAL before focus() can clobber it,
       and suppress the passive refresher for the duration of the call. Belt and
       braces on purpose: the local is what this function uses, the flag is what
       protects every OTHER reader of savedRange (the bookmark, the table ops) from
       a position-0 caret this restoration invented. */
    const saved = savedRange.current;
    restoringRef.current = true;
    try { el.focus(); } finally { restoringRef.current = false; }
    const sel = window.getSelection();
    if (!sel) return true;
    sel.removeAllRanges();
    /* 121.md §4 (fix 4) — A SAVED RANGE POINTED AT THE ROOT IS NOT A TEXT POSITION.
       A live Range survives the removal of its own nodes: the browser re-points it at
       the surviving parent, so a section whose children were all replaced leaves
       `savedRange` collapsed at (root, k) — and `el.contains(...)` accepts that
       without complaint. Inserting there puts the chip BETWEEN two blocks, and
       mdDom's walkBlocks then serializes that inline run as its OWN paragraph: the
       one variant of the "next line" defect that survives a reload. So a rooted range
       is first SNAPPED into the adjacent block (which is where the researcher's caret
       visibly was), and only a rooted range that cannot be snapped is rejected — the
       caret-at-end fallback below, unchanged, is what a lost caret has always meant
       on this path (the picker paths refuse instead; see restoreCaretBookmark). */
    const rootedSaved = !!saved && saved.commonAncestorContainer === el;
    // Deferred, so the snap runs ONLY on the branch that would install this range.
    const usable = () => !!saved && el.contains(saved.commonAncestorContainer)
      && (!rootedSaved || snapCollapsedEndIntoBlock(saved, null));
    if (keep) sel.addRange(keep);
    else if (usable()) {
      // Clone: a Range handed to the selection is live in some engines, and the
      // saved caret must not be dragged along by the next cursor movement.
      savedRange.current = saved;
      sel.addRange(saved.cloneRange());
    } else {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.addRange(r);
    }
    return true;
  };

  const exec = useCallback((cmd, val) => {
    if (!focusWithSelection()) return;
    try { document.execCommand(cmd, false, val); } catch { /* unsupported command → no-op */ }
    rememberSelection();
    emit();
  }, [emit]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * @param {string} html
   * @param {object} [opts]
   * @param {boolean} [opts.hoistFromIslands] 119.md §2 — the html contains BLOCK
   *   content the pipe grammar cannot nest (a table, a captioned table, a
   *   paragraph). Move the insertion point out of any caption island / table cell
   *   first, so the insertion can never produce DOM that htmlToMd would then throw
   *   away. Inline insertions (citation and cross-reference chips) never set it:
   *   a chip inside a cell is legal, and hoisting one would be a caret bug.
   */
  const insertHtml = useCallback((html, opts) => {
    if (!focusWithSelection()) return;
    if (opts && opts.hoistFromIslands) hoistInsertionPoint({ blockLevel: !!(opts && opts.blockLevel) });
    /* 121.md §4 r1 — an INLINE insertion at the end of a block needs the sacrificial
       nbsp pad, or Blink puts the element after the block (see endOfBlockPad). It stays
       in the DOM on purpose — the serializer trims it, and removing it would corrupt
       the engine's own undo of this very command. */
    if (opts && opts.inlineAtCaret) endOfBlockPad();
    let ok = false;
    try { ok = document.execCommand('insertHTML', false, html); } catch { ok = false; }
    if (!ok) {
      // Range fallback for engines without insertHTML
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        const lastNode = tpl.content.lastChild;
        r.insertNode(tpl.content);
        if (lastNode) {
          r.setStartAfter(lastNode);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    }
    rememberSelection();
    emit();
  }, [emit]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 116.md §61 — apply a pure table op by whole-table replacement (see the
      table header comment above). Returns true when a table op was applied. */
  const runTableOp = (opId, ctxOverride, forcedTable) => {
    if (readOnlyRef.current) return false;
    /* 119.md §2 — resolving WHICH table, in falling order of certainty:
       `forcedTable`   a whole-table selection (Delete/Backspace/Cut) hands the node
                       straight in, so the key runs the very same op the ✕ Table menu
                       runs rather than a second deletion that would orphan a caption;
       `ctxOverride.tableId`  the caller named the object (the §11 delete confirmation
                       knows the id it warned about, and by the time the researcher
                       confirms, the caret is long gone);
       the live caret; and finally the last table the caret owned — the fallback that
       makes the floating controls work in Safari at all (see notifyTableFocus). */
    const { tableId: overrideId, ...opCtx } = ctxOverride || {};
    const named = overrideId ? tableForCaptionId(overrideId) : null;
    const lr = lastTableRef.current;
    const rememberedBase = lr ? contextForTable(lr.table) : null;
    // The remembered cell matters: 'rowAbove' on the row the caret was in is a
    // different edit from 'rowAbove' on row 0.
    const remembered = rememberedBase ? { ...rememberedBase, gridRow: lr.gridRow, col: lr.col } : null;
    const ctx = contextForTable(forcedTable) || contextForTable(named)
      || tableDomContext() || remembered;
    if (!ctx) return false;
    const res = applyTableOp(opId, htmlToMd(ctx.table.outerHTML), {
      gridRow: ctx.gridRow, col: ctx.col, ...opCtx,
    });
    if (!res) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    const cap = captionForTable(ctx.table);
    const tableId = cap ? (cap.getAttribute('data-tblcap') || '') : '';
    const r = document.createRange();
    // 117.md §4 — a table and its caption are ONE object. Deleting the table
    // selects the caption too, so the id disappears with the data instead of
    // leaving an orphan caption that would keep numbering an empty slot. One
    // native undo restores both, which is exactly why identity lives in the prose.
    /* 119.md §2 — select the WHOLE object (caption + table). Rebuildable, because
       the WebKit retry below needs the same range a second time. */
    const selectObject = () => {
      /* …and the selection climbs out of any wrapper that holds NOTHING
         but this object first. Engines disagree about the START of a replacement
         range: WebKit PRESERVES the block the range begins in, so a range starting
         before a caption that a wrapper <div> holds left the caption element behind
         as an empty husk — the "Delete does not delete the table" report, in Safari,
         through the ✕ Table menu as much as through the key. Selecting the wrapper
         itself is the same edit expressed one level up, it is what Blink was already
         doing implicitly, and one native undo still restores everything. The guard
         is what keeps it safe: we only climb while the parent contains this object
         and nothing else. */
      let startNode = cap || ctx.table;
      let endNode = ctx.table;
      const owns = cap ? 2 : 1;
      while (startNode.parentElement && startNode.parentElement !== rootRef.current
        && endNode.parentElement === startNode.parentElement
        && significantChildren(startNode.parentElement).length === owns) {
        startNode = startNode.parentElement;
        endNode = startNode;
      }
      const rr = document.createRange();
      rr.setStartBefore(startNode);
      rr.setEndAfter(endNode);
      sel.removeAllRanges();
      sel.addRange(rr);
      savedRange.current = rr.cloneRange();
    };
    if (res.md == null) {
      selectObject();
      // delete-table → an empty paragraph keeps a caret target; htmlToMd drops
      // it again, so the persisted markdown stays clean
      insertHtml('<p><br></p>');
      /* 119.md §2 — the last engine difference, handled by RETRY rather than by a
         branch on the engine.
         WebKit's replacement machinery treats a contenteditable="false" element at
         the START of the range as immovable. Depending on what precedes the object it
         either makes the whole command a NO-OP — "✕ Table does nothing in Safari",
         exactly as reported, whenever the table opens the section — or it keeps the
         caption element as an empty husk with its number and title deleted. Blink
         does neither, and the cases WebKit already handles must not be disturbed, so
         the fix only runs when the first attempt provably did not finish.
         Releasing the attribute is a write to non-content STRUCTURE, not a content
         edit: the grammar re-derives it on every mount and repairCaptionIslands
         re-stamps it on the emit that follows (including the emit an undo triggers),
         so no caret can ever reach the derived number. */
      const stillThere = () => rootRef.current && rootRef.current.contains(ctx.table);
      if (stillThere() && cap) {
        cap.removeAttribute('contenteditable');
        selectObject();
        insertHtml('<p><br></p>');
      }
      /* …and whatever caption WebKit left standing goes too — but only once the
         TABLE is provably gone, so a command that failed outright can never turn
         into "the caption disappeared and the data stayed". That covers both shapes
         WebKit leaves: an emptied husk and a complete caption. It goes through the
         same execCommand path everything else uses, never a removeChild.
         120.md r2 — the test is THIS caption's own table, and `stillThere()` has
         already proved it is gone; the old extra `cap.nextElementSibling !== TABLE`
         condition kept the husk standing precisely when a DIFFERENT, caption-less
         table happened to follow it, which is the second route into the caption
         identity-theft the serializer now refuses (mdDom's repairCaptionBlocks). */
      if (!stillThere() && cap && rootRef.current && rootRef.current.contains(cap)) {
        cap.removeAttribute('contenteditable');
        replaceNode(cap, null);
        /* 120.md §3 (r1) — and when the mutation path PROVABLY LIED, the husk goes
           directly. Reproduced under webkit-manuscript: with the §3 trailing
           affordance now following the husk, WebKit's execCommand('delete') over a
           selectNode(husk) range RETURNS TRUE while removing nothing (the retry's
           insertHTML had merged the replacement <p> INSIDE the preserved caption
           div, and a div holding a block child survives the delete). This direct
           removal does not violate the never-removeChild doctrine, because that
           doctrine protects the undo stack and the autosave — and a caption whose
           table is gone is ALREADY invisible to both: the serializer drops its
           line on every emit (dropOrphanCaptionBlocks), so the persisted markdown
           is byte-identical with or without the husk, exactly like a sacrificial
           pad. Native undo still restores caption + table together from the
           replacement the engine DID record. Guarded to run only after the
           execCommand path was given its chance and provably did not finish. */
        if (rootRef.current.contains(cap) && typeof cap.remove === 'function') cap.remove();
      }
      // 120.md §3 — a deletion can promote another media block to last child.
      ensureTrailingParagraph(rootRef.current);
      notifyTableFocus();
      return true;
    }
    // A STRUCTURAL op replaces the table node in place; the caption is untouched.
    r.setStartBefore(ctx.table);
    r.setEndAfter(ctx.table);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
    const html = mdToHtml(res.md, {
      orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
      ...factOptsRef.current, ...refOptsRef.current, figures: figuresRef.current,
    }).replace('<table>', '<table data-ms-new="1">');
    insertHtml(html);
    const nt = rootRef.current && rootRef.current.querySelector('table[data-ms-new="1"]');
    if (nt) {
      // the marker only exists to find the replacement table again; it is removed
      // immediately and htmlToMd ignores unknown attributes, so it never persists
      nt.removeAttribute('data-ms-new');
      if (res.caret) focusCellAt(nt, res.caret.gridRow, res.caret.col);
    }
    // 117.md §4 — a STRUCTURAL change stamps the table's last-modified time (prose
    // typing does not: the draft's own updatedAt already covers that, and stamping
    // per keystroke would be write amplification for a hover tooltip).
    if (tableId && onTableMetaRef.current) onTableMetaRef.current(tableId, { updatedAt: new Date().toISOString() });
    // 120.md §3 — a whole-table replacement re-creates the <table> node, so the
    // affordance below a trailing table is re-established here too.
    ensureTrailingParagraph(rootRef.current);
    notifyTableFocus();
    return true;
  };

  /**
   * 117.md §10 — replace or delete ONE node through the editor's normal mutation
   * path (selection → execCommand), so native undo records it and the resulting
   * input event autosaves it. Returns false when the node is no longer ours.
   */
  const replaceNode = (node, html) => {
    const el = rootRef.current;
    if (readOnlyRef.current || !el || !node || !el.contains(node)) return false;
    if (typeof window === 'undefined' || !window.getSelection) return false;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return false;
    const r = document.createRange();
    r.selectNode(node);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
    if (html) { insertHtml(html); return true; }
    let ok = false;
    try { ok = document.execCommand('delete'); } catch { ok = false; }
    if (!ok) r.deleteContents();
    rememberSelection();
    emit();
    return true;
  };

  /* ══════════ 120.md §3/§4 — the media BOUNDARY commands ══════════
   *
   * These are the keyboard half of "a media block is a structured entity you can
   * write around but not into". Everything here only ever MOVES A CARET — none of
   * it mutates the document — so the undo stack, the autosave and the byte-stable
   * markdown are untouched by construction. The one exception is the redirected
   * character in onCaptionGapKeyDown, which goes through the same execCommand path
   * as ordinary typing and is therefore one ordinary native undo step.
   *
   * The rule for every handler below is the 108.md §23 router rule: claim ONLY
   * unmodified keys, and only in the exact position where the browser has nothing
   * valid to do. Anywhere the engine already behaves, it keeps the key.
   */

  /** The LAST top-level block of the media object a node sits in, or null. A
      manual table's object is caption + table (the table ends it); a figure's
      object is the single island. */
  const mediaObjectEndBlock = (node) => {
    const el = rootRef.current;
    if (!el || !node) return null;
    const cap = captionFromNode(node);
    if (cap) {
      if (cap.classList && cap.classList.contains(FIGURE_BLOCK_CLASS)) return topBlockOf(cap);
      const next = cap.nextElementSibling;
      return topBlockOf(next && next.tagName === 'TABLE' ? next : cap);
    }
    const cell = cellFromNode(node);
    const table = cell && typeof cell.closest === 'function' ? cell.closest('table') : null;
    if (table && el.contains(table)) return topBlockOf(table);
    return null;
  };

  /**
   * Put a collapsed caret at the START of the block after `top`, synthesizing the
   * trailing paragraph first when `top` is the last block (120.md §3). Returns
   * false when there is nowhere to land, and the caller then leaves the keystroke
   * to the browser rather than inventing a position.
   *
   * A next block that is itself MEDIA is deliberately refused: an empty paragraph
   * wedged between two media objects is not expressible in the persisted markdown
   * (the serializer drops empties), so it would silently disappear on reload. The
   * researcher can still put a paragraph there by typing in the one below and
   * moving it, and the caption/table pair keeps its adjacency.
   */
  const placeCaretAfterBlock = (top) => {
    const el = rootRef.current;
    if (!el || !top || top.parentElement !== el) return false;
    if (typeof window === 'undefined' || !window.getSelection) return false;
    if (!nextSignificantSibling(top)) ensureTrailingParagraph(el);
    const next = nextSignificantSibling(top);
    if (!next || next.nodeType !== 1 || isMediaBlockNode(next)) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    // The caret was inside a nested editing island (a caption title), so DOM focus
    // has to come back to the host before the range is applied — the same order
    // placeCaretInTitle uses in the other direction.
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(next);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
    return true;
  };

  /** The collapsed caret range inside this root, or null (a selection is not a
      caret, and every handler here is about where the caret IS). */
  const collapsedCaretRange = () => {
    const el = rootRef.current;
    if (!el || typeof window === 'undefined' || !window.getSelection) return null;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    return el.contains(r.startContainer) ? r : null;
  };

  /** Is the caret at the very end of `node`'s text? (Nothing but markup after it.) */
  const caretAtEndOfNode = (node, range) => {
    if (!node || !range) return false;
    try {
      const r = document.createRange();
      r.selectNodeContents(node);
      r.setStart(range.endContainer, range.endOffset);
      return r.toString().length === 0;
    } catch { return false; }
  };

  /**
   * 120.md §3 — ArrowDown out of trailing media, and 120.md §4 — Enter in a title.
   *
   *  · ArrowDown in the LAST ROW of a table that nothing follows (or that only the
   *    synthesized paragraph follows) lands in that paragraph. In every other row
   *    the browser is already right — it moves down a row — so it keeps the key.
   *  · ArrowDown in a FIGURE title does the same, because a figure's caption sits
   *    BELOW its picture. A TABLE caption sits ABOVE its table, so ArrowDown there
   *    must keep moving INTO the table: left native, deliberately.
   *  · Enter in a caption/figure title never splits the entity (§4 is explicit).
   *    At the end of the title it moves the caret to the paragraph below the whole
   *    object — the "move from the final caption to a new paragraph" interaction
   *    §3 asks for. Mid-title, and for Shift+Enter, it is swallowed: a title is one
   *    line, and a line break there is not a thing this model can express (the
   *    serializer's cleanCaptionTitle already strips newlines — this just stops the
   *    UI from pretending otherwise).
   */
  const onMediaBoundaryKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'Enter') return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    /* An IME composition keystroke is not a command — the Enter that COMMITS a
       CJK/accent candidate must reach the input method, not move the caret out of
       the title. Same rule (and same two tests) the 108.md §23 adapter applies. */
    if (e.isComposing || e.keyCode === 229) return false;
    const r = collapsedCaretRange();
    if (!r) return false;
    const cap = captionFromNode(r.startContainer);
    const titleEl = cap ? captionTitleOf(cap) : null;
    const inTitle = !!(titleEl && (titleEl === r.startContainer || titleEl.contains(r.startContainer)));
    if (e.key === 'Enter') {
      if (!inTitle) return false;
      e.preventDefault();
      if (e.shiftKey) return true;
      if (!caretAtEndOfNode(titleEl, r)) return true;
      placeCaretAfterBlock(mediaObjectEndBlock(r.startContainer));
      return true;
    }
    // A Shift-extended ArrowDown is a SELECTION gesture — always the browser's.
    if (e.shiftKey) return false;
    let top = null;
    if (inTitle) {
      if (!(cap.classList && cap.classList.contains(FIGURE_BLOCK_CLASS))) return false;
      top = topBlockOf(cap);
    } else {
      const cell = cellFromNode(r.startContainer);
      const table = cell && typeof cell.closest === 'function' ? cell.closest('table') : null;
      if (!table || !rootRef.current.contains(table)) return false;
      const trs = Array.from(table.querySelectorAll('tr'));
      if (trs.indexOf(cell.closest('tr')) !== trs.length - 1) return false;
      top = topBlockOf(table);
    }
    if (!top) return false;
    /* Only when the media is TRAILING — i.e. nothing follows it, or the only thing
       that follows is the synthesized empty paragraph at the very end. Media with
       real prose after it is a position every engine already handles. */
    const next = nextSignificantSibling(top);
    if (next && !(isEmptyParagraph(next) && !nextSignificantSibling(next))) return false;
    if (!placeCaretAfterBlock(top)) return false;
    e.preventDefault();   // …only now, because only now did the caret actually move
    return true;
  };

  /**
   * 120.md §4 — CLOSE the gap between a caption and its table.
   *
   * The caption island and the <table> are top-level SIBLINGS, so a browser will
   * put a collapsed caret between them and a keystroke there creates an arbitrary
   * paragraph inside the object — the precise structure §4 forbids ("Table 1 /
   * Example title / an unrelated paragraph / the actual table"), and the structure
   * that used to cost the researcher the caption entirely on the next save.
   *
   * The fix is the inverse of hoistInsertionPoint: an insertion that has no valid
   * position inside the object is moved to the one region of it that IS editable —
   * the title — and the keystroke follows the caret. The character is inserted
   * through execCommand like any other typing, so it is one native undo step and
   * one ordinary autosave emit.
   */
  const captionGapCaption = () => {
    const el = rootRef.current;
    const r = collapsedCaretRange();
    if (!el || !r) return null;
    let before = null;
    let after = null;
    if (r.startContainer === el) {
      const kids = el.childNodes;
      let b = kids[r.startOffset - 1] || null;
      while (b && !isSignificantNode(b)) b = b.previousSibling;
      let a = kids[r.startOffset] || null;
      while (a && !isSignificantNode(a)) a = a.nextSibling;
      before = b;
      after = a;
    } else if (r.startContainer.nodeType === 3 && r.startContainer.parentNode === el
      && !String(r.startContainer.textContent || '').trim()) {
      // Engines also park the caret in the whitespace text node between two blocks.
      before = prevSignificantSibling(r.startContainer);
      after = nextSignificantSibling(r.startContainer);
    } else return null;
    if (!before || !after || before.nodeType !== 1) return null;
    if (!(before.classList && before.classList.contains(TABLE_CAPTION_CLASS))) return null;
    if (String(after.tagName || '').toUpperCase() !== 'TABLE') return null;
    return before;
  };

  const onCaptionGapKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.isComposing || e.keyCode === 229) return false;   // never claim an IME keystroke
    // One-character keys are the printable ones ('a', ' ', '€'); 'Dead'/'Process'
    // and every named key are longer, so IME composition is never claimed here.
    const printable = typeof e.key === 'string' && e.key.length === 1;
    if (!printable && e.key !== 'Enter') return false;
    const cap = captionGapCaption();
    const titleEl = cap ? captionTitleOf(cap) : null;
    if (!titleEl) return false;
    e.preventDefault();
    placeCaretInTitle(titleEl);   // no point → the END of the title
    if (printable) exec('insertText', e.key);
    return true;
  };

  /**
   * 120.md §3 — a CLICK in the empty space below trailing media.
   *
   * `e.target === root` means the pointer hit the editing host itself rather than
   * any block in it, which is exactly the "visual space directly below the media"
   * §3 names. With the synthesized paragraph in place most engines land there on
   * their own; claiming the case makes it deterministic in all of them (an empty
   * block after a `contenteditable="false"` island is precisely the caret geometry
   * WebKit has been unreliable about — 119.md §2's finding, same shape).
   *
   * Scoped hard: only when the last block is media or the synthesized paragraph
   * after media, and only when the pointer is genuinely BELOW it. A click beside
   * ordinary prose keeps the browser's own placement.
   */
  const onBelowMediaMouseDown = (e) => {
    const el = rootRef.current;
    if (!el || e.target !== el || readOnlyRef.current) return false;
    const last = lastSignificantChild(el);
    const afterMedia = isMediaBlockNode(last)
      || (isEmptyParagraph(last) && isMediaBlockNode(prevSignificantSibling(last)));
    if (!afterMedia) return false;
    const box = typeof last.getBoundingClientRect === 'function' ? last.getBoundingClientRect() : null;
    if (!box || typeof e.clientY !== 'number' || e.clientY < box.bottom) return false;
    ensureTrailingParagraph(el);
    const target = lastSignificantChild(el);
    if (!isEmptyParagraph(target) || typeof window === 'undefined' || !window.getSelection) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    e.preventDefault();
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(target);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
    return true;
  };

  /* ══════════ 120.md §5 — the picker-session caret bookmark ══════════
   *
   * §5's required lifecycle is: capture the selection BEFORE the popover, the
   * search input or the portal takes focus; let the researcher search
   * asynchronously; map the saved position through whatever happened to the
   * document meanwhile; insert THERE; and if it cannot be found again, say so
   * rather than inserting somewhere else.
   *
   * `savedRange` cannot serve on its own. It is a raw DOM Range that is passively
   * refreshed, and it dies whenever the section remounts (mount key = active draft
   * + section + generation stamp + content epoch), whenever a whole-table
   * replacement swaps the DOM out from under it, and whenever Section View
   * switches away. A bookmark therefore carries BOTH:
   *
   *   · `range`   — the live Range, used when its container is still connected to
   *                 this root. Exact, and the case that holds ~always.
   *   · `logical` — { blockIndex, charOffset, before, after }: which top-level
   *                 block, how far into its text, and what the text either side
   *                 said. Survives a remount, because it describes the TEXT rather
   *                 than the nodes. The context strings are verified before the
   *                 position is used, and an ambiguous match is refused (see
   *                 caretBookmark.js).
   *
   * There is no third fallback. "Insert at the start of the section" is the exact
   * behaviour §5 exists to remove.
   */
  const bookmarkRef = useRef(null);

  /** The nested editing island (a caption/figure title) a node sits in, or null. */
  const titleHostOf = (node) => {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== rootRef.current) {
      if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return el;
      el = el.parentElement;
    }
    return null;
  };

  /* ══════════ 121.md §4 — the BOUNDARY NORMALISATION ══════════
   *
   * §4: "There is an intermittent defect where inserting a citation or cross-reference
   * places it on the following line even though the caret was located within the
   * current line." The dominant path needs no remount, no async data and no browser
   * bug — it is arithmetic the editor was doing to itself.
   *
   * A selection with LINE or PARAGRAPH granularity — triple-click, a drag past the end
   * of a line, Shift+Down — ends at the START OF THE NEXT BLOCK: Blink reports
   * (nextParagraph, 0). Both places that collapse a selection for an insertion
   * (`saveCaretBookmark` when the picker opens, `collapseSelectionToEnd` when it
   * commits) do `collapse(false)`, which honestly takes that boundary at its word. The
   * bookmark then records blockIndex = the FOLLOWING paragraph at charOffset 0, every
   * validity check passes, and the chip is inserted at the start of the next line —
   * exactly what the researcher reported, and only for selections that end at a
   * boundary, which is why it read as "intermittent".
   *
   * The normalisation: a collapsed caret at the START of a line block, produced by
   * collapsing a selection that BEGAN in an earlier block, belongs at the END of the
   * previous block's content — the position the researcher's selection visibly ended
   * at. A caret genuinely placed at the start of a line (no selection) is left exactly
   * where it is; that is the whole reason the previously-dead `hadSelection` flag
   * scopes this.
   *
   * The second, unconditional half is a caret at ROOT level, which is not a text
   * position at all in any editing model: it sits BETWEEN blocks, and execCommand
   * there produces an inline run that mdDom serializes as its own paragraph (the one
   * "next line" variant that survives a reload). It is snapped into the adjacent block
   * whether or not there was a selection.
   */

  /** A top-level block a caret can genuinely sit IN — a line of the document, or the
      bare text node Blink leaves when the first run is typed into an empty host. A
      table or a media island is not one. */
  const isRealLineBlock = (top) => {
    if (!top) return false;
    if (top.nodeType === 3) return true;
    if (top.nodeType !== 1) return false;
    if (isMediaBlockNode(top)) return false;
    return LINE_BLOCK_TAGS.has(String(top.tagName || '').toUpperCase());
  };

  /** A collapsed Range at the END of a block's content, SKIPPING the trailing
      placeholder `<br>` (a caret after it renders on a second visual line — the very
      shape §4 is about). Empty block → its start. */
  const caretAtEndOfBlock = (block) => {
    if (!block || typeof document === 'undefined') return null;
    const r = document.createRange();
    if (block.nodeType === 3) {
      r.setStart(block, (block.nodeValue || '').length);
      r.collapse(true);
      return r;
    }
    if (block.nodeType !== 1) return null;
    const kids = Array.from(block.childNodes);
    let i = kids.length - 1;
    while (i >= 0) {
      const n = kids[i];
      const isBr = n.nodeType === 1 && String(n.tagName || '').toUpperCase() === 'BR';
      const blank = n.nodeType === 3 && !(n.nodeValue || '').length;
      if (!isBr && !blank) break;
      i -= 1;
    }
    const last = i >= 0 ? kids[i] : null;
    if (!last) { r.selectNodeContents(block); r.collapse(true); return r; }
    if (last.nodeType === 3) { r.setStart(last, (last.nodeValue || '').length); r.collapse(true); return r; }
    r.setStartAfter(last);      // after a chip / a bold run — still INSIDE the block
    r.collapse(true);
    return r;
  };

  /** Is there genuinely nothing before this caret inside its own block? Text is
      measured with a Range (chips and nested marks contribute their text), and
      `gapHasElement` catches the invisible content `toString()` cannot see — a leading
      `<br>` or image means the caret is on a LATER visual line, not at the start. */
  const atBlockStart = (block, r) => {
    try {
      const probe = document.createRange();
      probe.selectNodeContents(block);
      probe.setEnd(r.startContainer, r.startOffset);
      if (probe.toString().length) return false;
      return !gapHasElement(probe);
    } catch { return false; }
  };

  /**
   * Move a collapsed caret out of a between-blocks / start-of-next-block position and
   * into the line it belongs to. Mutates `range` in place and returns whether it did.
   *
   * @param {Range}      range   the collapsed caret (mutated)
   * @param {Range|null} origin  the selection it was collapsed FROM, when there WAS a
   *                             selection (the `hadSelection` scope). null → only the
   *                             unconditional root-level rule applies.
   */
  const snapCollapsedEndIntoBlock = (range, origin) => {
    const el = rootRef.current;
    if (!el || !range || typeof document === 'undefined') return false;
    if (!range.collapsed) return false;
    if (!el.contains(range.startContainer)) return false;
    const blocks = significantChildren(el);
    const moveTo = (r) => {
      if (!r) return false;
      range.setStart(r.startContainer, r.startOffset);
      range.collapse(true);
      return true;
    };
    const top = topBlockOf(range.startContainer);
    if (!top) {
      // (a) ROOT LEVEL — between two blocks. Prefer the end of the block BEFORE the
      //     boundary (where a downward selection or a boundary click came from); the
      //     start of the block after it when there is nothing before.
      if (range.startContainer !== el) return false;
      const kids = Array.from(el.childNodes);
      const idx = Math.max(0, Math.min(range.startOffset, kids.length));
      let prev = null;
      for (let i = idx - 1; i >= 0; i -= 1) if (blocks.indexOf(kids[i]) >= 0) { prev = kids[i]; break; }
      if (isRealLineBlock(prev)) return moveTo(caretAtEndOfBlock(prev));
      /* 121.md r2 — a LIST is not a line, so the old refusal here left the caret at
         root level for every section that ends in one (Ctrl+A ends exactly there), and
         the chip was written after the `</ul>` as its own paragraph — the §4 variant
         that survives a reload. Descend to the end of the last item, which is the line
         the researcher's selection actually covered. */
      const lastLi = lastListLine(prev);
      if (lastLi) return moveTo(caretAtEndOfBlock(lastLi));
      let next = null;
      for (let i = idx; i < kids.length; i += 1) if (blocks.indexOf(kids[i]) >= 0) { next = kids[i]; break; }
      const startAt = (n) => {
        const r = document.createRange();
        r.selectNodeContents(n);
        r.collapse(true);
        return moveTo(r);
      };
      if (!isRealLineBlock(next)) {
        const firstLi = firstListLine(next);      // 121.md r2 — …and the same on this side
        return firstLi ? startAt(firstLi) : false;
      }
      return startAt(next);
    }
    // (b) START OF A LINE BLOCK, reached by collapsing a selection that began earlier.
    if (!origin || origin.collapsed) return false;
    /* (c) 121.md §4 r1 — …or the selection ended in a block the caret cannot write
       PROSE into. WebKit's paragraph-granularity selection does not stop at the end of
       the paragraph: it reaches into the CAPTION ISLAND that follows, and collapsing to
       that end put the cross-reference inside the table's TITLE — a different line
       block, and one whose serialization keeps only the marker, so the chip vanished at
       the next save. The insertion belongs on the last REAL line the selection covered.
       Scoped twice over: a collapsed caret never reaches here (origin is null), so
       §1's "a symbol inserts inside a caption title" is untouched; and a selection that
       ends in a table CELL is left alone, because a cell IS a real line of the
       document and a chip there is legal. */
    if (!isRealLineBlock(top)) {
      const lb = lineBlockOf(range.startContainer);
      const lbTag = lb && lb.tagName ? String(lb.tagName).toUpperCase() : '';
      if (lbTag === 'TD' || lbTag === 'TH') return false;
      const endsIn = blocks.indexOf(top);
      const from = blocks.indexOf(topBlockOf(origin.startContainer));
      if (endsIn < 0 || from < 0 || from >= endsIn) return false;
      for (let i = endsIn - 1; i >= from; i -= 1) {
        if (isRealLineBlock(blocks[i])) return moveTo(caretAtEndOfBlock(blocks[i]));
      }
      return false;
    }
    if (!atBlockStart(top, range)) return false;
    const here = blocks.indexOf(top);
    const began = blocks.indexOf(topBlockOf(origin.startContainer));
    if (here <= 0 || began < 0 || began >= here) return false;
    const prev = blocks[here - 1];
    if (!isRealLineBlock(prev)) return false;   // never snap INTO a table or a figure
    return moveTo(caretAtEndOfBlock(prev));
  };

  /**
   * 121.md §4 r1 — THE SCOPE OF "a root-level caret is not a text position".
   *
   * Fix 4 refuses a caret whose container is the editing host itself, because that is
   * how a chip ends up BETWEEN two blocks. But the host's children are not always
   * blocks: typing the first run into an empty section leaves bare text nodes, chips
   * and `<br>`s as DIRECT children (Blink wraps nothing until the first Enter), so a
   * caret after a Shift+Enter at that level has a root container and is nevertheless a
   * perfectly ordinary position inside the one implicit line of the document. Refusing
   * it turned "cite, Shift+Enter, cite again" into a CARET_LOST notice
   * (manuscript-citation-caret-120.spec.ts §5 r2).
   *
   * The distinction fix 4 actually needs is not "root container" but "between BLOCKS":
   * if either side of the offset is INLINE content, the insertion joins that inline run
   * and mdDom's walkBlocks keeps it in the same block — no paragraph is created. A host
   * with no significant children at all has nothing to be between, so it is inline too.
   * Everything fix 4 was written for — a caret between two paragraphs, before the first
   * block, after the last one — still has blocks on both sides and is still refused.
   */
  const rootInlineCaret = (container, offset) => {
    const el = rootRef.current;
    if (!el || container !== el) return false;
    const kids = Array.from(el.childNodes);
    const blocks = significantChildren(el);
    if (!blocks.length) return true;                 // nothing to be BETWEEN
    const idx = Math.max(0, Math.min(Math.floor(Number(offset) || 0), kids.length));
    let prev = null;
    for (let i = idx - 1; i >= 0; i -= 1) if (blocks.indexOf(kids[i]) >= 0) { prev = kids[i]; break; }
    let next = null;
    for (let i = idx; i < kids.length; i += 1) if (blocks.indexOf(kids[i]) >= 0) { next = kids[i]; break; }
    const inline = (n) => {
      if (!n) return false;
      if (n.nodeType === 3) return true;             // a bare run of prose
      if (n.nodeType !== 1) return false;
      if (isMediaBlockNode(n)) return false;
      const tag = String(n.tagName || '').toUpperCase();
      /* 121.md r2 — a CONTAINER of lines is a block, however inline it looks to a
         tag-name test. A UL/OL passed both tests above and read as inline, so the
         caret Ctrl+A leaves after a trailing list was accepted as "a real position"
         and the chip landed between the list and the end of the section. */
      if (BLOCK_CONTAINER_TAGS.has(tag)) return false;
      return !LINE_BLOCK_TAGS.has(tag);
    };
    return inline(prev) || inline(next);
  };

  /** Snapshot a caret position as { blockIndex, charOffset, before, after } — plus,
      for a caret in an EMPTY block, { prevTail, nextHead } (121.md §4, see below). */
  const caretLogicalOf = (r) => {
    const el = rootRef.current;
    if (!el || !r) return null;
    const top = topBlockOf(r.endContainer);
    if (!top) return null;
    const blocks = significantChildren(el);
    const blockIndex = blocks.indexOf(top);
    if (blockIndex < 0) return null;
    let offset = 0;
    try {
      const pre = document.createRange();
      pre.selectNodeContents(top);
      pre.setEnd(r.endContainer, r.endOffset);
      offset = pre.toString().length;
    } catch { return null; }
    const lg = { blockIndex, ...logicalContext(top.textContent || '', offset) };
    /* 121.md §4 (fix 3) — AN EMPTY CONTEXT SAYS NOTHING ABOUT WHERE IT WAS. `before`
       and `after` are both empty exactly when the block holds no text, and that
       snapshot matches EVERY empty block in the section: after a remount (which drops
       un-persisted empty paragraphs — a blank markdown line renders nothing) the
       unique-block scan deterministically found the §3 trailing affordance and the
       citation landed at the end of the section (the documented F17,
       docs/editor-engine-120.md item 10). Remembering the NEIGHBOURS is what tells one
       empty block from another — and `null` for "there is no next block" is precisely
       what tells the trailing affordance apart from a paragraph in the middle. */
    if (!lg.before && !lg.after) {
      const prev = blockIndex > 0 ? blocks[blockIndex - 1] : null;
      const next = blocks[blockIndex + 1] || null;
      Object.assign(lg, neighborContext(
        prev ? (prev.textContent || '') : null,
        next ? (next.textContent || '') : null,
      ));
    }
    return lg;
  };

  /** Character offset within a block → a collapsed Range, never inside an atomic
      chip (a chip is contenteditable=false; a caret "inside" one is not a caret). */
  const rangeAtTextOffset = (top, offset) => {
    if (!top || typeof document === 'undefined') return null;
    /* A top-level block is not necessarily an ELEMENT. Typing the first run into an
       empty contentEditable leaves the text as a bare text node child of the
       editing host in Blink, and that node is a perfectly ordinary block of this
       document — treating it as "not a block" made every bookmark taken in a
       freshly typed section unresolvable. Reproduced in
       manuscript-citation-caret-120.spec.ts. */
    if (top.nodeType === 3) {
      const rt = document.createRange();
      rt.setStart(top, Math.max(0, Math.min(offset, (top.nodeValue || '').length)));
      rt.collapse(true);
      return rt;
    }
    const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT, null);
    let seen = 0;
    let node = null;
    while (walker.nextNode()) {
      const t = walker.currentNode;
      const len = (t.nodeValue || '').length;
      if (seen + len >= offset) { node = t; break; }
      seen += len;
    }
    const r = document.createRange();
    if (!node) {
      r.selectNodeContents(top);
      /* 121.md §4 (fix 2) — WHICH SIDE OF THE PLACEHOLDER <br>. An empty block is
         `<p><br></p>`, and `collapse(false)` yields (p, 1) — AFTER the br. Inserting
         there puts the chip on the second visual line of the very paragraph the caret
         was in, because the engine keeps the placeholder (WebKit reliably, Blink in
         some shapes): "inserted on the next line" without any block boundary being
         crossed at all. An empty block's only honest caret is at its START, which is
         also what the §3 trailing-affordance click handler installs (collapse(true)).
         A block WITH text keeps the old end-of-block behaviour: there the branch means
         "the offset is past the last character", and the end is where it belongs. */
      r.collapse(!(top.textContent || '').length);
      return r;
    }
    let atomic = null;
    let up = node.parentElement;
    while (up && up !== top && up !== rootRef.current) {
      if (up.getAttribute && up.getAttribute('contenteditable') === 'false') atomic = up;
      up = up.parentElement;
    }
    if (atomic) { r.setStartAfter(atomic); r.collapse(true); return r; }
    const max = (node.nodeValue || '').length;
    r.setStart(node, Math.max(0, Math.min(offset - seen, max)));
    r.collapse(true);
    return r;
  };

  /** Re-resolve a logical position against the CURRENT DOM, or null (refuse). */
  const rangeFromLogical = (logical) => {
    const el = rootRef.current;
    if (!el || !logical) return null;
    // Elements AND bare text nodes — see rangeAtTextOffset for why both are blocks.
    const blocks = significantChildren(el);
    /* 121.md §4 (fix 3) — a candidate must satisfy the block's OWN text rule AND, for
       an empty-context bookmark, still have the neighbours it was taken beside. Old
       bookmarks (no neighbour fields — one held across a hot update, or handed in by
       the workspace session) degrade to the pre-121 rule: `neighborsMatch` answers
       TRUE when there is nothing to verify. */
    const offsetIn = (b) => {
      const i = blocks.indexOf(b);
      const off = resolveContext(b.textContent || '', logical);
      if (off == null) return null;
      const prev = i > 0 ? blocks[i - 1] : null;
      const next = i >= 0 ? (blocks[i + 1] || null) : null;
      const ok = neighborsMatch(
        logical,
        prev ? (prev.textContent || '') : null,
        next ? (next.textContent || '') : null,
      );
      return ok ? off : null;
    };
    const emptyContext = !logical.before && !logical.after;
    const top0 = blocks[logical.blockIndex] || null;
    let top = top0;
    let off = top ? offsetIn(top) : null;
    /* …and the DIRECT INDEX HIT is not privileged for an empty context. Every empty
       block "fits" an empty context, so a remembered index that now addresses a
       DIFFERENT empty block resolved silently and confidently into the wrong place —
       the aliasing half of F17. For an empty context the index hit is therefore held
       to the same uniqueness discipline as the scan below: exactly one block in the
       section may claim it, or nothing is resolved. A context WITH text keeps index
       priority on purpose: two paragraphs may legitimately read the same ("Not
       applicable."), the remembered index is real evidence about which one, and
       refusing there would turn working insertions into refusal notices. */
    if (off != null && emptyContext) {
      let claims = 0;
      for (const b of blocks) if (offsetIn(b) != null) claims += 1;
      if (claims !== 1) return null;
    }
    if (off == null) {
      /* The block itself moved (a paste or a generation inserted blocks above it).
         Accept a match elsewhere ONLY when exactly one block in the section can
         claim this context — two candidates is exactly the "never insert into the
         wrong paragraph silently" case, and it refuses. */
      let hit = null;
      for (const b of blocks) {
        const o = offsetIn(b);
        if (o == null) continue;
        if (hit) return null;
        hit = { b, o };
      }
      if (!hit) return null;
      top = hit.b;
      off = hit.o;
    }
    return rangeAtTextOffset(top, off);
  };

  /**
   * Is the bookmark's LIVE range still the place it was taken from?
   *
   * A DOM Range is live in a way that defeats the obvious test. When the nodes it
   * points at are removed, the browser does not invalidate it — it RE-POINTS it at
   * the surviving parent. A section whose children are all replaced (a regenerate,
   * a snapshot restore, a structure merge) therefore leaves the saved range
   * collapsed at `(root, 0)`, which `root.contains(...)` accepts without complaint
   * — and inserting there is exactly the start-of-section behaviour §5 exists to
   * remove. Reproduced under chromium in manuscript-citation-caret-120.spec.ts.
   *
   * So the live range counts only when the TEXT around it still says what it said
   * when the bookmark was taken. If it does not, the logical re-resolution runs and
   * may still find the position honestly; if that fails too, the caller refuses.
   */
  const liveRangeStillValid = (r, logical) => {
    /* 121.md §4 (fix 4) — A NULL LOGICAL IS NOT A LICENCE. `caretLogicalOf` returns
       null when it cannot name a top-level block for the position: a selection END at
       ROOT level (select-all, a boundary click between two blocks) is the everyday
       way to get there. "Nothing to verify against — best effort" then accepted a
       caret that is not in any line of the document, and execCommand put the chip
       BETWEEN two paragraphs, where mdDom serializes it as its own paragraph. That is
       the only variant of the next-line defect that survives a reload.
       So a null logical is trusted ONLY when the range genuinely sits in a real line
       block (its own logical snapshot merely failed for some other reason). The
       save-side normalisation is the other half of this: `saveCaretBookmark` snaps
       root-level ends into the block they came from BEFORE the bookmark is taken, so
       this stays a rare refusal rather than a new everyday one. */
    if (!logical) {
      if (isRealLineBlock(topBlockOf(r && r.endContainer))) return true;
      /* 121.md §4 r1 — …and a root-level caret sitting in an INLINE run at root is a
         real position too (see rootInlineCaret): a section whose prose has never been
         wrapped in a block keeps its lines as bare children, and Shift+Enter leaves the
         caret exactly there. Scoping fix 4 to genuinely between-BLOCKS positions is
         what it always meant; refusing this one only produced a CARET_LOST notice
         where a second citation belonged. */
      return !!r && rootInlineCaret(r.endContainer, r.endOffset);
    }
    const now = caretLogicalOf(r);
    if (!now) return false;
    /* Deliberately NOT neighbour-checked. The neighbour context (fix 3) exists to tell
       one empty block from another when the position has to be RE-FOUND by text; a live
       range whose container is still connected to this root is not a re-resolution at
       all — it is the very node the bookmark was taken in. Requiring its neighbours to
       be unchanged would refuse a perfectly good caret because someone edited the
       paragraph above it, which is the refusal-rate risk the audit warns about. The
       re-resolution path (rangeFromLogical) is where the check belongs and is applied. */
    return now.before === logical.before && now.after === logical.after;
  };

  /** Install a resolved caret and hand DOM focus to whichever host owns it. */
  const applyCaretRange = (r) => {
    const el = rootRef.current;
    if (!el || !r || typeof window === 'undefined' || !window.getSelection) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    // 121.md §4 (fix 1) — normalise the INPUT too: a resolved range that landed at
    // root level (or at the start of a block a selection ran into) is snapped back
    // into the block it belongs to before it is installed as the caret.
    snapCollapsedEndIntoBlock(r, null);
    const host = titleHostOf(r.startContainer) || el;
    restoringRef.current = true;
    try { host.focus(); } finally { restoringRef.current = false; }
    sel.removeAllRanges();
    sel.addRange(r.cloneRange());
    savedRange.current = r.cloneRange();
    return true;
  };

  /* ══════════ 120.md §5 — citation GROUPING ══════════
   *
   * "Inserting a second citation adjacent to an existing citation should follow the
   * current style engine's grouping rules rather than producing malformed
   * duplicated brackets." One chip carrying [a,b] renders "[1,2]" (or the
   * author-year equivalent) through the SAME citeChipLabel every other chip uses,
   * so the grouping is the style engine's, not a second implementation of it.
   *
   * Adjacency is measured as TEXT: the run between the chip and the caret must be
   * empty or a single space/nbsp (the chip inserter leaves one nbsp behind, which
   * is exactly the gap a researcher's second citation appears in). Anything else —
   * a word, a comma, a full stop — is content between two citations, and merging
   * across it would change what the sentence says. Scoped to the caret's own LINE
   * block, because Range.toString() reports nothing for a block boundary and would
   * otherwise call the end of the previous paragraph "adjacent".
   */
  const LINE_BLOCK_TAGS = new Set(['P', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DIV', 'PRE']);
  /* 121.md r2 — CONTAINERS that hold lines without being one. mdDom's walkBlocks
     treats a UL/OL as a block (its BLOCK_TAGS lists them); the caret classifiers did
     not, and the disagreement is the whole "section that ends in a list" defect:
     `isRealLineBlock` refused to snap into one, and `rootInlineCaret` then read the
     very same UL as INLINE and accepted a caret sitting between it and the end of the
     section — where execCommand writes a root-level run that mdDom serializes as its
     own paragraph. Both sides now read a list the way the serializer does. */
  const BLOCK_CONTAINER_TAGS = new Set(['UL', 'OL', 'DL', 'TABLE', 'FIGURE', 'HR']);
  const LIST_TAGS = new Set(['UL', 'OL']);
  const tagOf = (n) => (n && n.nodeType === 1 ? String(n.tagName || '').toUpperCase() : '');
  const listItemsOf = (list) => Array.from((list && list.children) || [])
    .filter((c) => tagOf(c) === 'LI');
  /** The LAST line inside a list — its last item, or the last item of the nested list
      that item ends with (which is the visually last line of the whole construct). */
  const lastListLine = (node) => {
    let list = node;
    let li = null;
    for (let guard = 0; list && LIST_TAGS.has(tagOf(list)) && guard < 32; guard += 1) {
      const items = listItemsOf(list);
      if (!items.length) break;
      li = items[items.length - 1];
      const tail = li.lastElementChild;
      list = tail && LIST_TAGS.has(tagOf(tail)) ? tail : null;
    }
    return li;
  };
  /** …and the FIRST, for a caret that sits before a leading list. */
  const firstListLine = (node) => {
    const items = LIST_TAGS.has(tagOf(node)) ? listItemsOf(node) : [];
    return items.length ? items[0] : null;
  };
  const NON_SPACE_RE = /\S/;

  const lineBlockOf = (node) => {
    const el = rootRef.current;
    let n = node && (node.nodeType === 1 ? node : node.parentElement);
    while (n && n !== el) {
      if (LINE_BLOCK_TAGS.has(String(n.tagName || '').toUpperCase())) return n;
      n = n.parentElement;
    }
    return el;
  };

  // The regex space class already covers U+00A0, so the `&nbsp;` a chip insertion
  // leaves behind counts as joinable while a comma or a full stop never does.
  const joinableGap = (s) => s.length <= 1 && !NON_SPACE_RE.test(s);

  /** A collapsed Range at one boundary point (start/end of a node, or the caret). */
  const pointAt = (fn) => { const p = document.createRange(); fn(p); p.collapse(true); return p; };

  /** Elements that ARE content even though they hold no text — a soft line break, a
      picture. An EMPTY formatting wrapper (`<strong></strong>` cloned because the
      caret sits at the edge of a bold run) is not content and stays joinable. */
  const VOID_CONTENT_TAGS = new Set(['BR', 'IMG', 'HR', 'VIDEO', 'CANVAS', 'INPUT']);

  /** 120.md r2 — does the gap contain a real element? `Range.toString()` concatenates
      text-node data only, so an element boundary is invisible to it; cloning the
      contents is the only honest probe. */
  const gapHasElement = (range) => {
    try {
      const frag = range.cloneContents();
      if (!frag || typeof frag.querySelectorAll !== 'function') return false;
      for (const el of frag.querySelectorAll('*')) {
        if (VOID_CONTENT_TAGS.has(String(el.tagName || '').toUpperCase())) return true;
        /* 121.md r2 — "has children" is not "has content", and the difference is the
           whole "immediately after formatted text" row of §4's matrix. `cloneContents`
           PARTIALLY contains the element a boundary point sits inside, and the spec
           clones it as a SHELL holding one sliced — here zero-length — text node. So a
           caret at the end of a trailing `<b>bold</b>` (or `<i>`, or a link) produced a
           gap whose clone was `<b></b>` with childNodes.length === 1, the end-of-block
           pad was refused, and Blink ejected the chip out of the paragraph onto its own
           line. Read the TEXT: a wrapper whose whole descendant text is empty and that
           holds no void content is exactly the empty formatting wrapper the comment
           above already says is not content. */
        if ((el.textContent || '').length) return true;
      }
      return false;
    } catch { return false; }
  };

  /**
   * The citation chip the collapsed caret is immediately beside, or null.
   *
   * The DIRECTION has to be established before the gap is measured. A Range whose
   * end is set BEFORE its start does not throw — the spec collapses it onto the end
   * point — so a naive "gap from the chip's end to the caret" probe reports an
   * empty string for every chip that sits AFTER the caret, and the reverse probe
   * does the same for every chip before it. The result was that any chip anywhere in
   * the paragraph read as adjacent, and a citation typed a whole sentence later
   * merged into it. Reproduced under chromium in manuscript-citation-caret-120.
   */
  const adjacentCiteChip = () => {
    const el = rootRef.current;
    const r = collapsedCaretRange();
    if (!el || !r) return null;
    const line = lineBlockOf(r.startContainer);
    if (!line || typeof line.querySelectorAll !== 'function') return null;
    const chips = Array.from(line.querySelectorAll(`span.${CITE_CHIP_CLASS}[data-cite]`));
    for (const chip of chips) {
      if (lineBlockOf(chip) !== line) continue;      // a chip in a nested block is not beside us
      try {
        const caret = pointAt((p) => p.setStart(r.startContainer, r.startOffset));
        const end = pointAt((p) => p.setStartAfter(chip));
        const gap = document.createRange();
        if (end.compareBoundaryPoints(Range.START_TO_START, caret) <= 0) {
          gap.setStart(end.startContainer, end.startOffset);       // …chip] gap [caret…
          gap.setEnd(caret.startContainer, caret.startOffset);
        } else {
          const start = pointAt((p) => p.setStartBefore(chip));    // …caret] gap [chip…
          gap.setStart(caret.startContainer, caret.startOffset);
          gap.setEnd(start.startContainer, start.startOffset);
        }
        /* 120.md r2 — a SOFT LINE BREAK is content, and Range.toString() cannot see
           it: a <br> is an element and contributes nothing to the string, so the gap
           between a chip and a caret one visual line below stringified to the single
           nbsp the chip inserter leaves behind and read as "adjacent". Shift+Enter in
           prose is not intercepted anywhere (only Enter inside a caption title is), so
           the browser puts a real <br> in the paragraph and mdDom serializes it as a
           newline — the second citation then merged into the chip on the PREVIOUS line
           and nothing appeared where the researcher was typing. Any element in the gap
           is content between two citations. */
        if (gapHasElement(gap)) continue;
        if (joinableGap(gap.toString())) return chip;
      } catch { /* the chip is not comparable with the caret → not adjacent */ }
    }
    return null;
  };

  /**
   * 120.md §5 — the sacrificial wrapper that keeps an inline chip an ELEMENT.
   *
   * §5 lists "inside a list item" among the positions insertion must work in, and
   * it did not: Blink's `execCommand('insertHTML')` UNWRAPS the outermost element
   * of the inserted fragment when the caret is inside an `<li>`. It returns true,
   * and what lands is the chip's TEXT — "[1]" as literal characters, with no
   * data-cite, no chip element, no hover card, no action menu, and nothing for the
   * renumbering effect to find, so it froze at "[?]" forever. The same class of
   * silent-success trap as WebKit's no-op execCommand, in the other engine.
   *
   * The repair is a SHAPE, not a browser check (no UA sniffing, and no retry that
   * would cost a second undo step): give the engine a throwaway outer `<span>` to
   * unwrap. Verified in Blink across `<p>`, `<h2>`, `<td>` and `<li>` — the wrapper
   * is consumed in every one of them and the chip element survives intact. The
   * trailing `&nbsp;` stays OUTSIDE the wrapper, where it is ordinary text either
   * way. Same idea as removeFigureBlock's sacrificial empty blocks (119.md §5).
   */
  /* 121.md §4:168 — ONE definition, now in the shared insertion utility so the
     insert path (which reaches it through the {kind:'chip'} payload policy) and the
     three chip-MUTATION paths below (group, remove one id, relink — node swaps, not
     insertions) can never disagree about the shape. */
  const wrapInlineChip = wrapInlineChipHtml;

  /** Merge ids into an existing chip through the SAME replaceNode + citeChipLabel
      path removeCitation uses: one node swap, one native undo step. */
  const mergeIntoCiteChip = (chip, ids) => {
    const cur = parseCiteIds(chip.getAttribute('data-cite') || '');
    const next = cur.slice();
    for (const id of ids) if (!next.includes(String(id))) next.push(String(id));
    // Already cited here → the sentence already says what the researcher asked for.
    // Rewriting the chip to itself would only cost them an undo step.
    if (next.length === cur.length) return true;
    const ro = refOptsRef.current || {};
    const { label, broken } = citeChipLabel(next, orderMapRef.current, ro.citationStyle, ro.refsById, ro.yearSuffixes);
    return replaceNode(chip, wrapInlineChip(citeChipHtml(next, label, { broken })));
  };

  /** 120.md §5 "Selected-text behavior" — a citation/cross-reference inserted over
      a SELECTION lands AFTER it: the selected words are not deleted and none of
      their inline marks (bold, italic, superscript, links, chips) are disturbed.
      Replacement is not an insertion, and §5 forbids doing it silently. */
  const collapseSelectionToEnd = () => {
    if (typeof window === 'undefined' || !window.getSelection) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    if (!rootRef.current || !rootRef.current.contains(r.commonAncestorContainer)) return;
    const end = r.cloneRange();
    end.collapse(false);
    // 121.md §4 (fix 1) — a paragraph-granularity selection ENDS at (nextBlock, 0);
    // taking that literally is what put the chip on the following line. The selection
    // itself is the scope: `r` is not collapsed here by construction.
    snapCollapsedEndIntoBlock(end, r);
    sel.removeAllRanges();
    sel.addRange(end);
    savedRange.current = end.cloneRange();
  };

  /* ══════════ 121.md §4:168 — THE ONE INSERTION TRANSACTION ══════════
   *
   * "If citations, cross-references and symbols currently use different insertion
   * logic, create or strengthen a shared, editor-safe insertion utility that preserves
   * and restores the active selection consistently. Do not duplicate fragile
   * caret-handling logic across separate features."
   *
   * `prepareCaret` is the caret discipline every inline insertion needs, in one place:
   * restore focus WITH the selection (the 120 §5 clobber fix), then collapse a
   * selection to its normalised END so the insertion lands AFTER the selected words
   * without deleting them or disturbing their marks. `commitInsertion` is the single
   * transaction — one execCommand, one native undo step, one autosave emit — with the
   * payload policy in insertionSession.js deciding WHAT is written (element chips get
   * the sacrificial wrapper and the grouping nbsp; text gets neither).
   */
  /**
   * 121.md §4 r1 — A CARET INSIDE AN ATOMIC CHIP IS NOT A CARET.
   *
   * `rangeAtTextOffset` has always said so on the re-resolution path ("a chip is
   * contenteditable=false; a caret 'inside' one is not a caret"), but the LIVE path
   * never did — and a click lands inside one every day: the abstract's first field is
   * a single manual-input placeholder (102.md §3), so clicking it parks the caret in
   * the middle of an atomic span. execCommand happily wrote the citation THERE, the
   * chip rendered, the action menu opened, and the serializer — which emits an atomic
   * chip from its own attributes and never from its children — dropped it at the next
   * save. An insertion that disappears when the researcher reloads is the worst shape
   * of §4's family, so the caret is moved to the one honest position: immediately
   * AFTER the chip, which is where rangeAtTextOffset puts it too.
   *
   * The walk stops at the nearest contenteditable="true" ancestor, because a nested
   * EDITING ISLAND (a table caption's title lives inside a contenteditable=false
   * caption) is a place the caret legally belongs — 121.md §1's "a symbol inserts
   * inside a caption title" depends on not hoisting out of it.
   */
  const atomicAtCaret = (node) => {
    const el = rootRef.current;
    let up = node && (node.nodeType === 1 ? node : node.parentElement);
    let atomic = null;
    while (up && up !== el && el && el.contains(up)) {
      const ce = up.getAttribute && up.getAttribute('contenteditable');
      if (ce === 'true') break;
      if (ce === 'false') atomic = up;
      up = up.parentElement;
    }
    return atomic;
  };

  const snapCaretOutOfAtomic = () => {
    if (typeof window === 'undefined' || !window.getSelection) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    if (!rootRef.current || !rootRef.current.contains(r.startContainer)) return;
    const atomic = atomicAtCaret(r.startContainer);
    if (!atomic) return;
    /* 121.md r2 — WHICH SIDE the caret escapes to. Moving it unconditionally AFTER the
       chip inserted on the wrong side of the I-beam: a paragraph that BEGINS with a
       manual-input placeholder (the abstract's first field) is clicked at its leading
       edge every day, the selection reports offset 0 inside the atomic span, and the
       symbol the researcher meant to put in front of the placeholder landed behind it.
       §4's promise is the I-beam's position, so read it: nothing of the chip's own text
       before the caret means the caret was at its leading edge, and the honest escape
       is BEFORE. Everywhere else — mid-chip, at its end — after it is still right. */
    let leading = false;
    try {
      const probe = document.createRange();
      probe.selectNodeContents(atomic);
      probe.setEnd(r.startContainer, r.startOffset);
      leading = probe.toString().length === 0;
    } catch { leading = false; }
    const out = document.createRange();
    if (leading) out.setStartBefore(atomic);
    else out.setStartAfter(atomic);
    out.collapse(true);
    sel.removeAllRanges();
    sel.addRange(out);
    savedRange.current = out.cloneRange();
  };

  /** 121.md r2 — a caret at or after the end-of-block pad is a caret at the end of the
      block's CONTENT: the pad is markup this editor appended, not a character of the
      document (see the module-scope pad helpers). Moving in front of it is the same
      visual position, and it is what makes the pad probe, the citation grouping gap
      and the insertion itself agree about where the end of the line is. */
  const snapCaretBeforeTrailingPad = () => {
    if (typeof window === 'undefined' || !window.getSelection) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const el = rootRef.current;
    if (!el || !el.contains(r.startContainer)) return;
    const block = lineBlockOf(r.startContainer);
    if (!block || block === el || block.nodeType !== 1) return;
    const pad = trailingPadNode(block);
    if (!pad) return;
    try {
      const before = document.createRange();
      before.setStartBefore(pad);
      before.collapse(true);
      // A caret EARLIER in the line is where the researcher put it and stays there.
      if (before.compareBoundaryPoints(Range.START_TO_START, r) > 0) return;
      sel.removeAllRanges();
      sel.addRange(before);
      savedRange.current = before.cloneRange();
    } catch { /* not comparable → leave the caret alone */ }
  };

  const prepareCaret = () => {
    if (readOnlyRef.current) return false;
    if (!focusWithSelection()) return false;
    collapseSelectionToEnd();
    // 121.md §4 r1 — one more normalisation, shared by every inline insertion.
    snapCaretOutOfAtomic();
    // 121.md r2 — …and the pad is transparent to all of them.
    snapCaretBeforeTrailingPad();
    return true;
  };

  /* 121.md r2 — …and transparent to TYPING, which is the other half of the same rule.
     A caret at the true end of the line sits AFTER the pad, so the next character the
     researcher typed landed behind it and turned this editor's own markup into
     INTERIOR content: mdDom trims block edges only, so the separator nbsp plus the pad
     nbsp folded into a permanent double space in the model, byte-stable through every
     reload and into the .docx. Moving the caret in front of the pad before the engine
     performs the insertion is the same visual position and leaves the pad where it
     belongs — trailing, and trimmed away by the serializer.

     A NATIVE listener, not React's `onBeforeInput`: React 18 synthesizes that one from
     `textInput` in Blink, and a `textInput` event carries no `inputType`, so the
     discrimination below would be impossible. Scoped to insertions that write TEXT —
     an IME must never have its caret moved mid-composition (`insertCompositionText`),
     Enter may leave the pad on the line it is already on, and a deletion is never
     redirected. */
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof el.addEventListener !== 'function') return undefined;
    const onBeforeInput = (e) => {
      const t = String((e && e.inputType) || '');
      if (t !== 'insertText' && t !== 'insertFromPaste' && t !== 'insertReplacementText') return;
      if (readOnlyRef.current) return;
      snapCaretBeforeTrailingPad();
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 121.md §4 r1 — THE END-OF-BLOCK PAD.
   *
   * MEASURED, not assumed (the matrix is reproduced in the §4 journey): Blink's
   * `execCommand('insertHTML')` with the caret at the END of a block's content puts an
   * inserted ELEMENT *after* the block instead of inside it. Text goes in — a leading
   * zero-width space in the same fragment lands inside the paragraph while the element
   * behind it still comes out at root level — and an atomic chip is always an element.
   * mdDom's walkBlocks then writes that root-level run as its OWN paragraph, which is
   * §4's "inserted on the next line" in its most durable form: it survives a reload.
   *
   * It is the DOMINANT §4 shape rather than an edge case, because every one of the
   * caret normalisations lands the caret exactly there: a triple-click, a selection
   * dragged across a block boundary and a Ctrl+End all resolve to the end of a
   * paragraph, which is the one position the engine will not honour.
   *
   * ONE `&nbsp;` appended to the block makes the caret no longer the last position in
   * it, and the engine then inserts in place. Three properties, all measured:
   *
   *   · it must be an NBSP, not a plain space. A trailing plain space is collapsed and
   *     the engine still calls the caret end-of-block — the chip escapes anyway;
   *   · it must STAY. Removing it after the execCommand corrupts the un-apply: undo
   *     then strips the separator, restores the sacrificial wrapper and LEAVES the
   *     chip, which breaks §4's "a single undoable transaction". Left in place, undo
   *     reverts cleanly to the paragraph plus this one nbsp;
   *   · it is therefore NOT CONTENT, by the same construction the §3 trailing
   *     affordance relies on: mdDom folds nbsp to a space and TRIMS every block, so a
   *     trailing nbsp cannot reach the model, cannot reach an export and cannot
   *     accumulate — the gap probe below already refuses to add a second one. It is
   *     also the exact shape the chip inserter's own separator leaves behind, which is
   *     why the 121 bookmark normalisations (nbsp-tolerant context, the end-of-block
   *     trim) already resolve carets beside it.
   *
   * Deliberately NOT applied when: the caret's line block is the editing host itself (a
   * section whose prose has never been wrapped has no block to be pushed out of), the
   * block is a media island (padding one would put a stray text node inside a caption),
   * or something already holds the end of the block (text, a `<br>`, a picture, an
   * earlier pad) — there the caret is not at the boundary and the engine already
   * behaves.
   */
  /** @returns {boolean} whether it padded. Pure-ish: appends at most one nbsp. */
  const endOfBlockPad = () => {
    const el = rootRef.current;
    if (!el || typeof document === 'undefined') return false;
    const r = collapsedCaretRange();
    if (!r) return false;
    const block = lineBlockOf(r.startContainer);
    if (!block || block === el || block.nodeType !== 1) return false;
    if (isMediaBlockNode(block)) return false;
    if (block.getAttribute && block.getAttribute('contenteditable') === 'false') return false;
    /* 121.md r2 — REUSE, never accumulate. The gap probe below only refuses a second
       pad when the caret sits BEFORE the first one; a caret at the true end of the
       line sits AFTER it and measured an empty gap. `prepareCaret` now moves such a
       caret in front of the pad (snapCaretBeforeTrailingPad), and this is the second
       half of the same rule for the paths that reach an insertion without it: an
       existing pad already holds the end of the block, which is the whole job. */
    if (trailingPadNode(block)) return false;
    try {
      const gap = document.createRange();
      gap.setStart(r.startContainer, r.startOffset);
      gap.setEnd(block, block.childNodes.length);
      if (gap.toString().length) return false;
      if (gapHasElement(gap)) return false;
    } catch { return false; }
    const pad = document.createTextNode(' ');
    block.appendChild(pad);
    padNodesRef.current = padNodesRef.current.concat([pad]);
    return true;
  };

  const commitInsertion = (payload) => {
    const plan = insertionPlan(payload);
    if (!plan) return false;
    /* The DEV postcondition §4 was missing: every defect in this family SUCCEEDED,
       silently, in the wrong block. Read the caret's line block before the write and
       the inserted content's line block after it — a mismatch is the bug itself. */
    const caretLine = () => {
      const cr = collapsedCaretRange();
      return cr ? lineBlockOf(cr.startContainer) : null;
    };
    const before = DEV_INSERT_CHECKS ? caretLine() : null;
    // 121.md §4 r1 — `inlineAtCaret` is what turns on the end-of-block pad; a BLOCK
    // insertion (a table, a pasted document) belongs between blocks and must not get it.
    if (plan.via === 'html') insertHtml(plan.html, { inlineAtCaret: true });
    else insertPlainText(plan.text);
    if (DEV_INSERT_CHECKS) {
      const problem = insertionPostconditionProblem(before, caretLine());
      if (problem && typeof console !== 'undefined' && console.warn) console.warn(problem);
    }
    return true;
  };

  /** The whole inline-insertion path in one call: caret discipline + one transaction. */
  const insertAtCaret = (payload) => (prepareCaret() ? commitInsertion(payload) : false);

  const api = useMemo(() => ({
    exec,
    focus: () => rootRef.current && rootRef.current.focus(),
    /**
     * 120.md §6 — apply ONE writing-assistant correction.
     *
     * The whole point of routing it through here rather than letting the assistant
     * touch the DOM is that this is the SAME selection → execCommand path every
     * toolbar command uses: one native undo step, one autosave emit, the caret left
     * after the replacement. A correction is an ordinary editor transaction and
     * behaves like one (§6 "Accepted corrections are real editor transactions").
     *
     * `expect` is the stale guard §6 demands — "Verify that the original text still
     * matches before applying a correction. Never apply a correction to text that has
     * changed." The range is read back and compared BEFORE anything is written; a
     * mismatch refuses and returns false rather than corrupting a sentence the
     * researcher has since edited. (The hook checks the committed markdown too; this
     * is the second, DOM-level half of the same promise.)
     *
     * Focus is installed before `insertHtml` so its `focusWithSelection()` sees a
     * live in-root selection and keeps it, instead of restoring the remembered caret
     * over the range we just selected.
     */
    applyRangeText: (range, replacement, expect) => {
      if (readOnlyRef.current) return false;
      const el = rootRef.current;
      if (!el || !range || typeof replacement !== 'string') return false;
      if (!el.contains(range.commonAncestorContainer)) return false;
      const nbsp = (s) => String(s).replace(/ /g, ' ');
      if (expect != null && nbsp(range.toString()) !== nbsp(expect)) return false;
      const sel = typeof window !== 'undefined' && window.getSelection && window.getSelection();
      if (!sel) return false;
      restoringRef.current = true;
      try { el.focus(); } finally { restoringRef.current = false; }
      sel.removeAllRanges();
      sel.addRange(range);
      // Re-read AFTER the selection is installed: WebKit can normalise a Range on
      // its way into the selection, and a silent no-op insert is its classic trap.
      if (expect != null && nbsp(String(sel.toString())) !== nbsp(expect)) return false;
      insertHtml(escapeHtml(replacement));
      rememberSelection();
      return true;
    },
    /** Insert subset markdown at the caret as normal editable content (MS-8). */
    insertMarkdown: (md) => insertHtml(mdToHtml(md, {
      orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
      ...factOptsRef.current, ...refOptsRef.current, figures: figuresRef.current,
    })),
    /**
     * 116.md §60 + 117.md §4 — insert a fresh rows × cols table at the caret,
     * WITH its caption marker so it is a first-class manuscript object from the
     * first keystroke (numbered, referenceable, exportable). Goes through
     * insertHtml → native undo + autosave emit; returns the new table's id.
     *
     * The caret lands in the TITLE region rather than the first cell: §4 is
     * "automatic numbering AND naming", the number is already filled in, and the
     * one thing only the researcher can supply is what the table is called.
     */
    insertTable: (rows, cols, tblOpts = {}) => {
      if (readOnlyRef.current) return null;
      /* 119.md §2 — ONE insertion intent produces exactly ONE table. The caller
         stamps a per-gesture operation id; a re-entrant call carrying an id this
         editor has already applied returns the SAME table id and mutates nothing.
         That is structural idempotency, not a debounce: a doubled listener, a
         StrictMode double-invoke, a click+keyboard pair on the same grid cell or a
         retried gesture all collapse to the first insertion, and a genuinely new
         gesture (a new id) always inserts. */
      const opId = tblOpts.opId ? String(tblOpts.opId) : '';
      if (opId && insertOpIds.current.has(opId)) return insertOpIds.current.get(opId);
      const id = mintManualTableId(usedTableIds());
      const md = makeCaptionedTableMd(id, tblOpts.title || '', rows, cols);
      const html = mdToHtml(md, {
        orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
        ...factOptsRef.current, ...refOptsRef.current, figures: figuresRef.current,
      }).replace('<table>', '<table data-ms-new="1">');
      if (opId) {
        insertOpIds.current.set(opId, id);
        // Bounded: this is a re-entrancy guard for one gesture, not a history.
        if (insertOpIds.current.size > 64) {
          const oldest = insertOpIds.current.keys().next();
          if (!oldest.done) insertOpIds.current.delete(oldest.value);
        }
      }
      // the trailing empty paragraph gives a caret target below a table inserted
      // at the section end; htmlToMd drops it, so the markdown stays clean.
      // 119.md §2 — hoisted: the previous insertion parked the caret in a caption
      // title, and inserting there nested a table inside a caption (visible
      // duplicate + silent htmlToMd data loss on the next round trip).
      insertHtml(`${html}<p><br></p>`, { hoistFromIslands: true });
      const root = rootRef.current;
      const nt = root && root.querySelector('table[data-ms-new="1"]');
      if (nt) nt.removeAttribute('data-ms-new');
      const cap = root && root.querySelector(`div.${TABLE_CAPTION_CLASS}[data-tblcap="${id}"]`);
      const titleEl = cap && cap.querySelector(`span.${TABLE_CAPTION_TITLE_CLASS}`);
      if (titleEl) {
        titleEl.focus();
        selectCellContents(titleEl);
      } else if (nt) focusCellAt(nt, 0, 0);
      if (onTableMetaRef.current) {
        onTableMetaRef.current(id, { origin: 'manual', createdAt: new Date().toISOString() });
      }
      notifyTableFocus();
      return id;
    },
    /** 116.md §61 — structural op ('rowAbove'|'rowBelow'|'colLeft'|'colRight'|
        'deleteRow'|'deleteCol'|'deleteTable') on the table holding the caret. */
    tableOp: (opId, ctxOverride) => runTableOp(opId, ctxOverride),
    /**
     * 117.md §4 — promote the ANONYMOUS pipe table under the caret to a numbered
     * manuscript object by giving it a caption marker. This is what makes the
     * export notice ("add a caption to number it") an action rather than advice,
     * and it is how every table typed before this feature existed joins the
     * numbering sequence. Returns the new id, or null when there is nothing to do.
     */
    addTableCaption: (title = '') => {
      if (readOnlyRef.current) return null;
      const ctx = tableDomContext();
      if (!ctx || captionForTable(ctx.table)) return null;
      const id = mintManualTableId(usedTableIds());
      const md = `${tableCaptionLine(id, title)}\n\n${htmlToMd(ctx.table.outerHTML)}`;
      const html = mdToHtml(md, {
        orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
        ...factOptsRef.current, ...refOptsRef.current, figures: figuresRef.current,
      });
      if (!replaceNode(ctx.table, html)) return null;
      const root = rootRef.current;
      const cap = root && root.querySelector(`div.${TABLE_CAPTION_CLASS}[data-tblcap="${id}"]`);
      const titleEl = cap && cap.querySelector(`span.${TABLE_CAPTION_TITLE_CLASS}`);
      if (titleEl) { titleEl.focus(); selectCellContents(titleEl); }
      if (onTableMetaRef.current) {
        onTableMetaRef.current(id, { origin: 'manual', createdAt: new Date().toISOString() });
      }
      notifyTableFocus();
      return id;
    },
    /**
     * Insert an atomic citation chip at the caret.
     *
     * 117.md §34/§35 — accepts ONE id or a LIST. A multi-select insertion becomes a
     * SINGLE chip carrying every id (`[[cite:a,b,c]]` → "[1,2,5]"), not three
     * adjacent chips: the researcher selected one citation, and "Remove citation"
     * plus the range collapse both need one object to act on.
     */
    insertCitation: (refId) => {
      const ids = (Array.isArray(refId) ? refId : parseCiteIds(refId)).filter(Boolean);
      if (!ids.length) return;
      /* 120.md §5 — resolve the caret FIRST (this is the restore that used to be
         clobbered by its own focus() call), then decide between grouping and a new
         chip. 121.md §4:168 — `prepareCaret` is that discipline, shared verbatim with
         the cross-reference and symbol paths; the chip payload is what differs. */
      if (!prepareCaret()) return;
      const chip = adjacentCiteChip();
      if (chip) { mergeIntoCiteChip(chip, ids); return; }
      const ro = refOptsRef.current || {};
      const { label, broken } = citeChipLabel(ids, orderMapRef.current, ro.citationStyle, ro.refsById, ro.yearSuffixes);
      commitInsertion({ kind: 'chip', html: citeChipHtml(ids, label, { broken }) });
    },
    /* ── 120.md §5 — the picker-session bookmark (see the block above the api) ── */
    /** Snapshot the caret the moment a picker opens, BEFORE it takes focus. */
    saveCaretBookmark: () => {
      const el = rootRef.current;
      if (!el || typeof window === 'undefined' || !window.getSelection) return null;
      let r = null;
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const live = sel.getRangeAt(0);
        if (el.contains(live.commonAncestorContainer)) r = live.cloneRange();
      }
      if (!r && savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
        r = savedRange.current.cloneRange();
      }
      if (!r) { bookmarkRef.current = null; return null; }
      /* §5 "Selected-text behavior": collapse to the END of the selection now, so
         the citation lands AFTER the selected words and nothing is deleted. Only
         our bookmark is collapsed — the researcher's visible selection is left
         exactly as they made it while the picker is open. */
      const end = r.cloneRange();
      end.collapse(false);
      /* 121.md §4 (fix 1) — and the collapse is NORMALISED before anything is
         remembered about it. `hadSelection` was recorded here since 120 and never
         read; it is what scopes the start-of-next-block repair, and doing the repair
         at SAVE time (rather than only at insert time) is what keeps the tightened
         null-logical refusal rare: a root-level end becomes a real position in a real
         block before the bookmark ever describes it. */
      const hadSelection = !r.collapsed;
      snapCollapsedEndIntoBlock(end, hadSelection ? r : null);
      const bm = { range: end, hadSelection, logical: caretLogicalOf(end) };
      bookmarkRef.current = bm;
      return bm;
    },
    /**
     * Resolve a bookmark and put the caret back on it. Returns FALSE when the
     * position cannot be re-found safely — the caller then says so instead of
     * inserting somewhere else (§5 "Do not fall back to the beginning of the
     * section"). A locked section always refuses.
     */
    restoreCaretBookmark: (bmIn) => {
      const el = rootRef.current;
      const bm = bmIn || bookmarkRef.current;
      bookmarkRef.current = null;
      if (!el || !bm || readOnlyRef.current) return false;
      let r = null;
      const live = bm.range;
      const anchor = live && live.commonAncestorContainer;
      // Still the same DOM AND still the same place in the text (see above — the
      // second half is not optional, a live Range survives its own nodes' removal).
      if (anchor && el.contains(anchor) && liveRangeStillValid(live, bm.logical)) {
        r = live.cloneRange();
      }
      if (!r) r = rangeFromLogical(bm.logical);
      if (!r) return false;
      r.collapse(false);
      return applyCaretRange(r);
    },
    /** §5 "Canceling the picker must clear the saved bookmark without modifying
        the manuscript" — this touches no DOM at all. */
    clearCaretBookmark: () => { bookmarkRef.current = null; },
    /**
     * 117.md §38 — "Remove citation". Removing ONE id from a multi-cite chip leaves
     * the others in place (the sentence keeps the citations it still means);
     * removing the last id removes the chip itself. `null` removes the whole chip.
     */
    removeCitation: (refId) => {
      const chip = activeCiteRef.current;
      activeCiteRef.current = null;
      if (!chip) return false;
      const ids = parseCiteIds(chip.getAttribute('data-cite') || '');
      const next = refId ? ids.filter((x) => x !== String(refId)) : [];
      if (!next.length) return replaceNode(chip, null);
      const ro = refOptsRef.current || {};
      const { label, broken } = citeChipLabel(next, orderMapRef.current, ro.citationStyle, ro.refsById, ro.yearSuffixes);
      return replaceNode(chip, wrapInlineChip(citeChipHtml(next, label, { broken })));
    },
    /** Forget the citation chip the menu was bound to (dismissed without acting). */
    clearActiveCitation: () => { activeCiteRef.current = null; },
    /**
     * 117.md §9 — insert a cross-reference chip AT THE CARET.
     *
     * Deliberately not `insertMarkdown(assetToken(id))`: mdToHtml wraps a bare
     * token in a <p>, and inserting a block mid-sentence splits the paragraph the
     * researcher is writing. The chip is inline, so it lands inside the sentence,
     * which is the only place a cross-reference belongs.
     */
    insertAssetRef: (assetId) => {
      if (!assetId) return;
      // 120.md §5 / 121.md §4:168 — the SAME shared caret discipline and the SAME
      // single transaction as insertCitation; only the chip's html differs.
      if (!prepareCaret()) return;
      const ro = refOptsRef.current || {};
      const { label, broken } = assetChipLabel(assetId, assetNumbersRef.current, ro.knownAssetIds, ro.templateId);
      commitInsertion({ kind: 'chip', html: assetChipHtml(assetId, label, { broken }) });
    },
    /**
     * 121.md §1 — insert ONE symbol character at the caret.
     *
     * The same session, the same caret discipline and the same one transaction as a
     * citation, with the {kind:'text'} payload policy: NO element wrapper (htmlToMd
     * serializes only known constructs and would silently drop a styled span around
     * the character) and NO trailing nbsp (the serializer folds it to a space and
     * trims it at a block end, which is what makes an end-of-paragraph bookmark refuse
     * after a remount — symbols must not inherit that). It reaches the document
     * through `insertPlainText`, i.e. execCommand('insertText') with WebKit's
     * silent-no-op verified and a Range fallback: island-legal, so a symbol can be
     * typed into a table or figure caption title, and a NATIVE undo step, so §1's
     * "participates normally in undo/redo" is the browser's own behaviour rather than
     * a second history implementation. Blink may coalesce that step with an adjacent
     * typed run — which is exactly how a typed character behaves here already.
     *
     * No equation editor exists in this codebase (no KaTeX/MathJax/MathML anywhere in
     * src; mdDom drops <math> outright), so §1's "existing equation fields" clause has
     * nothing to target: superscripts and subscripts ship as Unicode characters.
     */
    insertSymbol: (ch) => {
      const s = String(ch == null ? '' : ch);
      if (!s) return;
      insertAtCaret({ kind: 'text', text: s });
    },
    /** 117.md §10 — "Remove cross-reference": the CHIP goes, the table stays. */
    removeCrossRef: () => {
      const chip = activeChipRef.current;
      activeChipRef.current = null;
      return replaceNode(chip, null);
    },
    /** 117.md §11 — "Relink": rebind the chip in place to another object. */
    relinkCrossRef: (assetId) => {
      const chip = activeChipRef.current;
      activeChipRef.current = null;
      if (!chip || !assetId) return false;
      const ro = refOptsRef.current || {};
      const { label, broken } = assetChipLabel(assetId, assetNumbersRef.current, ro.knownAssetIds, ro.templateId);
      return replaceNode(chip, wrapInlineChip(assetChipHtml(assetId, label, { broken })));
    },
    /** Forget the chip the menu was bound to (menu dismissed without an action). */
    clearActiveCrossRef: () => { activeChipRef.current = null; },
    /**
     * 117.md §10 — "Go to table": scroll a manual table's caption into view and
     * mark it, so the jump is visible rather than a silent scroll. Returns false
     * when this section does not hold that table (the parent then switches
     * section and retries — same pattern as placeholder navigation).
     */
    focusManualTable: (tableId) => {
      const el = rootRef.current;
      if (!el || !tableId || typeof el.querySelector !== 'function') return false;
      const cap = el.querySelector(`div.${TABLE_CAPTION_CLASS}[data-tblcap="${String(tableId).replace(/"/g, '')}"]`);
      if (!cap) return false;
      if (typeof cap.scrollIntoView === 'function') cap.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.querySelectorAll(`div.${TABLE_CAPTION_CLASS}[data-tblcap-current="true"]`)
        .forEach((n) => n.removeAttribute('data-tblcap-current'));
      cap.setAttribute('data-tblcap-current', 'true');
      return true;
    },
    /** Focus a manual table's TITLE region ("Edit table" on a manual object). */
    editManualTable: (tableId) => {
      const el = rootRef.current;
      if (!el || !tableId || typeof el.querySelector !== 'function') return false;
      const cap = el.querySelector(`div.${TABLE_CAPTION_CLASS}[data-tblcap="${String(tableId).replace(/"/g, '')}"]`);
      const titleEl = cap && cap.querySelector(`span.${TABLE_CAPTION_TITLE_CLASS}`);
      if (!titleEl) return false;
      if (typeof cap.scrollIntoView === 'function') cap.scrollIntoView({ block: 'center', inline: 'nearest' });
      titleEl.focus();
      selectCellContents(titleEl);
      return true;
    },
    /**
     * 118.md §65 — reveal the SENTENCE that cross-references an object ("View in
     * manuscript" for a generated table/figure, which has no prose body of its own).
     * The chip is already focusable (role=button, tabindex=0), so focusing it after
     * the scroll lands the reader — and a keyboard user — exactly on the reference
     * without inserting a highlight the document would have to clean up.
     * Returns false when this section does not carry that reference.
     */
    focusAssetRef: (assetId) => {
      const el = rootRef.current;
      if (!el || !assetId || typeof el.querySelector !== 'function') return false;
      const chip = el.querySelector(`span.${ASSET_CHIP_CLASS}[data-asset="${String(assetId).replace(/"/g, '')}"]`);
      if (!chip) return false;
      if (typeof chip.scrollIntoView === 'function') chip.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (typeof chip.focus === 'function') chip.focus();
      return true;
    },
    /* ══════════ 119.md §5 — uploaded figures ══════════ */
    /**
     * Insert an already-uploaded figure at the caret as a first-class manuscript
     * object: the `[[figcap:<key>]] Title` marker, rendered as the picture + its
     * derived number + an editable title.
     *
     * Goes through insertHtml → ONE native undo step + one autosave emit, and
     * hoists out of caption islands / table cells first (the §2 rule) because a
     * figure is a BLOCK the pipe grammar cannot nest. The caret lands in the
     * TITLE, for the same reason insertTable does: the number is already derived
     * and the one thing only the researcher can supply is what the figure shows.
     */
    insertFigure: (figKey, title = '') => {
      if (readOnlyRef.current || !figKey) return null;
      const key = String(figKey).replace(/[^a-z0-9-]/g, '');
      if (!key || usedFigureKeys().has(key)) return null;   // never place one twice
      const md = figureCaptionLine(key, title);
      const html = mdToHtml(md, {
        orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
        ...factOptsRef.current, ...refOptsRef.current, figures: figuresRef.current,
      });
      insertHtml(`${html}<p><br></p>`, { hoistFromIslands: true, blockLevel: true });
      const root = rootRef.current;
      const fb = root && root.querySelector(`figure.${FIGURE_BLOCK_CLASS}[data-figcap="${key}"]`);
      const titleEl = fb && fb.querySelector(`span.${FIGURE_CAPTION_TITLE_CLASS}`);
      if (titleEl) { titleEl.focus(); selectCellContents(titleEl); }
      return key;
    },
    /** "View in manuscript" for a placed figure — scroll to it and mark it. */
    focusFigure: (figKey) => {
      const el = rootRef.current;
      if (!el || !figKey || typeof el.querySelector !== 'function') return false;
      const fb = el.querySelector(`figure.${FIGURE_BLOCK_CLASS}[data-figcap="${String(figKey).replace(/"/g, '')}"]`);
      if (!fb) return false;
      if (typeof fb.scrollIntoView === 'function') fb.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.querySelectorAll(`figure.${FIGURE_BLOCK_CLASS}[data-figcap-current="true"]`)
        .forEach((n) => n.removeAttribute('data-figcap-current'));
      fb.setAttribute('data-figcap-current', 'true');
      return true;
    },
    /** Focus a placed figure's TITLE region ("Edit figure"). */
    editFigure: (figKey) => {
      const el = rootRef.current;
      if (!el || !figKey || typeof el.querySelector !== 'function') return false;
      const fb = el.querySelector(`figure.${FIGURE_BLOCK_CLASS}[data-figcap="${String(figKey).replace(/"/g, '')}"]`);
      const titleEl = fb && fb.querySelector(`span.${FIGURE_CAPTION_TITLE_CLASS}`);
      if (!titleEl) return false;
      if (typeof fb.scrollIntoView === 'function') fb.scrollIntoView({ block: 'center', inline: 'nearest' });
      titleEl.focus();
      selectCellContents(titleEl);
      return true;
    },
    /** Take a placed figure out of the document (undoable — see removeFigureBlock). */
    removeFigure: (figKey) => {
      const el = rootRef.current;
      if (!el || !figKey || typeof el.querySelector !== 'function') return false;
      const fb = el.querySelector(`figure.${FIGURE_BLOCK_CLASS}[data-figcap="${String(figKey).replace(/"/g, '')}"]`);
      return removeFigureBlock(fb);
    },
    /** Every figure key this section currently places (document order). */
    figureKeys: () => {
      const el = rootRef.current;
      if (!el || typeof el.querySelectorAll !== 'function') return [];
      return Array.from(el.querySelectorAll('[data-figcap]')).map((n) => n.getAttribute('data-figcap') || '');
    },
    /** Every manual-table id this section currently renders (document order). */
    manualTableIds: () => {
      const el = rootRef.current;
      if (!el || typeof el.querySelectorAll !== 'function') return [];
      return Array.from(el.querySelectorAll('[data-tblcap]')).map((n) => n.getAttribute('data-tblcap') || '');
    },
    /**
     * 102.md §2/§27 — reveal the Nth placeholder in THIS section: scroll it into
     * view, select the whole thing, and focus the editor so the researcher can type
     * immediately. Returns false when this section has no such placeholder, which
     * is how the workspace knows to move on to the next section.
     */
    focusPlaceholder: (ordinal = 0) => {
      const el = rootRef.current;
      if (!el || typeof el.querySelectorAll !== 'function') return false;
      const chips = el.querySelectorAll(`span.${INPUT_CHIP_CLASS}[data-input]`);
      const chip = chips[ordinal];
      if (!chip) return false;
      if (typeof chip.scrollIntoView === 'function') {
        // 'nearest' avoids yanking the page when the field is already visible;
        // reduced-motion users get an instant jump from the CSS side.
        chip.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      el.focus();
      selectPlaceholderNode(chip);
      return true;
    },
    /** How many placeholder chips this section currently renders. */
    placeholderCount: () => {
      const el = rootRef.current;
      if (!el || typeof el.querySelectorAll !== 'function') return 0;
      return el.querySelectorAll(`span.${INPUT_CHIP_CLASS}[data-input]`).length;
    },
    // runTableOp/focusCellAt/notifyTableFocus close over refs only, so the
    // memoized closures can never go stale (same pattern as factOptsRef).
  }), [exec, insertHtml, selectPlaceholderNode]); // eslint-disable-line react-hooks/exhaustive-deps
  apiRef.current = api;
  useImperativeHandle(ref, () => api, [api]);

  /**
   * 101.md §11 — undo.
   *
   * Ctrl/Cmd+Z is deliberately NOT intercepted. Every mutation this editor makes
   * goes through document.execCommand, which pushes onto the browser's NATIVE undo
   * stack, so the platform shortcut already does the right thing; swallowing it here
   * would only replace a working implementation with a worse one. The subsequent
   * `input` event (inputType 'historyUndo') re-runs emit(), so the parent's autosave
   * sees the reverted markdown like any other edit.
   *
   * §11's real requirement is the SCOPE, and it holds structurally: this stack is
   * owned by one contentEditable element and contains only text operations on it.
   * Research data — screening decisions, extracted values, analysis settings, risk-of-
   * bias judgments — is never mutated from this surface; it changes through the
   * engines, is recorded in the ProjectEvent ledger, and reaches the manuscript only
   * as re-resolved fact-chip TEXT (see the fact effect above). There is therefore no
   * path by which Ctrl+Z here can undo a research operation. Reverting project data
   * is the project history's job; reverting a fact's WORDING is the §10 provenance
   * card's job. Three separate histories, on purpose.
   *
   * Redo: Ctrl+Shift+Z is the cross-platform gesture, Ctrl+Y the Windows one. Both
   * route to execCommand('redo') — the same native stack, just a shortcut some
   * engines do not map by default.
   */
  /**
   * 116.md §61 — Word-style Tab/Shift+Tab cell navigation. ONLY the unmodified
   * Tab (Shift for direction) is claimed, and only while the caret sits inside a
   * table cell: preventDefault on a MODIFIED chord would mark it claimed for the
   * 108.md §23 shortcut router (exactly the regression the placeholder handler
   * above documents), and outside tables the browser's focus-move behaviour must
   * stay untouched. Runs on React's root bubble, so the claim is visible to the
   * window-bubble router via defaultPrevented. Tab in the LAST cell appends a
   * row (Word behaviour) through the same replace-table op as the menus.
   */
  const onTableTab = (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return false;
    const ctx = tableDomContext();
    if (!ctx) return false;
    e.preventDefault();
    const cellsAll = Array.from(ctx.table.querySelectorAll('th,td'));
    const idx = cellsAll.indexOf(ctx.cell);
    if (e.shiftKey) {
      if (idx > 0) selectCellContents(cellsAll[idx - 1]); // first cell → stay put (Word)
    } else if (idx + 1 < cellsAll.length) {
      selectCellContents(cellsAll[idx + 1]);
    } else {
      runTableOp('rowBelow', { col: 0 }); // caret lands in the new row's first cell
    }
    rememberSelection();
    return true;
  };

  /**
   * 117.md §10/§71 — keyboard parity for the chip menu. The chip carries
   * role="button" + tabindex=0, so Tab reaches it; Enter/Space opens the same
   * action menu a click opens. Modified chords fall through untouched, for exactly
   * the reason the placeholder handler documents (a preventDefault on a modified
   * key would steal it from the 108.md §23 shortcut router).
   */
  const onChipKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const chip = assetChipFrom(e.target);
    if (!chip) return false;
    e.preventDefault();
    openChipMenu(chip);
    return true;
  };

  /** 117.md §38 — Enter/Space on a focused citation chip opens its action menu. */
  const onCiteKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (!onCiteChipMenuRef.current) return false;
    const chip = citeChipFrom(e.target);
    if (!chip) return false;
    e.preventDefault();
    openCiteMenu(chip);
    return true;
  };

  /**
   * 119.md §2 — Delete/Backspace over a WHOLE table.
   *
   * Left to the browser, a drag over every cell deletes the <table> node and leaves
   * the contenteditable="false" caption standing: an orphan "Table 1." that keeps
   * numbering an empty slot and round-trips as a [[tblcap:]] line — which is what
   * "selecting the table and pressing Delete does not delete it" actually is. The
   * key is therefore claimed ONLY for a selection that covers a whole table (see
   * fullySelectedTable), and it routes to the SAME deleteTable op the ✕ Table menu
   * runs: caption + table leave together, in one native undo step, through the one
   * selection→execCommand mutation path, so undo restores the data, the title, the
   * identity and every cross-reference, redo removes it again, and autosave sees a
   * normal input event.
   *
   * Everything else stays native on purpose: a partial cell selection, a row or
   * column selection, a selection that also covers surrounding prose, and any
   * MODIFIED chord (claiming one would steal it from the 108.md §23 shortcut router).
   */
  const onTableDeleteKey = (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    const table = fullySelectedTable();
    if (!table) return false;
    e.preventDefault();
    runTableOp('deleteTable', null, table);
    return true;
  };

  /**
   * 119.md §2 — Cut over a whole table: the clipboard gets usable content (the
   * caption+table HTML and its markdown), then the SAME deleteTable op removes it.
   * An engine that refuses the synthetic clipboard write keeps the browser default
   * rather than deleting into a void.
   */
  const onCut = (e) => {
    if (readOnlyRef.current) return;
    const table = fullySelectedTable();
    if (!table || !e.clipboardData) return;
    const cap = captionForTable(table);
    const html = `${cap ? cap.outerHTML : ''}${table.outerHTML}`;
    let ok = false;
    try {
      e.clipboardData.setData('text/html', html);
      e.clipboardData.setData('text/plain', htmlToMd(html));
      ok = true;
    } catch { ok = false; }
    if (!ok) return;
    e.preventDefault();
    runTableOp('deleteTable', null, table);
  };

  /**
   * 119.md §5 — Delete/Backspace over a whole FIGURE removes the picture, its
   * title and its position in ONE native undo step (Ctrl+Z brings all three back,
   * pointing at bytes the server still holds). Partial selections stay
   * browser-default, and any modified chord is left to the §23 shortcut router.
   */
  const onFigureDeleteKey = (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    const fb = fullySelectedFigure();
    if (!fb) return false;
    e.preventDefault();
    removeFigureBlock(fb);
    return true;
  };

  const onKeyDown = (e) => {
    // 117.md §38 — the citation chip first (it is the innermost target).
    if (onCiteKeyDown(e)) return;
    // 117.md §10 — Enter/Space on a focused cross-reference opens its menu. This
    // runs even in a LOCKED section: "Go to table" is a read-only action, and the
    // mutating ones re-check readOnly before touching the document.
    if (onChipKeyDown(e)) return;
    if (readOnlyRef.current) return;
    // 102.md §3 — Enter/Space on a focused placeholder selects the whole field.
    if (onPlaceholderKeyDown(e)) return;
    // 116.md §61 — Tab moves between table cells (and never leaves the editor
    // while inside a table).
    if (onTableTab(e)) return;
    // 120.md §4 — typing in the gap between a caption and its table goes into the
    // TITLE instead of creating a paragraph inside the object.
    if (onCaptionGapKeyDown(e)) return;
    // 120.md §3/§4 — ArrowDown out of trailing media, Enter at the end of a title.
    if (onMediaBoundaryKeyDown(e)) return;
    // 119.md §2 — Delete/Backspace over a whole table removes table + caption.
    if (onTableDeleteKey(e)) return;
    // 119.md §5 — the same rule for a whole uploaded figure.
    if (onFigureDeleteKey(e)) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = String(e.key || '').toLowerCase();
    if (k === 'b') { e.preventDefault(); exec('bold'); }
    else if (k === 'i') { e.preventDefault(); exec('italic'); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); exec('redo'); }
    // k === 'z' without shift → falls through to the browser's native undo.
  };

  /* ══════════ 119.md §5 — clipboard / drag-drop IMAGE capture ══════════
   *
   * This runs BEFORE the htmlToMd sanitizer on purpose. `img` is a void tag with
   * no markdown emission, so until now a pasted picture vanished silently — the
   * worst possible outcome, because the researcher watched it disappear with no
   * explanation. Intercepting the FILE (never the <img> markup) means the bytes
   * take exactly the same validated server path as a file-picker upload: nothing
   * is ever inlined into the markdown, and a remote URL is never trusted.
   *
   * The parent owns the upload (it has the project id, the governance answer and
   * the error surface) and returns the figures to place; this only decides that
   * an image WAS the thing being pasted, and where it goes.
   */
  const imageFilesFrom = (dt) => {
    if (!dt) return [];
    const out = [];
    const list = dt.files && dt.files.length ? Array.from(dt.files) : [];
    for (const f of list) if (f && /^image\//i.test(f.type || '')) out.push(f);
    if (out.length) return out;
    const items = dt.items ? Array.from(dt.items) : [];
    for (const it of items) {
      if (!it || it.kind !== 'file' || !/^image\//i.test(it.type || '')) continue;
      const f = typeof it.getAsFile === 'function' ? it.getAsFile() : null;
      if (f) out.push(f);
    }
    return out;
  };

  /** Upload through the parent, then place each returned figure at the caret. */
  const placeImageFiles = (files) => {
    const cb = onImageFilesRef.current;
    if (!cb || !files.length) return;
    Promise.resolve(cb(files)).then((placed) => {
      const list = Array.isArray(placed) ? placed : [];
      for (const f of list) {
        if (f && f.figKey) apiRef.current.insertFigure(f.figKey, f.title || '');
      }
    }).catch(() => { /* the parent surfaces its own error — never throw into paste */ });
  };

  /** The caption/figure TITLE island the current selection sits in, or null. */
  const titleRegionAtCaret = () => {
    const el = rootRef.current;
    if (!el || typeof window === 'undefined' || !window.getSelection) return null;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.commonAncestorContainer)) return null;
    const cap = captionFromNode(r.commonAncestorContainer);
    const t = cap ? captionTitleOf(cap) : null;
    if (!t) return null;
    return (t === r.commonAncestorContainer || t.contains(r.commonAncestorContainer)) ? t : null;
  };

  /**
   * 120.md §7 — insert clipboard content as PLAIN TEXT.
   *
   * Used for the one position where block markup is meaningless: a media object's
   * title. A title is one line of prose in the marker grammar (cleanCaptionTitle
   * strips newlines and bracket grammar on the way out), so pasting three
   * paragraphs and a table into it can only ever be flattened — this flattens it
   * VISIBLY and at insertion time instead of silently at the next save.
   *
   * WebKit doctrine: execCommand may report success and do nothing, so the result
   * is verified against the host's own text and the Range fallback runs on a
   * PROVABLE failure rather than on a browser name.
   */
  const insertPlainText = (text) => {
    const s = String(text == null ? '' : text);
    if (!focusWithSelection()) return;
    const host = titleRegionAtCaret() || rootRef.current;
    const was = host ? (host.textContent || '') : '';
    let ok = false;
    try { ok = document.execCommand('insertText', false, s); } catch { ok = false; }
    const moved = host ? (host.textContent || '') !== was : false;
    if ((!ok || !moved) && s) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const node = document.createTextNode(s);
        r.insertNode(node);
        r.setStartAfter(node);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
    rememberSelection();
    emit();
  };

  /**
   * 120.md §7 steps 4-14 — the ONE insertion path for pasted markdown.
   *
   * Identity minting, the Word-caption harvest, the duplicate re-mint and the
   * figure-marker rule are all in the pure `transformPastedMd`; this does the two
   * things only the editor can do — put the result through the single
   * `insertHtml` call (ONE native undo step, ONE autosave emit: §7 "Record the
   * insertion as one undoable transaction", "Undo must remove the entire pasted
   * table in one logical action") and report each minted table's provenance.
   */
  const pasteMarkdown = (e, md0, opts = {}) => {
    e.preventDefault();
    const { md, mintedTables } = transformPastedMd(md0, {
      usedTableIds: usedTableIds(),
      usedFigureKeys: usedFigureKeys(),
    });
    /* 119.md §2 — a BLOCK paste while the caret sits in a caption title (or a
       cell) would nest one table inside another object, which the pipe grammar
       cannot round-trip: the same hoist insertTable uses applies, and it is also
       §7's "follow the editor's established cell-paste behavior rather than
       creating an unintended nested table" — cells pasted into an existing table
       land AFTER the whole object, never as a table inside a cell. A paste with no
       block in it is ordinary inline/prose content and keeps the caret exactly
       where the researcher put it. */
    // 120.md r2 — `opts.block` is the same claim for a payload with no table in it:
    // multi-paragraph prose that must land AFTER a media object rather than inside it.
    const hasBlock = opts.table || opts.block
      || /^\s*\|/m.test(md) || /\[\[tblcap:/.test(md) || /\[\[figcap:/.test(md);
    insertHtml(mdToHtml(md, {
      orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
      ...factOptsRef.current, ...refOptsRef.current, figures: figuresRef.current,
    }), { hoistFromIslands: hasBlock });
    /* §7 step 8/9 — the pasted table is a first-class manuscript object from the
       first frame: numbered by manuscript order, cross-referenceable, exportable.
       `origin:'paste'` is the honest provenance (it was imported, not typed), and
       it is stamped AFTER the insertion for the same reason insertTable does it —
       the caption is in the document by then, so the registry entry it creates has
       something to belong to. */
    const cb = onTableMetaRef.current;
    if (cb && mintedTables.length) {
      const createdAt = new Date().toISOString();
      for (const t of mintedTables) cb(t.id, { origin: 'paste', createdAt });
    }
  };

  /* ══════════ 120.md §7 — the paste LADDER ══════════
   *
   * ONE handler, mutually-exclusive returns, no beforeinput layer and no second
   * listener (§7: "Ensure that only one handler consumes the paste event").
   *
   * THE ORDERING FIX. The image branch used to run FIRST, before text/html was
   * ever read. Excel, PowerPoint and Word all put a BITMAP of the selection on the
   * clipboard beside the structured HTML, so `imageFilesFrom` found a file every
   * time and the table was imported as a screenshot — 120.md §7's explicit
   * anti-goal ("Do not import the table as an opaque image when structured
   * clipboard data is available"). The HTML is now sanitized first and the
   * RESULT — never the raw string — is asked whether it contains a real table.
   *
   * The rungs, in order:
   *   1. readOnly swallows the paste entirely (unchanged).
   *   2. the §4 caption-gap redirect (unchanged).
   *   3. text/html → htmlToMd → does it contain a pipe table?  → TABLE route.
   *   4. image FILES on the clipboard → the figure upload path (a genuine
   *      screenshot paste: an image item and no table HTML).
   *   5. no text/html at all → tab-separated text → TABLE route; this is also the
   *      Safari degradation §7 names, reached by construction and not by sniffing.
   *   6. a non-table paste into a media TITLE → plain text, first line only.
   *   7. text/html without a table → the ordinary sanitized prose path.
   *   8. anything else → the browser's own text paste, untouched.
   */
  const onPaste = (e) => {
    if (readOnly) { e.preventDefault(); return; }
    /* 120.md §4 — a paste with the caret parked in the caption/table gap would put
       a block INSIDE the object. Move the insertion point into the title first;
       a BLOCK paste is then hoisted past the whole object by the §2 rule above,
       and an inline paste lands in the title, which is the only editable region
       the researcher could have meant. */
    const gapCap = captionGapCaption();
    let gapRedirected = false;
    if (gapCap) {
      const gapTitle = captionTitleOf(gapCap);
      if (gapTitle) { placeCaretInTitle(gapTitle); gapRedirected = true; }
    }
    const cd = e.clipboardData;
    if (!cd) return;
    const html = (cd.getData && cd.getData('text/html')) || '';
    /* Word/Docs/Excel HTML → markdown subset (everything outside it drops to text;
       scripts, styles, mso-* fragments, event handlers and form elements are
       dropped outright by htmlToMd's DROP_TAGS + escape-first parser).
       117.md §4(c)/(d) + 119.md §5 — the identity rules for a marker that came
       along with the copy live in `transformPastedMd`. */
    /* 120.md r2 — a DEGENERATE (1×1) table is reduced to its text before the ladder
       looks at it, so one cell copied from Excel, or an email body wrapped in a
       layout table, can never take the table route: no minted id, no caption, no
       registry entry and no renumbering of the manuscript's real tables. Real grids
       (≥2 rows or ≥2 columns) are untouched. */
    const mdHtml = html ? flattenDegenerateTables(htmlToMd(html)) : '';
    if (hasPipeTableBlock(mdHtml)) { pasteMarkdown(e, mdHtml, { table: true }); return; }
    // 119.md §5 — an image FILE (never <img> markup) still becomes a figure, and
    // the bytes still take the validated server path a file-picker upload takes.
    if (onImageFilesRef.current) {
      const imgs = imageFilesFrom(cd);
      if (imgs.length) { e.preventDefault(); placeImageFiles(imgs); return; }
    }
    const plain = (cd.getData && cd.getData('text/plain')) || '';
    const titleEl = titleRegionAtCaret();
    if (!html) {
      const tsv = tsvToPipeTable(plain);
      if (tsv) { pasteMarkdown(e, tsv, { table: true }); return; }
      if (titleEl && plain) { e.preventDefault(); insertPlainText(firstLineOf(plain)); return; }
      return;   // plain-text paste → browser default (inserted as text)
    }
    if (titleEl) {
      /* 120.md r2 — the "first line only" flatten is the right contract for a paste
         the researcher AIMED at a one-line title. It is the wrong one for a caret the
         §4 gap redirect just moved there: that position was chosen by the browser (a
         boundary click lands between the caption island and its table), not by the
         user, and flattening silently discarded every paragraph after the first —
         while the SAME paste with a table in it is hoisted past the object and keeps
         all of them. A multi-block prose paste in the gap therefore goes past the
         object too, as prose. */
      if (gapRedirected && /\n/.test(String(mdHtml).trim())) {
        pasteMarkdown(e, mdHtml, { block: true });
        return;
      }
      e.preventDefault();
      insertPlainText(firstLineOf(plain || stripInlineMd(mdHtml)));
      return;
    }
    pasteMarkdown(e, mdHtml);
  };

  /* 119.md §5 "Drag and drop" — dropping image files anywhere in the section
     uploads them and places them at the drop point. A drop carrying no image
     files is left entirely alone (dragging text within the editor must keep
     working), and the highlight is cleared on every exit path. */
  const [dropActive, setDropActive] = useState(false);

  /**
   * 120.md §4 — a media island may not be dragged APART.
   *
   * §4 lists drag-and-drop among the ways a title must never be separated from its
   * media, and native drag of a `contenteditable="false"` island is exactly that:
   * the engine moves the element (or its title text) on its own, with no path
   * through the editor's mutation seam, so nothing renumbers, nothing re-mints an
   * id, and the resulting DOM may be shapes the pipe grammar cannot round-trip.
   * Rather than build drag support the model does not need, the drag is refused at
   * its source — moving a whole object is `Cut` then `Paste`, which already keeps
   * the caption, the id and every cross-reference (onCut + remintDuplicateCaptions).
   * Scoped to the ISLANDS: ordinary prose and table-cell text drags are untouched,
   * and an external image FILE drop never fires dragstart here at all.
   */
  const onDragStart = (e) => {
    if (readOnlyRef.current) return;
    const t = e.target;
    const island = t && typeof t.closest === 'function'
      ? t.closest(`div.${TABLE_CAPTION_CLASS}, figure.${FIGURE_BLOCK_CLASS}`)
      : null;
    if (island && rootRef.current && rootRef.current.contains(island)) e.preventDefault();
  };

  const onDragOver = (e) => {
    if (readOnly || !onImageFilesRef.current) return;
    const dt = e.dataTransfer;
    const types = dt && dt.types ? Array.from(dt.types) : [];
    if (!types.includes('Files')) return;
    e.preventDefault();
    if (dt) dt.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };

  const onDragLeave = (e) => {
    if (!dropActive) return;
    // Only the real exit counts — dragging over a child fires leave on the parent.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropActive(false);
  };

  const onDrop = (e) => {
    if (readOnly || !onImageFilesRef.current) return;
    const imgs = imageFilesFrom(e.dataTransfer);
    setDropActive(false);
    if (!imgs.length) return;
    e.preventDefault();
    // Put the caret where the picture was dropped, so it lands there rather than
    // wherever the caret happened to be before the drag.
    if (typeof document.caretRangeFromPoint === 'function' && window.getSelection) {
      const r = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (r && rootRef.current && rootRef.current.contains(r.startContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        savedRange.current = r.cloneRange();
      }
    }
    placeImageFiles(imgs);
  };

  return (
    <div
      ref={rootRef}
      className="ms-rich ms-page-body"
      style={{ minHeight, ...(readOnly ? { opacity: 0.92 } : {}) }}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-readonly={readOnly ? 'true' : undefined}
      aria-label={ariaLabel || 'Section editor'}
      data-testid={testId}
      /* 101.md §6 — the ONE thing the Show Changes toggle changes. Every overlay rule
         in SHOW_CHANGES_CSS hangs off this attribute, so the document itself (text,
         chips, markdown) is byte-identical in both modes. */
      data-show-changes={showChanges ? 'true' : 'false'}
      /* 119.md §5 — drag-and-drop target feedback (styled in RICH_EDITOR_CSS). */
      data-fig-drop={dropActive ? 'true' : undefined}
      data-placeholder={placeholder || 'Write this section, or generate it from your project data.'}
      /* 120.md §6 — was a bare `spellCheck` (always on). Now prop-driven so the
         Writing Assistant can suppress the browser's overlapping red underline in
         THIS surface only, and restore it the moment the assistant is switched off. */
      spellCheck={nativeSpellcheck !== false}
      onInput={() => { rememberSelection(); emit(); }}
      onKeyDown={onKeyDown}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      /* 102.md §3 — click anywhere in a placeholder and the WHOLE field (both
         brackets included) is selected, ready to be typed over.
         117.md §10 — a click on a cross-reference opens its action menu instead,
         WITHOUT moving the caret. */
      onMouseDown={onEditorMouseDown}
      /* 117.md §10/§38 — ONE delegated hover entry point for both chip kinds. */
      onMouseOver={(onAssetChipHover || onCiteChipHover) ? ((e) => { onChipMouseOver(e); onCiteMouseOver(e); }) : undefined}
      onMouseLeave={(onAssetChipHover || onCiteChipHover) ? onChipMouseLeave : undefined}
      onFocus={rememberSelection}
      onPaste={onPaste}
      /* 120.md §4 — a caption/figure island can never be dragged out of its object. */
      onDragStart={onDragStart}
      /* 119.md §5 — drop an image file straight into the manuscript. */
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      /* 119.md §2 — cutting a whole table removes table + caption together and
         leaves usable content on the clipboard; partial selections stay native. */
      onCut={onCut}
      dangerouslySetInnerHTML={{ __html: html0.current }}
    />
  );
});

/* ════════════ toolbar ════════════ */

const TB_BUTTONS = [
  { key: 'p', glyph: '¶', aria: 'Paragraph', title: 'Paragraph', cmd: ['formatBlock', '<p>'] },
  { key: 'h2', glyph: 'H2', aria: 'Heading level 2', title: 'Heading 2', cmd: ['formatBlock', '<h2>'] },
  { key: 'h3', glyph: 'H3', aria: 'Heading level 3', title: 'Heading 3', cmd: ['formatBlock', '<h3>'] },
  { key: 'bold', glyph: 'B', aria: 'Bold (Ctrl+B)', title: 'Bold (Ctrl+B)', cmd: ['bold'], style: { fontWeight: 800 } },
  { key: 'italic', glyph: 'I', aria: 'Italic (Ctrl+I)', title: 'Italic (Ctrl+I)', cmd: ['italic'], style: { fontStyle: 'italic', fontFamily: 'Georgia,serif' } },
  { key: 'ul', glyph: '• List', aria: 'Bulleted list', title: 'Bulleted list', cmd: ['insertUnorderedList'] },
  { key: 'ol', glyph: '1. List', aria: 'Numbered list', title: 'Numbered list', cmd: ['insertOrderedList'] },
];

/**
 * 116.md §60 — Insert → Table: a compact grid selector (Word-style rows × cols
 * picker) behind one toolbar button. Same selection-preserving onMouseDown
 * preventDefault pattern as every other toolbar control, so the editor caret
 * survives the whole interaction; insertion goes through api.insertTable →
 * insertHtml (native undo + autosave emit).
 */
const TABLE_GRID_MAX = 6;

/**
 * 119.md §2 — the id of ONE table-insertion INTENT.
 *
 * It is minted where the intent begins (the picker opening), not where the DOM
 * mutation happens, which is the whole point: every re-entrant path that could
 * reach `insertTable` for the same gesture carries the same id, and the editor
 * turns the second call into a no-op returning the first table's id. Exported so
 * other insertion surfaces can join the same contract.
 */
let tableOpSeq = 0;
export function newTableOpId() {
  tableOpSeq += 1;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `tblop-${crypto.randomUUID()}`;
    }
  } catch { /* no WebCrypto here — the counter below is enough for one client */ }
  return `tblop-${Date.now().toString(36)}-${tableOpSeq}`;
}

const GRID_ARROWS = {
  ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0],
};

export function TableGridPicker({ getApi, disabled, onInserted }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ r: 0, c: 0 });
  /* 119.md §2 — the keyboard focus point (APG roving tabindex): exactly one cell is
     tabbable, arrows move it, Enter/Space on it inserts. Before this the cells were
     all tabIndex={-1}, so a table could not be created by keyboard AT ALL. */
  const [active, setActive] = useState({ r: 1, c: 1 });
  const btnRef = useRef(null);
  const gridRef = useRef(null);
  const kbRef = useRef(false);
  /* ONE gesture = ONE table. `opRef` is the intent id (minted on open, re-checked by
     the editor); `doneRef` closes the gesture locally on the first insertion. A
     doubled listener, a click arriving alongside a keyboard activation, a re-render
     mid-gesture or a rapid double-click therefore all collapse to one table —
     structurally, not by debouncing a button (§2 forbids that). */
  const opRef = useRef('');
  const doneRef = useRef(false);

  const openPicker = (fromKeyboard) => {
    opRef.current = newTableOpId();
    doneRef.current = false;
    kbRef.current = !!fromKeyboard;
    setHover({ r: 0, c: 0 });
    setActive({ r: 1, c: 1 });
    setOpen(true);
  };
  const closePicker = (restoreFocus) => {
    setOpen(false);
    setHover({ r: 0, c: 0 });
    if (restoreFocus && btnRef.current && btnRef.current.focus) btnRef.current.focus();
  };

  /* A keyboard-opened picker has to put focus somewhere reachable; a mouse-opened
     one must NOT move focus (that would throw away the editor caret the whole
     preventDefault dance exists to preserve). */
  useEffect(() => {
    if (!open || !kbRef.current || !gridRef.current) return;
    const cell = gridRef.current.querySelector('[data-tblgrid-active="true"]');
    if (cell && cell.focus) cell.focus();
  }, [open]);

  const insert = (r, c) => {
    if (doneRef.current) return;
    doneRef.current = true;
    // Focus is NOT restored to the button here: insertTable parks the caret in the
    // new caption's title so the researcher can name the table immediately (§4).
    closePicker(false);
    const api = getApi && getApi();
    if (!(api && api.insertTable)) return;
    // 117.md §4 — insertTable returns the new object's stable id so the parent can
    // record its creation stamp / focus it. 119.md §2 — carrying the gesture id.
    const id = api.insertTable(r, c, { opId: opRef.current });
    if (onInserted) onInserted(id);
  };

  const onGridKeyDown = (e) => {
    /* 117.md §44 — this popup CONSUMES the Escape, so it takes ownership of the
       fullscreen exit the browser queues alongside it: without the latch, dismissing
       the size picker in Focus Mode would also drop the whole workspace layout. */
    if (e.key === 'Escape') { markOverlayEscape(); e.preventDefault(); closePicker(true); return; }
    // A MODIFIED chord is never claimed (108.md §23 — it belongs to the router).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const d = GRID_ARROWS[e.key];
    if (!d) return;
    e.preventDefault();
    const r = Math.min(TABLE_GRID_MAX, Math.max(1, active.r + d[0]));
    const c = Math.min(TABLE_GRID_MAX, Math.max(1, active.c + d[1]));
    kbRef.current = true;
    setActive({ r, c });
    setHover({ r, c });
    const cell = gridRef.current
      && gridRef.current.querySelector(`[data-testid="stitch-manuscript-table-grid-${r}-${c}"]`);
    if (cell && cell.focus) cell.focus();
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" ref={btnRef} aria-label="Insert table" title="Insert a table"
        disabled={disabled} aria-haspopup="true" aria-expanded={open}
        data-testid="stitch-manuscript-tb-table"
        onMouseDown={(e) => e.preventDefault()}
        /* `detail === 0` is the standard "this click came from the keyboard" signal
           (Enter/Space on a button synthesises a click with no pointer detail). */
        onClick={(e) => { if (open) closePicker(false); else openPicker(e.detail === 0); }}
        style={{
          ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
          background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
        }}>
        ⊞ Table
      </button>
      {open && !disabled && (
        <>
          {/* click-away backdrop; preventDefault keeps the editor selection */}
          <div onMouseDown={(e) => { e.preventDefault(); closePicker(false); }}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }} />
          <div role="dialog" aria-label="Table size"
            data-testid="stitch-manuscript-table-grid"
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={onGridKeyDown}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41,
              background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
              padding: 10, boxShadow: '0 10px 26px rgba(15,23,42,0.18)',
            }}>
            <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: `repeat(${TABLE_GRID_MAX}, 16px)`, gap: 3 }}>
              {Array.from({ length: TABLE_GRID_MAX * TABLE_GRID_MAX }, (_, i) => {
                const r = Math.floor(i / TABLE_GRID_MAX) + 1;
                const c = (i % TABLE_GRID_MAX) + 1;
                const on = r <= hover.r && c <= hover.c;
                const isActive = r === active.r && c === active.c;
                return (
                  <button key={i} type="button" tabIndex={isActive ? 0 : -1}
                    aria-label={`Insert ${r} by ${c} table`}
                    data-testid={`stitch-manuscript-table-grid-${r}-${c}`}
                    data-tblgrid-active={isActive ? 'true' : undefined}
                    onMouseEnter={() => setHover({ r, c })}
                    onFocus={() => { setHover({ r, c }); setActive({ r, c }); }}
                    onClick={() => insert(r, c)}
                    style={{
                      width: 16, height: 16, padding: 0, cursor: 'pointer', borderRadius: 3,
                      border: `1px solid ${on ? C.acc : C.brd2}`,
                      background: on ? alpha(C.acc, '22') : 'transparent',
                    }} />
                );
              })}
            </div>
            <div aria-live="polite" style={{ marginTop: 6, fontSize: 10.5, color: C.txt2, textAlign: 'center' }}>
              {hover.r > 0 ? `${hover.r} × ${hover.c} (first row is the header)` : 'Pick rows × columns'}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

/* ══════════ 117.md §9 — Insert → Cross-reference ══════════
 *
 * The old control was a bare <select> of asset titles. That is wrong for three
 * reasons: a native select has no search (§9 explicitly asks for it when there are
 * many tables), it cannot show a number and an origin next to a title, and it
 * inserted a BLOCK at the caret. This is a real picker: type-to-filter over every
 * table AND figure, each row showing what the researcher actually recognises — the
 * live number, the title and where the object came from — and picking one inserts
 * an inline chip exactly where the caret is.
 *
 * `items` are precomputed by the caller: { id, kind, label, title, origin }.
 */
export const CROSSREF_EMPTY_TEXT = 'No tables or figures to reference yet.';
export const CROSSREF_NO_MATCH_TEXT = 'Nothing matches that search.';

const originBadge = (origin) => (origin === 'manual' ? 'Manual' : 'Auto');

export function CrossRefList({ items, onPick, testIdPrefix, autoFocus = false, emptyText }) {
  const [q, setQ] = useState('');
  const list = Array.isArray(items) ? items : [];
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? list.filter((it) => `${it.label} ${it.title} ${originBadge(it.origin)} ${it.id}`.toLowerCase().includes(needle))
    : list;
  return (
    <div>
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search tables and figures…"
        aria-label="Search tables and figures"
        data-testid={`${testIdPrefix}-search`}
        style={{ ...inp, fontSize: 11.5, marginBottom: 6 }} />
      <div role="listbox" aria-label="Tables and figures"
        style={{ maxHeight: 236, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {shown.map((it) => (
          <button key={it.id} type="button" role="option" aria-selected="false"
            data-testid={`${testIdPrefix}-item-${String(it.id).replace(/:/g, '-')}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick && onPick(it.id)}
            title={`${it.label} — ${it.title || it.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', width: '100%',
              padding: '5px 7px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid transparent', background: 'transparent', color: C.txt2, fontSize: 11.5,
            }}>
            <span style={{
              flexShrink: 0, fontWeight: 700, fontSize: 10, color: C.acc,
              background: alpha(C.acc, '14'), borderRadius: 99, padding: '1px 7px', whiteSpace: 'nowrap',
            }}>{it.label}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.title || it.id}
            </span>
            <span style={{
              flexShrink: 0, fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase',
              color: C.muted, border: `1px solid ${C.brd2}`, borderRadius: 99, padding: '0 6px',
            }}>{originBadge(it.origin)}</span>
          </button>
        ))}
        {!shown.length && (
          <div data-testid={`${testIdPrefix}-empty`} style={{ fontSize: 11, color: C.muted, padding: '6px 4px' }}>
            {list.length ? CROSSREF_NO_MATCH_TEXT : (emptyText || CROSSREF_EMPTY_TEXT)}
          </div>
        )}
      </div>
    </div>
  );
}

/** The popover form of the picker: one button that opens CrossRefList. */
export function CrossRefPicker({
  items, onPick, disabled, testIdPrefix = 'stitch-manuscript-crossref',
  label = '⧉ Cross-reference', title = 'Insert a reference to a table or figure at the cursor',
  block = false,
  // 120.md §5 — the picker SESSION. `onSessionStart` fires before this popover
  // exists (so the caret is bookmarked before any portal, list or search input can
  // take focus); `onSessionEnd` fires on every close that did NOT insert, which is
  // §5's "canceling the picker must clear the saved bookmark without modifying the
  // manuscript". An insert closes through `pick`, which hands the session to the
  // caller instead of ending it.
  onSessionStart = null, onSessionEnd = null,
}) {
  const [open, setOpen] = useState(false);
  const pick = (id) => { setOpen(false); if (onPick) onPick(id); };
  const cancel = () => { setOpen(false); if (onSessionEnd) onSessionEnd(); };
  const toggle = () => {
    if (open) { cancel(); return; }
    if (onSessionStart) onSessionStart();
    setOpen(true);
  };
  return (
    <span style={{ position: 'relative', display: block ? 'block' : 'inline-flex' }}>
      <button type="button" aria-label="Insert cross-reference" title={title}
        disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        data-testid={`${testIdPrefix}-open`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        style={{
          ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
          background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
          ...(block ? { width: '100%', justifyContent: 'center' } : {}),
        }}>
        {label}
      </button>
      {open && !disabled && (
        <>
          <div onMouseDown={(e) => { e.preventDefault(); cancel(); }}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }} />
          <div role="dialog" aria-label="Insert cross-reference"
            data-testid={`${testIdPrefix}-popover`}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41, width: 288,
              background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
              padding: 10, boxShadow: '0 10px 26px rgba(15,23,42,0.18)',
            }}>
            <CrossRefList items={items} onPick={pick} testIdPrefix={testIdPrefix} autoFocus />
          </div>
        </>
      )}
    </span>
  );
}

/* ══════════ 117.md §34/§35 — Insert → Citation ══════════
 *
 * The old control was a bare <select> of "Family Year" strings. §34 asks for search
 * across author, title, DOI, PMID, journal, year and keyword, and §35 asks for a
 * MULTI-reference citation — neither is expressible in a native select. This is the
 * same picker idiom as the cross-reference control above (type-to-filter list in a
 * popover, selection-preserving onMouseDown), with one addition: rows are
 * CHECKABLE, and "Insert" emits every checked id as ONE chip.
 *
 * `items` are precomputed by the caller: { id, label, title, meta, search, cited }.
 */
export const CITE_EMPTY_TEXT = 'No references yet — add included studies, or add a reference in the References tab.';
export const CITE_NO_MATCH_TEXT = 'No reference matches that search.';

/**
 * Turn a reference row ({ id, ref, index }) into a picker item. §34's six
 * searchable fields all land in `search`, so the filter needs no field knowledge.
 */
export function citeItemOf(row, refLabel) {
  const r = (row && row.ref) || row || {};
  const a = (r.authorsList && r.authorsList[0]) || null;
  const fam = (a && (a.family || a.raw)) || r.title || row.id;
  const label = refLabel ? refLabel(row) : `${fam}${r.year ? ` ${r.year}` : ''}`;
  const kw = [
    ...(Array.isArray(r.keywords) ? r.keywords : []),
    ...(Array.isArray(r.tags) ? r.tags : []),
  ].join(' ');
  return {
    id: row.id || r.id,
    label,
    title: r.title || '',
    meta: r.year || '',
    cited: !!row.cited,
    search: [label, r.title, r.authorsRaw, r.journal, r.year, r.doi, r.pmid, kw]
      .filter(Boolean).join(' '),
  };
}

export function CiteRefList({
  items, onInsert, testIdPrefix = 'stitch-manuscript-cite', autoFocus = false, emptyText,
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const list = Array.isArray(items) ? items : [];
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? list.filter((it) => String(it.search || `${it.label} ${it.title}`).toLowerCase().includes(needle))
    : list;
  const toggle = (id) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const commit = (ids) => {
    if (!ids.length) return;
    setPicked([]);
    setQ('');
    if (onInsert) onInsert(ids);
  };
  return (
    <div>
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search author, title, DOI, PMID, journal, year…"
        aria-label="Search references"
        data-testid={`${testIdPrefix}-search`}
        style={{ ...inp, fontSize: 11.5, marginBottom: 6 }} />
      <div role="listbox" aria-label="References" aria-multiselectable="true"
        style={{ maxHeight: 236, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {shown.map((it) => {
          const on = picked.includes(it.id);
          return (
            <button key={it.id} type="button" role="option" aria-selected={on ? 'true' : 'false'}
              data-testid={`${testIdPrefix}-item-${String(it.id).replace(/[^A-Za-z0-9_-]/g, '-')}`}
              onMouseDown={(e) => e.preventDefault()}
              /* A plain click inserts THIS reference immediately (the overwhelmingly
                 common case is one citation); the checkbox builds a multi-cite. */
              onClick={() => commit([it.id])}
              title={it.title || it.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', width: '100%',
                padding: '5px 7px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${on ? alpha(C.acc, '55') : 'transparent'}`,
                background: on ? alpha(C.acc, '10') : 'transparent', color: C.txt2, fontSize: 11.5,
              }}>
              <span role="checkbox" aria-checked={on ? 'true' : 'false'}
                aria-label={`Add ${it.label} to a multiple citation`}
                data-testid={`${testIdPrefix}-check-${String(it.id).replace(/[^A-Za-z0-9_-]/g, '-')}`}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(it.id); }}
                style={{
                  flexShrink: 0, width: 13, height: 13, borderRadius: 3, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 9, lineHeight: 1,
                  border: `1px solid ${on ? C.acc : C.brd2}`, color: '#fff',
                  background: on ? C.acc : 'transparent',
                }}>{on ? '✓' : ''}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong style={{ color: C.txt, fontWeight: 700 }}>{it.label}</strong>
                {it.title ? ` — ${it.title}` : ''}
              </span>
              {it.meta && (
                <span style={{
                  flexShrink: 0, fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase',
                  color: C.muted, border: `1px solid ${C.brd2}`, borderRadius: 99, padding: '0 6px',
                }}>{it.meta}</span>
              )}
            </button>
          );
        })}
        {!shown.length && (
          <div data-testid={`${testIdPrefix}-empty`} style={{ fontSize: 11, color: C.muted, padding: '6px 4px' }}>
            {list.length ? CITE_NO_MATCH_TEXT : (emptyText || CITE_EMPTY_TEXT)}
          </div>
        )}
      </div>
      {picked.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, paddingTop: 7, borderTop: `1px solid ${C.brd}` }}>
          <span style={{ fontSize: 10.5, color: C.muted, flex: 1 }} data-testid={`${testIdPrefix}-picked`}>
            {picked.length} selected
          </span>
          <button type="button" data-testid={`${testIdPrefix}-insert`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit(picked)}
            style={{ ...btnS('primary'), fontSize: 11 }}>
            Insert {picked.length} citations
          </button>
        </div>
      )}
    </div>
  );
}

/** The popover form of the citation picker: one button that opens CiteRefList. */
export function CiteRefPicker({
  items, onInsert, disabled, testIdPrefix = 'stitch-manuscript-insert-citation',
  label = '+ Cite…', title = 'Insert a citation at the cursor', block = false,
  // 120.md §5 — the picker SESSION; see CrossRefPicker above for the contract.
  // This one matters most: CiteRefList's search input carries autoFocus, and
  // WebKit drops the document selection the moment focus reaches a control
  // (documented in-repo at the citation-menu comment below), so the caret has to
  // be bookmarked BEFORE `setOpen(true)` renders the popover.
  onSessionStart = null, onSessionEnd = null,
}) {
  const [open, setOpen] = useState(false);
  const insert = (ids) => { setOpen(false); if (onInsert) onInsert(ids); };
  const cancel = () => { setOpen(false); if (onSessionEnd) onSessionEnd(); };
  const toggle = () => {
    if (open) { cancel(); return; }
    if (onSessionStart) onSessionStart();
    setOpen(true);
  };
  return (
    <span style={{ position: 'relative', display: block ? 'block' : 'inline-flex' }}>
      <button type="button" aria-label="Insert citation" title={title}
        disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        data-testid={testIdPrefix}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        style={{
          ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
          background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
          ...(block ? { width: '100%', justifyContent: 'center' } : {}),
        }}>
        {label}
      </button>
      {open && !disabled && (
        <>
          <div onMouseDown={(e) => { e.preventDefault(); cancel(); }}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }} />
          <div role="dialog" aria-label="Insert citation"
            data-testid={`${testIdPrefix}-popover`}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41, width: 320,
              background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
              padding: 10, boxShadow: '0 10px 26px rgba(15,23,42,0.18)',
            }}>
            <CiteRefList items={items} onInsert={insert} testIdPrefix={testIdPrefix} autoFocus />
          </div>
        </>
      )}
    </span>
  );
}

/**
 * Formatting toolbar. `getApi()` returns the imperative handle of the editor that
 * last had the caret (one toolbar serves the abstract's multiple fields too).
 * onMouseDown preventDefault keeps the editor selection alive through the click.
 */
export function RichToolbar({
  getApi, citeRefs, refLabel, disabled, crossRefs, onInsertCrossRef, onInsertCitation,
  // 119.md §5 — Insert → Picture. Rendered only when the host supplies the seam,
  // so a shell without a figure store never shows a control that cannot act (§69).
  onInsertPicture = null,
  // 121.md §1 — Insert → Symbol. The workspace routes it through the same picker
  // session as the other two pickers; without a host seam the control falls back to
  // the caret's own editor api, exactly like the cross-reference control does.
  onInsertSymbol = null,
  // 120.md §5 — both Insert pickers bookmark the caret before they open and clear
  // the bookmark when they close without inserting. The toolbar only forwards;
  // the workspace owns the session (it is the one that knows WHICH section's
  // editor the caret was in).
  onInsertSessionStart = null, onInsertSessionEnd = null,
}) {
  const run = (cmd) => {
    const api = getApi && getApi();
    if (api && api.exec) api.exec(cmd[0], cmd[1]);
  };
  return (
    <div role="toolbar" aria-label="Formatting" data-testid="stitch-manuscript-toolbar"
      style={{
        display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '6px 8px',
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, marginBottom: 10,
      }}>
      {TB_BUTTONS.map((b) => (
        <button key={b.key} type="button" aria-label={b.aria} title={b.title} disabled={disabled}
          data-testid={`stitch-manuscript-tb-${b.key}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(b.cmd)}
          style={{
            ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
            background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
            ...(b.style || {}),
          }}>
          {b.glyph}
        </button>
      ))}
      {/* 116.md §60 — Insert → Table grid selector */}
      <TableGridPicker getApi={getApi} disabled={disabled} />
      {/* 119.md §5 — Insert → Picture (the file-picker path; paste and drag-drop
          reach the same upload seam from inside the editor). */}
      {onInsertPicture && (
        <button type="button" aria-label="Insert picture" title="Insert a picture as a numbered figure"
          disabled={disabled} data-testid="stitch-manuscript-tb-picture"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsertPicture()}
          style={{
            ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
            background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
          }}>
          ▤ Picture
        </button>
      )}
      {/* 121.md §1 — Insert → Symbol, at the caret. Between ▤ Picture and
          ⧉ Cross-reference: the Insert group in the order a researcher reaches for it,
          and the same session wiring, so "clicking the Symbols menu must not cause the
          editor to lose the intended insertion position" is the SAME guarantee the
          citation picker already keeps rather than a second implementation of it. */}
      <SymbolPicker disabled={disabled}
        onSessionStart={onInsertSessionStart} onSessionEnd={onInsertSessionEnd}
        onInsert={(ch) => {
          if (onInsertSymbol) { onInsertSymbol(ch); return; }
          const api = getApi && getApi();
          if (api && api.insertSymbol) api.insertSymbol(ch);
        }} />
      {/* 117.md §9 — Insert → Cross-reference, at the caret */}
      <CrossRefPicker items={crossRefs || []} disabled={disabled}
        onSessionStart={onInsertSessionStart} onSessionEnd={onInsertSessionEnd}
        onPick={(id) => {
          if (onInsertCrossRef) { onInsertCrossRef(id); return; }
          const api = getApi && getApi();
          if (api && api.insertAssetRef) api.insertAssetRef(id);
        }} />
      {/* 117.md §34/§35 — Insert → Citation. It replaces the bare <select>, which
          had no search (§34 asks for six searchable fields) and could not express a
          multi-reference citation at all (§35). Rendered even when the library is
          empty so the control has a stable place in the toolbar and can say WHY it
          is empty; the old select silently vanished. */}
      {!disabled && (
        <>
          <span style={{ width: 1, alignSelf: 'stretch', background: C.brd, margin: '0 4px' }} />
          <CiteRefPicker
            items={(citeRefs || []).map((r) => citeItemOf(r, refLabel))}
            onSessionStart={onInsertSessionStart} onSessionEnd={onInsertSessionEnd}
            onInsert={(ids) => {
              if (onInsertCitation) { onInsertCitation(ids); return; }
              const api = getApi && getApi();
              if (api && api.insertCitation) api.insertCitation(ids);
            }} />
        </>
      )}
      <span style={{
        marginLeft: 'auto', fontSize: 10, color: C.muted, letterSpacing: 0.3,
        background: alpha(C.acc, '08'), padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap',
      }}>
        Formatted editing — no markup needed
      </span>
    </div>
  );
}

export default RichSectionEditor;
