/**
 * MetaAnalysisGuidePage — public route /resources/how-to-run-a-meta-analysis.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources", path: "/resources"}, {label: "How to run a meta-analysis"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/what-is-a-systematic-review': 'the review that a meta-analysis sits inside',
  '/resources/forest-plots-and-heterogeneity': 'reading the plot and the heterogeneity statistics',
  '/resources/prisma-2020-explained': 'reporting the synthesis',
  '/features/meta-analysis': 'the models PecanRev implements',
};

export function MetaAnalysisGuidePage() {
  return (
    <ArticlePage
      slug="resources/how-to-run-a-meta-analysis"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default MetaAnalysisGuidePage;
