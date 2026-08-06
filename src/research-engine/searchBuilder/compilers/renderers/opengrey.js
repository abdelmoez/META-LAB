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
  /* 100.md §3 — no controlled vocabulary (capabilities: controlledVocab:false), so
     controlled terms fall through the shared layer to a plain quoted phrase. */
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
