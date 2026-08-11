/**
 * ForestPlotsGuidePage — public route /resources/forest-plots-and-heterogeneity.
 *
 * 113.md W1-B — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{ label: 'Home', path: '/' }, { label: 'Resources', path: '/resources' }, { label: 'Forest plots and heterogeneity' }];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/how-to-run-a-meta-analysis': 'choosing a model and running the analysis',
  '/resources/publication-bias': 'the other plot you have to read',
  '/resources/network-meta-analysis-explained': 'when there are more than two treatments',
  '/features/meta-analysis': 'the forest plots PecanRev draws',
};

export function ForestPlotsGuidePage() {
  return (
    <ArticlePage
      slug="resources/forest-plots-and-heterogeneity"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default ForestPlotsGuidePage;
