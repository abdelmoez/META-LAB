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
    info.push({ field: 'es', msg: 'No effect size yet — this article will not enter the meta-analysis until one is derived.' });
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
