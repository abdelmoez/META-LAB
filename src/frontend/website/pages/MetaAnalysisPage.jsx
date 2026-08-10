/**
 * MetaAnalysisPage — public route /features/meta-analysis.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Meta-analysis"}];

const RELATED = [{label: "How to run a meta-analysis", path: "/resources/how-to-run-a-meta-analysis", note: "choosing models and reading heterogeneity"}, {label: "Data extraction", path: "/features/data-extraction", note: "where the input data comes from"}, {label: "Manuscript editor", path: "/features/manuscript", note: "how results reach the write-up"}];

export function MetaAnalysisPage() {
  return (
    <ArticlePage
      slug="features/meta-analysis"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      related={RELATED}
    />
  );
}

export default MetaAnalysisPage;
