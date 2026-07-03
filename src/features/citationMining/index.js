/**
 * features/citationMining — public API (P15 Bibliomine "Citation mining").
 *
 * A flag-gated in-project workspace over the citation-mining backend
 * (server/routes/citationMining.js) + the pure viz engines
 * (src/research-engine/citationMining). Mirrors the manuscript / fullText / living
 * feature modules: a thin client (citationMiningApi.js) + an eager flag hook
 * (useCitationMiningEnabled.js) + self-contained panels. When the `citationMining`
 * flag is OFF the nav entry is hidden and the panel renders a quiet disabled note —
 * no new tab, no citation-mining network calls. No user-facing "AI" wording.
 */
export { default as CitationMiningPanel } from './CitationMiningPanel.jsx';
export { default as SeedReviewUpload } from './SeedReviewUpload.jsx';
export { default as ReferenceReview } from './ReferenceReview.jsx';
export { default as CitationChasePanel } from './CitationChasePanel.jsx';
export { default as StudyMap } from './StudyMap.jsx';
export { default as CharacteristicsHistograms } from './CharacteristicsHistograms.jsx';
export { citationMiningApi, citationMiningEnabled } from './citationMiningApi.js';
export { useCitationMiningEnabled } from './useCitationMiningEnabled.js';
