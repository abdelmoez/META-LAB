/**
 * renderers/cinahl.js — CINAHL (EBSCOhost) compiler.
 *
 * CINAHL Headings: (MH "Heading+") explodes, (MH "Heading") does not. Field codes:
 * TI / AB (and a TI…OR…AB group for title-or-abstract), TX for all text. Truncation
 * '*', wildcard '#', N/n proximity. The CINAHL Headings thesaurus differs from MeSH,
 * so a subject heading is reused as an approximate CINAHL Heading candidate (warned).
 * Limits: PY range, LA language, PT publication type.
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
  renderControlled(term, vocab, warnings) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    vocab.mapped++;
    vocab.approximate = true;
    warnings.push({ code: 'VOCAB_APPROXIMATE', message: `"${heading}" was reused as a CINAHL Heading candidate; the CINAHL Headings thesaurus differs from MeSH, so confirm it in CINAHL.` });
    return `(MH "${S(heading).replace(/"/g, '')}${term.noExplode ? '' : '+'}")`;
  },
  renderFree: ebscoFree,
  buildFilters(filters) { return ebscoFilters(filters); },
};
