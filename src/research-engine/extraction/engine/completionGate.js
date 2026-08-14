/**
 * extraction/engine/completionGate.js — 76.md §17/§22 (validation tiers + completion).
 *
 * Turns the pure per-study validator output into a THREE-TIER decision (§17:
 * informational / warning / blocking) and a completion gate (§22): an article may be
 * marked complete only when there are no BLOCKING errors, but warnings never block —
 * they surface for the reviewer to acknowledge. This is the single source of truth the
 * server completion endpoint and the workspace "Mark complete" button both call.
 *
 * PURE — no IO. Reuses validateStudy (blocking=error) and adds engine-level
 * analysis-readiness checks (§17 "analysis-readiness validation").
 */

import { validateStudy } from '../../validation/study-validator.js';
import { analysisReady } from './syncState.js';
import { hasAnyValue, progressOf } from './articleStatus.js';
// 116.md §41/§47 — derive-at-analysis-boundary awareness: a PROP row with valid raw
// events/total DOES enter the meta-analysis now, so the info line must not claim
// otherwise (it directly contradicted the Analysis tab — the §41 regression's wording).
// 116.md §46 (r2) — the predicate is `derivesPropEffect`, NOT "has a usable effect":
// `hasUsableEffect` is true for ANY row with a stored es, so the derivation message
// fired for reviewer-typed effect sizes on every measure — claiming an events/total
// derivation that does not exist, and a store-on-complete that cannot happen
// (deriveEffectSizeFromRaw returns null once `es` is set). Imported from the
// dependency-free poolableRow module — the SAME guard `poolableStudyView` uses — so
// the server completion path does not pull the meta-analysis engine in through here.
import { derivesPropEffect, hasStoredEffect, hasStoredInterval } from '../../statistics/poolableRow.js';

/** Severity tiers (76.md §17). */
export const SEVERITY = Object.freeze({ INFO: 'info', WARN: 'warn', BLOCK: 'block' });

/**
 * evaluateCompletion(study) — the completion decision for one article.
 * @returns {{
 *   canComplete: boolean,
 *   blocking: Array<{field:string,msg:string}>,
 *   warnings: Array<{field:string,msg:string}>,
 *   info: Array<{field:string,msg:string}>,
 *   progress: {filledFields:number,totalFields:number,pct:number}
 * }}
 */
export function evaluateCompletion(study = {}) {
  const raw = validateStudy(study) || [];
  const blocking = [];
  const warnings = [];
  const info = [];

  for (const it of raw) {
    if (it.sev === 'error') blocking.push({ field: it.field, msg: it.msg });
    else warnings.push({ field: it.field, msg: it.msg });
  }

  // Engine-level analysis-readiness advisories (informational, never blocking):
  if (!hasAnyValue(study)) {
    info.push({ field: 'values', msg: 'No values captured yet — this article has nothing to analyse.' });
  } else if (!analysisReady(study)) {
    // 116.md §41 — a PROP row with valid events/total is analyzable WITHOUT a stored
    // es/lo/hi (the analysis derives it); say so instead of the contradicting warning.
    // 116.md §46 (r2) — gated on ACTUAL derivation. Every clause of this sentence is
    // only true for a row `poolableStudyView` derives: an events/total source, a value
    // that did not exist before, and a Complete action that really does store it.
    if (derivesPropEffect(study)) {
      info.push({ field: 'es', msg: 'Effect size is derived automatically from events/total for analysis — marking complete also stores it on the row.' });
    } else if (hasStoredEffect(study) && !hasStoredInterval(study)) {
      // 116.md §46 (r2) — the row class that used to receive the derivation message by
      // mistake: a stored effect size runMeta cannot weight. Worded to match
      // analysisEligibility's 'missingCI' reason, so the Analysis tab and this panel
      // describe the same row the same way. study-validator already warns when BOTH
      // bounds are blank; a PARTIALLY filled interval was silent, which is how the
      // false §41 line became the only guidance for that row.
      const ciWarned = warnings.some((w) => /confidence interval/i.test(w.msg));
      if (!ciWarned) {
        info.push({ field: 'lo', msg: 'Effect size has no usable 95% confidence interval — enter both bounds or it cannot be weighted in the meta-analysis.' });
      }
    } else {
      info.push({ field: 'es', msg: 'No effect size yet — this article will not enter the meta-analysis until one is derived.' });
    }
  }
  if (!study.outcome) {
    info.push({ field: 'outcome', msg: 'Outcome is unnamed — name it so this article groups with the same outcome across studies.' });
  }

  return {
    canComplete: blocking.length === 0,
    blocking,
    warnings,
    info,
    progress: progressOf(study),
  };
}

/**
 * completionBlockReason(study) — a short human string when completion is blocked, or
 * '' when it is allowed. Convenience for the server 422 message.
 * @returns {string}
 */
export function completionBlockReason(study = {}) {
  const { canComplete, blocking } = evaluateCompletion(study);
  if (canComplete) return '';
  const first = blocking[0];
  const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : '';
  return `${blocking.length} blocking data check${blocking.length > 1 ? 's' : ''} must be resolved first: ${first.msg}${more}`;
}
