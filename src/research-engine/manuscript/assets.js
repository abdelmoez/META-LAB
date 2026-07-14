/**
 * manuscript/assets.js — 85.md Objective 2 (B1). Derived registry of every asset
 * the Word export can emit: the 5 data-linked tables (tables.js builders) plus
 * the figure set (PRISMA diagram, forest plots per outcome, RoB traffic light,
 * funnel plot). The registry is DERIVED per call — nothing here is persisted
 * except the per-asset overrides in draft.assets (normalizeDraft preserves them
 * only when non-empty, like snapshots).
 *
 * Identity rules (critique-hardened):
 *   - Per-outcome forest ids are `figure:forest:<slug>` where the slug comes from
 *     the STABLE pair.key ('outcome|||timepoint'), NOT from the study-count sort
 *     position — adding a study can never orphan a caption override.
 *   - Slug collisions are suffixed deterministically by lexicographic pair.key
 *     order (independent of the analyses sort), so ids stay stable across runs.
 *   - Ids satisfy the token grammar ([a-z0-9:-] only, no ']', no whitespace);
 *     the human outcome label is stored separately (`outcomeLabel`).
 *
 * Inclusion defaults: available tables, figure:prisma and figure:forest-primary
 * default to included; per-outcome forests, figure:rob and figure:funnel default
 * to EXCLUDED and are auto-included when a token references them (numbering
 * resolves that — see refTokens.resolveNumbering).
 *
 * Pure — no DOM/React/network, deterministic.
 */

import {
  buildStudyCharacteristicsTable, buildSummaryOfFindingsTable, buildPrismaCountsTable,
  buildRobTable, buildSearchStrategyTable,
} from './tables.js';
import { computePrismaCounts } from './prismaCounts.js';
import { allAnalyses } from './draft.js';

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
 *   staleAssets   {[assetId]:true} map or Set — stamps `stale:true`
 *
 * @returns Array of ordered asset descriptors:
 *   { id, kind:'table'|'figure', builderId, title, defaultCaption, legend?,
 *     available, stale?, includedDefault, included, note?, source,
 *     pairKey?, outcomeLabel? }   // forest/funnel figures only
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
    const a = { ...base };
    const ov = overrides[base.id];
    if (ov && typeof ov === 'object') {
      if (typeof ov.included === 'boolean') a.included = ov.included;
      if (clean(ov.title)) a.title = clean(ov.title);
      if (clean(ov.caption)) a.defaultCaption = clean(ov.caption);
      if (clean(ov.legend)) a.legend = clean(ov.legend);
      if (clean(ov.note)) a.note = clean(ov.note);
    }
    if (staleFlag(stale, base.id)) a.stale = true;
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
  push({
    id: 'figure:forest-primary',
    kind: 'figure',
    builderId: 'forest',
    title: `Forest plot — ${primaryLabel}`,
    defaultCaption: `Forest plot — ${primaryLabel}`,
    available: primaryAvailable,
    includedDefault: primaryAvailable,
    included: primaryAvailable,
    source: 'analysis',
    pairKey: (primary && primary.pair && primary.pair.key) || null,
    outcomeLabel: primaryLabel,
  });

  // Per-NON-primary-outcome forests. Slug base from the stable pair.key; collision
  // suffixes assigned in lexicographic pair.key order so a study-count re-sort of
  // `analyses` can never flip which pair owns 'slug-2'.
  const secondaries = analyses.filter((a) => a && a.pair && (!primary || a.pair.key !== primary.pair.key));
  const slugById = new Map();
  const byBase = new Map();
  for (const a of secondaries) {
    const base = assetSlug(a.pair.key);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(a.pair.key);
  }
  for (const [base, keys] of byBase) {
    const sorted = keys.slice().sort();
    sorted.forEach((key, i) => slugById.set(key, i === 0 ? base : `${base}-${i + 1}`));
  }
  for (const a of secondaries) {
    const slug = slugById.get(a.pair.key);
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

  // Funnel plot for the PRIMARY analysis — same ≥3-study guard the Analysis tab uses.
  const funnelAvailable = primaryAvailable && funnelEligible(primary && primary.subset);
  push({
    id: 'figure:funnel',
    kind: 'figure',
    builderId: 'funnel',
    title: `Funnel plot — ${primaryLabel}`,
    defaultCaption: `Funnel plot — ${primaryLabel}`,
    available: funnelAvailable,
    includedDefault: false,
    included: false,
    source: 'analysis',
    pairKey: (primary && primary.pair && primary.pair.key) || null,
    outcomeLabel: primaryLabel,
  });

  return out;
}

export default { computeManuscriptAssets, assetSlug };
