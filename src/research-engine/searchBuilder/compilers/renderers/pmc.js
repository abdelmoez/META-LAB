/**
 * renderers/pmc.js — PubMed Central compiler.
 *
 * PMC uses NCBI-style tags but a narrower, full-text-indexed field set, so we keep to
 * the conservative common subset: [Title], [Abstract], [All Fields], and "X"[MeSH Terms].
 * A title-or-abstract term expands to ("x"[Title] OR "x"[Abstract]) because PMC has no
 * single [tiab] tag. NCBI token rules (phrase quoting, single-word 'word*' truncation)
 * are shared with PubMed. A note flags that PMC field behaviour differs from PubMed.
 */
import { S, ncbiToken } from '../shared.js';
import { pubmedDateClause, pubmedLangClause, pubmedPubTypeClause } from './pubmed.js';

export const pmc = {
  id: 'pmc',
  /* 100.md §4 — PMC indexes MEDLINE's own MeSH descriptors, so the mapping is the
     identity. `[MeSH Terms]` always explodes and PMC exposes no NoExp form, which the
     capability table declares (explosion:false, explosionDefault:'explode') — the
     shared layer raises the mismatch warning when the user asked for no explosion. */
  renderHeading(plan) {
    return `"${S(plan.heading)}"[MeSH Terms]`;
  },
  renderFree(term) {
    const { token, field } = ncbiToken(term);
    if (field === 'ti') return `${token}[Title]`;
    if (field === 'ab') return `${token}[Abstract]`;
    if (field === 'all') return `${token}[All Fields]`;
    return `(${token}[Title] OR ${token}[Abstract])`;
  },
  buildFilters(filters, warnings, notes) {
    const clauses = [
      pubmedDateClause(filters, 'Publication Date'),
      pubmedLangClause(filters),
      pubmedPubTypeClause(filters),
    ].filter(Boolean);
    notes.push('PMC indexes full text, so its field behaviour differs from PubMed — the same tags return broader results here.');
    return { clauses, applied: clauses.length > 0 };
  },
};
