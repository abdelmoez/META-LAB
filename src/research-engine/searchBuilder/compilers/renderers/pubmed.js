/**
 * renderers/pubmed.js — PubMed / MEDLINE compiler.
 *
 * The concept/term rendering is byte-identical to today's SearchBuilderTab output
 * (renderControlled/pubmedFree/freeTextToken): '"X"[Mesh]' / '"X"[Mesh:NoExp]',
 * word/"phrase" with [ti] / [tiab] / [all], single-word 'word*' truncation.
 * Filters are appended as PubMed limits (Date - Publication range, [Language],
 * [Publication Type]) — an additive layer SearchBuilderTab does not render today.
 */
import { S, stripDouble, ncbiToken, toSlashDate, langName, uniq } from '../shared.js';

/** PubMed publication-date range, e.g. ("2010/01/01"[Date - Publication] : "2025/12/31"[Date - Publication]). */
export function pubmedDateClause(filters, field = 'Date - Publication') {
  if (!filters.dateFrom && !filters.dateTo) return null;
  const from = toSlashDate(filters.dateFrom || '1500', 'start');
  const to = toSlashDate(filters.dateTo || '3000', 'end');
  return `("${from}"[${field}] : "${to}"[${field}])`;
}

/** [Language] clause; a single language is emitted bare, several OR-grouped. */
export function pubmedLangClause(filters) {
  if (!filters.languages.length) return null;
  const names = uniq(filters.languages.map(langName));
  const parts = names.map((n) => `${n}[Language]`);
  return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
}

/** [Publication Type] clause; a single type is emitted bare, several OR-grouped. */
export function pubmedPubTypeClause(filters) {
  if (!filters.pubTypes.length) return null;
  const parts = filters.pubTypes.map((p) => `"${stripDouble(p)}"[Publication Type]`);
  return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
}

export const pubmed = {
  id: 'pubmed',
  renderControlled(term, vocab) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    if (term.vocab && term.vocab.mesh) vocab.mapped++; else vocab.unmapped++;
    return `"${S(heading)}"[Mesh${term.noExplode ? ':NoExp' : ''}]`;
  },
  renderFree(term) {
    const { token, field } = ncbiToken(term);
    const tag = field === 'ti' ? '[ti]' : field === 'all' ? '[all]' : '[tiab]';
    return `${token}${tag}`;
  },
  buildFilters(filters) {
    const clauses = [pubmedDateClause(filters), pubmedLangClause(filters), pubmedPubTypeClause(filters)].filter(Boolean);
    return { clauses, applied: clauses.length > 0 };
  },
};
