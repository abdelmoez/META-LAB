/**
 * manuscript/refTokens.js — 85.md Objective 2 (B1). Structured references from
 * manuscript prose to registry assets (tables/figures): the stable
 * `[[table:<id>]]` / `[[figure:<id>]]` tokens, the numbering resolver that turns
 * them into "Table 2" / "Figure 1" by order of first BODY mention, and the plain
 * marker renderer for consumers that cannot show chips.
 *
 * Design rules:
 *   - The token grammar deliberately CANNOT collide with CITATION_TOKEN_RE
 *     (`[[cite:…]]`) — the kind prefix is a closed (table|figure) set.
 *   - Numbering counts ONLY assets that will actually be emitted by the export:
 *     available AND (included OR referenced). A token reference to an available
 *     asset auto-includes it (returned in `autoIncluded`).
 *   - Abstract/title mentions count as mentions (for cross-ref text) but never
 *     drive first-mention ordering or placement — only body sections do.
 *   - Referenced-but-unavailable / unknown ids resolve to number null and are
 *     reported in `unresolved` so exportValidation can warn/error honestly.
 *
 * Pure — no DOM/React/network, deterministic.
 */

import { SECTION_TYPES } from './model.js';

/** `[[table:study]]`, `[[figure:forest:mace-5y]]` — ids are [a-z0-9:-] only. */
export const ASSET_TOKEN_RE = /\[\[(table|figure):([a-z0-9:-]+)\]\]/g;

/** Placement/numbering zone: introduction..conclusion (abstract/title excluded). */
export const BODY_SECTION_IDS = SECTION_TYPES.filter((s) => s.group === 'body').map((s) => s.id);

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

/**
 * Normalize the `sections` argument: accepts an ordered [{id, content}] array as-is,
 * or a draft (reads draft.sections in canonical SECTION_TYPES order). Pure.
 */
export function orderedSections(draftOrSections) {
  if (Array.isArray(draftOrSections)) return draftOrSections;
  const secs = (draftOrSections && draftOrSections.sections) || {};
  return SECTION_TYPES.map((s) => ({
    id: s.id,
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
 * Numbering rule: sequential per kind by FIRST token occurrence walking body
 * sections in section order; emitted-but-never-body-mentioned assets get numbers
 * AFTER all mentioned ones, in registry (assets array) order. Pure, cheap
 * (single pass over section text) — safe to call per editor render.
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
  const bodyFirstMention = [];
  const bodySeen = new Set();

  for (const sec of secs) {
    const tokens = findAssetTokens(sec && sec.content);
    for (const tk of tokens) {
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
      if (bodySet.has(sec.id) && !bodySeen.has(asset.id)) { bodySeen.add(asset.id); bodyFirstMention.push(asset.id); }
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
  const counters = { table: 0, figure: 0 };
  const orderTables = [];
  const orderFigures = [];
  const assign = (id) => {
    const a = byAssetId.get(id);
    if (!a || (a.kind !== 'table' && a.kind !== 'figure')) return;
    counters[a.kind] += 1;
    byId[id] = counters[a.kind];
    (a.kind === 'table' ? orderTables : orderFigures).push(id);
  };
  for (const id of bodyFirstMention) if (emitted.has(id) && byId[id] == null) assign(id);
  for (const a of list) if (emitted.has(a.id) && byId[a.id] == null) assign(a.id);

  // Alias ids mirror their canonical number so every renderer (editor chips,
  // renderAssetMarkers, docx parseInline) resolves alias tokens identically.
  for (const a of list) {
    for (const al of (a.aliasIds || [])) if (!(al in byId)) byId[al] = byId[a.id];
  }

  return { byId, orderTables, orderFigures, mentioned, unresolved, autoIncluded };
}

/**
 * Replace asset tokens with plain "Table 2" / "Figure 1" text for consumers that
 * cannot render chips (mirrors citations.renderInlineMarkers). Unknown/unnumbered
 * ids render as "Table ?" / "Figure ?" — never a raw token leak. Pure.
 */
export function renderAssetMarkers(md, numbering, _assets) {
  const byId = (numbering && numbering.byId) || {};
  const re = new RegExp(ASSET_TOKEN_RE.source, 'g');
  return String(md == null ? '' : md).replace(re, (_full, kind, suffix) => {
    const n = byId[`${kind}:${suffix}`];
    return `${kind === 'figure' ? 'Figure' : 'Table'} ${n == null ? '?' : n}`;
  });
}

export default {
  ASSET_TOKEN_RE,
  BODY_SECTION_IDS,
  assetToken,
  findAssetTokens,
  orderedSections,
  resolveNumbering,
  renderAssetMarkers,
};
