/**
 * PublicationBiasGuidePage — public route /resources/publication-bias.
 *
 * 113.md W1-B — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{ label: 'Home', path: '/' }, { label: 'Resources', path: '/resources' }, { label: 'Publication bias' }];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/forest-plots-and-heterogeneity': 'heterogeneity is the rival explanation',
  '/resources/how-to-run-a-meta-analysis': 'where this assessment belongs',
  '/resources/systematic-review-search-strategy': 'registry searching addresses the cause',
  '/features/meta-analysis': 'the funnel plot and tests PecanRev runs',
};

export function PublicationBiasGuidePage() {
  return (
    <ArticlePage
      slug="resources/publication-bias"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default PublicationBiasGuidePage;
