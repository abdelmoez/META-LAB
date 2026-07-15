/**
 * shared/access/index.js — 91.md. Public barrel for the pure access-state engine:
 * the restriction-type vocabulary, the AccessDecision model + structured HTTP body
 * (+ client parse-back), the capability registry, and the one resolver both the
 * frontend and backend call. No DOM/React/network — importable everywhere.
 */
export * from './restrictionTypes.js';
export * from './accessDecision.js';
export * from './capabilities.js';
export * from './resolveAccess.js';
