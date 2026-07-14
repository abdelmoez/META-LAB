/**
 * manuscript/exportValidation.js — 85.md Objective 2 (B1). Pre-export validation
 * for the Word exporter: rolls the asset registry, numbering, placement,
 * save/freshness state and live-source health into a single honest
 * { errors, warnings, info } report the export dialog renders.
 *
 * Severity contract:
 *   ERRORS block the export (broken references, internal numbering invariant,
 *   unrenderable asset kinds). WARNINGS allow "Export anyway" (unavailable
 *   references, unplaced/unlabelled assets, staleness, pending saves, legacy
 *   plain-text mention drift, mixed reference modes). INFO is awareness only
 *   (user pipe tables are unnumbered by design; out-of-scope figure kinds).
 *
 * Every entry is { code, message, action }. Pure, deterministic and CHEAP —
 * B2 calls this per editor render, so everything expensive (assets, numbering,
 * placements) is taken as INPUT, never recomputed here.
 */

import { orderedSections } from './refTokens.js';
import { sectionBlocks } from './placement.js';

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

/**
 * @param {object} args {
 *   project, draft,
 *   assets      computeManuscriptAssets output,
 *   numbering   resolveNumbering output,
 *   placements  computePlacements output,
 *   saveState   'saved'|'saving'|'error' (useManuscript),
 *   sourcesSettled boolean,
 *   freshness   computeFreshness output ({status,label,counts}),
 *   dataStatus  {[sourceKey]: 'ok'|'error'|…} (manuscriptData honesty map)
 * }
 * @returns {{ errors:[{code,message,action}], warnings:[...], info:[...] }}
 */
export function validateExport(args = {}) {
  const {
    project, draft, assets, numbering, placements,
    saveState, sourcesSettled, freshness, dataStatus,
  } = args;
  const list = Array.isArray(assets) ? assets : [];
  const num = numbering || {};
  const byId = num.byId || {};
  const pl = placements || {};
  const assetById = new Map(list.map((a) => [a.id, a]));
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
      const kindLabel = u.kind === 'figure' ? 'Figure ?' : 'Table ?';
      push(warnings, 'ref-unavailable',
        `${u.token} refers to "${(a && (a.title || a.id)) || u.id}", which has no data yet — it will export as plain "${kindLabel}" and the ${u.kind} will be skipped.`,
        'Provide the underlying data (or remove the reference) before exporting.');
    }
  }

  // Duplicate numbering — internal invariant; should be impossible.
  for (const kind of ['table', 'figure']) {
    const seen = new Map();
    for (const id of Object.keys(byId)) {
      const n = byId[id];
      if (n == null) continue;
      const a = assetById.get(id);
      if (!a || a.kind !== kind) continue;
      if (seen.has(n)) {
        push(errors, 'duplicate-numbering',
          `Internal numbering error: ${kind} number ${n} was assigned to both "${seen.get(n)}" and "${id}".`,
          'Regenerate the export; if this persists, report it as a bug.');
      } else seen.set(n, id);
    }
  }

  // Included asset of a kind the export cannot render.
  for (const a of list) {
    if (a && a.included && a.kind !== 'table' && a.kind !== 'figure') {
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
    const ov = assetOverrides[id];
    if (!(ov && ov.included === true)) continue;
    const a = assetById.get(id);
    const kindLabel = a && a.kind === 'figure' ? 'Figure' : 'Table';
    push(warnings, 'included-not-mentioned',
      `${kindLabel} "${(a && (a.title || a.id)) || id}" is included but never referenced in the text — it will be placed at the end of the document.`,
      'Insert a reference where it belongs, or exclude it from the export.');
  }

  // Emitted assets without any title/caption, and stale ones.
  for (const a of list) {
    if (!a || byId[a.id] == null) continue; // only assets that will be emitted
    if (!String(a.title || '').trim() && !String(a.defaultCaption || '').trim()) {
      push(warnings, 'missing-caption',
        `${a.kind === 'figure' ? 'Figure' : 'Table'} "${a.id}" has no title or caption.`,
        'Add a title or caption in the Tables & Figures panel.');
    }
    if (a.stale === true) {
      push(warnings, 'stale-asset',
        `"${a.title || a.id}" may be out of date with the current project data.`,
        'Refresh project sources, then re-check before exporting.');
    }
  }

  // Overall generated-content freshness (84.md computeFreshness rollup).
  if (freshness && (freshness.status === 'critical' || freshness.status === 'updates')) {
    push(warnings, 'stale-content',
      `Generated content may be out of date — ${freshness.label || freshness.status}.`,
      'Review the sync panel and refresh outdated sections before exporting.');
  }

  // Manuscript save not settled → the exported file may miss the last edits' server copy.
  if (saveState != null && saveState !== 'saved') {
    push(warnings, 'pending-save',
      saveState === 'error'
        ? 'The last manuscript save FAILED — the server copy is behind your editor.'
        : 'A manuscript save is still in progress.',
      'Wait for the save indicator to show "Saved" (or retry the save) before exporting.');
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
  for (const w of (pl.warnings || [])) {
    push(warnings, w.code || 'plain-mention-mismatch', w.message,
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

  // User-authored pipe tables — unnumbered by design (85.md v1 scope).
  let userTables = 0;
  for (const sec of orderedSections(draft || [])) {
    for (const b of sectionBlocks(sec.content)) if (b.type === 'table') userTables += 1;
  }
  if (userTables) {
    push(info, 'user-tables',
      `The text contains ${userTables} user-authored table${userTables === 1 ? '' : 's'} — these export as-is, without numbers or captions (by design).`,
      'Add captions manually in Word, or keep key data in the numbered data-linked tables.');
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

  return { errors, warnings, info };
}

export default { validateExport, closestAssetId };
