/**
 * features/searchWizard — public API (prompt60).
 *
 * The unified 3-step Search stage (Define → Build → Run). It embeds the existing
 * Search Builder + Pecan Search engines unchanged; see SearchWizard.jsx.
 */
export { default as SearchWizard } from './SearchWizard.jsx';
// 69.md — reproducibility/quality panels + their pure models (also exported for tests).
export { default as SearchQualityPanel, QualityRows, QualityCard } from './SearchQualityPanel.jsx';
export { default as SearchVersionsPanel, VersionList, DiffView } from './SearchVersionsPanel.jsx';
export { default as SearchExportPanel, MethodsModal, PrismaSExport } from './SearchExportPanel.jsx';
export { buildQualityModel } from './searchQualityModel.js';
export { formatVersionDiff } from './versionDiff.js';
export { buildReproLog, reproLogToJson, reproLogFilename } from './reproLog.js';
export { searchVersionsApi } from './searchVersionsApi.js';
// P11 — guided Strategy Studio (generator↔critic) + recall check panels + their pure
// leaves (exported for unit tests) and the thin API client / flag helper.
export { default as StrategyStudioPanel, StrategyCard, IterationTimeline } from './StrategyStudioPanel.jsx';
export { default as RecallReportPanel, SeedList, RecallSummary } from './RecallReportPanel.jsx';
export { strategyStudioApi } from './strategyStudioApi.js';
export { strategyStudioFlagEnabled } from './strategyStudioFlag.js';
