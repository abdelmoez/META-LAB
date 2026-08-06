/**
 * renderers/gscholar.js — Google Scholar (simplified) compiler.
 *
 * Google Scholar is intentionally coarse: quoted phrases and OR within a concept, and
 * an implicit-AND space between concepts. It auto-stems, so there is no truncation
 * wildcard (truncation requests are warned). There are no field tags or subject
 * headings, and limits belong in the Advanced-search panel, not the query. The ~256
 * character query ceiling is checked and warned when exceeded.
 */
import { fieldBody } from '../shared.js';

const MAX_LEN = 256;

export const gscholar = {
  id: 'gscholar',
  conceptJoiner(op) { return op === 'OR' ? ' OR ' : ' '; },
  /* 100.md §3 — no subject headings at all (capabilities: controlledVocab:false), so
     controlled terms fall through the shared vocabulary layer to a plain phrase. */
  renderFree(term, warnings, unsupported) {
    if (term.field && term.field !== 'tiab' && term.field !== 'all') {
      unsupported.push({ feature: 'field-tags', detail: `Google Scholar cannot restrict "${term.text}" to the ${term.field} field; use the intitle: operator manually if needed.` });
    }
    return fieldBody(term, { quoteChar: '"', wildcard: null, warnings });
  },
  buildFilters(filters, warnings, notes) {
    if (filters.dateFrom || filters.dateTo || filters.languages.length || filters.pubTypes.length) {
      notes.push('Set the year range and language in the Google Scholar Advanced search (the ▾ menu) — Scholar has no in-query limits.');
    }
    return { clauses: [], applied: false };
  },
  postProcess(query, warnings) {
    if (query.length > MAX_LEN) {
      warnings.push({ code: 'LENGTH_LIMIT', message: `The query is ${query.length} characters; Google Scholar truncates around ${MAX_LEN}. Shorten it or split it into several searches.` });
    }
    return query;
  },
};
