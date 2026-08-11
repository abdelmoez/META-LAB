/**
 * NetworkMetaAnalysisPage — public route /features/network-meta-analysis.
 *
 * 113 W1-A. Thin route component in the 111.md §§8/9 shape: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Network meta-analysis"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/meta-analysis': 'pairwise pooling and everything around it',
  '/features/data-extraction': 'arm-level data is the input',
  '/resources/network-meta-analysis-explained': 'geometry, transitivity and consistency',
  '/resources/how-to-run-a-meta-analysis': 'the method, before the software',
};

export function NetworkMetaAnalysisPage() {
  return (
    <ArticlePage
      slug="features/network-meta-analysis"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default NetworkMetaAnalysisPage;
