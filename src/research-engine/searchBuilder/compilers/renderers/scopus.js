/**
 * renderers/scopus.js — Scopus Advanced document search compiler.
 *
 * Field groups: TITLE-ABS-KEY() (title + abstract + keywords, the default),
 * TITLE() / ABS() / ALL(). Truncation '*', single-char wildcard '?', W/n proximity.
 * Scopus has no MeSH/Emtree thesaurus, so subject headings map to INDEXTERMS() with an
 * approximate warning. Limits: PUBYEAR range + LANGUAGE(); publication-type limits do
 * not map cleanly to Scopus DOCTYPE, so they are warned rather than faked.
 */
import { S, fieldBody, langName, uniq } from '../shared.js';

const FIELD_FN = { ti: 'TITLE', ab: 'ABS', all: 'ALL', tiab: 'TITLE-ABS-KEY' };

export const scopus = {
  id: 'scopus',
  renderControlled(term, vocab, warnings) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    vocab.mapped++;
    vocab.approximate = true;
    warnings.push({ code: 'VOCAB_APPROXIMATE', message: `Scopus has no MeSH/Emtree thesaurus; "${heading}" was mapped to INDEXTERMS(), which is approximate.` });
    return `INDEXTERMS("${S(heading).replace(/"/g, '')}")`;
  },
  renderFree(term, warnings) {
    const body = fieldBody(term, { quoteChar: '"', wildcard: '*', warnings });
    return `${FIELD_FN[term.field] || FIELD_FN.tiab}(${body})`;
  },
  buildFilters(filters, warnings) {
    const clauses = [];
    let applied = false;
    if (filters.dateFrom || filters.dateTo) {
      const parts = [];
      const from = parseInt((filters.dateFrom.match(/\d{4}/) || [])[0], 10);
      const to = parseInt((filters.dateTo.match(/\d{4}/) || [])[0], 10);
      if (Number.isFinite(from)) parts.push(`PUBYEAR > ${from - 1}`);
      if (Number.isFinite(to)) parts.push(`PUBYEAR < ${to + 1}`);
      if (parts.length) { clauses.push(parts.length > 1 ? `(${parts.join(' AND ')})` : parts[0]); applied = true; }
    }
    if (filters.languages.length) {
      const langs = uniq(filters.languages.map(langName));
      clauses.push(...langs.map((l) => `LANGUAGE(${l})`));
      applied = true;
    }
    if (filters.pubTypes.length) {
      warnings.push({ code: 'FILTER_NOT_EMBEDDABLE', message: 'Scopus DOCTYPE codes do not map to publication types like "Randomized Controlled Trial"; the publication-type limit was not embedded.' });
    }
    return { clauses, applied };
  },
};
