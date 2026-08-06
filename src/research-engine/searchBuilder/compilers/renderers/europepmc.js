/**
 * renderers/europepmc.js — Europe PMC compiler.
 *
 * Mirrors the conventions of server/pecanSearch/connectors/europepmc.js: TITLE:/
 * ABSTRACT: native fields, TIAB expanded to (TITLE:… OR ABSTRACT:…), ALL as a bare
 * term. Truncation 'term*' (never on a phrase). Controlled MeSH has no native
 * explosion field, so it is rendered best-effort as MESH:"…" with a warning. Limits:
 * (PUB_YEAR:[y TO y]), (LANG:"<iso639-2b>"), (PUB_TYPE:"…").
 */
import { S, fieldBody, langIso6392b, year, uniq } from '../shared.js';

export const europepmc = {
  id: 'europepmc',
  /* 100.md §4 — Europe PMC carries MEDLINE's MeSH annotations, so the descriptor is
     used as-is (identity mapping). `MESH:` matches the heading EXACTLY — there is no
     explosion form — which the capability table declares as
     explosion:false / explosionDefault:'exact'; the shared layer warns when the user
     asked for narrower topics. */
  renderHeading(plan, term, warnings, notes) {
    notes.push('Europe PMC applies MeSH annotations imported from MEDLINE, so records that PubMed has not yet indexed will not match a MESH: clause.');
    return `MESH:"${S(plan.heading).replace(/"/g, '')}"`;
  },
  renderFree(term, warnings) {
    const body = fieldBody(term, { quoteChar: '"', wildcard: '*', warnings });
    if (term.field === 'ti') return `TITLE:${body}`;
    if (term.field === 'ab') return `ABSTRACT:${body}`;
    if (term.field === 'all') return body;
    return `(TITLE:${body} OR ABSTRACT:${body})`;
  },
  buildFilters(filters, warnings, notes) {
    const clauses = [];
    let applied = false;
    if (filters.dateFrom || filters.dateTo) {
      clauses.push(`(PUB_YEAR:[${year(filters.dateFrom, '1500')} TO ${year(filters.dateTo, '3000')}])`);
      applied = true;
    }
    if (filters.languages.length) {
      const codes = [];
      for (const l of filters.languages) {
        const code = langIso6392b(l);
        if (code) codes.push(code);
        else warnings.push({ code: 'FILTER_NOT_EMBEDDABLE', message: `Language "${l}" could not be mapped to a Europe PMC ISO 639-2 code and was not applied.` });
      }
      if (codes.length) { clauses.push(`(${uniq(codes).map((c) => `LANG:"${c}"`).join(' OR ')})`); applied = true; }
    }
    if (filters.pubTypes.length) {
      clauses.push(`(${filters.pubTypes.map((p) => `PUB_TYPE:"${S(p).replace(/"/g, '')}"`).join(' OR ')})`);
      applied = true;
      notes.push('Europe PMC publication types differ from PubMed; confirm the PUB_TYPE values match Europe PMC’s vocabulary.');
    }
    return { clauses, applied };
  },
};
