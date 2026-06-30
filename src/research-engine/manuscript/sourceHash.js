/**
 * manuscript/sourceHash.js — 64.md (P3). Stable, dependency-free hashing used to
 * detect when a data-linked block (study table, SOF, PRISMA, RoB, search, forest,
 * references) is STALE because the underlying project data changed since the block
 * was last refreshed. Pure — no DOM, no crypto, importable anywhere.
 *
 * The hash is intentionally a content fingerprint over only the inputs that affect
 * a given block, so unrelated edits (e.g. typing in the Discussion) do NOT mark a
 * table stale.
 */

/** FNV-1a 32-bit hash of a string → 8-char hex. Deterministic. */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable JSON stringify (sorted keys) so {a:1,b:2} and {b:2,a:1} hash identically.
 * Handles cycles defensively by dropping repeated references.
 */
export function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
    if (typeof v !== 'object') return v;
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  };
  try {
    return JSON.stringify(walk(value));
  } catch {
    return '';
  }
}

export function hashOf(value) {
  return hashString(stableStringify(value));
}

/**
 * Compute the source fingerprint for each data-block type from the live project.
 * Returns { [blockId]: hash }. Only the relevant slice of project data feeds each
 * block so staleness is precise. Pure.
 *
 * @param {object} project  the Project.data blob (pico/search/prisma/studies/…)
 */
export function computeBlockHashes(project) {
  const p = project || {};
  const studies = Array.isArray(p.studies) ? p.studies : [];
  const prisma = p.prisma || {};
  const search = p.search || {};

  // Slim study projection — only fields that appear in tables/figures.
  const studyProj = studies.map((s) => ({
    id: s.id,
    title: s.title, author: s.author, authors: s.authors, year: s.year,
    journal: s.journal, country: s.country, design: s.design,
    population: s.populationDef, intervention: s.interventionDef, comparator: s.comparatorDef,
    outcome: s.outcome, timepoint: s.timepoint, followup: s.followup,
    esType: s.esType, es: s.es, lo: s.lo, hi: s.hi,
    n: s.n, nExp: s.nExp, nCtrl: s.nCtrl, a: s.a, b: s.b, c: s.c, d: s.d,
    events: s.events, total: s.total,
    doi: s.doi, pmid: s.pmid, rob: s.rob,
  }));

  const robProj = studies.map((s) => ({ id: s.id, rob: s.rob }));

  return {
    study_characteristics_table: hashOf(studyProj),
    summary_of_findings_table: hashOf(studyProj),
    forest_plot: hashOf(studyProj),
    references: hashOf(studies.map((s) => ({ t: s.title, a: s.authors || s.author, y: s.year, j: s.journal, d: s.doi, p: s.pmid }))),
    risk_of_bias_table: hashOf(robProj),
    prisma_counts_table: hashOf(prisma),
    prisma_flow: hashOf(prisma),
    search_strategy_table: hashOf({ search, prisma: { dbs: prisma.dbs, reg: prisma.reg, other: prisma.other } }),
  };
}

/**
 * Given a manuscript's stored dataBlocks metadata and the live project, return a
 * map { [blockId]: { stale, currentHash, lastRefreshedAt } } so the UI can badge
 * out-of-date blocks. Pure.
 */
export function evaluateStaleness(draft, project) {
  const live = computeBlockHashes(project);
  const blocks = (draft && draft.dataBlocks) || {};
  const out = {};
  for (const id of Object.keys(live)) {
    const meta = blocks[id] || {};
    const currentHash = live[id];
    const stale = !meta.sourceHash || meta.sourceHash !== currentHash;
    out[id] = { stale, currentHash, lastRefreshedAt: meta.lastRefreshedAt || null };
  }
  return out;
}

export default { hashString, stableStringify, hashOf, computeBlockHashes, evaluateStaleness };
