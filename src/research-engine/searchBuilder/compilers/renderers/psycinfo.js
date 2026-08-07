/**
 * renderers/psycinfo.js — APA PsycInfo (EBSCOhost) compiler.
 *
 * Field codes: TI / AB (and a TI…OR…AB group), TX for all text. Truncation '*',
 * wildcard '#', N/n proximity. Limits reuse the EBSCOhost PY / LA / PT clauses shared
 * with CINAHL.
 *
 * 100.md §§3-4 — APA descriptors: DE "descriptor". The hook exists, but nothing reaches
 * it TODAY: the APA Thesaurus of Psychological Index Terms is proprietary, has no
 * published MeSH crosswalk, and its descriptors are frequently worded quite differently
 * from MeSH (a biomedical thesaurus) — so the registry ships none and a MeSH concept
 * compiles to PsycInfo free text with an explicit "no verified APA descriptor
 * equivalent" warning. The old compiler emitted `DE "<MeSH heading>"`, which returns
 * zero whenever the APA descriptor differs.
 *
 * Keeping the hook is what makes the documented extension path REAL: register a
 * mesh→apa crosswalk and this renderer emits native syntax with no edit here.
 */
import { S } from '../shared.js';
import { ebscoFree, ebscoFilters } from './cinahl.js';

export const psycinfo = {
  id: 'psycinfo',
  renderHeading(plan) {
    return `DE "${S(plan.heading).replace(/"/g, '')}"`;
  },
  renderFree: ebscoFree,
  buildFilters(filters) { return ebscoFilters(filters); },
};
