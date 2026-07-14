/**
 * features/provenance/format.js — 88.md Part IV. PURE presentation helpers for the
 * Project History UI: human-readable event titles, significance badge tone/label,
 * manuscript-impact summary, and a compact before→after string. Mirrors the shared
 * auditFormat.js catalogue pattern. No React/DOM — unit-testable.
 */
import { SIGNIFICANCE_LABELS } from '../../research-engine/provenance/taxonomy.js';

/** Human titles for the common event types (fallback humanizes the raw type). */
export const EVENT_TITLES = Object.freeze({
  PROJECT_CREATED: 'Project created',
  PROJECT_RENAMED: 'Project renamed',
  PROJECT_STATE_BASELINE: 'Project history baseline created',
  MEMBER_ROLE_CHANGED: 'Member role changed',
  RESEARCH_QUESTION_CHANGED: 'Review question changed',
  PICO_CHANGED: 'PICO changed',
  PROTOCOL_REGISTERED: 'Protocol registered',
  PROTOCOL_UPDATED: 'Protocol updated',
  ELIGIBILITY_CRITERIA_CHANGED: 'Eligibility criteria changed',
  SEARCH_MODE_CHANGED: 'Search mode changed',
  DATABASE_SEARCH_METHOD_CHANGED: 'Database search method changed',
  DATABASE_ADDED: 'Database added',
  DATABASE_REMOVED: 'Database removed',
  SEARCH_STRATEGY_UPDATED: 'Search strategy updated',
  SEARCH_DATE_CHANGED: 'Search date changed',
  SEARCH_EXECUTED: 'Search executed',
  SEARCH_RERUN: 'Search re-run',
  SEARCH_RESULTS_IMPORTED: 'Search results imported',
  DEDUPLICATION_COMPLETED: 'Deduplication completed',
  SCREENING_WORKFLOW_CHANGED: 'Screening workflow changed',
  STUDY_SCREENING_DECISION_CHANGED: 'Screening decision changed',
  FULL_TEXT_EXCLUSION_REASON_CHANGED: 'Full-text exclusion reason changed',
  STUDY_INCLUDED: 'Study included',
  STUDY_EXCLUDED: 'Study removed',
  STUDY_INCLUDED_IN_ANALYSIS: 'Study included in analysis',
  STUDY_EXCLUDED_FROM_ANALYSIS: 'Study excluded from analysis',
  OUTCOME_DEFINITION_CHANGED: 'Outcome definition changed',
  EXTRACTED_VALUE_CHANGED: 'Extracted value changed',
  EXTRACTION_CONVERSION_APPLIED: 'Statistical conversion applied',
  STUDY_LABEL_CORRECTED: 'Study label corrected',
  RISK_OF_BIAS_TOOL_CHANGED: 'Risk-of-bias tool changed',
  RISK_OF_BIAS_JUDGMENT_CHANGED: 'Risk-of-bias judgment changed',
  EFFECT_MEASURE_CHANGED: 'Effect measure changed',
  META_ANALYSIS_MODEL_CHANGED: 'Meta-analysis model changed',
  HETEROGENEITY_ESTIMATOR_CHANGED: 'Heterogeneity estimator changed',
  CONTINUITY_CORRECTION_CHANGED: 'Continuity correction changed',
  CONFIDENCE_LEVEL_CHANGED: 'Confidence level changed',
  ANALYSIS_RUN_EXECUTED: 'Analysis run executed',
  ANALYSIS_STATUS_CHANGED: 'Analysis status changed',
  SENSITIVITY_ANALYSIS_EXECUTED: 'Sensitivity analysis executed',
  SUBGROUP_ANALYSIS_ADDED: 'Subgroup analysis added',
  META_REGRESSION_RUN: 'Meta-regression run',
  PUBLICATION_BIAS_ASSESSED: 'Publication bias assessed',
  GRADE_CERTAINTY_CHANGED: 'GRADE certainty changed',
  PRISMA_COUNTS_CHANGED: 'PRISMA counts changed',
  CHART_APPEARANCE_CHANGED: 'Chart appearance changed',
  TEMPLATE_STYLE_CHANGED: 'Manuscript template/style changed',
  MANUSCRIPT_SECTION_REGENERATED: 'Manuscript section regenerated',
  MANUSCRIPT_SECTION_EDITED: 'Manuscript section edited',
  PROTOCOL_DEVIATION_FLAGGED: 'Potential protocol deviation',
  EXPORT_GENERATED: 'Export generated',
});

/** Humanize an unknown SCREAMING_SNAKE type → 'Title case'. */
export function humanizeType(t) {
  return String(t || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function eventTitle(event) {
  const t = event && event.eventType;
  return EVENT_TITLES[t] || humanizeType(t);
}

/** Significance → { tone, label } for a badge (tones align with StitchBadge). */
export function significanceBadge(level) {
  const label = SIGNIFICANCE_LABELS[level] || 'Change';
  let tone = 'neutral';
  if (level >= 6) tone = 'danger';
  else if (level >= 5) tone = 'warn';
  else if (level >= 4) tone = 'info';
  else if (level >= 3) tone = 'brand';
  else tone = 'neutral';
  return { tone, label, level };
}

const SECTION_LABELS = {
  title: 'Title', abstract: 'Abstract', introduction: 'Introduction', methods: 'Methods',
  results: 'Results', discussion: 'Discussion', limitations: 'Limitations', conclusion: 'Conclusion',
};

/** Manuscript-impact summary line for an event. */
export function manuscriptImpact(event) {
  const secs = Array.isArray(event && event.manuscriptSections) ? event.manuscriptSections : [];
  if (!secs.length) return null;
  const names = secs.map((s) => SECTION_LABELS[s] || s);
  const verb = event.resultImpact === 'changed' ? 'updated' : 'may need updating';
  return `${names.join(', ')} ${verb}`;
}

const short = (v) => {
  if (v == null) return '∅';
  if (typeof v === 'object') {
    if (v.__truncated || v.__array) return `[${v.__size} items]`;
    try { const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 77) + '…' : s; } catch { return '[object]'; }
  }
  const s = String(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
};

/** Compact "before → after" for the row (null when not meaningful). */
export function beforeAfter(event) {
  if (event == null) return null;
  const { prevValue, newValue } = event;
  if (prevValue == null && newValue == null) return null;
  return { prev: short(prevValue), next: short(newValue) };
}

/** Origin → short human label. */
export function originLabel(origin) {
  const map = {
    user_action: 'User', bulk_user_action: 'Bulk action', automated_search: 'Automated search',
    imported_file: 'Import', background_process: 'Background', system_recalculation: 'Recalculation',
    api_integration: 'API', manuscript_action: 'Manuscript', administrative: 'Admin',
    migration: 'Migration', conflict_resolution: 'Conflict resolution', data_correction: 'Correction',
  };
  return map[origin] || 'User';
}

export default { EVENT_TITLES, eventTitle, humanizeType, significanceBadge, manuscriptImpact, beforeAfter, originLabel };
