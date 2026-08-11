/**
 * MetaAnalysisPage — public route /features/meta-analysis.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Meta-analysis"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/data-extraction': 'where the input data comes from',
  '/features/network-meta-analysis': 'more than two treatments at once',
  '/features/manuscript': 'how results reach the write-up',
  '/resources/how-to-run-a-meta-analysis': 'choosing models and reading heterogeneity',
  '/resources/forest-plots-and-heterogeneity': 'how to read the plot',
};

export function MetaAnalysisPage() {
  return (
    <ArticlePage
      slug="features/meta-analysis"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default MetaAnalysisPage;
