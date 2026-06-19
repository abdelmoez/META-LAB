/**
 * features/searchBuilder — public API (prompt: SearchEngine).
 *
 * The concept→multi-database Search Builder, modularized out of the monolith. The
 * SearchBuilderTab engine is self-contained (do NOT edit its syntax renderers —
 * see .claude/SearchEngine/INTEGRATION_README.md); only its 4 seams are wired
 * here. Persists per project via the separated /api/search-builder backend.
 */
export { default as SearchBuilderTab } from './SearchBuilderTab.jsx';
export { searchBuilderApi, loadSearch, saveSearch, searchEngineFlagEnabled } from './searchBuilderApi.js';
