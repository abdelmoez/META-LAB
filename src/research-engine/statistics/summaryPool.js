/**
 * summaryPool.js
 * A single, correct way for SUMMARY views (Overview I² badge, Results write-up,
 * legacy GRADE tab, report HTML, gradeSuggestions) to pool studies.
 *
 * 86.md P1.6 — those views called runMeta(project.studies, 'random') over ALL
 * studies at once, so a multi-outcome project (6 mortality lnOR + 5 pain-score SMD)
 * pooled 11 studies of different measures into one nonsensical estimate with a
 * spuriously huge I², driving wrong GRADE downgrades and an auto-drafted Results
 * paragraph describing a pool that exists in no real analysis. This helper pools the
 * PRIMARY outcome group only — the same (outcome, timepoint, esType) grouping the
 * Analysis tab uses — with the project's persisted τ² estimator (P1.5) and excluding
 * studies the reviewer marked out of analysis (P1.17). `outcomeCount > 1` lets a
 * caller show "showing the primary outcome — see Analysis for the rest".
 */
import { runMeta } from './monolithStats.js';
import { analyzableStudies } from './studyFilter.js';
import { getOutcomePairs, filterStudiesForOutcome } from '../import-export/journalSubmission.js';
import { isNonPrimary } from '../import-export/referenceParsers.js';

/**
 * poolPrimaryOutcome(studies, method, opts)
 * @returns {{ result: object|null, subset: object[], pair: object|null, outcomeCount: number }}
 */
export function poolPrimaryOutcome(studies, method = 'random', opts = {}) {
  const list = analyzableStudies(Array.isArray(studies) ? studies : []);
  const pairs = getOutcomePairs(list);
  if (!pairs.length) return { result: null, subset: [], pair: null, outcomeCount: 0 };
  // Prefer an outcome whose studies are PRIMARY (not flagged non-primary); else the
  // first-seen outcome. Deterministic and matches the "one forest per outcome" set.
  let primary = pairs[0];
  for (const p of pairs) {
    const sub = filterStudiesForOutcome(list, p);
    if (sub.some((s) => !isNonPrimary(s))) { primary = p; break; }
  }
  const subset = filterStudiesForOutcome(list, primary);
  return { result: runMeta(subset, method, opts), subset, pair: primary, outcomeCount: pairs.length };
}
