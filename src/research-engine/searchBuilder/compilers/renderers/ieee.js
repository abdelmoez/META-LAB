/**
 * renderers/ieee.js — IEEE Xplore Command Search compiler.
 *
 * Field groups: "Document Title":x, "Abstract":x, "All Metadata":x (and a
 * Title-or-Abstract group). Truncation '*', NEAR/n proximity. IEEE has no
 * subject-heading thesaurus, so a subject term degrades to an "All Metadata" full-text
 * search recorded as an unsupported entry. Limits are set from the results-page facets.
 */
import { fieldBody } from '../shared.js';

export const ieee = {
  id: 'ieee',
  renderControlled(term, vocab, warnings, unsupported) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    vocab.unmapped++;
    vocab.approximate = true;
    unsupported.push({ feature: 'controlled-vocabulary', detail: `IEEE Xplore has no subject-heading field; "${heading}" was searched as "All Metadata" full text.` });
    const body = fieldBody({ text: heading, type: 'freetext', phrase: true }, { quoteChar: '"', wildcard: null, warnings });
    return `"All Metadata":${body}`;
  },
  renderFree(term, warnings) {
    const body = fieldBody(term, { quoteChar: '"', wildcard: '*', warnings });
    if (term.field === 'ti') return `"Document Title":${body}`;
    if (term.field === 'ab') return `"Abstract":${body}`;
    if (term.field === 'all') return `"All Metadata":${body}`;
    return `("Document Title":${body} OR "Abstract":${body})`;
  },
  buildFilters(filters, warnings, notes) {
    if (filters.dateFrom || filters.dateTo || filters.languages.length || filters.pubTypes.length) {
      notes.push('Set the year range and content type with the IEEE Xplore results-page facets — Command Search has no in-string limits.');
    }
    return { clauses: [], applied: false };
  },
};
