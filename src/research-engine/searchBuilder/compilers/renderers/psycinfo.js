/**
 * renderers/psycinfo.js — APA PsycInfo (EBSCOhost) compiler.
 *
 * APA descriptors: DE "descriptor". Field codes: TI / AB (and a TI…OR…AB group),
 * TX for all text. Truncation '*', wildcard '#', N/n proximity. The APA Thesaurus of
 * Psychological Index Terms differs from MeSH, so a subject heading is reused as an
 * approximate descriptor candidate (warned). Limits reuse the EBSCOhost PY / LA / PT
 * clauses shared with CINAHL.
 */
import { S } from '../shared.js';
import { ebscoFree, ebscoFilters } from './cinahl.js';

export const psycinfo = {
  id: 'psycinfo',
  renderControlled(term, vocab, warnings) {
    const heading = (term.vocab && term.vocab.mesh) || term.text;
    vocab.mapped++;
    vocab.approximate = true;
    warnings.push({ code: 'VOCAB_APPROXIMATE', message: `"${heading}" was reused as an APA PsycInfo descriptor candidate; the APA Thesaurus differs from MeSH, so confirm it in PsycInfo.` });
    return `DE "${S(heading).replace(/"/g, '')}"`;
  },
  renderFree: ebscoFree,
  buildFilters(filters) { return ebscoFilters(filters); },
};
