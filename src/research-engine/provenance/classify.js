/**
 * provenance/classify.js — 88.md "Scientific Significance Classification" +
 * "Manuscript Relevance Classification". Deterministic, rule-based (NOT LLM):
 * given an event draft it assigns a significance level, the affected manuscript
 * sections, result-impact, and the recalc/refresh/review flags.
 *
 * Manuscript relevance is derived by REVERSING the manuscript engine's existing
 * SECTION_DEPENDENCIES map (src/research-engine/manuscript/dependencies.js) — the
 * ONE place that knows "which section depends on which project fact" — so the two
 * systems can never disagree.
 *
 * Pure — no DOM/React/network/Date.
 */

import { SECTION_DEPENDENCIES } from '../manuscript/dependencies.js';
import { eventTypeMeta, SIGNIFICANCE, RESULT_IMPACT } from './taxonomy.js';

/** Reverse index: dependency key → manuscript section ids that consume it. */
const KEY_TO_SECTIONS = (() => {
  const idx = {};
  for (const [section, keys] of Object.entries(SECTION_DEPENDENCIES)) {
    for (const k of keys) (idx[k] || (idx[k] = new Set())).add(section);
  }
  const out = {};
  for (const k of Object.keys(idx)) out[k] = Array.from(idx[k]);
  return Object.freeze(out);
})();

const SECTION_ORDER = ['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion'];

/** Manuscript sections affected by a set of dependency keys, in canonical order. */
export function manuscriptSectionsForKeys(keys) {
  const set = new Set();
  for (const k of (Array.isArray(keys) ? keys : [])) {
    for (const s of (KEY_TO_SECTIONS[k] || [])) set.add(s);
  }
  return SECTION_ORDER.filter((s) => set.has(s));
}

/** True when a structured diff carries no actual change (no-op). */
export function diffIsEmpty(diff) {
  if (!diff || typeof diff !== 'object') return false;
  if (diff.kind === 'scalar') {
    const a = JSON.stringify(diff.prev ?? null);
    const b = JSON.stringify(diff.next ?? null);
    return a === b;
  }
  if (diff.kind === 'object') {
    return Object.keys(diff.changed || {}).length === 0 && (diff.added || []).length === 0 && (diff.removed || []).length === 0;
  }
  if (diff.kind === 'array') return diff.addedCount === 0 && diff.removedCount === 0 && diff.prevLen === diff.nextLen;
  return false;
}

const RECALC_KEYS = new Set(['studies.values', 'studies.roster', 'analysis.model', 'analysis.tau2', 'prisma.counts', 'extraction.conversions']);

/**
 * classifyEvent(draft, opts) → the classification block merged into the event.
 * opts.numericChange (optional): 'changed' | 'none' from a deterministic numeric
 * comparison (e.g. statistics/evidenceShift) — upgrades resultImpact from the
 * type's default 'possible'. opts.noop forces the operational L0 path.
 *
 * @returns {{ category, stage, module, significance, manuscriptSections:string[],
 *   resultImpact, requiresRecalc, requiresManuscriptRefresh, requiresReview, origin }}
 */
export function classifyEvent(draft = {}, opts = {}) {
  const meta = eventTypeMeta(draft.eventType);
  const noop = opts.noop === true || diffIsEmpty(draft.diff);

  // No-op (a selection immediately reverted, a save with no scientific delta) →
  // operational, invisible to the manuscript. Still recordable for the raw audit.
  if (noop) {
    return {
      category: meta.category, stage: meta.stage, module: meta.module,
      significance: SIGNIFICANCE.OPERATIONAL, manuscriptSections: [],
      resultImpact: RESULT_IMPACT.NONE, requiresRecalc: false,
      requiresManuscriptRefresh: false, requiresReview: false,
      origin: draft.origin || meta.origin || 'user_action', noop: true,
    };
  }

  const significance = draft.significance != null ? draft.significance : meta.significance;
  const depKeys = meta.dependencyKeys || [];
  const manuscriptSections = manuscriptSectionsForKeys(depKeys);

  // resultImpact: type default, upgraded/cleared by a deterministic numeric result.
  let resultImpact = meta.resultImpact || RESULT_IMPACT.NONE;
  if (opts.numericChange === 'changed') resultImpact = RESULT_IMPACT.CHANGED;
  else if (opts.numericChange === 'none' && resultImpact === RESULT_IMPACT.POSSIBLE) resultImpact = RESULT_IMPACT.NONE;

  const touchesRecalc = depKeys.some((k) => RECALC_KEYS.has(k));
  const requiresRecalc = touchesRecalc && resultImpact !== RESULT_IMPACT.NONE;

  // The manuscript only refreshes for real scientific content (>= data-correction)
  // that maps to a section — cosmetic/admin/operational never pollute it.
  const requiresManuscriptRefresh = manuscriptSections.length > 0 && significance >= SIGNIFICANCE.DATA_CORRECTION;

  const requiresReview = !!meta.requiresReview
    || significance >= SIGNIFICANCE.CRITICAL
    || resultImpact === RESULT_IMPACT.CHANGED;

  return {
    category: meta.category, stage: meta.stage, module: meta.module,
    significance, manuscriptSections, resultImpact,
    requiresRecalc, requiresManuscriptRefresh, requiresReview,
    origin: draft.origin || meta.origin || 'user_action', noop: false,
  };
}

/** Convenience: return a full event object = draft + classification. Pure. */
export function classifyDraft(draft, opts) {
  return { ...draft, ...classifyEvent(draft, opts) };
}

export { KEY_TO_SECTIONS };
export default { classifyEvent, classifyDraft, manuscriptSectionsForKeys, diffIsEmpty, KEY_TO_SECTIONS };
