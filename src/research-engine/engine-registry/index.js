/**
 * engine-registry/index.js — barrel re-export for the pure engine-version core.
 *
 * Import everything from here:
 *   import {
 *     bumpVersion, formatVersion, parseVersion, compareVersion,
 *     ENGINES, ENGINE_IDS, ENGINE_BY_ID, isEngineId, INITIAL_VERSION,
 *     classifyPaths, classifyChanges,
 *     parseManifest, parseCommitFooters, validateDeclarations,
 *   } from './research-engine/engine-registry/index.js';
 */

export * from './version.js';
export * from './engines.js';
export * from './ownership.js';
export * from './classify.js';
export * from './manifest.js';
