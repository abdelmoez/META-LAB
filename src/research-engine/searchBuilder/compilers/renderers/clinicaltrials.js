/**
 * renderers/clinicaltrials.js — ClinicalTrials.gov (modern search) compiler.
 *
 * The modern ClinicalTrials.gov search accepts an Essie expression: plain terms with
 * AND / OR / NOT and parentheses, quoted phrases, and AREA[...] operators for the few
 * targetable fields (ConditionSearch, InterventionSearch, TitleSearch, …). It has no
 * controlled-vocabulary thesaurus and no reliable per-term field tags, so subject
 * headings degrade to quoted phrases (recorded as unsupported) and a note explains
 * that field targeting is limited.
 */
import { fieldBody } from '../shared.js';

export const clinicaltrials = {
  id: 'clinicaltrials',
  /* 100.md §3 — no controlled-vocabulary field (capabilities: controlledVocab:false);
     the shared vocabulary layer records it and renders the concept as a plain phrase. */
  renderFree(term, warnings) {
    return fieldBody(term, { quoteChar: '"', wildcard: null, warnings });
  },
  buildFilters(filters, warnings, notes) {
    if (filters.dateFrom || filters.dateTo || filters.languages.length || filters.pubTypes.length) {
      notes.push('Apply date / status / study-type limits with the ClinicalTrials.gov result filters — they are not part of the query string.');
    }
    notes.push('Field targeting is limited on ClinicalTrials.gov; wrap a term in AREA[ConditionSearch] / AREA[InterventionSearch] if you need to scope it.');
    return { clauses: [], applied: false };
  },
};
