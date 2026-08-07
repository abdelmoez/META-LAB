/**
 * renderers/cinahl.js — CINAHL (EBSCOhost) compiler.
 *
 * Field codes: TI / AB (and a TI…OR…AB group for title-or-abstract), TX for all text.
 * Truncation '*', wildcard '#', N/n proximity. Limits: PY range, LA language, PT
 * publication type.
 *
 * 100.md §§3-4 — CINAHL Headings: (MH "Heading+") explodes, (MH "Heading") does not.
 * The hook exists, but nothing reaches it TODAY: CINAHL Headings are an EBSCO thesaurus
 * and although many overlap with MeSH, EBSCO publishes no crosswalk and the
 * nursing/allied-health headings diverge — so the registry ships none and a MeSH concept
 * compiles to CINAHL free text with an explicit "no verified CINAHL Heading equivalent"
 * warning. The old compiler pasted the MeSH string straight into `(MH "…+")`, which
 * silently returns zero for every heading CINAHL spells differently.
 *
 * Keeping the hook is what makes the documented extension path REAL: register a
 * mesh→cinahl crosswalk and this renderer emits native syntax with no edit here.
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
  renderHeading(plan) {
    return `(MH "${S(plan.heading).replace(/"/g, '')}${plan.explode ? '+' : ''}")`;
  },
  renderFree: ebscoFree,
  buildFilters(filters) { return ebscoFilters(filters); },
};
