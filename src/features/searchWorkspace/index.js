/**
 * features/searchWorkspace — public API (71.md; reshaped by 96.md).
 *
 * The staged, progressive-disclosure Search Workspace. 96.md retires the legacy
 * 3-step SearchWizard and the `searchWorkspaceV2` gate: whenever the `searchEngine`
 * flag is ON the dispatcher renders THIS workspace (question → terms → mode →
 * strategy → results → documentation → screening), composing the existing Search
 * Builder, Pecan Search and reproducibility/versions/studio components unchanged.
 */
export { default as SearchWorkspace } from './SearchWorkspace.jsx';
// 73.md/74.md/75.md — pure/presentational seams exported for unit tests. The stage
// table + the mode-scoped stage list (single source of truth for the visible
// workflow — shared with the white side-menu via navConfig) + the mode-switch stage
// remap now live in the React-free `searchStages.js`; the sticky PubMed pulse bar,
// the scroll-model walker, and the single-key search-mode persistence helper stay in
// the component module. Re-exported here so existing importers keep working unchanged.
// 96.md adds STAGE_ALIASES/resolveStageAlias (retired concepts/refine → terms).
export {
  STAGES, STAGE_ALIASES, resolveStageAlias, stagesFor, stageAfterModeChange, reconcileStageUrl,
} from './searchStages.js';
export {
  PubMedPulse, findScrollableAncestor, persistSearchModeMerged,
} from './SearchWorkspace.jsx';
export { searchWorkspaceV2FlagEnabled } from './searchWorkspaceFlag.js';
