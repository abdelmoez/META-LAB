/**
 * prisma/index.js — 103.md. Public barrel for the PRISMA study-selection
 * provenance system: the record-level model, the single deriver every consumer
 * reads, the structural reconciliation engine, and the projection layer that maps
 * PecanRev's tables onto it.
 *
 * Everything here is pure (no DOM/React/network/Prisma) and importable from the
 * server, the client and unit tests.
 */
export * from './model.js';
export * from './derive.js';
export * from './reconcile.js';
export * from './projection.js';
