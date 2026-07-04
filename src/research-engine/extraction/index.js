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
 * RoadMap/1.md unified workspace additions (protocol-scoped, PDF-driven):
 *   protocolOutcomes.js — the review's pre-specified primary/secondary outcomes
 *   outcomeMatch.js     — conservative outcome-name matching (synonyms/dictionary)
 *   patternExtract.js   — richer deterministic statistic harvesting from text
 *   pdfTextGrid.js      — pdf.js text items → row/column table grids
 *   records.js          — canonical per-outcome extraction record ⇄ mkStudy row
 *   autoExtract.js      — Method 1: protocol-scoped deterministic first pass
 *   digitizer/*         — plot digitizer math (axis calibration, figures, KM/Guyot)
 *
 * KEY FORMAT shared across the engine: `${elementId}::${armKey || ''}` (model.valueKey).
 */

export * from './model.js';
export * from './conflicts.js';
export * from './tableParse.js';
export * from './heuristicExtract.js';
export * from './validationMetrics.js';
export * from './maHandoff.js';
export * from './protocolOutcomes.js';
export * from './outcomeMatch.js';
export * from './patternExtract.js';
export * from './pdfTextGrid.js';
export * from './records.js';
export * from './autoExtract.js';
export * from './digitizer/calibration.js';
export * from './digitizer/figureExtract.js';
export * from './digitizer/kmGuyot.js';
