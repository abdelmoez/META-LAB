/**
 * renderers/proquest.js — ProQuest (Dissertations & Theses) compiler.
 *
 * Field groups: TI,AB(...) (title + abstract, the default), TI(...) / AB(...),
 * NOFT(...) for anywhere-except-full-text. Truncation '*', wildcard '?', NEAR/n
 * proximity. ProQuest has no MeSH/Emtree thesaurus, so a subject heading maps to
 * MAINSUBJECT.EXACT() with an approximate warning. Date and language belong to the
 * ProQuest limiters below the search box, so they are surfaced as a note.
 */
import { S, fieldBody } from '../shared.js';

const FIELD_FN = { ti: 'TI', ab: 'AB', all: 'NOFT', tiab: 'TI,AB' };

export const proquest = {
  id: 'proquest',
  renderControlled(term, vocab, warnings) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    vocab.mapped++;
    vocab.approximate = true;
    warnings.push({ code: 'VOCAB_APPROXIMATE', message: `ProQuest has no MeSH/Emtree thesaurus; "${heading}" was mapped to MAINSUBJECT.EXACT(), which is approximate.` });
    return `MAINSUBJECT.EXACT("${S(heading).replace(/"/g, '')}")`;
  },
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
