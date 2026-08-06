/**
 * renderers/cinahl.js — CINAHL (EBSCOhost) compiler.
 *
 * Field codes: TI / AB (and a TI…OR…AB group for title-or-abstract), TX for all text.
 * Truncation '*', wildcard '#', N/n proximity. Limits: PY range, LA language, PT
 * publication type.
 *
 * 100.md §3 — NO `renderHeading` hook, deliberately. CINAHL Headings are an EBSCO
 * thesaurus; although many overlap with MeSH, EBSCO publishes no MeSH crosswalk and
 * the nursing/allied-health headings diverge. The old compiler pasted the MeSH string
 * straight into `(MH "…+")`, which silently returns zero for every heading CINAHL
 * spells differently. Controlled terms now fall through the shared layer to a CINAHL
 * free-text phrase with an explicit "no verified CINAHL Heading equivalent" warning;
 * the real heading can be pasted through this database's manual override.
 */
import { S, fieldBody, langName, year, uniq } from '../shared.js';

/** EBSCOhost free-text field rendering — shared shape with PsycInfo. */
export function ebscoFree(term, warnings) {
  const body = fieldBody(term, { quoteChar: '"', wildcard: '*', warnings });
  if (term.field === 'ti') return `TI ${body}`;
  if (term.field === 'ab') return `AB ${body}`;
  if (term.field === 'all') return `TX ${body}`;
  return `(TI ${body} OR AB ${body})`;
}

/** EBSCOhost limit clauses — shared shape with PsycInfo. */
export function ebscoFilters(filters) {
  const clauses = [];
  let applied = false;
  if (filters.dateFrom || filters.dateTo) {
    clauses.push(`(PY ${year(filters.dateFrom, '1500')}-${year(filters.dateTo, '3000')})`);
    applied = true;
  }
  if (filters.languages.length) {
    clauses.push(...uniq(filters.languages.map(langName)).map((l) => `(LA ${l})`));
    applied = true;
  }
  if (filters.pubTypes.length) {
    clauses.push(`(${filters.pubTypes.map((p) => `PT "${S(p).replace(/"/g, '')}"`).join(' OR ')})`);
    applied = true;
  }
  return { clauses, applied };
}

export const cinahl = {
  id: 'cinahl',
  renderFree: ebscoFree,
  buildFilters(filters) { return ebscoFilters(filters); },
};
