/**
 * renderers/cochrane.js — Cochrane Library (CENTRAL) Search-manager compiler.
 *
 * MeSH: [mh "Heart Failure"] (explode) or [mh ^"Heart Failure"] (no explode).
 * Free text: double-quoted phrases with :ti (title) or :ti,ab,kw (default) fields.
 * NEAR/n and NEXT are available (documented in a note, not auto-inserted).
 * CENTRAL does not take publication-date / language limits inside the search string,
 * so those are surfaced as warnings + notes — never fabricated as inline syntax.
 */
import { S, fieldBody } from '../shared.js';

const FIELD_SUFFIX = { ti: ':ti', ab: ':ti,ab,kw', all: ':ti,ab,kw', tiab: ':ti,ab,kw' };

export const cochrane = {
  id: 'cochrane',
  renderControlled(term, vocab) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    if (term.vocab && term.vocab.mesh) vocab.mapped++; else vocab.unmapped++;
    return `[mh ${term.noExplode ? '^' : ''}"${S(heading)}"]`;
  },
  renderFree(term, warnings) {
    const body = fieldBody(term, { quoteChar: '"', wildcard: '*', warnings });
    return `${body}${FIELD_SUFFIX[term.field] || FIELD_SUFFIX.tiab}`;
  },
  buildFilters(filters, warnings, notes) {
    let flagged = false;
    if (filters.dateFrom || filters.dateTo) {
      warnings.push({ code: 'FILTER_NOT_EMBEDDABLE', message: 'Cochrane CENTRAL applies the publication-date limit through its own date picker; the date range was not embedded in the query.' });
      flagged = true;
    }
    if (filters.languages.length) {
      warnings.push({ code: 'FILTER_NOT_EMBEDDABLE', message: 'Cochrane CENTRAL has no in-string language limit; apply the language filter on the results page.' });
      flagged = true;
    }
    if (filters.pubTypes.length) {
      warnings.push({ code: 'FILTER_NOT_EMBEDDABLE', message: 'Cochrane CENTRAL has no in-string publication-type limit; use the results-page filters.' });
      flagged = true;
    }
    if (flagged) notes.push('Set your date / language / type limits with the Cochrane Library filters after running this search.');
    return { clauses: [], applied: false };
  },
};
