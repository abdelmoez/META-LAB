/**
 * manuscript/assets.js — 85.md Objective 2 (B1). Derived registry of every asset
 * the Word export can emit: the 5 data-linked tables (tables.js builders) plus
 * the figure set (PRISMA diagram, forest plots per outcome, RoB traffic light,
 * funnel plot). The registry is DERIVED per call — nothing here is persisted
 * except the per-asset overrides in draft.assets (normalizeDraft preserves them
 * only when non-empty, like snapshots).
 *
 * Identity rules (critique-hardened):
 *   - EVERY forest (the current primary included) gets a stable pair-keyed id
 *     `figure:forest:<slug>` where the slug comes from the STABLE pair.key
 *     ('outcome|||timepoint'), NOT from the study-count sort position — a primary
 *     flip (most-studies re-sort) can never rebind a token or caption override to
 *     a different outcome. The funnel is keyed `figure:funnel:<slug>` of the pair
 *     it plots. 'figure:forest-primary' / 'figure:funnel' survive as RESOLVABLE
 *     ALIASES (`aliasIds` on the current primary-pair assets): alias tokens keep
 *     numbering/rendering (they follow whatever pair is primary NOW), and alias
 *     overrides read through — but pair-keyed overrides always win, and new
 *     overrides are written under pair-keyed ids only (the panels key on a.id).
 *   - Slug allocation is GLOBAL over all pairs in lexicographic pair.key order
 *     (independent of the analyses sort): the first free candidate wins, so a
 *     synthesized '<base>-N' suffix can never collide with another pair's natural
 *     base slug (cross-base duplicates minted two assets with one id, which every
 *     Map-keyed consumer silently collapsed).
 *   - Ids satisfy the token grammar ([a-z0-9:-] only, no ']', no whitespace);
 *     the human outcome label is stored separately (`outcomeLabel`).
 *
 * Inclusion defaults: available tables, figure:prisma and the PRIMARY pair's
 * forest default to included; non-primary forests, figure:rob and the funnel
 * default to EXCLUDED and are auto-included when a token references them
 * (numbering resolves that — see refTokens.resolveNumbering).
 *
 * 117.md §4/§5 — MANUAL tables join the SAME registry. A hand-authored pipe table
 * carrying a `[[tblcap:<id>]]` caption line becomes a first-class asset
 * (`origin:'manual'`, id `table:<id>`), so it participates in one numbering
 * sequence with the builder tables, is cross-referenceable by the same
 * `[[table:…]]` token, and is validated/exported by the same code paths. It is
 * DERIVED from the prose on every call — nothing about a manual table is stored
 * except the marker itself and the optional `draft.tableMeta[<id>]` side-map
 * (created/modified stamps + extra caption/notes/source, never formatting).
 *
 * Pure — no DOM/React/network, deterministic.
 */

import {
  buildStudyCharacteristicsTable, buildSummaryOfFindingsTable, buildPrismaCountsTable,
  buildRobTable, buildSearchStrategyTable,
} from './tables.js';
import { computePrismaCounts } from './prismaCounts.js';
import { allAnalyses } from './draft.js';
import { collectManualTables, collectPlacedFigures } from './refTokens.js';

const clean = (s) => String(s == null ? '' : s).trim();

/** Deterministic token-grammar-safe slug ([a-z0-9-], never empty). Pure. */
export function assetSlug(text, fallback = 'outcome') {
  const t = String(text == null ? '' : text).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return t || fallback;
}

/** Funnel display guard — mirrors the Analysis tab's FunnelPlot: ≥3 studies with
 *  a numeric effect AND CI (the SE is derived from the CI). Pure. */
function funnelEligible(subset) {
  const list = Array.isArray(subset) ? subset : [];
  return list.filter((s) => s && s.es !== '' && s.lo !== '' && s.hi !== ''
    && !isNaN(+s.es) && !isNaN(+s.lo) && !isNaN(+s.hi)).length >= 3;
}

function staleFlag(stale, id) {
  if (!stale) return false;
  if (stale instanceof Set) return stale.has(id);
  return stale[id] === true;
}

/**
 * Compute the ordered asset registry for a project + draft.
 *
 * @param {object} project  Project.data blob
 * @param {object} draft    normalized manuscript draft (reads draft.assets overrides
 *                          + draft.prismaOverrides; never draft.dataBlocks — that
 *                          `enabled` flag is legacy-dead, see model.js)
 * @param {object} [opts]   perf/parity seams, all optional (mirror buildManuscriptDocx):
 *   tables        {study,sof,prisma,rob,search} precomputed table objects
 *   prismaCounts  computePrismaCounts result
 *   analyses      allAnalyses result (primary first)
 *   primary       primaryAnalysis result (defaults to analyses[0])
 *   robByStudyId / robOpts / robAssessments / searchOpts / gradeByOutcome /
 *   runMeta / prec / analysis / screening   threaded to the builders
 *   figures       119.md §5 — the project's ManuscriptFigure rows (uploaded
 *                 pictures). Absent = "the store is unknown here", and a placed
 *                 marker is then assumed honest rather than reported missing.
 *   staleAssets   {[assetId]:true} map or Set — stamps `stale:true`
 *
 * @returns Array of ordered asset descriptors:
 *   { id, kind:'table'|'figure', origin:'auto'|'manual', builderId, title,
 *     defaultCaption, caption?, legend?, available, stale?, includedDefault,
 *     included, note?, source,
 *     aliasIds?,                  // legacy role ids resolving to this asset
 *     pairKey?, outcomeLabel?,    // forest/funnel figures only
 *     manualId?, sectionId?, createdAt?, updatedAt? }  // manual tables only
 */
export function computeManuscriptAssets(project, draft, opts = {}) {
  const o = opts || {};
  const prismaResult = o.prismaCounts
    || computePrismaCounts(project, { overrides: (draft && draft.prismaOverrides) || {}, screening: o.screening });
  const tables = o.tables || {
    study: buildStudyCharacteristicsTable(project, { robByStudyId: o.robByStudyId }),
    sof: buildSummaryOfFindingsTable(project, { runMeta: o.runMeta, prec: o.prec, gradeByOutcome: o.gradeByOutcome, analysis: o.analysis }),
    prisma: buildPrismaCountsTable(prismaResult),
    rob: buildRobTable(project, o.robOpts || {}),
    search: buildSearchStrategyTable(project, o.searchOpts || {}),
  };
  const analyses = o.analyses || allAnalyses(project, o);
  const primary = o.primary || analyses[0] || null;
  const overrides = (draft && draft.assets && typeof draft.assets === 'object') ? draft.assets : {};
  const stale = o.staleAssets || null;

  const out = [];
  const push = (base) => {
    // 117.md §69 — every registry asset is machine-generated; `origin` is what the
    // cross-reference picker badges and what numbering uses to decide whether an
    // asset anchors at its own block (manual) or at its first mention (auto).
    const a = { origin: 'auto', ...base };
    // Alias overrides read through (legacy role-keyed draft.assets entries), but
    // the pair-keyed id always wins — new overrides are written under it only.
    for (const key of [...(base.aliasIds || []), base.id]) {
      const ov = overrides[key];
      if (!(ov && typeof ov === 'object')) continue;
      if (typeof ov.included === 'boolean') a.included = ov.included;
      if (clean(ov.title)) a.title = clean(ov.title);
      // caption is the asset's OWN field (rendered under the "Table N. Title"
      // line by the export) — it never masquerades as defaultCaption, which
      // stays the builder default the panel shows as a placeholder.
      if (clean(ov.caption)) a.caption = clean(ov.caption);
      if (clean(ov.legend)) a.legend = clean(ov.legend);
      if (clean(ov.note)) a.note = clean(ov.note);
    }
    if (staleFlag(stale, base.id) || (base.aliasIds || []).some((id) => staleFlag(stale, id))) a.stale = true;
    out.push(a);
  };

  /* ── Tables (registry order = the docx export's fixed order) ── */
  const TABLE_DEFS = [
    ['table:study', 'study', tables.study],
    ['table:sof', 'sof', tables.sof],
    ['table:prisma', 'prisma', tables.prisma],
    ['table:rob', 'rob', tables.rob],
    ['table:search', 'search', tables.search],
  ];
  for (const [id, builderId, tbl] of TABLE_DEFS) {
    const available = !!(tbl && tbl.available);
    push({
      id,
      kind: 'table',
      builderId,
      title: (tbl && tbl.title) || '',
      defaultCaption: (tbl && tbl.title) || '',
      available,
      includedDefault: available,
      included: available,
      note: (tbl && tbl.note) || '',
      source: (tbl && tbl.generatedFrom) || '',
    });
  }

  /* ── 117.md §4/§5 — MANUAL tables (derived from the prose caption markers) ──
     They sit directly after the builder tables in REGISTRY order, which only
     decides the Tables-panel listing and the never-anchored fallback: their actual
     number comes from their block position (refTokens.resolveNumbering).
     A manual table is always "available" — it is literally in the document — and
     always included, because excluding it would mean deleting prose. */
  const tableMeta = (draft && draft.tableMeta && typeof draft.tableMeta === 'object') ? draft.tableMeta : {};
  for (const t of collectManualTables(draft || [])) {
    const meta = (tableMeta[t.id] && typeof tableMeta[t.id] === 'object') ? tableMeta[t.id] : {};
    const ov = (overrides[`table:${t.id}`] && typeof overrides[`table:${t.id}`] === 'object')
      ? overrides[`table:${t.id}`] : {};
    // The TITLE is prose (the caption line) — a draft.assets title override would
    // silently win over what the researcher can see and edit in the page, so it is
    // deliberately not read here. Caption/notes ARE side-metadata and merge.
    const a = {
      id: t.assetId,
      kind: 'table',
      origin: 'manual',
      builderId: null,
      manualId: t.id,
      sectionId: t.sectionId,
      title: t.title,
      defaultCaption: t.title,
      available: true,
      includedDefault: true,
      included: true,
      source: 'manuscript',
    };
    const caption = clean(ov.caption) || clean(meta.caption);
    const note = clean(ov.note) || clean(meta.notes) || clean(meta.note);
    if (caption) a.caption = caption;
    if (note) a.note = note;
    if (clean(meta.source)) a.sourceNote = clean(meta.source);
    if (meta.createdAt) a.createdAt = meta.createdAt;
    if (meta.updatedAt) a.updatedAt = meta.updatedAt;
    out.push(a);
  }

  /* ── 119.md §5 — UPLOADED figures join the SAME registry ──
     kind:'figure', origin:'upload' — NOT a new ASSET_KIND, because §5 wants ONE
     Figures numbering sequence over generated and user-supplied pictures alike.
     Everything downstream (numbering, chips, the cross-reference picker, export
     validation, the .docx emitter, the Figures panel) consumes the registry shape
     generically and needed no change.

     They come FIRST among figures so an uploaded picture that is never placed and
     never referenced still lists above the generated set in the panel; the numbers
     themselves come from document position, never from this order.

     `opts.figures` is the ManuscriptFigure row list (threaded like robAssessments).
     When it is ABSENT the registry does not know what exists, so a placed marker is
     assumed honest (`available:true`) — the same doctrine mdDom's knownAssetIds
     follows: a consumer that has not resolved the store must never accuse a real
     figure of being missing. When it IS present, a marker with no row is honestly
     unavailable and export validation reports it. */
  const figureRows = Array.isArray(o.figures) ? o.figures : null;
  {
    const rowByKey = new Map();
    for (const f of (figureRows || [])) {
      if (f && f.figKey && !rowByKey.has(f.figKey)) rowByKey.set(f.figKey, f);
    }
    const placed = collectPlacedFigures(draft || []);
    const seen = new Set();
    const pushUpload = (figKey, row, placement) => {
      if (!figKey || seen.has(figKey)) return;
      seen.add(figKey);
      const id = `figure:${figKey}`;
      const known = !!row;
      const available = figureRows ? known : true;
      const title = clean(placement && placement.title) || clean(row && row.fileName) || 'Figure';
      const a = {
        id,
        kind: 'figure',
        origin: 'upload',
        builderId: null,
        figKey,
        title,
        defaultCaption: title,
        available,
        // A picture is "in the export" exactly when it is in the document; an
        // uploaded-but-unplaced figure is honestly listed as not placed instead of
        // being silently appended to the end of the manuscript.
        includedDefault: !!placement,
        included: !!placement,
        placed: !!placement,
        source: 'upload',
      };
      if (placement) { a.sectionId = placement.sectionId; a.blockIndex = placement.index; }
      if (row) {
        a.figureId = row.id || '';
        a.fileName = row.fileName || '';
        a.mimeType = row.mimeType || '';
        a.fileHash = row.fileHash || '';
        a.width = Number(row.width) || 0;
        a.height = Number(row.height) || 0;
        a.fileSize = Number(row.fileSize) || 0;
        a.uploadedBy = row.uploadedBy || '';
        a.uploadedByName = row.uploadedByName || '';
        a.uploadedAt = row.createdAt || null;
        a.replacedCount = Number(row.replacedCount) || 0;
        if (row.replacedAt) a.replacedAt = row.replacedAt;
        if (clean(row.altText)) a.altText = clean(row.altText);
        if (clean(row.sourceNote)) a.sourceNote = clean(row.sourceNote);
        if (row.origin === 'analysis') a.figureOrigin = 'analysis';
      }
      // Display overrides ride the EXISTING per-asset channel (draft.assets), so
      // caption/legend/alt-text/width/alignment edits are the same buffered
      // queueAssetPatch write every other figure already uses.
      const ov = (overrides[id] && typeof overrides[id] === 'object') ? overrides[id] : {};
      if (clean(ov.title)) a.title = clean(ov.title);
      if (clean(ov.caption)) a.caption = clean(ov.caption);
      if (clean(ov.legend)) a.legend = clean(ov.legend);
      if (clean(ov.note)) a.note = clean(ov.note);
      if (clean(ov.altText)) a.altText = clean(ov.altText);
      if (clean(ov.align)) a.align = clean(ov.align);
      const w = Number(ov.displayWidth);
      if (Number.isFinite(w) && w > 0) a.displayWidth = Math.min(100, Math.max(20, Math.round(w)));
      if (staleFlag(stale, id)) a.stale = true;
      out.push(a);
    };
    for (const p of placed) pushUpload(p.figKey, rowByKey.get(p.figKey) || null, p);
    for (const f of (figureRows || [])) pushUpload(f && f.figKey, f, null);
  }

  /* ── Figures ── */
  const prismaAvailable = !!(prismaResult && prismaResult.hasAny);
  push({
    id: 'figure:prisma',
    kind: 'figure',
    builderId: 'prisma',
    title: 'PRISMA 2020 flow diagram',
    defaultCaption: 'PRISMA 2020 flow diagram',
    available: prismaAvailable,
    includedDefault: prismaAvailable,
    included: prismaAvailable,
    source: 'prisma',
  });

  const primaryAvailable = !!(primary && primary.result);
  const primaryLabel = (primary && primary.pair && primary.pair.label) || 'primary outcome';
  const primaryPairKey = (primary && primary.pair && primary.pair.key) || null;

  // GLOBAL slug allocation over ALL pairs (primary included), lexicographic
  // pair.key order, first-free-candidate: cross-base collisions can never mint a
  // duplicate id, and the allocation is independent of the study-count sort.
  const slugByKey = new Map();
  {
    const used = new Set();
    const keys = [];
    for (const a of analyses) {
      if (a && a.pair && a.pair.key && !slugByKey.has(a.pair.key)) { slugByKey.set(a.pair.key, null); keys.push(a.pair.key); }
    }
    keys.sort();
    for (const key of keys) {
      const base = assetSlug(key);
      let slug = base;
      for (let i = 2; used.has(slug); i += 1) slug = `${base}-${i}`;
      used.add(slug);
      slugByKey.set(key, slug);
    }
  }

  // The current primary pair's forest — pair-keyed id so a primary flip never
  // rebinds tokens/overrides; 'figure:forest-primary' resolves to it as an alias.
  const primarySlug = primaryPairKey ? slugByKey.get(primaryPairKey) : null;
  push({
    id: primarySlug ? `figure:forest:${primarySlug}` : 'figure:forest-primary',
    ...(primarySlug ? { aliasIds: ['figure:forest-primary'] } : {}),
    kind: 'figure',
    builderId: 'forest',
    title: `Forest plot — ${primaryLabel}`,
    defaultCaption: `Forest plot — ${primaryLabel}`,
    available: primaryAvailable,
    includedDefault: primaryAvailable,
    included: primaryAvailable,
    source: 'analysis',
    pairKey: primaryPairKey,
    outcomeLabel: primaryLabel,
  });

  // Per-NON-primary-outcome forests (same global slug table).
  const secondaries = analyses.filter((a) => a && a.pair && a.pair.key && a.pair.key !== primaryPairKey);
  for (const a of secondaries) {
    const slug = slugByKey.get(a.pair.key);
    const label = a.pair.label || a.pair.outcome || 'outcome';
    push({
      id: `figure:forest:${slug}`,
      kind: 'figure',
      builderId: 'forest',
      title: `Forest plot — ${label}`,
      defaultCaption: `Forest plot — ${label}`,
      available: !!a.result,
      includedDefault: false,
      included: false,
      source: 'analysis',
      pairKey: a.pair.key,
      outcomeLabel: label,
    });
  }

  // RoB traffic light — available only when STRUCTURED assessments exist (the
  // legacy studies[].rob map has no domain matrix the plot can render honestly).
  const robAssessments = o.robAssessments || (o.robOpts && o.robOpts.assessments) || {};
  const robAvailable = Object.keys(robAssessments).some((k) => {
    const a = robAssessments[k];
    return !!(a && ((a.domains && Object.keys(a.domains).length) || clean(a.overall)));
  });
  push({
    id: 'figure:rob',
    kind: 'figure',
    builderId: 'rob',
    title: 'Risk of bias summary (traffic-light plot)',
    defaultCaption: 'Risk of bias summary (traffic-light plot)',
    available: robAvailable,
    includedDefault: false,
    included: false,
    source: 'rob',
  });

  // Funnel plot for the PRIMARY analysis — same ≥3-study guard the Analysis tab
  // uses. Keyed to the pair it plots; 'figure:funnel' resolves to it as an alias.
  const funnelAvailable = primaryAvailable && funnelEligible(primary && primary.subset);
  push({
    id: primarySlug ? `figure:funnel:${primarySlug}` : 'figure:funnel',
    ...(primarySlug ? { aliasIds: ['figure:funnel'] } : {}),
    kind: 'figure',
    builderId: 'funnel',
    title: `Funnel plot — ${primaryLabel}`,
    defaultCaption: `Funnel plot — ${primaryLabel}`,
    available: funnelAvailable,
    includedDefault: false,
    included: false,
    source: 'analysis',
    pairKey: primaryPairKey,
    outcomeLabel: primaryLabel,
  });

  return out;
}

export default { computeManuscriptAssets, assetSlug };
