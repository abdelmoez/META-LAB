/**
 * renderers/psycinfo.js — APA PsycInfo (EBSCOhost) compiler.
 *
 * Field codes: TI / AB (and a TI…OR…AB group), TX for all text. Truncation '*',
 * wildcard '#', N/n proximity. Limits reuse the EBSCOhost PY / LA / PT clauses shared
 * with CINAHL.
 *
 * 100.md §3 — NO `renderHeading` hook, deliberately. PsycInfo is indexed with the APA
 * Thesaurus of Psychological Index Terms, a proprietary vocabulary with no published
 * MeSH crosswalk; its descriptors are frequently worded quite differently from MeSH
 * (a biomedical thesaurus). The old compiler emitted `DE "<MeSH heading>"`, which
 * returns zero whenever the APA descriptor differs. Controlled terms now fall through
 * the shared vocabulary layer to a PsycInfo free-text phrase with an explicit "no
 * verified APA descriptor equivalent" warning; the real descriptor can be pasted
 * through this database's manual override.
 */
import { ebscoFree, ebscoFilters } from './cinahl.js';

export const psycinfo = {
  id: 'psycinfo',
  renderFree: ebscoFree,
  buildFilters(filters) { return ebscoFilters(filters); },
};
