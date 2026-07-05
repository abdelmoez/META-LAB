/**
 * features/searchWorkspace — public API (71.md).
 *
 * The staged, progressive-disclosure Search Workspace: a COMPOSITION redesign of the
 * 3-step SearchWizard that keeps every feature by reusing the existing Search Builder,
 * Pecan Search and reproducibility/quality/studio components unchanged. Gated behind the
 * `searchWorkspaceV2` flag (OFF by default) at the dispatcher; when OFF the legacy
 * SearchWizard renders unchanged.
 */
export { default as SearchWorkspace } from './SearchWorkspace.jsx';
// 73.md/74.md/75.md — pure/presentational seams exported for unit tests. The stage
// table + the mode-scoped stage list (single source of truth for the visible
// workflow — shared with the white side-menu via navConfig) + the mode-switch stage
// remap now live in the React-free `searchStages.js`; the sticky PubMed pulse bar,
// the scroll-model walker, and the single-key search-mode persistence helper stay in
// the component module. Re-exported here so existing importers keep working unchanged.
export { STAGES, stagesFor, stageAfterModeChange } from './searchStages.js';
export {
  PubMedPulse, findScrollableAncestor, persistSearchModeMerged,
} from './SearchWorkspace.jsx';
export { searchWorkspaceV2FlagEnabled } from './searchWorkspaceFlag.js';
