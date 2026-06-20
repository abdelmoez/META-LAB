/**
 * features/searchBuilder — public API (prompt: SearchEngine).
 *
 * The concept→multi-database Search Builder, modularized out of the monolith. The
 * SearchBuilderTab engine is self-contained (do NOT edit its syntax renderers —
 * see .claude/SearchEngine/INTEGRATION_README.md); only its 4 seams are wired
 * here. Persists per project via the separated /api/search-builder backend.
 */
export { default as SearchBuilderTab } from './SearchBuilderTab.jsx';
// prompt42 — pure helpers exported for unit tests (hit-status hash, relative time,
// and the `ignored` legacy→object normalizer used by the granular term restore).
export { strategyHash, relativeTime, normalizeIgnored, normalizeIgnoredEntry } from './SearchBuilderTab.jsx';
export { localMeshSuggestions } from '../../research-engine/searchBuilder/meshSuggest.js';
export { searchBuilderApi, loadSearch, saveSearch, searchEngineFlagEnabled } from './searchBuilderApi.js';
