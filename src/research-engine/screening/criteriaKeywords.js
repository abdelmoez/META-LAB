/**
 * criteriaKeywords.js — resolve a project's screening keyword state: which terms
 * are ACTIVE (highlight / filter / count) and which are merely SUGGESTED and still
 * awaiting review. Pure functions, no database, no side effects.
 *
 * 107.md §2 changed the contract here. Criteria-derived terms used to be merged
 * straight into the effective lists and were live for highlighting the moment the
 * criteria text was saved. They are now SUGGESTIONS that require review:
 *
 *   ACTIVE      = the stored ScreenProject list (∪ the shared defaults when the
 *                 stored list is empty) — unchanged semantics.
 *   SUGGESTED   = suggestCriteriaKeywords(picoSnapshot) (negation-aware,
 *                 generic-blocked, conflict-checked) MINUS anything already active
 *                 and minus anything the reviewer accepted/rejected.
 *   CONFLICTS   = concepts whose polarity is ambiguous; active on NEITHER side.
 *
 * The reviewer's accept/reject verdicts and per-term origins live in
 * `ScreenProject.keywordMeta` (see keywordModel.js); the suggestions themselves are
 * still never persisted, so editing the criteria immediately updates them and
 * regeneration can never overwrite a manually added term.
 *
 * Project-specificity is structural: the input is ONE project's picoSnapshot, so
 * the derived terms can never leak into another project's panel.
 */
import { extractConceptKeywords } from './conceptKeywords.js';
import { suggestCriteriaKeywords } from './suggestKeywords.js';
import { normalizeKeywordKey } from './keywordNormalize.js';
import { normalizeKeywordMeta, resolveOrigin, KEYWORD_ORIGIN } from './keywordModel.js';

/** Keyword sources — how an ACTIVE term got onto the list. */
export const KEYWORD_SOURCE = Object.freeze({
  DEFAULT: 'default',     // shared seed list (no stored edits yet)
  MANUAL: 'manual',       // typed by a leader (editor or abstract selection)
  ACCEPTED: 'accepted',   // a criteria suggestion the reviewer accepted
  CRITERIA: 'criteria',   // legacy badge — kept for back-compat, no longer emitted
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

/** Active terms for one side: the stored list, or the shared defaults when empty. */
function activeTerms(stored, defaults) {
  return (Array.isArray(stored) && stored.length) ? stored : (Array.isArray(defaults) ? defaults : []);
}

/**
 * resolveKeywordState — 107.md §2. The one place that answers "what is active, what
 * is still suggested, and what needs arbitration" for a screening project. Used by
 * the workbench panel, the keyword editor, the selection shortcut and the server's
 * keyword-stats endpoint, so all four agree exactly.
 *
 * @param {object} args
 * @param {string[]} args.storedInclude
 * @param {string[]} args.storedExclude
 * @param {string[]} args.defaultInclude — shared default include list (fallback)
 * @param {string[]} args.defaultExclude — shared default exclude list (fallback)
 * @param {object|string|null} args.picoSnapshot
 * @param {object|string|null} args.keywordMeta — ScreenProject.keywordMeta
 * @returns {{
 *   include: { terms:string[], sourceByTerm:Record<string,string>, pending:string[] },
 *   exclude: { terms:string[], sourceByTerm:Record<string,string>, pending:string[] },
 *   conflicts: Array<{term:string, reason:string}>,
 *   pendingCount: number,
 * }}
 */
export function resolveKeywordState({
  storedInclude, storedExclude, defaultInclude, defaultExclude, picoSnapshot, keywordMeta,
} = {}) {
  const meta = normalizeKeywordMeta(keywordMeta);
  const defaults = { include: defaultInclude || [], exclude: defaultExclude || [] };
  const suggestions = suggestCriteriaKeywords(picoSnapshot);

  const active = {
    include: activeTerms(storedInclude, defaults.include),
    exclude: activeTerms(storedExclude, defaults.exclude),
  };
  const activeKeys = {
    include: new Set(active.include.map(normalizeKeywordKey)),
    exclude: new Set(active.exclude.map(normalizeKeywordKey)),
  };

  const side = (list) => {
    const sourceByTerm = {};
    for (const t of active[list]) sourceByTerm[t] = resolveOrigin(t, list, meta, defaults);
    const seen = new Set();
    const pending = [];
    for (const t of suggestions[list]) {
      const k = normalizeKeywordKey(t);
      if (!k || seen.has(k) || activeKeys[list].has(k)) continue;
      if (meta.decisions[list][k]) continue;   // already accepted or rejected
      seen.add(k);
      pending.push(t);
    }
    return { terms: active[list], sourceByTerm, pending };
  };

  const include = side('include');
  const exclude = side('exclude');

  // A conflict stops being worth flagging once the reviewer has settled the concept
  // on either side (accepted it somewhere, rejected it, or already typed it in).
  const conflicts = suggestions.conflicts.filter(({ term }) => {
    const k = normalizeKeywordKey(term);
    if (!k) return false;
    if (activeKeys.include.has(k) || activeKeys.exclude.has(k)) return false;
    return !meta.decisions.include[k] && !meta.decisions.exclude[k];
  });

  return {
    include, exclude, conflicts,
    pendingCount: include.pending.length + exclude.pending.length + conflicts.length,
  };
}

/**
 * One-shot helper for both client and server: the ACTIVE include/exclude lists with
 * per-term origin. Stored-source is `default` when the stored array is empty (the
 * panel falls back to the shared defaults), `accepted` for an accepted suggestion,
 * else `manual`.
 *
 * 107.md §2 — criteria-derived terms are NO LONGER folded in here; they are
 * suggestions and reach this list only once accepted (see resolveKeywordState).
 *
 * @param {object} args — same shape as resolveKeywordState
 * @returns {{ include: {terms:string[], sourceByTerm:Record<string,string>}, exclude: {terms:string[], sourceByTerm:Record<string,string>} }}
 */
export function effectiveKeywords(args) {
  const st = resolveKeywordState(args);
  return {
    include: { terms: st.include.terms, sourceByTerm: st.include.sourceByTerm },
    exclude: { terms: st.exclude.terms, sourceByTerm: st.exclude.sourceByTerm },
  };
}

// Re-exported so consumers of the keyword layer need only one import.
export { KEYWORD_ORIGIN };
