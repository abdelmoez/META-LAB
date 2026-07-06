/**
 * extraction/engine/articleStatus.js — 76.md (Pecan Extraction Engine).
 *
 * PURE, dependency-light helpers that turn one blob study row (mkStudy shape) plus
 * its additive `extractionMeta` namespace into the article-level STATUS and PROGRESS
 * the new engine's article list (§6) and workspace toolbar (§7) display.
 *
 * WHY ADDITIVE META: the engine never changes the mkStudy contract — analysis and
 * legacy code keep reading `studies[]` unchanged. Engine bookkeeping lives under
 * `study.extractionMeta` (completion, lock, sync, provenance, assignment). A study
 * that has never touched the engine simply has no `extractionMeta` — it degrades to
 * "not started" / "in progress" derived purely from its values.
 *
 * No DOM/IO/Date.now/Math.random — safe to import from server, client and tests.
 */

import { validateStudy } from '../../validation/study-validator.js';

/** The article statuses the engine models (76.md §6). Order = rough workflow order. */
export const ARTICLE_STATUSES = Object.freeze([
  'not_started', 'in_progress', 'validation_required', 'ready_for_review',
  'complete', 'locked',
]);

/** Human labels + a semantic tone for the UI badges. */
export const STATUS_META = Object.freeze({
  not_started:         { label: 'Not started',        tone: 'neutral' },
  in_progress:         { label: 'In progress',        tone: 'info' },
  validation_required: { label: 'Validation required', tone: 'warn' },
  ready_for_review:    { label: 'Ready for review',   tone: 'brand' },
  complete:            { label: 'Complete',           tone: 'success' },
  locked:              { label: 'Locked',             tone: 'neutral' },
});

const nonEmpty = (v) => v !== '' && v !== null && v !== undefined;

/**
 * expectedFieldsFor(study) — the canonical set of value fields this article is
 * expected to carry, given its effect measure. Used for the completed-field count
 * and progress percentage. Always includes the identity/scope fields; the numeric
 * group is chosen by esType (falling back to a generic es/lo/hi when unset).
 * @returns {string[]}
 */
export function expectedFieldsFor(study = {}) {
  const base = ['author', 'year', 'outcome', 'esType', 'timepoint'];
  const t = study.esType || '';
  if (t === 'OR' || t === 'RR') return [...base, 'a', 'b', 'c', 'd'];
  if (t === 'PROP') return [...base, 'events', 'total'];
  if (t === 'SMD' || t === 'MD') return [...base, 'nExp', 'meanExp', 'sdExp', 'nCtrl', 'meanCtrl', 'sdCtrl'];
  if (t === 'DIAG') return [...base, 'tp', 'fp', 'fn', 'tn'];
  if (t === 'HR' || t === 'COR' || t === 'IRR' || t === 'BETA' || t === 'AUC' || t === 'GENERIC') return [...base, 'es', 'lo', 'hi'];
  // No measure chosen yet — count the generic effect slot so a hand-entered es/CI still moves the bar.
  return [...base, 'es', 'lo', 'hi'];
}

/**
 * progressOf(study) — completed-field count + percentage over expectedFieldsFor.
 * @returns {{ filledFields:number, totalFields:number, pct:number, fields:string[] }}
 */
export function progressOf(study = {}) {
  const fields = expectedFieldsFor(study);
  const filled = fields.filter((k) => nonEmpty(study[k]));
  const totalFields = fields.length;
  const filledFields = filled.length;
  const pct = totalFields ? Math.round((filledFields / totalFields) * 100) : 0;
  return { filledFields, totalFields, pct, fields };
}

/** True when a study carries ANY captured value (raw or effect). */
export function hasAnyValue(study = {}) {
  const VALS = ['n', 'nExp', 'nCtrl', 'meanExp', 'sdExp', 'meanCtrl', 'sdCtrl',
    'a', 'b', 'c', 'd', 'events', 'total', 'tp', 'fp', 'fn', 'tn', 'es', 'lo', 'hi'];
  return VALS.some((k) => nonEmpty(study[k]));
}

/**
 * validationSummary(study) — counts of blocking errors vs warnings for this study,
 * from the shared pure validator. `issues` is the raw list for drill-down.
 * @returns {{ errors:number, warnings:number, issues:Array }}
 */
export function validationSummary(study = {}) {
  const issues = validateStudy(study) || [];
  let errors = 0, warnings = 0;
  for (const i of issues) { if (i.sev === 'error') errors++; else warnings++; }
  return { errors, warnings, issues };
}

/**
 * articleStatusOf(study) — the single canonical status for the article list/toolbar.
 * Precedence: locked → complete → validation_required (blocking errors) →
 * ready_for_review (flagged) → in_progress (any value) → not_started.
 * Reads `study.extractionMeta` for completion/lock/ready flags.
 * @returns {string} one of ARTICLE_STATUSES
 */
export function articleStatusOf(study = {}) {
  const meta = study.extractionMeta || {};
  if (meta.locked) return 'locked';
  if (meta.completedAt) return 'complete';
  const { errors } = validationSummary(study);
  if (errors > 0) return 'validation_required';
  if (meta.readyForReview) return 'ready_for_review';
  if (hasAnyValue(study) || nonEmpty(study.outcome)) return 'in_progress';
  return 'not_started';
}
