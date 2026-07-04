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
  renderControlled(term, vocab, warnings) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    if (term.vocab && term.vocab.mesh) vocab.mapped++; else vocab.unmapped++;
    if (term.noExplode) warnings.push({ code: 'VOCAB_APPROXIMATE', message: `PMC searches MeSH via [MeSH Terms], which explodes by default; the no-explosion request for "${heading}" is not honored.` });
    return `"${S(heading)}"[MeSH Terms]`;
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
