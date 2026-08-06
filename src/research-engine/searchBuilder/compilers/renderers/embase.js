/**
 * renderers/embase.js — Embase.com quick-search compiler.
 *
 * Free text: single-quoted phrases with field suffixes :ti / :ab / :ti,ab (default) /
 * :ab,ti,kw (all-fields). Truncation with '*' (4-char minimum stem). Limits:
 * [yyyy-yyyy]/py for publication years and [english]/lim for language.
 *
 * 100.md §3 — NO `renderHeading` hook, deliberately. Embase indexes Emtree, which is
 * Elsevier-proprietary: no authoritative MeSH↔Emtree crosswalk is published, so Pecan
 * cannot confidently name the Emtree equivalent of a MeSH descriptor. The old compiler
 * emitted `'<lower-cased, de-inverted MeSH heading>'/exp` — a heading that frequently
 * does not exist in Emtree, i.e. exactly the invented syntax 100.md forbids. Controlled
 * terms now fall through the shared layer to a properly-quoted Embase free-text phrase
 * with an explicit "no verified Emtree equivalent" warning. A searcher who owns the
 * real Emtree term can still paste it through this database's manual override.
 */
import { S, fieldBody, langNameLower, year, uniq } from '../shared.js';

const FIELD_SUFFIX = { ti: ':ti', ab: ':ab', all: ':ab,ti,kw', tiab: ':ti,ab' };

export const embase = {
  id: 'embase',
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
