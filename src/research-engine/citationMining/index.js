/**
 * citationMining/index.js — P15 Bibliomine. Public barrel for the pure citation
 * mining + study-visualization engines. Dependency-free (no DOM/React, no network,
 * no Date): safe to import from the server, the client, and unit tests. Reuses the
 * shared screening deduplication engine and the shared countries reference.
 */

export { parseReferences } from './referenceParser.js';
export { dedupeReferences, classifyAgainstExisting } from './citationDedup.js';
export { aggregateStudyGeography } from './studyGeo.js';
export { buildCharacteristicHistograms } from './studyCharacteristics.js';
