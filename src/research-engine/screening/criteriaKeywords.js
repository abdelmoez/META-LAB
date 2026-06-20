/**
 * criteriaKeywords.js — derive a project's eligibility-criteria keywords and
 * merge them, with source provenance, into the screening keyword lists
 * (prompt28 Part 1). Pure functions, no database, no side effects.
 *
 * The project's inclusion / exclusion CRITERIA (free-text bullet lists stored on
 * the linked META·LAB project's `pico.incl` / `pico.excl`, cached per-screening-
 * project in `ScreenProject.picoSnapshot`) are turned into highlight/filter
 * phrases via the existing `extractKeywords` engine, then layered on top of the
 * stored (default + manual) keyword lists WITHOUT mutating them. Each surviving
 * term carries a `source` so the UI can badge the criteria-derived ones.
 *
 * Project-specificity is structural: the input is ONE project's picoSnapshot, so
 * the derived terms can never leak into another project's panel.
 */
import { extractConceptKeywords } from './conceptKeywords.js';

/** Keyword sources, most-specific last (criteria wins the badge). */
export const KEYWORD_SOURCE = Object.freeze({
  DEFAULT: 'default',     // shared seed list (no stored edits yet)
  MANUAL: 'manual',       // the leader's saved keyword list
  CRITERIA: 'criteria',   // derived from this project's inclusion/exclusion criteria
});

/**
 * Normalize a keyword for dedup: lowercase, collapse internal whitespace, trim.
 * Mirrors the comparison `extractKeywords` already uses so the two layers dedup
 * against each other reliably.
 * @param {string} s
 * @returns {string}
 */
export function normalizeKeyword(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Parse a picoSnapshot (object OR JSON string OR raw data) and derive ONLY the
 * eligibility-criteria keywords from its `incl` / `excl` text. We deliberately do
 * NOT fold in P/I/C/O/question here — the "Project criteria" layer should reflect
 * the explicit inclusion/exclusion criteria, not the whole PICO.
 *
 * prompt43 Area 1 — the criteria text is now DIGESTED into clinically meaningful
 * concepts + conservative synonyms (see conceptKeywords.js) instead of copying the
 * whole criteria sentence verbatim, so the derived terms actually match abstracts.
 *
 * @param {object|string|null} picoSnapshot
 * @returns {{ inclusion: string[], exclusion: string[] }}
 */
export function criteriaKeywordsFromSnapshot(picoSnapshot) {
  let pico = picoSnapshot;
  if (typeof pico === 'string') {
    try { pico = JSON.parse(pico || '{}'); } catch { pico = {}; }
  }
  if (!pico || typeof pico !== 'object') pico = {};
  return {
    inclusion: extractConceptKeywords(typeof pico.incl === 'string' ? pico.incl : ''),
    exclusion: extractConceptKeywords(typeof pico.excl === 'string' ? pico.excl : ''),
  };
}

/**
 * Merge stored keywords (default-or-manual) with criteria-derived terms into a
 * single ordered list with per-term provenance. Stored terms keep their original
 * display text and come first; criteria terms are appended ONLY when they are not
 * already present (case/space-insensitive), so nothing is duplicated and existing
 * default/manual keywords are preserved exactly.
 *
 * @param {string[]} storedTerms — the stored (or default-fallback) keyword list
 * @param {string[]} criteriaTerms — criteria-derived phrases for the same side
 * @param {{ storedSource?: string }} [opts] — label for the stored terms
 * @returns {{ terms: string[], sourceByTerm: Record<string,string> }}
 */
export function mergeKeywordSources(storedTerms, criteriaTerms, opts = {}) {
  const storedSource = opts.storedSource || KEYWORD_SOURCE.MANUAL;
  const terms = [];
  const sourceByTerm = {};
  const seen = new Set();

  for (const t of Array.isArray(storedTerms) ? storedTerms : []) {
    const n = normalizeKeyword(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    terms.push(t);
    sourceByTerm[t] = storedSource;
  }
  for (const t of Array.isArray(criteriaTerms) ? criteriaTerms : []) {
    const n = normalizeKeyword(t);
    if (!n || seen.has(n)) continue;   // already a default/manual term → no dup, no re-badge
    seen.add(n);
    terms.push(t);
    sourceByTerm[t] = KEYWORD_SOURCE.CRITERIA;
  }
  return { terms, sourceByTerm };
}

/**
 * One-shot helper for both client and server: given the stored include/exclude
 * arrays and a picoSnapshot, produce the effective lists + provenance for each
 * side. Stored-source is `default` when the stored array is empty (the panel
 * falls back to the shared defaults), else `manual`.
 *
 * @param {object} args
 * @param {string[]} args.storedInclude
 * @param {string[]} args.storedExclude
 * @param {string[]} args.defaultInclude — shared default include list (fallback)
 * @param {string[]} args.defaultExclude — shared default exclude list (fallback)
 * @param {object|string|null} args.picoSnapshot
 * @returns {{ include: {terms:string[], sourceByTerm:Record<string,string>}, exclude: {terms:string[], sourceByTerm:Record<string,string>} }}
 */
export function effectiveKeywords({ storedInclude, storedExclude, defaultInclude, defaultExclude, picoSnapshot }) {
  const criteria = criteriaKeywordsFromSnapshot(picoSnapshot);
  const incStored = Array.isArray(storedInclude) && storedInclude.length ? storedInclude : (defaultInclude || []);
  const excStored = Array.isArray(storedExclude) && storedExclude.length ? storedExclude : (defaultExclude || []);
  const incSource = (Array.isArray(storedInclude) && storedInclude.length) ? KEYWORD_SOURCE.MANUAL : KEYWORD_SOURCE.DEFAULT;
  const excSource = (Array.isArray(storedExclude) && storedExclude.length) ? KEYWORD_SOURCE.MANUAL : KEYWORD_SOURCE.DEFAULT;
  return {
    include: mergeKeywordSources(incStored, criteria.inclusion, { storedSource: incSource }),
    exclude: mergeKeywordSources(excStored, criteria.exclusion, { storedSource: excSource }),
  };
}
