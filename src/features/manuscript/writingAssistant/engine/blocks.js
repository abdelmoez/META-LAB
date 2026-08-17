/**
 * features/manuscript/writingAssistant/engine/blocks.js — 120.md §6 architecture
 * steps 1 and 2, "Text-block extraction from the editor model" and "Block
 * classification".
 *
 * Provided by the engine (rather than the hook) so the CLASSIFICATION rules are unit
 * tested and shared: Wave 4b's `useWritingAssistant` calls `splitBlocks()` on the
 * COMMITTED section markdown and ships the result to the worker. Keeping it here also
 * keeps the split identical to mdToHtml's line-based model, which is what makes the
 * decoration layer able to find block N in the DOM.
 *
 * §6's inclusion rules, implemented as `kind` + `checkText`:
 *   CHECK   headings, paragraphs, list items, caption TITLES, textual table cells.
 *   SKIP    `| --- |` separator rows, purely numeric table cells, code fences,
 *           horizontal rules, formatted reference entries, `[[token]]` markers,
 *           URLs and DOIs (the tokenizer firewall handles the last three).
 *
 * `checkText` is ALWAYS the same length as `text`. Everything excluded is masked in
 * place, never deleted, so an issue offset is an offset into the block's real text
 * and the decoration layer can walk the DOM with it. That is the single invariant
 * this module exists to hold.
 */

import { MASK_CHAR, maskNonProse } from './tokenize.js';

export const BLOCK_KIND = Object.freeze({
  HEADING: 'heading',
  PARAGRAPH: 'paragraph',
  LIST_ITEM: 'list-item',
  TABLE_ROW: 'table-row',
  SEPARATOR: 'separator',
  CODE: 'code',
  CAPTION_TITLE: 'caption-title',
  REFERENCE_ENTRY: 'reference-entry',
  BLANK: 'blank',
});

/** Kinds the checker never looks at. */
export const SKIPPED_KINDS = Object.freeze(new Set([
  BLOCK_KIND.SEPARATOR, BLOCK_KIND.CODE, BLOCK_KIND.REFERENCE_ENTRY, BLOCK_KIND.BLANK,
]));

const HEADING_RE = /^(#{1,6})(\s+)/;
const BULLET_RE = /^(\s*[-*+])(\s+)/;
const ORDERED_RE = /^(\s*\d+[.)])(\s+)/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^\s*```/;
const CAPTION_RE = /^\s*\[\[(?:tblcap|figcap):[^\]]+\]\]/;
/** A generated, formatted reference entry: "1. Author A, Author B. Title. Journal." */
const REFERENCE_ENTRY_RE = /^\s*(?:\[\d+\]|\d+\.)\s+\p{Lu}[^.]{2,}?[.,]\s/u;

const maskRun = (n) => MASK_CHAR.repeat(n);

/** Purely numeric / symbolic table cells carry nothing to spell-check. */
function isNumericCell(cell) {
  const trimmed = cell.trim();
  if (!trimmed) return true;
  return !/\p{L}{2,}/u.test(trimmed);
}

/**
 * Mask a pipe-table row down to its textual cells: the `|` delimiters and any cell
 * without at least two letters become mask characters.
 */
export function maskTableRow(line) {
  const out = line.split('');
  let cellStart = 0;
  const flush = (end) => {
    const cell = line.slice(cellStart, end);
    if (isNumericCell(cell)) {
      for (let i = cellStart; i < end; i += 1) {
        if (!/\s/.test(out[i])) out[i] = MASK_CHAR;
      }
    }
  };
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== '|') continue;
    // `\|` is the escaped literal pipe in the mdDom table grammar — not a delimiter.
    if (i > 0 && line[i - 1] === '\\') continue;
    flush(i);
    out[i] = MASK_CHAR;
    cellStart = i + 1;
  }
  flush(line.length);
  return out.join('');
}

/**
 * Classify one line.
 * @param {string} line
 * @param {{sectionKind?: string, inCodeFence?: boolean}} [opts]
 */
export function classifyBlock(line, opts = {}) {
  const raw = String(line ?? '');
  if (opts.inCodeFence || FENCE_RE.test(raw)) return BLOCK_KIND.CODE;
  if (!raw.trim()) return BLOCK_KIND.BLANK;
  if (RULE_RE.test(raw)) return BLOCK_KIND.SEPARATOR;
  if (TABLE_SEPARATOR_RE.test(raw) && raw.includes('-')) return BLOCK_KIND.SEPARATOR;
  if (CAPTION_RE.test(raw)) return BLOCK_KIND.CAPTION_TITLE;
  if (raw.includes('|') && /\|/.test(raw.trim())) return BLOCK_KIND.TABLE_ROW;
  if (HEADING_RE.test(raw)) return BLOCK_KIND.HEADING;
  if (BULLET_RE.test(raw) || ORDERED_RE.test(raw)) {
    // 120.md §6 — "Do not exclude the entire References section blindly if
    // user-authored annotations or titles within it are editable. Classify the
    // actual content." A numbered line that is shaped like a generated citation is
    // skipped; a numbered line of ordinary prose in the same section is checked.
    if (String(opts.sectionKind || '').toLowerCase() === 'references'
        && REFERENCE_ENTRY_RE.test(raw)) {
      return BLOCK_KIND.REFERENCE_ENTRY;
    }
    return BLOCK_KIND.LIST_ITEM;
  }
  if (String(opts.sectionKind || '').toLowerCase() === 'references'
      && REFERENCE_ENTRY_RE.test(raw)) {
    return BLOCK_KIND.REFERENCE_ENTRY;
  }
  return BLOCK_KIND.PARAGRAPH;
}

/** The same-length checkable projection of one line, given its kind. */
export function maskBlock(line, kind) {
  const raw = String(line ?? '');
  if (SKIPPED_KINDS.has(kind)) return maskRun(raw.length);
  let masked = raw;
  if (kind === BLOCK_KIND.TABLE_ROW) masked = maskTableRow(masked);
  if (kind === BLOCK_KIND.HEADING) {
    const m = HEADING_RE.exec(masked);
    if (m) masked = maskRun(m[1].length) + masked.slice(m[1].length);
  }
  if (kind === BLOCK_KIND.LIST_ITEM) {
    const m = BULLET_RE.exec(masked) || ORDERED_RE.exec(masked);
    if (m) masked = maskRun(m[1].length) + masked.slice(m[1].length);
  }
  return maskNonProse(masked);
}

/**
 * Split committed section markdown into checkable blocks.
 *
 * @param {string} markdown
 * @param {{sectionKind?: string, sectionId?: string}} [opts]
 * @returns {Array<{index:number, line:number, start:number, end:number, text:string,
 *   checkText:string, kind:string, checkable:boolean}>}
 */
export function splitBlocks(markdown, opts = {}) {
  const src = String(markdown ?? '');
  const lines = src.split('\n');
  const blocks = [];
  let offset = 0;
  let inFence = false;
  let index = 0;

  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line];
    const isFence = FENCE_RE.test(text);
    const kind = classifyBlock(text, { ...opts, inCodeFence: inFence });
    if (isFence) inFence = !inFence;

    if (kind !== BLOCK_KIND.BLANK) {
      blocks.push({
        index,
        line,
        start: offset,
        end: offset + text.length,
        text,
        checkText: maskBlock(text, kind),
        kind,
        checkable: !SKIPPED_KINDS.has(kind),
      });
      index += 1;
    }
    offset += text.length + 1;
  }
  return blocks;
}

/**
 * A cheap content hash for change detection. Wave 4b's hook compares this per block
 * to decide which blocks need rechecking, so the worker never sees an unchanged
 * paragraph twice (120.md §6 "Analysis of changed sentences or blocks").
 */
export function blockRevision(text) {
  const s = String(text ?? '');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}
