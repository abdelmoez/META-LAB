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
// 73.md — pure/presentational seams exported for unit tests: the stage table +
// mode-aware labelling, the sticky PubMed pulse bar, the scroll-model walker, and
// the load→merge→save search-mode persistence helper.
export {
  STAGES, stagesFor, PubMedPulse, findScrollableAncestor, persistSearchModeMerged,
} from './SearchWorkspace.jsx';
export { searchWorkspaceV2FlagEnabled } from './searchWorkspaceFlag.js';
