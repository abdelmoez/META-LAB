/**
 * provenance/taxonomy.js — 88.md Part I. The single source of truth for the
 * project event ledger's controlled vocabulary: significance levels, change
 * origins, high-level categories, project stages, and the per-event-type registry.
 *
 * Every event type declares the `dependencyKeys` it touches. Those keys are the
 * SAME keys the manuscript engine already fingerprints
 * (src/research-engine/manuscript/dependencies.js DEPENDENCY_KEYS), so an event's
 * manuscript relevance is derived from ONE map instead of a second, drifting copy.
 * classify.js reverses SECTION_DEPENDENCIES to turn dependencyKeys → affected
 * manuscript sections.
 *
 * Pure — no DOM/React/network/Date. Server + client + test safe.
 */

/**
 * Scientific significance (88.md "Scientific Significance Classification").
 * The classifier assigns exactly one level per event; the manuscript layer and
 * History UI both read it. Higher = more likely to matter to the science.
 */
export const SIGNIFICANCE = Object.freeze({
  OPERATIONAL: 0,   // navigation, opening a page, harmless UI state
  ADMINISTRATIVE: 1, // naming, assignments, non-scientific settings
  COSMETIC: 2,      // formatting, chart appearance, manuscript styling
  DATA_CORRECTION: 3, // changes a stored value but may not alter conclusions
  METHODOLOGICAL: 4, // changes how the research was conducted or analyzed
  RESULT_CHANGING: 5, // changes counts, estimates, CIs, heterogeneity, significance
  CRITICAL: 6,      // protocol deviation, eligibility change, dataset/analysis replacement
});

export const SIGNIFICANCE_LABELS = Object.freeze({
  0: 'Operational', 1: 'Administrative', 2: 'Cosmetic / reporting',
  3: 'Data correction', 4: 'Methodological', 5: 'Result-changing',
  6: 'Critical provenance',
});

/** 88.md "Change Origins" — how the event entered the system. */
export const ORIGINS = Object.freeze([
  'user_action', 'bulk_user_action', 'automated_search', 'imported_file',
  'background_process', 'system_recalculation', 'api_integration',
  'manuscript_action', 'administrative', 'migration', 'conflict_resolution',
  'data_correction',
]);

/** 88.md "Event Categories" — high-level taxonomy. */
export const CATEGORIES = Object.freeze([
  'project_config', 'protocol', 'eligibility', 'search_methodology',
  'search_execution', 'record_import', 'deduplication', 'screening',
  'conflict_resolution', 'study_inclusion', 'extraction', 'outcome_config',
  'risk_of_bias', 'statistical_analysis', 'sensitivity_analysis',
  'subgroup_analysis', 'results', 'reporting', 'manuscript', 'references',
  'collaboration', 'permissions', 'export', 'system_recalc', 'data_correction',
]);

/** Project stages an event can affect (aligns with the workflow TABS phases). */
export const PROJECT_STAGES = Object.freeze([
  'planning', 'protocol', 'eligibility', 'search', 'screening', 'extraction',
  'risk_of_bias', 'analysis', 'reporting', 'manuscript', 'collaboration', 'admin',
]);

/** Result-impact tri-state (deterministic numeric detection refines 'possible'→'changed'). */
export const RESULT_IMPACT = Object.freeze({ NONE: 'none', POSSIBLE: 'possible', CHANGED: 'changed' });

const S = SIGNIFICANCE;

/**
 * EVENT_TYPES — the registry. Each entry:
 *   category        one of CATEGORIES
 *   stage           one of PROJECT_STAGES
 *   module          engine that emits it (search|screening|extraction|rob|analysis|manuscript|core)
 *   significance    default SIGNIFICANCE level (classify.js may refine, e.g. no-op → 0)
 *   dependencyKeys  manuscript DEPENDENCY_KEYS this event can invalidate (drives sections)
 *   resultImpact    default RESULT_IMPACT (analysis/data events → 'possible' until numbers compared)
 *   requiresReason  a non-blocking reason prompt is recommended for this change
 *   requiresReview  a human should review manuscript impact before it is treated as final
 */
export const EVENT_TYPES = Object.freeze({
  // ── Project configuration / collaboration / permissions ──────────────────
  PROJECT_CREATED:        { category: 'project_config', stage: 'planning', module: 'core', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none' },
  PROJECT_RENAMED:        { category: 'project_config', stage: 'admin', module: 'core', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none' },
  PROJECT_STATE_BASELINE: { category: 'project_config', stage: 'admin', module: 'core', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none' },
  MEMBER_ADDED:           { category: 'collaboration', stage: 'collaboration', module: 'core', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none' },
  MEMBER_REMOVED:         { category: 'collaboration', stage: 'collaboration', module: 'core', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none' },
  MEMBER_ROLE_CHANGED:    { category: 'permissions', stage: 'admin', module: 'core', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none' },

  // ── Protocol / question / eligibility ────────────────────────────────────
  RESEARCH_QUESTION_CHANGED: { category: 'protocol', stage: 'planning', module: 'core', significance: S.METHODOLOGICAL, dependencyKeys: ['pico.question'], resultImpact: 'none', requiresReason: true },
  PICO_CHANGED:              { category: 'protocol', stage: 'planning', module: 'core', significance: S.METHODOLOGICAL, dependencyKeys: ['pico.question'], resultImpact: 'none', requiresReason: true },
  PROTOCOL_REGISTERED:       { category: 'protocol', stage: 'protocol', module: 'core', significance: S.METHODOLOGICAL, dependencyKeys: ['pico.registration'], resultImpact: 'none' },
  PROTOCOL_UPDATED:          { category: 'protocol', stage: 'protocol', module: 'core', significance: S.METHODOLOGICAL, dependencyKeys: ['pico.registration'], resultImpact: 'none' },
  ELIGIBILITY_CRITERIA_CHANGED: { category: 'eligibility', stage: 'eligibility', module: 'core', significance: S.CRITICAL, dependencyKeys: ['pico.criteria'], resultImpact: 'possible', requiresReason: true, requiresReview: true },

  // ── Search methodology / execution ───────────────────────────────────────
  SEARCH_MODE_CHANGED:            { category: 'search_methodology', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['search.databases', 'search.strategy'], resultImpact: 'none', requiresReason: true },
  DATABASE_SEARCH_METHOD_CHANGED: { category: 'search_methodology', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['search.databases'], resultImpact: 'none', requiresReason: true },
  DATABASE_ADDED:                 { category: 'search_methodology', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['search.databases'], resultImpact: 'possible', requiresReview: true },
  DATABASE_REMOVED:               { category: 'search_methodology', stage: 'search', module: 'search', significance: S.CRITICAL, dependencyKeys: ['search.databases'], resultImpact: 'possible', requiresReason: true, requiresReview: true },
  SEARCH_STRATEGY_UPDATED:        { category: 'search_methodology', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['search.strategy'], resultImpact: 'none' },
  SEARCH_DATE_CHANGED:            { category: 'search_methodology', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['search.date'], resultImpact: 'none' },
  SEARCH_EXECUTED:                { category: 'search_execution', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['search.date', 'prisma.counts'], resultImpact: 'possible', origin: 'automated_search' },
  SEARCH_RERUN:                   { category: 'search_execution', stage: 'search', module: 'search', significance: S.RESULT_CHANGING, dependencyKeys: ['search.date', 'prisma.counts'], resultImpact: 'possible', requiresReview: true },
  SEARCH_RESULTS_IMPORTED:        { category: 'record_import', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['prisma.counts'], resultImpact: 'possible', origin: 'imported_file' },
  CITATION_MINING_RUN:            { category: 'search_execution', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['prisma.counts', 'search.strategy'], resultImpact: 'possible' },
  LIVING_REVIEW_CONFIGURED:       { category: 'search_methodology', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['search.strategy'], resultImpact: 'none' },
  DEDUPLICATION_COMPLETED:        { category: 'deduplication', stage: 'search', module: 'search', significance: S.METHODOLOGICAL, dependencyKeys: ['prisma.counts'], resultImpact: 'possible', origin: 'background_process' },

  // ── Screening ────────────────────────────────────────────────────────────
  SCREENING_WORKFLOW_CHANGED:      { category: 'screening', stage: 'screening', module: 'screening', significance: S.METHODOLOGICAL, dependencyKeys: ['screening.workflow'], resultImpact: 'none', requiresReason: true },
  STUDY_SCREENING_DECISION_CHANGED:{ category: 'screening', stage: 'screening', module: 'screening', significance: S.DATA_CORRECTION, dependencyKeys: ['prisma.counts'], resultImpact: 'possible' },
  FULL_TEXT_EXCLUSION_REASON_CHANGED:{ category: 'screening', stage: 'screening', module: 'screening', significance: S.DATA_CORRECTION, dependencyKeys: ['prisma.counts'], resultImpact: 'possible' },
  SCREENING_CONFLICT_RESOLVED:     { category: 'conflict_resolution', stage: 'screening', module: 'screening', significance: S.DATA_CORRECTION, dependencyKeys: ['prisma.counts'], resultImpact: 'possible', origin: 'conflict_resolution' },

  // ── Study inclusion (roster) ─────────────────────────────────────────────
  STUDY_INCLUDED:              { category: 'study_inclusion', stage: 'screening', module: 'screening', significance: S.RESULT_CHANGING, dependencyKeys: ['studies.roster', 'prisma.counts'], resultImpact: 'possible', requiresReview: true },
  STUDY_EXCLUDED:              { category: 'study_inclusion', stage: 'screening', module: 'screening', significance: S.RESULT_CHANGING, dependencyKeys: ['studies.roster', 'prisma.counts'], resultImpact: 'possible', requiresReason: true, requiresReview: true },
  STUDY_EXCLUDED_FROM_ANALYSIS:{ category: 'study_inclusion', stage: 'analysis', module: 'analysis', significance: S.RESULT_CHANGING, dependencyKeys: ['studies.roster', 'prisma.counts', 'analysis.model'], resultImpact: 'possible', requiresReason: true, requiresReview: true },
  STUDY_INCLUDED_IN_ANALYSIS:  { category: 'study_inclusion', stage: 'analysis', module: 'analysis', significance: S.RESULT_CHANGING, dependencyKeys: ['studies.roster', 'analysis.model'], resultImpact: 'possible', requiresReview: true },

  // ── Extraction / outcomes ────────────────────────────────────────────────
  OUTCOME_DEFINITION_CHANGED:  { category: 'outcome_config', stage: 'extraction', module: 'extraction', significance: S.METHODOLOGICAL, dependencyKeys: ['studies.roster', 'studies.values'], resultImpact: 'possible', requiresReason: true, requiresReview: true },
  EXTRACTED_VALUE_CHANGED:     { category: 'extraction', stage: 'extraction', module: 'extraction', significance: S.DATA_CORRECTION, dependencyKeys: ['studies.values'], resultImpact: 'possible' },
  EXTRACTION_CONVERSION_APPLIED:{ category: 'extraction', stage: 'extraction', module: 'extraction', significance: S.METHODOLOGICAL, dependencyKeys: ['extraction.conversions', 'studies.values'], resultImpact: 'possible' },
  STUDY_LABEL_CORRECTED:       { category: 'data_correction', stage: 'extraction', module: 'extraction', significance: S.DATA_CORRECTION, dependencyKeys: [], resultImpact: 'none', origin: 'data_correction' },

  // ── Risk of bias ─────────────────────────────────────────────────────────
  RISK_OF_BIAS_TOOL_CHANGED:     { category: 'risk_of_bias', stage: 'risk_of_bias', module: 'rob', significance: S.METHODOLOGICAL, dependencyKeys: ['rob.method'], resultImpact: 'none', requiresReason: true },
  RISK_OF_BIAS_JUDGMENT_CHANGED: { category: 'risk_of_bias', stage: 'risk_of_bias', module: 'rob', significance: S.DATA_CORRECTION, dependencyKeys: ['rob.judgments'], resultImpact: 'possible' },

  // ── Statistical analysis ─────────────────────────────────────────────────
  EFFECT_MEASURE_CHANGED:       { category: 'statistical_analysis', stage: 'analysis', module: 'analysis', significance: S.RESULT_CHANGING, dependencyKeys: ['analysis.model', 'studies.values'], resultImpact: 'possible', requiresReason: true, requiresReview: true },
  META_ANALYSIS_MODEL_CHANGED:  { category: 'statistical_analysis', stage: 'analysis', module: 'analysis', significance: S.RESULT_CHANGING, dependencyKeys: ['analysis.model'], resultImpact: 'possible', requiresReason: true, requiresReview: true },
  HETEROGENEITY_ESTIMATOR_CHANGED:{ category: 'statistical_analysis', stage: 'analysis', module: 'analysis', significance: S.METHODOLOGICAL, dependencyKeys: ['analysis.tau2'], resultImpact: 'possible' },
  CONTINUITY_CORRECTION_CHANGED:{ category: 'statistical_analysis', stage: 'analysis', module: 'analysis', significance: S.METHODOLOGICAL, dependencyKeys: ['analysis.model'], resultImpact: 'possible' },
  CONFIDENCE_LEVEL_CHANGED:     { category: 'statistical_analysis', stage: 'analysis', module: 'analysis', significance: S.METHODOLOGICAL, dependencyKeys: ['analysis.model'], resultImpact: 'possible' },
  ANALYSIS_RUN_EXECUTED:        { category: 'statistical_analysis', stage: 'analysis', module: 'analysis', significance: S.METHODOLOGICAL, dependencyKeys: ['analysis.model', 'analysis.tau2'], resultImpact: 'possible', origin: 'system_recalculation' },
  ANALYSIS_STATUS_CHANGED:      { category: 'statistical_analysis', stage: 'analysis', module: 'analysis', significance: S.METHODOLOGICAL, dependencyKeys: ['analysis.model'], resultImpact: 'none' },
  SENSITIVITY_ANALYSIS_EXECUTED:{ category: 'sensitivity_analysis', stage: 'analysis', module: 'analysis', significance: S.METHODOLOGICAL, dependencyKeys: ['analysis.model'], resultImpact: 'possible' },
  SUBGROUP_ANALYSIS_ADDED:      { category: 'subgroup_analysis', stage: 'analysis', module: 'analysis', significance: S.METHODOLOGICAL, dependencyKeys: ['analysis.model'], resultImpact: 'possible', requiresReview: true },
  META_REGRESSION_RUN:          { category: 'statistical_analysis', stage: 'analysis', module: 'analysis', significance: S.METHODOLOGICAL, dependencyKeys: ['analysis.model'], resultImpact: 'possible' },
  PUBLICATION_BIAS_ASSESSED:    { category: 'results', stage: 'analysis', module: 'analysis', significance: S.METHODOLOGICAL, dependencyKeys: ['pubBias.results'], resultImpact: 'possible' },
  GRADE_CERTAINTY_CHANGED:      { category: 'results', stage: 'analysis', module: 'analysis', significance: S.DATA_CORRECTION, dependencyKeys: ['grade.certainty'], resultImpact: 'possible' },

  // ── Results / reporting ──────────────────────────────────────────────────
  PRISMA_COUNTS_CHANGED:  { category: 'reporting', stage: 'reporting', module: 'core', significance: S.RESULT_CHANGING, dependencyKeys: ['prisma.counts'], resultImpact: 'changed', origin: 'system_recalculation' },
  RESULTS_RECALCULATED:   { category: 'system_recalc', stage: 'analysis', module: 'analysis', significance: S.RESULT_CHANGING, dependencyKeys: ['analysis.model'], resultImpact: 'possible', origin: 'system_recalculation' },
  EXPORT_GENERATED:       { category: 'export', stage: 'reporting', module: 'core', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none' },
  CHART_APPEARANCE_CHANGED:{ category: 'reporting', stage: 'reporting', module: 'core', significance: S.COSMETIC, dependencyKeys: [], resultImpact: 'none' },
  TEMPLATE_STYLE_CHANGED: { category: 'reporting', stage: 'manuscript', module: 'manuscript', significance: S.COSMETIC, dependencyKeys: ['template.style'], resultImpact: 'none' },

  // ── Manuscript ───────────────────────────────────────────────────────────
  MANUSCRIPT_SECTION_REGENERATED: { category: 'manuscript', stage: 'manuscript', module: 'manuscript', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none', origin: 'manuscript_action' },
  MANUSCRIPT_SECTION_EDITED:      { category: 'manuscript', stage: 'manuscript', module: 'manuscript', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none', origin: 'manuscript_action' },
  MANUSCRIPT_UPDATE_ACCEPTED:     { category: 'manuscript', stage: 'manuscript', module: 'manuscript', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none', origin: 'manuscript_action' },
  MANUSCRIPT_UPDATE_REJECTED:     { category: 'manuscript', stage: 'manuscript', module: 'manuscript', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none', origin: 'manuscript_action' },
  MANUSCRIPT_SECTION_LOCKED:      { category: 'manuscript', stage: 'manuscript', module: 'manuscript', significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none', origin: 'manuscript_action' },

  // ── Deviations ───────────────────────────────────────────────────────────
  PROTOCOL_DEVIATION_FLAGGED: { category: 'protocol', stage: 'protocol', module: 'core', significance: S.CRITICAL, dependencyKeys: ['pico.registration'], resultImpact: 'none', requiresReview: true },
});

export const EVENT_TYPE_IDS = Object.keys(EVENT_TYPES);

/** Metadata for an event type, or a safe default for an unknown/custom type. */
export function eventTypeMeta(eventType) {
  return EVENT_TYPES[eventType] || {
    category: 'project_config', stage: 'admin', module: 'core',
    significance: S.ADMINISTRATIVE, dependencyKeys: [], resultImpact: 'none',
  };
}

export function isValidEventType(eventType) {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPES, eventType);
}

export function isValidOrigin(origin) {
  return ORIGINS.includes(origin);
}

export default {
  SIGNIFICANCE, SIGNIFICANCE_LABELS, ORIGINS, CATEGORIES, PROJECT_STAGES,
  RESULT_IMPACT, EVENT_TYPES, EVENT_TYPE_IDS, eventTypeMeta, isValidEventType,
  isValidOrigin,
};
