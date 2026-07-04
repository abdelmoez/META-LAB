/**
 * renderers/wos.js — Web of Science (Core Collection) Advanced Search compiler.
 *
 * Field groups: TS=(...) (Topic: title, abstract, author + keywords-plus), TI=(...)
 * (title), AB=(...) (abstract). Truncation '*', single-character wildcard '$',
 * NEAR/n proximity. Web of Science has no subject-heading thesaurus, so a subject
 * heading is searched as Topic text with an approximate warning. Limits: PY=(range)
 * and LA=(language); publication-type limits do not map to WoS DOCTYPE and are warned.
 */
import { S, fieldBody, langName, year, uniq } from '../shared.js';

const FIELD_FN = { ti: 'TI', ab: 'AB', all: 'ALL', tiab: 'TS' };

export const wos = {
  id: 'wos',
  renderControlled(term, vocab, warnings) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    vocab.unmapped++;
    vocab.approximate = true;
    warnings.push({ code: 'VOCAB_APPROXIMATE', message: `Web of Science has no subject-heading thesaurus; "${heading}" was searched as Topic (TS) text, which is approximate.` });
    return `TS=("${S(heading).replace(/"/g, '')}")`;
  },
  renderFree(term, warnings) {
    const body = fieldBody(term, { quoteChar: '"', wildcard: '*', warnings });
    return `${FIELD_FN[term.field] || FIELD_FN.tiab}=(${body})`;
  },
  buildFilters(filters, warnings) {
    const clauses = [];
    let applied = false;
    if (filters.dateFrom || filters.dateTo) {
      clauses.push(`PY=(${year(filters.dateFrom, '1500')}-${year(filters.dateTo, '3000')})`);
      applied = true;
    }
    if (filters.languages.length) {
      const langs = uniq(filters.languages.map(langName));
      clauses.push(...langs.map((l) => `LA=(${l})`));
      applied = true;
    }
    if (filters.pubTypes.length) {
      warnings.push({ code: 'FILTER_NOT_EMBEDDABLE', message: 'Web of Science DOCTYPE codes do not map to publication types like "Randomized Controlled Trial"; the publication-type limit was not embedded.' });
    }
    return { clauses, applied };
  },
};
