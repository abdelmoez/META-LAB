/**
 * renderers/embase.js — Embase.com quick-search compiler.
 *
 * Emtree subject headings: 'heart failure'/exp (explode) or 'heart failure'/de.
 * Free text: single-quoted phrases with field suffixes :ti / :ab / :ti,ab (default) /
 * :ab,ti,kw (all-fields). Truncation with '*' (4-char minimum stem). Limits:
 * [yyyy-yyyy]/py for publication years and [english]/lim for language. When an
 * Emtree term is absent the heading falls back to lowercased free text with an
 * explicit approximate warning (it is never silently mapped).
 */
import { S, fieldBody, langNameLower, year, uniq } from '../shared.js';

const FIELD_SUFFIX = { ti: ':ti', ab: ':ab', all: ':ab,ti,kw', tiab: ':ti,ab' };

export const embase = {
  id: 'embase',
  renderControlled(term, vocab, warnings) {
    const emtree = term.vocab && term.vocab.emtree;
    if (emtree) {
      vocab.mapped++;
      return `'${S(emtree)}'/${term.noExplode ? 'de' : 'exp'}`;
    }
    // No Emtree mapping → fall back to the lowercased text as a quoted phrase, warned.
    vocab.unmapped++;
    vocab.approximate = true;
    warnings.push({ code: 'VOCAB_FALLBACK', message: `No Emtree mapping for "${term.text}"; it was searched as lowercased free text, which may differ from an exploded Emtree heading.` });
    const body = fieldBody({ ...term, text: S(term.text).toLowerCase(), type: 'freetext', truncate: false, phrase: true }, { quoteChar: "'", wildcard: null, warnings });
    return `${body}${FIELD_SUFFIX.tiab}`;
  },
  renderFree(term, warnings) {
    const body = fieldBody(term, { quoteChar: "'", wildcard: '*', minStem: 4, warnings });
    return `${body}${FIELD_SUFFIX[term.field] || FIELD_SUFFIX.tiab}`;
  },
  buildFilters(filters, warnings) {
    const clauses = [];
    let applied = false;
    if (filters.dateFrom || filters.dateTo) {
      clauses.push(`[${year(filters.dateFrom, '1500')}-${year(filters.dateTo, '3000')}]/py`);
      applied = true;
    }
    if (filters.languages.length) {
      const langs = uniq(filters.languages.map(langNameLower));
      clauses.push(...langs.map((l) => `[${l}]/lim`));
      applied = true;
    }
    if (filters.pubTypes.length) {
      warnings.push({ code: 'FILTER_NOT_EMBEDDABLE', message: 'Embase publication-type limits are applied from the results-page filters, not the query string; the publication-type limit was not embedded.' });
    }
    return { clauses, applied };
  },
};
