/**
 * manuscript/index.js — 64.md (P3). Public barrel for the pure manuscript engine.
 * Everything here is dependency-free (no DOM/React) and importable from the server,
 * the client, and unit tests. The CLIENT-side .docx/.zip exporters live in
 * src/features/manuscript/ (they need browser canvas to rasterize figures).
 */

export * from './model.js';
export * from './sourceHash.js';
export * from './prismaCounts.js';
export * from './citations.js';
export * from './tables.js';
export * from './draft.js';
export * from './prismaChecklist.js';
export * from './readiness.js';
export * from './abstractSections.js';
// 73.md Part 8 — synthesis-model wording, per-section provenance, consistency checks.
export * from './analysisDescribe.js';
export * from './sources.js';
export * from './consistency.js';
