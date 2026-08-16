/**
 * manuscript/refTokens.js — 85.md Objective 2 (B1), extended by 117.md §4-§11 and
 * §69/§70. The reference layer of the manuscript object system:
 *
 *   1. ONE kind registry (`ASSET_KINDS`) that every former hard-coded `table|figure`
 *      site now consumes — the token regex, the plain-mention scanner, the chip
 *      labels and the docx inline parser (117.md §69/§70: a future kind such as
 *      supplementary tables or equations is an ADDITIVE entry here, not a sweep).
 *   2. The stable `[[table:<id>]]` / `[[figure:<id>]]` cross-reference tokens.
 *   3. The MANUAL-TABLE caption grammar `[[tblcap:<id>]] Title` (117.md §4) — a
 *      block-level marker line that gives a hand-authored pipe table a stable
 *      identity and a title WITHOUT leaving the prose (see the grammar note below).
 *   4. The numbering resolver that turns all of that into "Table 2" / "Figure 1" —
 *      ONE sequence per kind, ordered by DOCUMENT position (117.md §5-§7).
 *   5. The caption FORMATTER seam (117.md §8): semantic metadata (number + title)
 *      never embeds journal formatting; the editor caption and the Word caption
 *      both render through `formatAssetCaption`, keyed by the draft's template.
 *
 * Why the caption marker lives in the prose (117.md §4 decision):
 *   A manual table IS prose — it is typed inside a section's markdown, and the
 *   browser's native undo stack owns it. Storing its identity anywhere else means
 *   one Ctrl+Z can restore the table without its id (or the id without its table),
 *   and every regeneration/paste/undo becomes a two-store reconciliation problem.
 *   Keeping the marker on its own line directly above the table makes identity and
 *   content atomic under undo, copy/paste and section regeneration, and makes the
 *   whole registry DERIVED — exactly like the builder assets. Metadata that is NOT
 *   prose (created/modified stamps, extra caption/notes/source) lives in the
 *   draft-side `draft.tableMeta` map keyed by the same id.
 *
 * Design rules (unchanged from B1):
 *   - The token grammar deliberately CANNOT collide with CITATION_TOKEN_RE
 *     (`[[cite:…]]`) — the kind prefix is a closed set, and `tblcap` is NOT in it,
 *     so a caption marker can never be read as a cross-reference.
 *   - Numbering counts ONLY assets that will actually be emitted by the export:
 *     available AND (included OR referenced). A token reference to an available
 *     asset auto-includes it (returned in `autoIncluded`).
 *   - Abstract/title mentions count as mentions (for cross-ref text) but never
 *     drive first-mention ordering — only body sections do. A manual table anchors
 *     at its OWN position, so a table typed into the abstract is numbered there.
 *   - Referenced-but-unavailable / unknown ids resolve to number null and are
 *     reported in `unresolved` so exportValidation can warn/error honestly.
 *
 * Pure — no DOM/React/network, deterministic.
 */

import { SECTION_TYPES, draftSectionTypes, draftSectionLabel } from './model.js';

/* ════════════ 117.md §69/§70 — the ONE kind registry ════════════ */

/**
 * Every manuscript object kind that participates in cross-referencing. `id` is the
 * token prefix, `label` the singular UI/caption word, `plural` the export section
 * heading. Adding a kind here (e.g. `{ id:'suppl', label:'Supplementary Table' }`)
 * extends the token grammar, the chip labels, the docx inline parser and the
 * plain-mention scanner in one edit — that is the whole point of §69.
 */
export const ASSET_KINDS = [
  { id: 'table', label: 'Table', plural: 'Tables' },
  { id: 'figure', label: 'Figure', plural: 'Figures' },
];

export const ASSET_KIND_IDS = ASSET_KINDS.map((k) => k.id);

/** `table|figure` — the alternation every kind-aware pattern is built from. */
export const ASSET_KIND_ALTERNATION = ASSET_KIND_IDS.join('|');

/** The singular caption/chip word for a kind id OR a full asset id. Pure. */
export function assetKindLabel(kindOrId) {
  const kind = String(kindOrId == null ? '' : kindOrId).split(':')[0];
  const k = ASSET_KINDS.find((x) => x.id === kind);
  return k ? k.label : 'Table';
}

/** The kind id of a full asset id ('figure:prisma' → 'figure'), or null. Pure. */
export function assetKindOf(assetId) {
  const kind = String(assetId == null ? '' : assetId).split(':')[0];
  return ASSET_KIND_IDS.includes(kind) ? kind : null;
}

/** `[[table:study]]`, `[[figure:forest:mace-5y]]` — ids are [a-z0-9:-] only. */
export const ASSET_TOKEN_RE = new RegExp(`\\[\\[(${ASSET_KIND_ALTERNATION}):([a-z0-9:-]+)\\]\\]`, 'g');

/** Plain-text "Table 3"/"Figure 1" prose (DETECTION-ONLY — placement.js scans with it). */
export const PLAIN_MENTION_RE = new RegExp(`\\b(${ASSET_KINDS.map((k) => k.label).join('|')})\\s+(\\d+)\\b`, 'g');

/**
 * Placement/numbering zone: introduction..conclusion (abstract/title excluded).
 *
 * 119.md §7 — this is the CORE list, and it stays exported because callers that
 * hold only an ordered `[{id,content}]` array (no draft) still need a default. A
 * draft-aware caller reads `sec.group` off `orderedSections`, which carries the
 * draft's own structure, so a template's extra body sections (CARE's Timeline,
 * CONSORT's Harms…) participate in numbering without being listed here.
 */
export const BODY_SECTION_IDS = SECTION_TYPES.filter((s) => s.group === 'body').map((s) => s.id);

/** True when this ordered-section row belongs to the placement/numbering zone. */
export function isBodySection(sec, bodySet) {
  if (sec && typeof sec.group === 'string') return sec.group === 'body';
  return (bodySet || new Set(BODY_SECTION_IDS)).has(sec && sec.id);
}

/** Build the stable token for a full asset id ('table:study' → '[[table:study]]'). Pure. */
export function assetToken(assetId) {
  return `[[${String(assetId == null ? '' : assetId).replace(/[[\]\s]/g, '')}]]`;
}

/** Scan markdown for asset tokens → [{ kind, id, index }] (id = full 'kind:suffix'). Pure. */
export function findAssetTokens(md) {
  const out = [];
  const re = new RegExp(ASSET_TOKEN_RE.source, 'g');
  const s = String(md == null ? '' : md);
  let m;
  while ((m = re.exec(s)) !== null) out.push({ kind: m[1], id: `${m[1]}:${m[2]}`, index: m.index });
  return out;
}

/** Count how many times ONE asset id is cross-referenced across a draft. Pure. */
export function countAssetMentions(draftOrSections, assetId) {
  if (!assetId) return 0;
  let n = 0;
  for (const sec of orderedSections(draftOrSections || [])) {
    for (const tk of findAssetTokens(sec && sec.content)) if (tk.id === assetId) n += 1;
  }
  return n;
}

/* ════════════ 117.md §4 — the manual-table caption grammar ════════════ */

/**
 * 119.md §5 — the ORIGINS that anchor at their own block instead of at their
 * first mention.
 *
 * A manual table IS prose (its pipe rows are typed into the section) and an
 * UPLOADED figure IS a block (its `[[figcap:…]]` marker is where the picture
 * sits), so for both the document position of the marker is the ordinal.
 * A generated table/figure has no body in the prose, so it anchors at the first
 * sentence that cross-references it (the 85.md rule, unchanged).
 */
export const IN_PROSE_ORIGINS = Object.freeze(['manual', 'upload']);

/** True when this asset's number comes from its own block, not from a mention. */
export function anchorsInProse(asset) {
  return !!asset && IN_PROSE_ORIGINS.includes(asset.origin);
}

/** Manual-table ids are `[a-z0-9-]` so `table:<id>` stays inside the token grammar. */
export const MANUAL_TABLE_ID_RE = /^[a-z0-9-]+$/;

/** A caption MARKER anywhere in a line (used for positions; see the LINE form). */
export const TABLE_CAPTION_TOKEN_RE = /\[\[tblcap:([a-z0-9-]+)\]\]/g;

/**
 * A caption LINE: the marker must OPEN the line (leading whitespace allowed) and
 * everything after it is the title. Line-anchoring is what keeps the grammar
 * unambiguous — a stray `[[tblcap:x]]` mid-sentence is not a caption, so a caption
 * can never be created by accident inside a paragraph.
 */
export const TABLE_CAPTION_LINE_RE = /^[ \t]*\[\[tblcap:([a-z0-9-]+)\]\][ \t]*(.*)$/;

/** Normalize a caption title for the prose form: one line, no bracket grammar. */
export function cleanCaptionTitle(title) {
  return String(title == null ? '' : title)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Serialize the caption marker line for a manual table. Pure, canonical. */
export function tableCaptionLine(id, title) {
  const safeId = String(id == null ? '' : id).replace(/[^a-z0-9-]/g, '');
  const t = cleanCaptionTitle(title);
  return `[[tblcap:${safeId}]]${t ? ` ${t}` : ''}`;
}

/**
 * Find every caption marker line in one section's markdown.
 * @returns [{ id, assetId, title, index, line }] — `index` is the character offset
 *          of the marker (numbering anchors compare it against token offsets).
 * Pure.
 */
export function findTableCaptions(md) {
  const s = String(md == null ? '' : md);
  if (s.indexOf('[[tblcap:') === -1) return [];
  const out = [];
  const lines = s.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(TABLE_CAPTION_LINE_RE);
    if (m) {
      out.push({
        id: m[1],
        assetId: `table:${m[1]}`,
        title: cleanCaptionTitle(m[2]),
        index: offset + line.indexOf('[[tblcap:'),
        line: i,
      });
    }
    offset += line.length + 1;
  }
  return out;
}

/**
 * Every manual table in a draft, in DOCUMENT order (canonical section order, then
 * position within the section). Duplicate ids resolve to their FIRST occurrence —
 * the editor mints a fresh id on paste (§4d), so a duplicate here only happens
 * when markdown was assembled outside the editor, and silently numbering the same
 * id twice would be worse than ignoring the copy.
 * @returns [{ id, assetId, title, sectionId, index, line }]
 * Pure.
 */
export function collectManualTables(draftOrSections) {
  const out = [];
  const seen = new Set();
  for (const sec of orderedSections(draftOrSections || [])) {
    for (const c of findTableCaptions(sec && sec.content)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ ...c, sectionId: (sec && sec.id) || '' });
    }
  }
  return out;
}

/* ════════════ 119.md §5 — the UPLOADED-FIGURE anchor grammar ════════════
 *
 * `[[figcap:<figKey>]] Title` — the same block-marker shape as `[[tblcap:…]]`,
 * for the same reason (117.md §4, quoted above): a picture placed in the
 * manuscript is a BLOCK of the document, so its identity, its position and its
 * title must live in the prose where one native Ctrl+Z restores all three
 * together. That is what makes §5's "Undo must restore the figure and its
 * references" true without a two-store reconciliation, and it is why the bytes
 * are only ever deleted through an explicit, reference-checked route (the marker
 * an undo brings back must still point at a live file).
 *
 * What is NOT in the prose: the binary, the uploader, the filename, the intrinsic
 * dimensions and the replacement history — those live in the ManuscriptFigure row
 * — and the display overrides (caption/legend/alt text/width/alignment), which
 * ride the existing per-asset `draft.assets` channel like every other figure's.
 *
 * A figure key is the same `[a-z0-9-]` grammar as a manual-table id, so
 * `figure:<figKey>` is a legal cross-reference token and `[[figcap:…]]` can never
 * be read as one (the kind alternation is a closed set that does not contain
 * `figcap`).
 */

/** A figure MARKER anywhere in a line (used for positions; see the LINE form). */
export const FIGURE_CAPTION_TOKEN_RE = /\[\[figcap:([a-z0-9-]+)\]\]/g;

/** A figure caption LINE: marker opens the line, everything after it is the title. */
export const FIGURE_CAPTION_LINE_RE = /^[ \t]*\[\[figcap:([a-z0-9-]+)\]\][ \t]*(.*)$/;

/** Serialize the marker line for an uploaded figure. Pure, canonical. */
export function figureCaptionLine(figKey, title) {
  const safe = String(figKey == null ? '' : figKey).replace(/[^a-z0-9-]/g, '');
  const t = cleanCaptionTitle(title);
  return `[[figcap:${safe}]]${t ? ` ${t}` : ''}`;
}

/**
 * Find every figure marker line in one section's markdown.
 * @returns [{ figKey, assetId, title, index, line }] — `index` is the character
 *          offset of the marker (numbering anchors compare it against tokens).
 * Pure.
 */
export function findFigureCaptions(md) {
  const s = String(md == null ? '' : md);
  if (s.indexOf('[[figcap:') === -1) return [];
  const out = [];
  const lines = s.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(FIGURE_CAPTION_LINE_RE);
    if (m) {
      out.push({
        figKey: m[1],
        assetId: `figure:${m[1]}`,
        title: cleanCaptionTitle(m[2]),
        index: offset + line.indexOf('[[figcap:'),
        line: i,
      });
    }
    offset += line.length + 1;
  }
  return out;
}

/**
 * Every PLACED uploaded figure in a draft, in DOCUMENT order. Duplicate keys
 * resolve to their FIRST occurrence — same rule (and same reason) as
 * collectManualTables: numbering one identity twice would be worse than ignoring
 * the copy, and the editor re-mints colliding keys on paste.
 * @returns [{ figKey, assetId, title, sectionId, index, line }]  Pure.
 */
export function collectPlacedFigures(draftOrSections) {
  const out = [];
  const seen = new Set();
  for (const sec of orderedSections(draftOrSections || [])) {
    for (const c of findFigureCaptions(sec && sec.content)) {
      if (seen.has(c.figKey)) continue;
      seen.add(c.figKey);
      out.push({ ...c, sectionId: (sec && sec.id) || '' });
    }
  }
  return out;
}

/**
 * 119.md §5 "Deleting a referenced figure must warn the user and identify
 * affected references" — how many times a figure is USED in a draft, split into
 * its placement (the marker) and its cross-references (the `[[figure:…]]`
 * tokens). Both matter and they are not the same thing: removing the picture
 * leaves the sentences that point at it, which is exactly what the warning has to
 * say.
 * @returns { placed:boolean, sectionIds:string[], references:number,
 *            referenceSections:string[] }  Pure.
 */
export function figureUsage(draftOrSections, figKey) {
  const key = String(figKey == null ? '' : figKey);
  const assetId = `figure:${key}`;
  const out = { placed: false, sectionIds: [], references: 0, referenceSections: [] };
  if (!key) return out;
  for (const sec of orderedSections(draftOrSections || [])) {
    const sid = (sec && sec.id) || '';
    for (const c of findFigureCaptions(sec && sec.content)) {
      if (c.figKey !== key) continue;
      out.placed = true;
      if (!out.sectionIds.includes(sid)) out.sectionIds.push(sid);
    }
    for (const tk of findAssetTokens(sec && sec.content)) {
      if (tk.id !== assetId) continue;
      out.references += 1;
      if (!out.referenceSections.includes(sid)) out.referenceSections.push(sid);
    }
  }
  return out;
}

/**
 * Re-mint DUPLICATE figure markers in a pasted markdown fragment — the §5
 * counterpart of remintDuplicateCaptions, with one deliberate difference: a
 * figure's bytes live in a server row keyed by its figKey, so a COPY cannot mint
 * a new key on its own (there is no second row to point at). Pasting a figure
 * that is already placed therefore DROPS the duplicate marker rather than
 * inventing a dangling identity; moving one (cut → paste) keeps its key and every
 * cross-reference to it.
 * @returns {{ md:string, dropped:string[] }}  Pure.
 */
export function dropDuplicateFigureMarkers(md, used) {
  const s = String(md == null ? '' : md);
  const dropped = [];
  if (s.indexOf('[[figcap:') === -1) return { md: s, dropped };
  const taken = used instanceof Set ? new Set(used) : new Set(used || []);
  const seenHere = new Set();
  const lines = s.split('\n');
  const out = [];
  for (const line of lines) {
    const m = line.match(FIGURE_CAPTION_LINE_RE);
    if (!m) { out.push(line); continue; }
    const key = m[1];
    if (taken.has(key) || taken.has(`figure:${key}`) || seenHere.has(key)) { dropped.push(key); continue; }
    seenHere.add(key);
    out.push(line);
  }
  return { md: out.join('\n'), dropped };
}

/**
 * The human label for a section id ('methods' → 'Methods'). 119.md §7 — when the
 * caller has the draft, its OWN structure names the section (a renamed or
 * template-introduced section reads as itself); without one, the core registry
 * answers and an unknown id renders as its id rather than a blank. Pure.
 */
export function sectionLabelOf(sectionId, draft) {
  if (draft && !Array.isArray(draft) && draft.sections) return draftSectionLabel(draft, sectionId);
  const s = SECTION_TYPES.find((x) => x.id === sectionId);
  return s ? s.label : String(sectionId == null ? '' : sectionId);
}

/**
 * 117.md §J.15 — caption ids that appear MORE THAN ONCE in a draft.
 *
 * `collectManualTables` resolves a duplicate id first-wins and says nothing, which is
 * right for the registry (silently numbering one id twice would be worse) but leaves
 * the researcher with a table that has no number and no working cross-reference, and
 * no explanation. Inside the editor this is unreachable — a paste re-mints colliding
 * ids (`remintDuplicateCaptions`, §4d). It becomes reachable when markdown is
 * assembled OUTSIDE the editor: a hand-edited project blob, an import, a script, or a
 * draft copied between projects through the API. That is exactly the population this
 * scan exists for, so it reports rather than repairs: rewriting ids in a blob the
 * researcher hand-authored would silently break whatever cross-references they wrote.
 *
 * @param {object|Array} draftOrSections a draft, or ordered [{id,content}]
 * @returns {Array<{id:string, count:number, sectionIds:string[], sectionLabels:string[]}>}
 *          duplicated ids only, in first-occurrence document order. Pure.
 */
export function collectDuplicateManualTableIds(draftOrSections) {
  const order = [];
  const byId = new Map();
  for (const sec of orderedSections(draftOrSections || [])) {
    const sid = (sec && sec.id) || '';
    for (const c of findTableCaptions(sec && sec.content)) {
      let e = byId.get(c.id);
      if (!e) { e = { id: c.id, count: 0, sectionIds: [] }; byId.set(c.id, e); order.push(e); }
      e.count += 1;
      // Section list is DISTINCT and in document order: two copies in one section is
      // a real case (a duplicated block), and "Methods, Methods" reads as a bug.
      if (!e.sectionIds.includes(sid)) e.sectionIds.push(sid);
    }
  }
  return order
    .filter((e) => e.count > 1)
    .map((e) => ({ ...e, sectionLabels: e.sectionIds.map((id) => sectionLabelOf(id, draftOrSections)) }));
}

/* Monotonic within a process run — combined with a hash of the counter so ids look
   opaque, and always verified against the ids already in the document. */
let _mintSeq = 0;
function hash36(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

/**
 * Mint a fresh manual-table id that collides with nothing in `used` (an iterable of
 * bare ids and/or full `table:<id>` asset ids). Pure apart from the module counter.
 */
export function mintManualTableId(used) {
  const taken = used instanceof Set ? used : new Set(used || []);
  for (let i = 0; i < 1000; i += 1) {
    _mintSeq += 1;
    const id = `t${_mintSeq.toString(36)}${hash36(`${_mintSeq}:${i}`)}`.slice(0, 24);
    if (!taken.has(id) && !taken.has(`table:${id}`)) return id;
  }
  return `t${Date.now().toString(36)}`;
}

/**
 * 117.md §4(d) — re-mint DUPLICATE caption ids in a markdown fragment.
 *
 * Copying a table (in the editor, or from another manuscript) carries its caption
 * marker along. Pasting it unchanged would give two tables one identity: every
 * cross-reference to the original would silently point at whichever copy the
 * document-order walk hit first. So a pasted id that is already in use is replaced
 * by a fresh one — the copy becomes its own table, and the original keeps every
 * reference it had. Ids that are NOT in use are preserved (moving a table between
 * sections by cut/paste keeps its references intact, which is the whole point of a
 * stable id).
 *
 * @param {string} md      the pasted markdown fragment
 * @param {Iterable} used  ids already in the document (bare or `table:<id>`)
 * @param {function} [mint] id factory (defaults to mintManualTableId) — injectable
 *                          so tests are deterministic
 * @returns {{ md:string, reminted:[{from,to}] }}  Pure.
 */
export function remintDuplicateCaptions(md, used, mint) {
  const s = String(md == null ? '' : md);
  const taken = used instanceof Set ? new Set(used) : new Set(used || []);
  const make = typeof mint === 'function' ? mint : mintManualTableId;
  const reminted = [];
  if (s.indexOf('[[tblcap:') === -1) return { md: s, reminted };
  const seenHere = new Set();
  const out = s.replace(new RegExp(TABLE_CAPTION_TOKEN_RE.source, 'g'), (full, id) => {
    if (!taken.has(id) && !taken.has(`table:${id}`) && !seenHere.has(id)) {
      seenHere.add(id);
      return full;
    }
    const next = make(new Set([...taken, ...seenHere]));
    taken.add(next);
    seenHere.add(next);
    reminted.push({ from: id, to: next });
    return `[[tblcap:${next}]]`;
  });
  return { md: out, reminted };
}

/* ════════════ 117.md §8 — the caption FORMATTER seam ════════════ */

/**
 * Caption rendering is TEMPLATE work, never object work: a manuscript object owns
 * a number and a title, and how those two become a visible caption line belongs to
 * the journal template. Both renderers — the editor's caption element and the Word
 * exporter's caption paragraph — go through this one seam, so a future JAMA/Lancet
 * caption rule is an entry in this map and nothing else changes.
 *
 * Today every shipped template resolves to `default` ("Table 3. Title"), which is
 * the behaviour the export already had. We deliberately do NOT invent per-journal
 * caption rules we have not verified against author instructions — the seam exists
 * so they can be added honestly, one verified journal at a time.
 */
export const CAPTION_FORMATS = {
  default: {
    id: 'default',
    /** Cross-reference / number-chip text: "Table 3", "Table ?" when unnumbered. */
    label: (kindLabel, number) => `${kindLabel} ${number == null ? '?' : number}`,
    /** The caption's number prefix: "Table 3." */
    prefix: (kindLabel, number) => `${kindLabel} ${number == null ? '?' : number}.`,
    /** The whole caption line: "Table 3. Baseline characteristics" */
    caption: (prefix, title) => (title ? `${prefix} ${title}` : prefix),
  },
};

/** Resolve the caption format for a draft template id (unknown → default). Pure. */
export function captionFormatFor(templateId) {
  const f = templateId && CAPTION_FORMATS[templateId];
  return f || CAPTION_FORMATS.default;
}

/** "Table 3" / "Figure ?" — the cross-reference chip text. Pure. */
export function formatAssetLabel(kindOrId, number, opts = {}) {
  const f = opts.format || captionFormatFor(opts.templateId);
  return f.label(assetKindLabel(kindOrId), number == null ? null : number);
}

/** "Table 3." — the caption's auto-derived number prefix. Pure. */
export function formatCaptionPrefix(kindOrId, number, opts = {}) {
  const f = opts.format || captionFormatFor(opts.templateId);
  return f.prefix(assetKindLabel(kindOrId), number == null ? null : number);
}

/** "Table 3. Baseline characteristics" — the whole caption line. Pure. */
export function formatAssetCaption(kindOrId, number, title, opts = {}) {
  const f = opts.format || captionFormatFor(opts.templateId);
  return f.caption(formatCaptionPrefix(kindOrId, number, { format: f }), String(title == null ? '' : title).trim());
}

/* ════════════ numbering ════════════ */

/**
 * Normalize the `sections` argument: accepts an ordered [{id, content}] array as-is,
 * or a draft.
 *
 * 119.md §7 — for a draft this reads the DRAFT'S OWN section order
 * (`draftSectionTypes`), not the module-level core list, which is what makes a
 * template's section set reach asset numbering, placement, the caption registry and
 * the export in ONE edit. A draft that never chose a structure resolves to exactly
 * the core eight, so every pre-119 numbering is byte-identical. `group` rides along
 * so `isBodySection` can answer for custom sections too. Pure.
 */
export function orderedSections(draftOrSections) {
  if (Array.isArray(draftOrSections)) return draftOrSections;
  const secs = (draftOrSections && draftOrSections.sections) || {};
  return draftSectionTypes(draftOrSections).map((s) => ({
    id: s.id,
    group: s.group,
    content: (secs[s.id] && typeof secs[s.id].content === 'string') ? secs[s.id].content : '',
  }));
}

/**
 * Resolve asset numbering for a draft.
 * @param {object} args { sections: ordered [{id,content}] (or a draft), assets: computeManuscriptAssets output }
 * @returns {{
 *   byId: {[assetId]: number|null},        // null = not emitted (or unavailable)
 *   orderTables: string[], orderFigures: string[],  // emission order per kind
 *   mentioned: Set<string>,                // known asset ids referenced anywhere
 *   unresolved: [{token, id, kind, sectionId, reason:'unknown'|'unavailable'}],
 *   autoIncluded: Set<string>,             // included ONLY because a token references them
 * }}
 *
 * 117.md §5-§7 — ONE sequence per kind, ordered by DOCUMENT position:
 *   - a MANUAL table (origin 'manual') anchors at its own caption marker, in
 *     whatever section it physically sits in. It is a block of the document, so
 *     its position IS its ordinal — moving it renumbers, deleting it renumbers,
 *     and every `[[table:<id>]]` reference follows because it points at the id.
 *   - a REGISTRY asset (a builder table / generated figure) has no in-prose body,
 *     so it anchors at its FIRST BODY token mention — the B1 rule, unchanged.
 *   - the two anchor streams are merged by character offset within each section,
 *     so a hand-typed table between two referenced builder tables lands between
 *     their numbers rather than after them.
 *   - assets that are emitted but never anchored keep numbers AFTER all anchored
 *     ones, in registry order.
 * Numbering is never persisted — it is recomputed on every render, which is what
 * makes deletion/reordering renumber for free (§6/§7). Pure and cheap (single pass
 * over section text) — safe to call per editor render.
 */
export function resolveNumbering({ sections, assets } = {}) {
  const secs = orderedSections(sections || []);
  const list = Array.isArray(assets) ? assets : [];
  // Alias ids (asset.aliasIds — e.g. legacy 'figure:forest-primary') resolve to
  // their asset; everything downstream is tracked under the CANONICAL asset.id.
  const byAssetId = new Map(list.map((a) => [a.id, a]));
  for (const a of list) {
    for (const al of (a.aliasIds || [])) if (!byAssetId.has(al)) byAssetId.set(al, a);
  }
  const bodySet = new Set(BODY_SECTION_IDS);

  const mentioned = new Set();
  const unresolved = [];
  const anchorOrder = [];
  const anchorSeen = new Set();

  for (const sec of secs) {
    const isBody = isBodySection(sec, bodySet);
    // ONE positional stream per section: caption markers (manual tables) and
    // cross-reference tokens interleaved by character offset. Captions sort BEFORE
    // a token at the same offset — they cannot actually collide (different
    // grammars), the tie-break only keeps the sort deterministic.
    const stream = [];
    for (const c of findTableCaptions(sec && sec.content)) stream.push({ t: 0, index: c.index, id: c.assetId });
    // 119.md §5 — an uploaded figure's marker joins the SAME positional stream, so
    // a picture pasted between two referenced tables lands between their numbers
    // and a figure moved up the page renumbers everything below it for free.
    for (const c of findFigureCaptions(sec && sec.content)) stream.push({ t: 0, index: c.index, id: c.assetId });
    for (const tk of findAssetTokens(sec && sec.content)) stream.push({ t: 1, index: tk.index, tk });
    stream.sort((a, b) => (a.index - b.index) || (a.t - b.t));

    for (const ev of stream) {
      if (ev.t === 0) {
        // A manual table / placed figure anchors HERE, in every section (a table
        // typed into the abstract is still a table at that document position).
        const asset = byAssetId.get(ev.id);
        if (!asset) continue; // caption without a registry entry → nothing to number
        if (!anchorSeen.has(asset.id)) { anchorSeen.add(asset.id); anchorOrder.push(asset.id); }
        continue;
      }
      const tk = ev.tk;
      const asset = byAssetId.get(tk.id);
      if (!asset) {
        unresolved.push({ token: assetToken(tk.id), id: tk.id, kind: tk.kind, sectionId: sec.id, reason: 'unknown' });
        continue;
      }
      mentioned.add(asset.id);
      if (!asset.available) {
        unresolved.push({ token: assetToken(tk.id), id: tk.id, kind: tk.kind, sectionId: sec.id, reason: 'unavailable' });
        continue;
      }
      // An in-prose object's ordinal is its OWN block position, never a mention of
      // it — otherwise "Table 4 is discussed in the Introduction" would renumber
      // the table itself (117.md §7; 119.md §5 for uploaded figures).
      if (anchorsInProse(asset)) continue;
      if (isBody && !anchorSeen.has(asset.id)) { anchorSeen.add(asset.id); anchorOrder.push(asset.id); }
    }
  }

  // Auto-include: a token reference to an AVAILABLE asset counts as included.
  const autoIncluded = new Set();
  const emitted = new Set();
  for (const a of list) {
    if (!a.available) continue;
    if (a.included) { emitted.add(a.id); continue; }
    if (mentioned.has(a.id)) { emitted.add(a.id); autoIncluded.add(a.id); }
  }

  const byId = {};
  for (const a of list) byId[a.id] = null;
  const counters = {};
  for (const k of ASSET_KIND_IDS) counters[k] = 0;
  const order = {};
  for (const k of ASSET_KIND_IDS) order[k] = [];
  const assign = (id) => {
    const a = byAssetId.get(id);
    if (!a || !ASSET_KIND_IDS.includes(a.kind)) return;
    counters[a.kind] += 1;
    byId[id] = counters[a.kind];
    order[a.kind].push(id);
  };
  for (const id of anchorOrder) if (emitted.has(id) && byId[id] == null) assign(id);
  for (const a of list) if (emitted.has(a.id) && byId[a.id] == null) assign(a.id);

  // Alias ids mirror their canonical number so every renderer (editor chips,
  // renderAssetMarkers, docx parseInline) resolves alias tokens identically.
  for (const a of list) {
    for (const al of (a.aliasIds || [])) if (!(al in byId)) byId[al] = byId[a.id];
  }

  return {
    byId,
    orderTables: order.table || [],
    orderFigures: order.figure || [],
    orderByKind: order,
    mentioned,
    unresolved,
    autoIncluded,
  };
}

/**
 * Replace asset tokens with plain "Table 2" / "Figure 1" text for consumers that
 * cannot render chips (mirrors citations.renderInlineMarkers). Unknown/unnumbered
 * ids render as "Table ?" / "Figure ?" — never a raw token leak. Caption marker
 * lines render as their formatted caption ("Table 3. Baseline characteristics"),
 * so a plain-text rendering of a manual table keeps its number and title. Pure.
 */
export function renderAssetMarkers(md, numbering, _assets, opts = {}) {
  const byId = (numbering && numbering.byId) || {};
  const fmt = opts.format || captionFormatFor(opts.templateId);
  const capRe = new RegExp(TABLE_CAPTION_LINE_RE.source, 'gm');
  const figRe = new RegExp(FIGURE_CAPTION_LINE_RE.source, 'gm');
  const re = new RegExp(ASSET_TOKEN_RE.source, 'g');
  return String(md == null ? '' : md)
    .replace(capRe, (_full, id, title) => formatAssetCaption('table', byId[`table:${id}`], title, { format: fmt }))
    // 119.md §5 — a placed figure's marker renders as its formatted caption too, so
    // a plain-text rendering keeps the picture's number and title where it sits.
    .replace(figRe, (_full, key, title) => formatAssetCaption('figure', byId[`figure:${key}`], title, { format: fmt }))
    .replace(re, (_full, kind, suffix) => formatAssetLabel(kind, byId[`${kind}:${suffix}`], { format: fmt }));
}

export default {
  ASSET_KINDS,
  ASSET_KIND_IDS,
  ASSET_KIND_ALTERNATION,
  ASSET_TOKEN_RE,
  PLAIN_MENTION_RE,
  BODY_SECTION_IDS,
  isBodySection,
  MANUAL_TABLE_ID_RE,
  TABLE_CAPTION_LINE_RE,
  TABLE_CAPTION_TOKEN_RE,
  FIGURE_CAPTION_LINE_RE,
  FIGURE_CAPTION_TOKEN_RE,
  IN_PROSE_ORIGINS,
  anchorsInProse,
  CAPTION_FORMATS,
  assetKindLabel,
  assetKindOf,
  assetToken,
  findAssetTokens,
  countAssetMentions,
  cleanCaptionTitle,
  tableCaptionLine,
  findTableCaptions,
  collectManualTables,
  figureCaptionLine,
  findFigureCaptions,
  collectPlacedFigures,
  figureUsage,
  dropDuplicateFigureMarkers,
  mintManualTableId,
  remintDuplicateCaptions,
  captionFormatFor,
  formatAssetLabel,
  formatCaptionPrefix,
  formatAssetCaption,
  orderedSections,
  resolveNumbering,
  renderAssetMarkers,
};
