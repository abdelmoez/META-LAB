/**
 * manuscript/index.js — 64.md (P3). Public barrel for the pure manuscript engine.
 * Everything here is dependency-free (no DOM/React) and importable from the server,
 * the client, and unit tests. The CLIENT-side .docx/.zip exporters live in
 * src/features/manuscript/ (they need browser canvas to rasterize figures).
 */

export * from './model.js';
// 119.md §7 — the template registry: reporting STRUCTURES (section sets layered
// over the closed core registry, each carrying its guideline + version + reviewed
// date), the journal-PROFILE provenance layer, and the pure switch/preview/apply
// primitives. Structure ≠ journal profile ≠ citation style — three dimensions.
export * from './templates.js';
export * from './sourceHash.js';
export * from './prismaCounts.js';
export * from './citations.js';
// 117.md §26-§33 + §88 — THE reference resolver seam (derived included studies +
// the project-level overlay), its pure overlay writers, and the undo/audit model
// those writers are recorded through. No name collides with anything else here.
export * from './referenceLibrary.js';
export * from './tables.js';
export * from './draft.js';
export * from './prismaChecklist.js';
export * from './readiness.js';
export * from './abstractSections.js';
// 73.md Part 8 — synthesis-model wording, per-section provenance, consistency checks.
export * from './analysisDescribe.js';
export * from './sources.js';
export * from './consistency.js';
// 84.md — live project synchronization: engine versions, dependency graph, safe
// sync/review workflow, contradiction + missing-info detection, snapshots, freshness.
export * from './versions.js';
export * from './dependencies.js';
export * from './syncPlan.js';
export * from './contradictions.js';
export * from './missingInfo.js';
export * from './snapshots.js';
export * from './freshness.js';
// 85.md Objective 2 (B1) — asset registry, structured [[table:…]]/[[figure:…]]
// references, block-level placement model and pre-export validation.
export * from './assets.js';
export * from './refTokens.js';
export * from './placement.js';
export * from './exportValidation.js';
// 101.md §5/§8/§9/§10 — live, sentence-level project facts: the [[fact:…]] token
// layer that keeps methodology current without ever rewriting human prose, and the
// provenance/revert history layered over it.
export * from './factTokens.js';
export * from './factProvenance.js';
// 108.md §6 — the pure capture/apply/compare primitives the project-wide history
// uses to reverse the two undoable STRUCTURED manuscript mutations (section lock,
// fact pin). Prose keeps native undo — see the module header.
export * from './historyOps.js';
// 102.md — manual-input placeholders: precise detection (default-deny, so the
// square brackets of scientific notation are never claimed), counts, grouping and
// prev/next navigation.
export * from './placeholders.js';
