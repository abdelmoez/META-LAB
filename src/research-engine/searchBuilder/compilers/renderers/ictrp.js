/**
 * renderers/ictrp.js — WHO ICTRP compiler.
 *
 * ICTRP's advanced search is deliberately minimal: AND / OR and quoted phrases only.
 * There are no subject headings, field tags, truncation, or in-string limits, so every
 * unsupported feature is recorded as an unsupported entry or a warning — nothing is
 * silently dropped or faked.
 */
import { fieldBody } from '../shared.js';

export const ictrp = {
  id: 'ictrp',
  renderControlled(term, vocab, warnings, unsupported) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    vocab.unmapped++;
    vocab.approximate = true;
    unsupported.push({ feature: 'controlled-vocabulary', detail: `WHO ICTRP has no subject-heading field; "${heading}" was searched as a plain phrase.` });
    return fieldBody({ text: heading, type: 'freetext', phrase: true }, { quoteChar: '"', wildcard: null, warnings });
  },
  renderFree(term, warnings, unsupported) {
    if (term.field && term.field !== 'tiab' && term.field !== 'all') {
      unsupported.push({ feature: 'field-tags', detail: `WHO ICTRP cannot restrict "${term.text}" to the ${term.field} field; it was searched across all fields.` });
    }
    return fieldBody(term, { quoteChar: '"', wildcard: null, warnings });
  },
  buildFilters(filters, warnings, notes) {
    if (filters.dateFrom || filters.dateTo || filters.languages.length || filters.pubTypes.length) {
      notes.push('WHO ICTRP has no in-string limits; use its Advanced-search date and recruitment-status fields after pasting the query.');
    }
    return { clauses: [], applied: false };
  },
};
