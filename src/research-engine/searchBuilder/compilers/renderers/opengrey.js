/**
 * renderers/opengrey.js — OpenGrey / grey-literature compiler.
 *
 * Grey-literature portals accept only simple AND/OR and quoted phrases. There are no
 * subject headings, field tags, truncation, or in-string limits, so headings degrade
 * to plain phrases, field/truncation requests are recorded, and a heavy limitation
 * note tells the user to screen results manually.
 */
import { fieldBody } from '../shared.js';

export const opengrey = {
  id: 'opengrey',
  renderControlled(term, vocab, warnings) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    vocab.unmapped++;
    vocab.approximate = true;
    warnings.push({ code: 'VOCAB_APPROXIMATE', message: `Grey-literature search has no subject headings; "${heading}" was searched as a plain phrase.` });
    return fieldBody({ text: heading, type: 'freetext', phrase: true }, { quoteChar: '"', wildcard: null, warnings });
  },
  renderFree(term, warnings, unsupported) {
    if (term.field && term.field !== 'tiab' && term.field !== 'all') {
      unsupported.push({ feature: 'field-tags', detail: `Grey-literature search cannot restrict "${term.text}" to the ${term.field} field; it was searched across all fields.` });
    }
    return fieldBody(term, { quoteChar: '"', wildcard: null, warnings });
  },
  buildFilters(filters, warnings, notes) {
    notes.push('Grey-literature portals support only simple AND/OR and quoted phrases — no fields, truncation, or limits. Expect a coarse match and screen the results manually.');
    return { clauses: [], applied: false };
  },
};
