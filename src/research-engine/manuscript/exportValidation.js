/**
 * manuscript/exportValidation.js — 85.md Objective 2 (B1). Pre-export validation
 * for the Word exporter: rolls the asset registry, numbering, placement,
 * save/freshness state and live-source health into a single honest
 * { errors, warnings, info } report the export dialog renders.
 *
 * Severity contract:
 *   ERRORS block the export (broken references — including a reference to a manual
 *   table that has since been deleted, 117.md §11 — internal numbering invariant,
 *   unrenderable asset kinds). WARNINGS allow "Export anyway" (unavailable
 *   references, unplaced/unlabelled assets, staleness, pending saves, legacy
 *   plain-text mention drift, mixed reference modes). INFO is awareness only
 *   (pipe tables that carry NO caption are still unnumbered; out-of-scope figures).
 *
 * Every entry is { code, message, action }. Pure, deterministic and CHEAP —
 * B2 calls this per editor render, so everything expensive (assets, numbering,
 * placements) is taken as INPUT, never recomputed here.
 */

import {
  orderedSections, TABLE_CAPTION_LINE_RE, assetKindLabel, ASSET_KIND_IDS,
  // 117.md §J.15 — duplicate caption ids the editor could not have produced.
  collectDuplicateManualTableIds,
} from './refTokens.js';
import { sectionBlocks, PLAIN_MENTION_CODE } from './placement.js';
// 117.md §39 — citation integrity reads the SAME usage scan the numbering and the
// References panel read, so the export dialog can never disagree with the page.
import { collectCitationUsage } from './citations.js';
import { suggestReferenceDuplicates } from './referenceLibrary.js';

/* Small bounded Levenshtein for closest-id suggestions on typo'd references. */
function editDistance(a, b) {
  const s = String(a); const t = String(b);
  if (Math.abs(s.length - t.length) > 8) return Infinity;
  const prev = new Array(t.length + 1);
  const curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= t.length; j += 1) prev[j] = curr[j];
  }
  return prev[t.length];
}

/** Closest known asset id to a mistyped one (same kind preferred), or null. */
export function closestAssetId(id, knownIds) {
  const list = Array.isArray(knownIds) ? knownIds : [];
  const kind = String(id || '').split(':')[0];
  let best = null;
  let bestD = Infinity;
  for (const k of list) {
    const d = editDistance(id, k) + (String(k).split(':')[0] === kind ? 0 : 2);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= Math.max(3, Math.floor(String(id || '').length / 2)) ? best : null;
}

/** 117.md §39 — closest known REFERENCE id to a citation that resolves to nothing. */
export function closestReferenceId(id, knownIds) {
  const list = Array.isArray(knownIds) ? knownIds : [...(knownIds || [])];
  let best = null;
  let bestD = Infinity;
  for (const k of list) {
    const d = editDistance(id, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= Math.max(3, Math.floor(String(id || '').length / 2)) ? best : null;
}

/** Metadata a CITED reference must carry before it is submission-ready (§39). */
const KEY_REFERENCE_FIELDS = [
  { key: 'title', label: 'title' },
  { key: 'authorsRaw', label: 'authors' },
  { key: 'year', label: 'year' },
];

/**
 * 117.md §39/§40 — citation integrity.
 *
 * Split out so it is unit-testable on its own and so `validateExport` stays a
 * composition rather than one long function. Severities follow the §39 contract:
 *   ERROR    a citation resolves to no reference (typo, deleted study, id drift) —
 *            or to a reference the researcher SUPPRESSED. Either way the exported
 *            marker would point at a bibliography entry that is not there.
 *   WARNING  a CITED reference is missing key metadata, or two library entries look
 *            like the same work.
 *   INFO     a library entry that is never cited (perfectly legal while drafting —
 *            it is awareness, not a defect).
 *
 * @param {object} args { draft, references, aliases, removedIds, library }
 * @returns {{errors:[], warnings:[], info:[]}}  Pure.
 */
export function validateCitations(args = {}) {
  const { draft, references, aliases, removedIds } = args;
  const errors = [];
  const warnings = [];
  const info = [];
  const push = (arr, code, message, action) => arr.push({ code, message, action });
  const refs = Array.isArray(references) ? references : [];
  if (!draft) return { errors, warnings, info };

  const byId = new Map(refs.map((r) => [r.id, r]));
  const knownIds = refs.map((r) => r.id);
  const suppressed = removedIds instanceof Set ? removedIds : new Set(removedIds || []);
  const usage = collectCitationUsage(draft, { aliases });

  // 1. citations that resolve to nothing (§39: "citation nodes pointing to missing
  //    references"). Deduped per id, with a closest-match suggestion.
  const seen = new Set();
  for (const tk of usage.tokens) {
    for (let i = 0; i < tk.resolved.length; i += 1) {
      const id = tk.resolved[i];
      const raw = tk.ids[i];
      if (byId.has(id) || seen.has(id)) continue;
      seen.add(id);
      if (suppressed.has(id)) {
        push(errors, 'cite-suppressed',
          `The manuscript cites "${raw}" in ${tk.sectionId}, but that reference is hidden from the library.`,
          'Restore the reference in the References tab, or remove the citation.');
        continue;
      }
      const near = closestReferenceId(id, knownIds);
      const nearRef = near ? byId.get(near) : null;
      push(errors, 'cite-unknown',
        `The manuscript cites "${raw}" in ${tk.sectionId}, which is not in the reference library${nearRef ? ` — the closest match is "${nearRef.title || near}"` : ''}.`,
        nearRef ? 'Re-point the citation from its chip menu, or remove it.' : 'Add the reference to the library, or remove the citation.');
    }
  }

  // 2. cited references missing metadata a bibliography entry needs (§39).
  for (const r of refs) {
    if (!usage.cited.has(r.id)) continue;
    const missing = KEY_REFERENCE_FIELDS.filter((f) => !String(r[f.key] || '').trim()).map((f) => f.label);
    if (!missing.length) continue;
    push(warnings, 'cited-ref-incomplete',
      `Cited reference "${r.title || r.id}" is missing its ${missing.join(' and ')}.`,
      'Complete the reference in the References tab before submission.');
  }

  // 3. library entries nobody cites — INFO, never a warning: an uncited reference
  //    is a normal state of a manuscript in progress.
  const uncited = refs.filter((r) => !usage.cited.has(r.id));
  if (uncited.length && usage.cited.size) {
    push(info, 'uncited-references',
      `${uncited.length} reference${uncited.length === 1 ? '' : 's'} in the library ${uncited.length === 1 ? 'is' : 'are'} never cited in the text — ${uncited.length === 1 ? 'it' : 'they'} will still be listed in the bibliography.`,
      'Cite them where they belong, or hide them from the References tab.');
  }

  // 4. probable duplicate bibliography entries (§39). Bounded scan (§33).
  const dup = suggestReferenceDuplicates(refs);
  for (const p of dup.pairs.slice(0, 5)) {
    push(warnings, 'duplicate-references',
      `"${p.a.title || p.a.id}" and "${p.b.title || p.b.id}" look like the same work (${p.verdict.reasons.slice(0, 2).join(', ')}).`,
      'Merge them in the References tab — citations to either one keep working.');
  }

  return { errors, warnings, info };
}

/**
 * @param {object} args {
 *   project, draft,
 *   assets      computeManuscriptAssets output,
 *   numbering   resolveNumbering output,
 *   placements  computePlacements output,
 *   saveState   'saved'|'saving'|'error' (useManuscript),
 *   sourcesSettled boolean,
 *   freshness   computeFreshness output ({status,label,counts}),
 *   dataStatus  {[sourceKey]: 'ok'|'error'|…} (manuscriptData honesty map),
 *   // 117.md §39 — the resolved reference library (resolveReferenceLibrary output
 *   // fields). Optional: omitted → the citation checks simply do not run, which is
 *   // the pre-117 behaviour for any caller that has not been updated.
 *   references, aliases, removedIds
 * }
 * @returns {{ errors:[{code,message,action}], warnings:[...], info:[...] }}
 */
export function validateExport(args = {}) {
  const {
    project, draft, assets, numbering, placements,
    saveState, sourcesSettled, freshness, dataStatus,
    references, aliases, removedIds,
  } = args;
  const list = Array.isArray(assets) ? assets : [];
  const num = numbering || {};
  const byId = num.byId || {};
  const pl = placements || {};
  // Alias ids (asset.aliasIds — e.g. 'figure:forest-primary') resolve to their
  // asset so alias-referencing messages/checks describe the right item.
  const assetById = new Map(list.map((a) => [a.id, a]));
  for (const a of list) {
    for (const al of (a.aliasIds || [])) if (!assetById.has(al)) assetById.set(al, a);
  }
  const knownIds = list.map((a) => a.id);

  const errors = [];
  const warnings = [];
  const info = [];
  const push = (arr, code, message, action) => arr.push({ code, message, action });

  /* ── ERRORS ── */

  // Unknown reference (typo / renamed outcome) — dedupe per id, suggest closest.
  const seenUnknown = new Set();
  const seenUnavailable = new Set();
  for (const u of (num.unresolved || [])) {
    if (u.reason === 'unknown') {
      if (seenUnknown.has(u.id)) continue;
      seenUnknown.add(u.id);
      const near = closestAssetId(u.id, knownIds);
      push(errors, 'unknown-asset-ref',
        `${u.token} in ${u.sectionId} does not match any table or figure${near ? ` — closest match is "${near}"` : ''}.`,
        near ? `Change the reference to [[${near}]] or remove it.` : 'Remove or correct the reference.');
    } else if (u.reason === 'unavailable') {
      if (seenUnavailable.has(u.id)) continue;
      seenUnavailable.add(u.id);
      const a = assetById.get(u.id);
      const kindLabel = `${assetKindLabel(u.kind)} ?`;
      push(warnings, 'ref-unavailable',
        `${u.token} refers to "${(a && (a.title || a.id)) || u.id}", which has no data yet — it will export as plain "${kindLabel}" and the ${u.kind} will be skipped.`,
        'Provide the underlying data (or remove the reference) before exporting.');
    }
  }

  // Duplicate numbering — internal invariant; should be impossible.
  // 117.md §69 — driven by the kind registry, so a new kind is checked for free.
  for (const kind of ASSET_KIND_IDS) {
    const seen = new Map();
    for (const id of Object.keys(byId)) {
      const n = byId[id];
      if (n == null) continue;
      const a = assetById.get(id);
      // Alias entries mirror their canonical number by design — not a duplicate.
      if (!a || a.kind !== kind || a.id !== id) continue;
      if (seen.has(n)) {
        push(errors, 'duplicate-numbering',
          `Internal numbering error: ${kind} number ${n} was assigned to both "${seen.get(n)}" and "${id}".`,
          'Regenerate the export; if this persists, report it as a bug.');
      } else seen.set(n, id);
    }
  }

  // Included asset of a kind the export cannot render.
  for (const a of list) {
    if (a && a.included && !ASSET_KIND_IDS.includes(a.kind)) {
      push(errors, 'unsupported-asset-kind',
        `"${a.title || a.id}" has kind "${a.kind}", which the Word export cannot render.`,
        'Exclude this item from the export.');
    }
  }

  /* ── WARNINGS ── */

  // Included but never mentioned in the text → fallback end section. B2 scope
  // refinement: this fires ONLY for assets the researcher EXPLICITLY included
  // (draft.assets[id].included === true). Default-included assets landing in the
  // end-of-document sections IS the legacy layout — warning on them would put a
  // dialog in front of every export of every draft ever generated, which defeats
  // the clean-path one-click contract. Explicit inclusion states intent ("put
  // this in my manuscript"), so an unmentioned explicit include is worth a nudge.
  const assetOverrides = (draft && draft.assets && typeof draft.assets === 'object') ? draft.assets : {};
  for (const id of (pl.fallback || [])) {
    const fa = assetById.get(id);
    // Alias overrides read through (legacy role-keyed draft.assets entries).
    const ov = assetOverrides[id]
      || ((fa && fa.aliasIds) || []).map((al) => assetOverrides[al]).find((x) => x && x.included === true);
    if (!(ov && ov.included === true)) continue;
    const a = fa;
    const kindLabel = assetKindLabel(a ? a.kind : 'table');
    push(warnings, 'included-not-mentioned',
      `${kindLabel} "${(a && (a.title || a.id)) || id}" is included but never referenced in the text — it will be placed at the end of the document.`,
      'Insert a reference where it belongs, or exclude it from the export.');
  }

  // Emitted assets without any title/caption, and stale ones.
  for (const a of list) {
    if (!a || byId[a.id] == null) continue; // only assets that will be emitted
    if (!String(a.title || '').trim() && !String(a.defaultCaption || '').trim()) {
      push(warnings, 'missing-caption',
        `${assetKindLabel(a.kind)} "${a.id}" has no title or caption.`,
        a.origin === 'manual'
          // 117.md §4 — a manual table's title IS its caption line in the page, so
          // the fix is in the editor, not in the Tables & Figures panel.
          ? 'Give the table a title in its caption line in the manuscript text.'
          : 'Add a title or caption in the Tables & Figures panel.');
    }
    if (a.stale === true) {
      push(warnings, 'stale-asset',
        `"${a.title || a.id}" may be out of date with the current project data.`,
        'Refresh project sources, then re-check before exporting.');
    }
  }

  /* 117.md §J.15 — the SAME caption id used by two tables.
     Only reachable from markdown assembled outside the editor (hand-edited blob,
     import, API copy) — the editor re-mints on paste. First-wins is stated out loud
     because that is what the researcher will otherwise experience as "one of my
     tables lost its number and every reference to it points at the wrong table". */
  for (const d of collectDuplicateManualTableIds(draft || [])) {
    const where = d.sectionLabels.filter(Boolean).join(', ');
    push(warnings, 'duplicate-table-id',
      `Table id "${d.id}" is used by ${d.count} tables${where ? ` (${where})` : ''} — only the first one is numbered and cross-referenced; the others export as unnumbered tables.`,
      'Delete the repeated caption line and re-add it with “+ Caption” in the editor, which mints a fresh id.');
  }

  // Overall generated-content freshness (84.md computeFreshness rollup).
  if (freshness && (freshness.status === 'critical' || freshness.status === 'updates')) {
    push(warnings, 'stale-content',
      `Generated content may be out of date — ${freshness.label || freshness.status}.`,
      'Review the sync panel and refresh outdated sections before exporting.');
  }

  // Manuscript save not settled → the exported file may miss the last edits' server copy.
  // 117.md §J.13 — `saveState` is now the COMPOSED state (the editor's own ∘ the
  // shell's real autosave), so 'conflict' can reach here: the server REFUSED this
  // client's write and holds a different, newer copy. Exporting then produces a
  // document that matches nothing on the server, which is a different warning from
  // "still saving" and has a different fix.
  if (saveState != null && saveState !== 'saved') {
    push(warnings, 'pending-save',
      saveState === 'conflict'
        ? 'This manuscript was updated elsewhere and your last change was refused — the server copy differs from your editor.'
        : saveState === 'error'
          ? 'The last manuscript save FAILED — the server copy is behind your editor.'
          : 'A manuscript save is still in progress.',
      saveState === 'conflict'
        ? 'Load the latest version before exporting, then re-apply anything that is missing.'
        : 'Wait for the save indicator to show "Saved" (or retry the save) before exporting.');
  }

  // Live sources still loading → availability/numbers may change once settled.
  if (sourcesSettled === false) {
    push(warnings, 'sources-unsettled',
      'Live project sources are still loading — table/figure availability may change.',
      'Wait a moment for sources to settle, then export.');
  }

  // Sources that hard-failed to load (manuscriptData dataStatus honesty map).
  if (dataStatus && typeof dataStatus === 'object') {
    const bad = Object.keys(dataStatus).filter((k) => dataStatus[k] === 'error');
    if (bad.length) {
      push(warnings, 'source-errors',
        `Live project sources failed to load: ${bad.join(', ')}. The export will use whatever data is present.`,
        'Retry loading the manuscript sources, or export knowing these inputs are missing.');
    }
  }

  // Legacy plain-text mention drift (placement's detection-only scan).
  // r2 — the fallback code is the SAME constant the emitter uses. It used to be a
  // second, hand-typed string ('plain-mention-mismatch') that nothing else knew, so
  // a placement warning arriving without a code would have been unmappable by every
  // consumer downstream. One code, one source.
  for (const w of (pl.warnings || [])) {
    push(warnings, w.code || PLAIN_MENTION_CODE, w.message,
      'Update or remove the plain-text mention — plain "Table N" text is not renumbered automatically.');
  }

  // Mixed mode: structured tokens AND plain-text "Table N" prose both present.
  const hasTokens = !!((num.mentioned && num.mentioned.size) || (num.unresolved || []).length);
  if (hasTokens && (pl.plainMentions || []).length) {
    push(warnings, 'mixed-references',
      `The draft mixes structured references with ${pl.plainMentions.length} plain-text "Table/Figure N" mention${pl.plainMentions.length === 1 ? '' : 's'} — plain text is not renumbered and may drift.`,
      'Replace plain-text mentions with inserted references from the Tables & Figures panel.');
  }

  /* ── INFO ── */

  // 117.md §4/§11 — user-authored pipe tables. A table that carries a caption
  // marker is a first-class manuscript object: it is numbered, referenceable and
  // exported with a caption + bookmark like any other, so the old "by design, no
  // numbers" notice is RETIRED for it. Only tables that are still anonymous prose
  // are counted here — and the fix is now a real action in the editor, not a
  // suggestion to patch the Word file by hand.
  let uncaptionedTables = 0;
  for (const sec of orderedSections(draft || [])) {
    const blocks = sectionBlocks(sec.content);
    for (let i = 0; i < blocks.length; i += 1) {
      if (blocks[i].type !== 'table') continue;
      const prev = i > 0 ? blocks[i - 1] : null;
      const captioned = !!(prev && prev.type === 'paragraph' && TABLE_CAPTION_LINE_RE.test(prev.text));
      if (!captioned) uncaptionedTables += 1;
    }
  }
  if (uncaptionedTables) {
    push(info, 'user-tables',
      `The text contains ${uncaptionedTables} table${uncaptionedTables === 1 ? '' : 's'} without a caption — ${uncaptionedTables === 1 ? 'it exports' : 'they export'} as-is, without a number, and cannot be cross-referenced.`,
      'Put the cursor in the table and choose “+ Caption” to number it, or leave it as plain prose.');
  }

  // Out-of-v1-scope figure kinds, only when the project data suggests they matter.
  // (Uploaded images have no model at all yet, and meta-regression bubble plots
  // have no reliable project-blob signal — those stay silent by design.)
  const nma = project && project.nma;
  if (nma && Array.isArray(nma.studies) && nma.studies.length) {
    push(info, 'unsupported-figure-kinds',
      'This project has network meta-analysis data; network/SUCRA plots are not included in the Word export yet.',
      'Export NMA figures from the Analysis tab and insert them in Word if needed.');
  }

  /* ── 117.md §39/§40 — citation integrity, folded in at the same severities ── */
  if (Array.isArray(references)) {
    const cit = validateCitations({ draft, references, aliases, removedIds });
    errors.push(...cit.errors);
    warnings.push(...cit.warnings);
    info.push(...cit.info);
  }

  return { errors, warnings, info };
}

export default { validateExport, validateCitations, closestAssetId, closestReferenceId };
