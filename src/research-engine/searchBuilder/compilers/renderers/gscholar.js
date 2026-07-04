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
  renderControlled(term, vocab, warnings) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    vocab.unmapped++;
    vocab.approximate = true;
    warnings.push({ code: 'VOCAB_APPROXIMATE', message: `Google Scholar has no subject headings; "${heading}" was searched as a plain phrase.` });
    return fieldBody({ text: heading, type: 'freetext', phrase: true }, { quoteChar: '"', wildcard: null, warnings });
  },
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
