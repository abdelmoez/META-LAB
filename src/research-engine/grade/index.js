/**
 * grade/index.js — P12 barrel. Pure, deterministic GRADE certainty engine.
 *
 * Formalises the app's existing GRADE logic (GRADE_OPTIONS + gradeSuggestions in
 * the monolith; rob/gradeSync.js) into one engine-agnostic model:
 *   - gradeModel  — domains, ratings, starting certainty, computeCertainty.
 *   - gradeSuggest— evidence-linked domain suggestions (reviewer overrides).
 *   - sof         — per-outcome certainty map + footnotes for the manuscript SoF.
 *   - cinema      — CINeMA ↔ engine-domain mapping so NMA can reuse the model.
 */
export * from './gradeModel.js';
export * from './gradeSuggest.js';
export * from './sof.js';
export * from './cinema.js';
