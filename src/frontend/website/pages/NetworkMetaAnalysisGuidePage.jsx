/**
 * NetworkMetaAnalysisGuidePage — public route /resources/network-meta-analysis-explained.
 *
 * 113.md W1-B — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{ label: 'Home', path: '/' }, { label: 'Resources', path: '/resources' }, { label: 'Network meta-analysis' }];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/how-to-run-a-meta-analysis': 'the pairwise foundations',
  '/resources/forest-plots-and-heterogeneity': 'reading the estimates and their spread',
  '/resources/data-extraction-for-systematic-reviews': 'arm-level data is what a network needs',
  '/features/network-meta-analysis': 'the engine PecanRev runs',
};

export function NetworkMetaAnalysisGuidePage() {
  return (
    <ArticlePage
      slug="resources/network-meta-analysis-explained"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default NetworkMetaAnalysisGuidePage;
