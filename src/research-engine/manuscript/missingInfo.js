/**
 * manuscript/missingInfo.js — 84.md Part 19. Aggregates the actionable
 * "the manuscript needs a fact the project does not contain" prompts. It rolls up
 * the per-section missing[] hints from sources.computeSectionInputs (deduped by
 * field, remembering which sections each gap affects) and adds a few project-level
 * rules (unpersisted analysis model, empty search date / registration, a
 * template-required funding statement). Each entry carries a resolveAt stage so the
 * UI can deep-link the researcher to the right tab to fix the source (never store a
 * manuscript-only copy — 84.md Part 19).
 *
 * collectMissingInfo(project, draft, opts) → [{ field, hint, sections:[ids],
 * resolveAt }]. Pure — no DOM/React/network.
 */

import { computeSectionInputs } from './sources.js';
import { JOURNAL_TEMPLATES, SECTION_IDS } from './model.js';

const clean = (s) => String(s == null ? '' : s).trim();

/** Map a source field name to the project stage where it is fixed. */
export function resolveAtFor(field) {
  const f = String(field || '');
  if (f === 'protocol' || f.startsWith('pico.')) return 'protocol';
  if (f.startsWith('search')) return 'search';
  if (f === 'screening' || f === 'reviewers') return 'screening';
  if (f.startsWith('rob')) return 'rob';
  if (f === 'analysis' || f === 'pubBias' || f.startsWith('analysisSettings')) return 'analysis';
  return 'manuscript';
}

export function collectMissingInfo(project, draft, opts = {}) {
  const p = project || {};
  const all = computeSectionInputs(p, opts);
  const map = new Map(); // field → { field, hint, sections:Set, resolveAt }

  const add = (field, hint, sectionId) => {
    if (!field) return;
    let e = map.get(field);
    if (!e) { e = { field, hint: hint || '', sections: new Set(), resolveAt: resolveAtFor(field) }; map.set(field, e); }
    if (sectionId) e.sections.add(sectionId);
    if (!e.hint && hint) e.hint = hint;
  };

  // 1) Aggregate the per-section missing hints (order = section order).
  for (const id of SECTION_IDS) {
    const entry = all[id];
    if (!entry || !Array.isArray(entry.missing)) continue;
    for (const m of entry.missing) add(m.field, m.hint, id);
  }

  // 2) Project-level rules (deduped by field via add()).
  const tau2Set = !!(p.analysisSettings && clean(p.analysisSettings.tau2Method));
  if (!tau2Set) {
    add('analysisSettings.tau2Method',
      'The synthesis model / heterogeneity estimator is not persisted — set it in the Analysis tab so Methods can describe it.',
      'methods');
    map.get('analysisSettings.tau2Method').resolveAt = 'analysis';
  }
  if (!clean(p.search && p.search.date)) {
    add('search.date', 'The final search date is not recorded.', 'methods');
    map.get('search.date').sections.add('abstract');
  }
  if (!clean(p.pico && p.pico.prosperoId)) {
    add('pico.prosperoId', 'A PROSPERO registration number completes the registration statement.', 'methods');
  }
  const tpl = JOURNAL_TEMPLATES.find((t) => t.id === (opts.templateId || (draft && draft.templateId)));
  const requiresFunding = !!(tpl && Array.isArray(tpl.requiredStatements) && tpl.requiredStatements.includes('funding'));
  const fundingText = clean(draft && draft.statements && draft.statements.funding);
  if (requiresFunding && !fundingText) {
    add('statements.funding', 'This journal template requires a funding statement.', 'methods');
    map.get('statements.funding').resolveAt = 'manuscript';
  }

  return [...map.values()].map((e) => ({
    field: e.field,
    hint: e.hint,
    sections: [...e.sections],
    resolveAt: e.resolveAt,
  }));
}

export default { collectMissingInfo, resolveAtFor };
