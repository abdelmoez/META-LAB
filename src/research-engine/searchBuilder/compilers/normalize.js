/**
 * compilers/normalize.js — 73.md Part 6. One normalizer from the saved Search-Builder
 * strategy shape to a small intermediate representation (IR) the per-database renderers
 * consume. Pure + deterministic; no app / DOM / I/O.
 *
 * Saved strategy shape (see SearchBuilderTab persistence):
 *   { concepts:[{ id, label, picoField, op:'AND'|'OR',
 *                 terms:[{ text, type:'freetext'|'controlled', field:'ti'|'ab'|'tiab'|'all',
 *                          vocab:{mesh,meshUI,tree,emtree,synonyms,…}, noExplode, truncate, phrase }] }],
 *     filters:{ dateFrom, dateTo, languages:[], pubTypes:[] },
 *     overrides:{ [dbId]: string } }
 *
 * IR:
 *   { concepts:[{ id, label, picoField, op, terms:[normTerm] }],
 *     emptyConcepts:[label],        // concepts whose terms are all blank (skipped, noted)
 *     filters:{ dateFrom, dateTo, languages:[], pubTypes:[] },
 *     overrides:{ [dbId]: string } }
 *
 * ALL concepts are kept (even empty ones) so a renderer can chain concept.op exactly
 * the way SearchBuilderTab does (the previous SURVIVING block's op joins to the next).
 */
import { S, isPhrase } from './shared.js';
import { isLiveTerm } from '../termLiveness.js';

/** Canonical field intents. Legacy aliases (title/abstract) fold in; unknown → 'tiab'. */
const FIELD_ALIAS = { ti: 'ti', title: 'ti', ab: 'ab', abstract: 'ab', tiab: 'tiab', all: 'all' };
function normField(field) {
  return FIELD_ALIAS[S(field).trim().toLowerCase()] || 'tiab';
}

/** Normalize one saved term → a compact IR term (blank-text terms are dropped upstream). */
function normTerm(t) {
  const text = S(t && t.text).trim();
  return {
    text,
    type: t && t.type === 'controlled' ? 'controlled' : 'freetext',
    field: normField(t && t.field),
    vocab: t && t.vocab && typeof t.vocab === 'object' ? t.vocab : null,
    noExplode: !!(t && t.noExplode),
    truncate: !!(t && t.truncate),
    phrase: t && t.phrase != null ? !!t.phrase : isPhrase(text),
  };
}

/** Live terms of a concept — the shared rule (non-blank text AND not disabled),
 *  so every DB compiler, the PubMed count and the previews all skip a term the
 *  user switched off (85.md A1; see termLiveness.js). */
function liveTerms(concept) {
  return ((concept && concept.terms) || [])
    .filter(isLiveTerm)
    .map(normTerm);
}

/** Normalize the search-scope limits block (mirrors searchState.normalizePersistedFilters). */
export function normalizeFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v.map((x) => S(x).trim()).filter(Boolean) : []);
  return {
    dateFrom: S(f.dateFrom).trim(),
    dateTo: S(f.dateTo).trim(),
    languages: arr(f.languages),
    pubTypes: arr(f.pubTypes),
  };
}

/** True when a filters block carries at least one active limit. */
export function hasFilters(filters) {
  return !!(filters && (filters.dateFrom || filters.dateTo || filters.languages.length || filters.pubTypes.length));
}

/** normalizeStrategy(strategy) → IR (see file header). Accepts junk safely. */
export function normalizeStrategy(strategy) {
  const src = strategy && typeof strategy === 'object' ? strategy : {};
  const rawConcepts = Array.isArray(src.concepts) ? src.concepts : [];
  const concepts = [];
  const emptyConcepts = [];
  rawConcepts
    .filter((c) => c && typeof c === 'object')
    .forEach((c, i) => {
      const label = S(c.label).trim() || S(c.picoField).trim() || `Concept ${i + 1}`;
      const terms = liveTerms(c);
      if (!terms.length) emptyConcepts.push(label);
      concepts.push({
        id: S(c.id) || `c${i + 1}`,
        label,
        picoField: S(c.picoField).trim() || null,
        op: c.op === 'OR' ? 'OR' : 'AND',
        terms,
      });
    });

  const overrides = {};
  if (src.overrides && typeof src.overrides === 'object') {
    for (const [k, v] of Object.entries(src.overrides)) {
      if (typeof v === 'string' && v.trim()) overrides[k] = v.trim();
    }
  }

  return { concepts, emptyConcepts, filters: normalizeFilters(src.filters), overrides };
}
