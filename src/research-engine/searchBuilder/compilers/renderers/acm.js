/**
 * renderers/acm.js — ACM Digital Library (Advanced Search) compiler.
 *
 * Field groups: Title:(x), Abstract:(x), AllField:(x) (and a Title-or-Abstract group).
 * Truncation '*'. ACM has no subject-heading thesaurus, so a subject term degrades to
 * an AllField full-text search (warned). Date limits are applied from the results-page
 * filters, not the query string.
 */
import { fieldBody } from '../shared.js';

export const acm = {
  id: 'acm',
  /* 100.md §3 — no subject-heading thesaurus (capabilities: controlledVocab:false);
     the shared vocabulary layer records it and renders the concept through renderFree
     (Title OR Abstract) rather than an AllField full-text sweep. */
  renderFree(term, warnings) {
    const body = fieldBody(term, { quoteChar: '"', wildcard: '*', warnings });
    if (term.field === 'ti') return `Title:(${body})`;
    if (term.field === 'ab') return `Abstract:(${body})`;
    if (term.field === 'all') return `AllField:(${body})`;
    return `(Title:(${body}) OR Abstract:(${body}))`;
  },
  buildFilters(filters, warnings, notes) {
    if (filters.dateFrom || filters.dateTo || filters.languages.length || filters.pubTypes.length) {
      notes.push('Apply the publication-date limit with the ACM DL results-page filters — the query string does not carry limits.');
    }
    return { clauses: [], applied: false };
  },
};
