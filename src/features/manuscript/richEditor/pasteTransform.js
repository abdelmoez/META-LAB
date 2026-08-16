/**
 * features/manuscript/richEditor/pasteTransform.js — 120.md §7 (Microsoft Office
 * table recognition and import). PURE markdown-level transforms, no DOM and no
 * React, so the whole import pipeline is unit-testable in Node exactly like
 * mdDom.js and tableOps.js.
 *
 * WHERE THIS SITS IN THE PASTE LADDER
 *
 *   clipboard text/html → htmlToMd (sanitize: escape-first, DROP_TAGS, scheme
 *   whitelist, mso-* and Office XML reduced to nothing) → THIS MODULE → mdToHtml →
 *   ONE insertHtml call (one native undo step, one autosave emit).
 *
 * Nothing here ever sees raw clipboard markup: it operates on the markdown subset
 * that has ALREADY been through the sanitizer. That ordering is the security
 * property (§7 "Security and sanitization") and it is also why a `<table>` hidden
 * inside a `<script>` can never reach the table route — the sanitizer dropped the
 * script long before this module counts pipe tables.
 *
 * Three things happen here, in this order, and each is a pure function:
 *
 *   1. remintDuplicateCaptions  (117.md §4d) — a COPIED table gets a fresh id, a
 *      MOVED one (cut → paste) keeps its id and therefore its cross-references.
 *   2. dropDuplicateFigureMarkers (119.md §5) — a figure key points at server
 *      bytes and cannot be re-minted, so a duplicate marker is dropped.
 *   3. pasteTableIdentity (120.md §7, NEW) — every pipe table that arrives WITHOUT
 *      a caption marker gets one: a freshly minted id and, when Word sent the
 *      caption paragraph along with the table, the DESCRIPTIVE part of it. The
 *      imported NUMBER is always discarded — PecanRev derives numbers from
 *      manuscript order, and a frozen "Table 2" would be wrong the moment anything
 *      is inserted above it (§7 "Do not retain an imported number that conflicts
 *      with PecanRev numbering", "Do not create two captions").
 *
 * Deliberately NOT in htmlToMd: htmlToMd has non-paste callers (the editor's own
 * serialization, the table-op round trip, the pinned converter tests) and minting
 * an identity there would change bytes for every one of them.
 */

import { serializePipeTable } from './mdDom.js';
import {
  mintManualTableId, remintDuplicateCaptions, dropDuplicateFigureMarkers,
  tableCaptionLine, cleanCaptionTitle, TABLE_CAPTION_LINE_RE,
} from '../../../research-engine/manuscript/refTokens.js';

/**
 * Blocks in the markdown subset are joined with a blank line, and no block of the
 * subset contains one — so this split is exact rather than heuristic.
 *
 * The trim is not cosmetic. `dropDuplicateFigureMarkers` removes a LINE, which
 * leaves the surviving fragment with a leading newline ("\n| A |\n| --- |"), and a
 * block that does not START with a pipe is not recognized as a table — a pasted
 * table whose figure sibling was dropped would have gone in anonymous. Stripping
 * blank lines at either END of a block cannot change any block of the grammar
 * (every one of them is already trimmed when htmlToMd emits it).
 */
const trimBlock = (b) => String(b == null ? '' : b)
  .replace(/^(?:[ \t]*\n)+/, '')
  .replace(/(?:\n[ \t]*)+$/, '');

const splitBlocks = (md) => String(md == null ? '' : md)
  .split(/\n{2,}/)
  .map(trimBlock)
  .filter((b) => b !== '');

/** A pipe-table block: the block grammar is "a run of lines starting with |". */
export const isTableBlock = (b) => typeof b === 'string' && /^[ \t]*\|/.test(b);

/** A manual-table caption MARKER line (identity + title). */
export const isCaptionBlock = (b) => typeof b === 'string' && TABLE_CAPTION_LINE_RE.test(b);

/**
 * 120.md §7 — does this SANITIZED markdown contain a real table?
 *
 * The paste ladder asks this BEFORE it looks at image items, which is the whole
 * §7 fix: Excel, PowerPoint and Word all put a bitmap on the clipboard beside the
 * structured data, and the old ladder consumed the bitmap first and imported the
 * table as a screenshot — 120.md's explicit anti-goal.
 *
 * It is asked of the CONVERTED markdown and never of the raw clipboard string: a
 * regex over raw HTML would fire on a `<table>` inside a dropped `<script>` or a
 * commented-out mso fragment, i.e. on markup the sanitizer has already decided is
 * not content.
 */
export function hasPipeTableBlock(md) {
  return splitBlocks(md).some(isTableBlock);
}

/**
 * 120.md §7 "Caption handling" — a Word caption paragraph, recognized.
 *
 * Word emits the caption as an ordinary paragraph next to the table ("Table 2.
 * Baseline characteristics"); by the time it reaches here the sanitizer has
 * reduced its caption STYLING to nothing, so the text is all there is to match on.
 *
 * Returns the descriptive remainder (possibly '') when `block` is a caption
 * paragraph, or null when it is ordinary prose that must be left alone.
 *
 * Deliberately stricter than "Table <n> anything": the separator after the number
 * is REQUIRED unless the remainder is empty. Without that, the sentence "Table 1
 * shows the pooled baseline data." — a perfectly ordinary paragraph a researcher
 * may well have copied together with the table it describes — would be eaten and
 * turned into a title, which is worse than not harvesting at all. Word's own
 * caption separators are '.', ':', an en/em dash or ')'.
 *
 * Conservative by construction: one line, short, no block grammar of its own.
 */
/* '.' ':' ')' and the whole hyphen/dash family (ASCII '-', U+2010‥U+2015, U+2212). */
const CAPTION_SEPARATORS = '[.:)\\-\\u2010-\\u2015\\u2212]';
const CAPTION_PARAGRAPH_RE = new RegExp(
  `^[ \\t]*table[ \\t]+(?:[0-9]{1,4}|[ivxlcdm]{1,7})[ \\t]*(?:${CAPTION_SEPARATORS}[ \\t]*|[ \\t]*$)(.*)$`,
  'i',
);
const CAPTION_PARAGRAPH_MAX = 200;

export function harvestCaptionTitle(block) {
  if (typeof block !== 'string') return null;
  if (block.length > CAPTION_PARAGRAPH_MAX) return null;
  if (block.indexOf('\n') !== -1) return null;          // one paragraph, one line
  if (isTableBlock(block) || isCaptionBlock(block)) return null;
  if (/^[ \t]*(?:#|[-*+][ \t]|[0-9]+\.[ \t]|>)/.test(block)) return null;  // heading/list/quote
  const m = block.match(CAPTION_PARAGRAPH_RE);
  if (!m) return null;
  // The imported NUMBER (capture group deliberately absent — it is not read at
  // all) is discarded: PecanRev renumbers by manuscript order.
  return cleanCaptionTitle(m[1] || '');
}

/**
 * 120.md §7 steps 9-11 — give every caption-less pasted table a stable identity,
 * consuming an adjacent Word caption paragraph for its title.
 *
 * @param {string} md        sanitized markdown (already reminted / figure-cleaned)
 * @param {Iterable} used    table ids already in the document (bare or `table:<id>`)
 * @param {object} [opts]
 * @param {function} [opts.mint] id factory — injectable so tests are deterministic
 * @returns {{ md:string, mintedTables:Array<{id:string,title:string}> }}  Pure.
 */
export function pasteTableIdentity(md, used, opts = {}) {
  const mint = typeof opts.mint === 'function' ? opts.mint : mintManualTableId;
  const taken = new Set();
  for (const u of (used instanceof Set ? used : new Set(used || []))) {
    const s = String(u == null ? '' : u);
    if (!s) continue;
    taken.add(s);
    taken.add(s.replace(/^table:/, ''));
  }
  const src = splitBlocks(md);
  // Ids the fragment itself already claims are taken too, so two caption-less
  // tables in one paste can never be minted onto the same id.
  for (const b of src) {
    const m = typeof b === 'string' ? b.match(TABLE_CAPTION_LINE_RE) : null;
    if (m) { taken.add(m[1]); taken.add(`table:${m[1]}`); }
  }
  const out = [];
  const mintedTables = [];
  for (const b of src) {
    if (!isTableBlock(b)) { out.push(b); continue; }
    const prev = out.length ? out[out.length - 1] : null;
    // Already a first-class object (an internal copy, or the previous iteration's
    // freshly minted caption) — never create a SECOND caption for it.
    if (prev != null && isCaptionBlock(prev)) { out.push(b); continue; }
    let title = '';
    const harvested = prev == null ? null : harvestCaptionTitle(prev);
    if (harvested != null) { out.pop(); title = harvested; }
    const id = mint(taken);
    taken.add(id);
    taken.add(`table:${id}`);
    out.push(tableCaptionLine(id, title));
    out.push(b);
    mintedTables.push({ id, title });
  }
  return { md: out.join('\n\n'), mintedTables };
}

/**
 * 120.md §7 — the ONE markdown transform the paste handler applies.
 *
 * @param {string} md
 * @param {object} [opts]
 * @param {Iterable} [opts.usedTableIds]   ids already in the draft (bare or table:<id>)
 * @param {Iterable} [opts.usedFigureKeys] figure keys already placed
 * @param {function} [opts.mint]           injectable id factory (tests)
 * @returns {{ md:string, mintedTables:Array, reminted:Array, droppedFigures:Array }}
 * Pure.
 */
export function transformPastedMd(md, opts = {}) {
  const usedTables = opts.usedTableIds;
  const a = remintDuplicateCaptions(String(md == null ? '' : md), usedTables || [], opts.mint);
  const b = dropDuplicateFigureMarkers(a.md, opts.usedFigureKeys || []);
  const taken = new Set(usedTables instanceof Set ? usedTables : (usedTables || []));
  for (const r of a.reminted) taken.add(r.to);
  const c = pasteTableIdentity(b.md, taken, { mint: opts.mint });
  return { md: c.md, mintedTables: c.mintedTables, reminted: a.reminted, droppedFigures: b.dropped };
}

/**
 * 120.md §7 "Clipboard formats" / "Special cases" — tab-separated clipboard text
 * to a pipe table, or null when the text is not a grid.
 *
 * Reached ONLY when the clipboard carries no text/html at all (Safari exposing
 * less clipboard metadata than Chromium is the case §7 names, and this is the
 * degradation path it asks for — no UA sniffing anywhere). The gate is
 * deliberately strict, because ordinary text pasting must not change:
 *
 *   · at least two rows, and
 *   · every row carries the SAME number of tabs, and that number is ≥ 1.
 *
 * A ragged tab count is prose that happens to contain tabs, not a grid, and it
 * stays with the browser's default text paste.
 *
 * First row = header: that is Excel's own convention and the same shape
 * makeTableMd builds, so a pasted range and a hand-inserted table are the same
 * kind of object from the first frame.
 *
 * Excel FORMULAS never arrive here as formulas: both text/plain and text/html
 * carry the DISPLAYED value, so what is imported is text and nothing is ever
 * evaluated (§7 "Import the displayed value").
 */
export function tsvToPipeTable(text) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  while (lines.length && lines[0].trim() === '') lines.shift();
  if (lines.length < 2) return null;
  let tabs = -1;
  for (const l of lines) {
    if (l.trim() === '') return null;                 // a blank interior row is not a grid
    const n = (l.match(/\t/g) || []).length;
    if (n < 1) return null;
    if (tabs < 0) tabs = n;
    else if (n !== tabs) return null;                 // ragged → not a grid
  }
  const rows = lines.map((l) => l.split('\t').map((c) => c.trim()));
  // serializePipeTable escapes a literal '|' in a cell (116.md §63) and
  // rectangularizes, so the result is inside the grammar by construction.
  return serializePipeTable({ header: rows[0], rows: rows.slice(1), align: null });
}

export default {
  transformPastedMd, pasteTableIdentity, harvestCaptionTitle,
  hasPipeTableBlock, tsvToPipeTable, isTableBlock, isCaptionBlock,
};
