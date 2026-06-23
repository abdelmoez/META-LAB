/**
 * features/pecanSearch — public API (P1 "Search & Discovery").
 *
 * The polished, accessible workspace over the Pecan Search Engine backend
 * (server/pecanSearch). Mirrors the searchBuilder feature module: a thin client
 * (pecanSearchApi.js) + a self-contained tab (PecanSearchTab.jsx). Gated behind
 * the `pecanSearch` feature flag (default OFF) via pecanSearchFlagEnabled.
 */
export { default as PecanSearchTab } from './PecanSearchTab.jsx';
export {
  pecanSearchApi, loadCanonicalQuery, pecanSearchFlagEnabled,
  newIdempotencyKey, runsUrl, reportExportUrl,
} from './pecanSearchApi.js';
