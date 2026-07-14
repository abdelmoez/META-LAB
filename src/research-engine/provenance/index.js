/**
 * provenance/index.js — 88.md. Public barrel for the pure research-provenance
 * engine: the append-only event ledger's controlled vocabulary (taxonomy), the
 * deterministic significance/manuscript-relevance classifier, the generic
 * before→after emitter, immutable analysis-run resolution, and the derived
 * scientific-state consolidation.
 *
 * Everything here is dependency-light (imports only the manuscript engine's
 * SECTION_DEPENDENCIES for the reverse map) and importable from the server, the
 * client, and unit tests. NO DOM/React/network/Date.
 */

export * from './taxonomy.js';
export * from './diff.js';
export * from './fingerprint.js';
export * from './emit.js';
export * from './classify.js';
export * from './analysisRuns.js';
export * from './derivedState.js';
