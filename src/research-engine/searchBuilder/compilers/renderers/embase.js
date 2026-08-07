/**
 * renderers/embase.js — Embase.com quick-search compiler.
 *
 * Free text: single-quoted phrases with field suffixes :ti / :ab / :ti,ab (default) /
 * :ab,ti,kw (all-fields). Truncation with '*' (4-char minimum stem). Limits:
 * [yyyy-yyyy]/py for publication years and [english]/lim for language.
 *
 * 100.md §§3-4 — Emtree headings: 'heart failure'/exp (explode) or /de. The hook exists,
 * but nothing reaches it TODAY: Emtree is Elsevier-proprietary, no authoritative
 * MeSH↔Emtree crosswalk is published, and the vocabulary registry therefore ships none —
 * so a MeSH concept resolves to `freetext` and compiles to a properly-quoted Embase
 * phrase with an explicit "no verified Emtree equivalent" warning. The old compiler
 * instead emitted `'<lower-cased, de-inverted MeSH heading>'/exp`, a heading that
 * frequently does not exist in Emtree — exactly the invented syntax 100.md forbids.
 *
 * Keeping the hook is what makes the documented extension path REAL: register a
 * mesh→emtree crosswalk and this renderer starts emitting native Emtree syntax with no
 * edit here. A term already sourced from Emtree resolves natively today (identity rule).
 */
import { S, fieldBody, langNameLower, year, uniq } from '../shared.js';

const FIELD_SUFFIX = { ti: ':ti', ab: ':ab', all: ':ab,ti,kw', tiab: ':ti,ab' };

export const embase = {
  id: 'embase',
  renderHeading(plan) {
    return `'${S(plan.heading).replace(/'/g, '')}'/${plan.explode ? 'exp' : 'de'}`;
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
