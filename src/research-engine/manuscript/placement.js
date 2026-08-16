/**
 * manuscript/placement.js — 85.md Objective 2 (B1). Block-level placement model
 * for the Word export: sections are decomposed into the SAME block groups the
 * docx converter emits (whole pipe tables and whole contiguous lists are ONE
 * block each — mirrors markdownToParagraphs, whose ordered-list numbering
 * instances must never be split), then every emitted asset is anchored AFTER the
 * block containing its FIRST body-section token.
 *
 * Rules (critique-hardened):
 *   - Token in a heading → after the heading block; in a list/table → after that
 *     WHOLE block (splicing mid-list would restart Word's list numbering).
 *   - Multiple first-mentions in one block → insertion order = token order
 *     within the block. Later mentions never re-insert.
 *   - Abstract/title are non-placement zones (mentions there count for cross-ref
 *     text only — refTokens handles that).
 *   - Legacy token-less drafts get NO placement from prose: plain-text mentions
 *     ("Table 2") are DETECTION-ONLY (validation warnings), excluding matches
 *     inside pipe-table blocks or a line-start match immediately above a pipe
 *     table (that is the user's own caption, not a cross-reference). Everything
 *     falls back to the end-of-document sections via `fallback`.
 *
 * Pure — no DOM/React/network, deterministic, single pass per section.
 */

import {
  ASSET_TOKEN_RE, BODY_SECTION_IDS, orderedSections,
  PLAIN_MENTION_RE, TABLE_CAPTION_LINE_RE, assetKindLabel,
} from './refTokens.js';

const TABLE_LINE_RE = /^\s*\|/;
const HEADING_RE = /^#{1,3}\s+/;
const LIST_RE = /^(?:[-*]\s+|\d+\.\s+)/;

/**
 * r2 — THE code for "the prose names a Table/Figure number that will not exist".
 *
 * It is emitted here, re-pushed verbatim by exportValidation, and mapped to a line
 * in the Overview's submission checklist. Three files, one string: exported as a
 * constant so a consumer can never hand-type a near-miss (the Overview shipped
 * 'plain-mention-mismatch', which nothing ever emits, so the §35 numbering line
 * read "Done" while the export dialog was warning about it).
 */
export const PLAIN_MENTION_CODE = 'plain-mention-out-of-range';

/**
 * Decompose a markdown section into ordered blocks. Line ranges are 0-based
 * inclusive over the section's own lines; blank lines belong to no block.
 * @returns [{ type:'paragraph'|'heading'|'list'|'table', startLine, endLine, text }]
 */
export function sectionBlocks(md) {
  const lines = String(md == null ? '' : md).split('\n');
  const blocks = [];
  let cur = null; // { type, startLine, endLine, lines }
  const close = () => {
    if (!cur) return;
    blocks.push({ type: cur.type, startLine: cur.startLine, endLine: cur.endLine, text: cur.lines.join('\n') });
    cur = null;
  };
  const extend = (type, i, line) => {
    if (cur && cur.type !== type) close();
    if (!cur) cur = { type, startLine: i, endLine: i, lines: [] };
    cur.endLine = i;
    cur.lines.push(line);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\s+$/, ''); // mirrors markdownToParagraphs
    if (TABLE_LINE_RE.test(line)) { extend('table', i, line); continue; }
    if (cur && cur.type === 'table') close();
    if (!line.trim()) { close(); continue; }
    if (HEADING_RE.test(line)) {
      close();
      blocks.push({ type: 'heading', startLine: i, endLine: i, text: line });
      continue;
    }
    if (LIST_RE.test(line)) { extend('list', i, line); continue; }
    close();
    blocks.push({ type: 'paragraph', startLine: i, endLine: i, text: line });
  }
  close();
  return blocks;
}

/** Plain-text "Table N"/"Figure N" detection (DETECTION-ONLY — never places). */
function collectPlainMentions(md, sectionId, out) {
  const lines = String(md == null ? '' : md).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (TABLE_LINE_RE.test(line)) continue; // inside a pipe-table block
    // 117.md §4 — a structured caption marker line is the OBJECT's own caption, not
    // prose drift: its "Table N" text is derived, so it must never be counted as a
    // stale plain-text mention.
    if (TABLE_CAPTION_LINE_RE.test(line)) continue;
    const re = new RegExp(PLAIN_MENTION_RE.source, 'g');
    let m;
    while ((m = re.exec(line)) !== null) {
      // Caption position: a line-start mention immediately above a pipe table is
      // the user's own table caption — not a cross-reference.
      if (m.index === 0 && TABLE_LINE_RE.test(lines[i + 1] || '')) continue;
      out.push({ kind: m[1].toLowerCase(), number: +m[2], sectionId, line: i });
    }
  }
}

/**
 * Compute where each emitted asset is spliced into the document.
 * @param {object} args {
 *   sections   ordered [{id,content}] (or a draft — orderedSections normalizes),
 *   numbering  resolveNumbering output (defines the emitted set + order),
 *   assets     computeManuscriptAssets output (resolves alias token ids —
 *              e.g. 'figure:forest-primary' — to their canonical asset)
 * }
 * @returns {{
 *   bySection: {[sectionId]: [{afterBlockIndex, assetId}]},
 *   fallback:  string[],   // emitted but never body-mentioned → end sections
 *   warnings:  [{code, message, sectionId}],
 *   plainMentions: [{kind, number, sectionId, line}],  // detection-only raw hits
 * }}
 */
export function computePlacements({ sections, numbering, assets } = {}) {
  const secs = orderedSections(sections || []);
  const num = numbering || {};
  const byId = num.byId || {};
  const emitted = new Set(Object.keys(byId).filter((id) => byId[id] != null));
  const bodySet = new Set(BODY_SECTION_IDS);

  // Alias token ids place their CANONICAL asset (the docx emitter is keyed by
  // canonical ids only — an alias assetId would silently emit nothing).
  const aliasTo = new Map();
  // 117.md §4 — MANUAL tables are ALREADY at their position: they are prose blocks
  // the exporter walks through anyway. Placing them would emit the same table
  // twice, so they are excluded from both `bySection` and `fallback`.
  const manualIds = new Set();
  for (const a of (Array.isArray(assets) ? assets : [])) {
    for (const al of (a.aliasIds || [])) if (!aliasTo.has(al)) aliasTo.set(al, a.id);
    if (a && a.origin === 'manual') manualIds.add(a.id);
  }

  const bySection = {};
  const placed = new Set();
  const plainMentions = [];

  for (const sec of secs) {
    const content = (sec && sec.content) || '';
    if (bodySet.has(sec && sec.id)) {
      const blocks = sectionBlocks(content);
      for (let bi = 0; bi < blocks.length; bi += 1) {
        const re = new RegExp(ASSET_TOKEN_RE.source, 'g');
        let m;
        while ((m = re.exec(blocks[bi].text)) !== null) {
          const raw = `${m[1]}:${m[2]}`;
          const id = aliasTo.get(raw) || raw;
          if (manualIds.has(id)) continue;                  // already inline (117.md §4)
          if (!emitted.has(id) || placed.has(id)) continue; // later mentions never re-insert
          placed.add(id);
          if (!bySection[sec.id]) bySection[sec.id] = [];
          bySection[sec.id].push({ afterBlockIndex: bi, assetId: id });
        }
      }
    }
    collectPlainMentions(content, sec && sec.id, plainMentions);
  }

  // Emitted but never mentioned in a body section → end-of-document sections,
  // in numbering order (tables first, then figures).
  const orderAll = [...(num.orderTables || []), ...(num.orderFigures || [])];
  const fallback = orderAll.filter((id) => emitted.has(id) && !placed.has(id) && !manualIds.has(id));

  // Numbering-mismatch warnings from plain-text mentions (legacy drafts, or
  // prose typed around tokens). Only the provable case: N exceeds what exports.
  const warnings = [];
  const counts = { table: (num.orderTables || []).length, figure: (num.orderFigures || []).length };
  for (const pm of plainMentions) {
    if (pm.number > (counts[pm.kind] || 0)) {
      const label = assetKindLabel(pm.kind);
      warnings.push({
        code: PLAIN_MENTION_CODE,
        sectionId: pm.sectionId,
        message: `The text mentions "${label} ${pm.number}" but only ${counts[pm.kind] || 0} ${pm.kind}${(counts[pm.kind] || 0) === 1 ? '' : 's'} will be exported.`,
      });
    }
  }

  return { bySection, fallback, warnings, plainMentions };
}

export default { sectionBlocks, computePlacements };
