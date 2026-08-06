/**
 * renderers/proquest.js — ProQuest (Dissertations & Theses) compiler.
 *
 * Field groups: TI,AB(...) (title + abstract, the default), TI(...) / AB(...),
 * NOFT(...) for anywhere-except-full-text. Truncation '*', wildcard '?', NEAR/n
 * proximity. Date and language belong to the ProQuest limiters below the search box,
 * so they are surfaced as a note.
 *
 * 100.md §3 — ProQuest Dissertations & Theses carries no medical subject-heading
 * thesaurus (capabilities: controlledVocab:false), so there is no `renderHeading`
 * hook. `MAINSUBJECT.EXACT("<MeSH heading>")` demanded an EXACT match against
 * ProQuest's own subject list and therefore returned nothing for most MeSH strings;
 * controlled terms now fall through to TI,AB free text.
 */
import { fieldBody } from '../shared.js';

const FIELD_FN = { ti: 'TI', ab: 'AB', all: 'NOFT', tiab: 'TI,AB' };

export const proquest = {
  id: 'proquest',
  renderFree(term, warnings) {
    const body = fieldBody(term, { quoteChar: '"', wildcard: '*', warnings });
    return `${FIELD_FN[term.field] || FIELD_FN.tiab}(${body})`;
  },
  buildFilters(filters, warnings, notes) {
    if (filters.dateFrom || filters.dateTo || filters.languages.length || filters.pubTypes.length) {
      notes.push('Apply the publication-date and language limits with the ProQuest limiters below the search box — they are not embedded in the query.');
    }
    return { clauses: [], applied: false };
  },
};
