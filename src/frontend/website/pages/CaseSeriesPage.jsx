/**
 * CaseSeriesPage — public route /features/case-series.
 *
 * 113 W1-A. Thin route component in the 111.md §§8/9 shape: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Case series"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/data-extraction': 'the workspace case mode lives in',
  '/features/prisma-flow-diagram': 'why the counts still report publications',
  '/features/meta-analysis': 'pooling proportions from case data',
};

export function CaseSeriesPage() {
  return (
    <ArticlePage
      slug="features/case-series"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default CaseSeriesPage;
