/**
 * extraction/index.js — P5. Public barrel for the pure structured-extraction
 * engine. Everything here is dependency-free (no DOM/React) and importable from the
 * server, the client, and unit tests. Server/UI wiring lives elsewhere; this layer
 * is only the logic.
 *
 * Modules:
 *   model.js            — Data Element model, templates, value validation/normalization
 *   conflicts.js        — double-extraction reconciliation (compare/summarize)
 *   tableParse.js       — delimited + HTML table parsing, grid-quality scoring
 *   heuristicExtract.js — deterministic regex extraction assistant (the non-LLM default)
 *   validationMetrics.js— scoring an extractor against a gold standard
 *   maHandoff.js        — reconciled values → mkStudy blob patch (+ calcES es/lo/hi)
 *
 * KEY FORMAT shared across the engine: `${elementId}::${armKey || ''}` (model.valueKey).
 */

export * from './model.js';
export * from './conflicts.js';
export * from './tableParse.js';
export * from './heuristicExtract.js';
export * from './validationMetrics.js';
export * from './maHandoff.js';
