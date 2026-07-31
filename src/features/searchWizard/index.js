/**
 * features/searchWizard — public API (prompt60; slimmed by 96.md).
 *
 * The legacy 3-step SearchWizard and the "Search quality" panel/model were RETIRED
 * by 96.md (the staged searchWorkspace + the inline Terms & Vocabulary quality card
 * replaced them). What remains here are the reproducibility surfaces the workspace
 * still composes: versions, export/methods-text, Strategy Studio and recall panels.
 */
// 69.md — reproducibility panels + their pure models (also exported for tests).
export { default as SearchVersionsPanel, VersionList, DiffView } from './SearchVersionsPanel.jsx';
export { default as SearchExportPanel, MethodsModal, PrismaSExport } from './SearchExportPanel.jsx';
export { formatVersionDiff } from './versionDiff.js';
export { buildReproLog, reproLogToJson, reproLogFilename } from './reproLog.js';
export { searchVersionsApi } from './searchVersionsApi.js';
// P11 — guided Strategy Studio (generator↔critic) + recall check panels + their pure
// leaves (exported for unit tests) and the thin API client / flag helper.
export { default as StrategyStudioPanel, StrategyCard, IterationTimeline } from './StrategyStudioPanel.jsx';
export { default as RecallReportPanel, SeedList, RecallSummary } from './RecallReportPanel.jsx';
export { strategyStudioApi } from './strategyStudioApi.js';
export { strategyStudioFlagEnabled } from './strategyStudioFlag.js';
