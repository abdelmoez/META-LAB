/**
 * extraction/engine/index.js — 76.md (Pecan Extraction Engine) pure-logic barrel.
 *
 * A SEPARATE barrel from ../index.js (the 66.md structured-extraction engine) so the
 * new engine's article-status / provenance / sync / completion / list helpers can be
 * deep-imported without risking `export *` name collisions with the older layer.
 * Everything here is dependency-light (imports only sibling pure modules + the shared
 * validator) — safe for server, client and unit tests.
 */

export * from './articleStatus.js';
export * from './articleProvenance.js';
export * from './syncState.js';
export * from './completionGate.js';
export * from './articleList.js';
