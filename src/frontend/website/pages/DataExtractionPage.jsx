/**
 * DataExtractionPage — public route /features/data-extraction.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Data extraction"}];

const RELATED = [{label: "Meta-analysis", path: "/features/meta-analysis", note: "what the extracted values feed"}, {label: "Screening", path: "/features/screening", note: "the stage before extraction"}, {label: "What is a systematic review?", path: "/resources/what-is-a-systematic-review", note: "extraction in the context of the full method"}];

export function DataExtractionPage() {
  return (
    <ArticlePage
      slug="features/data-extraction"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      related={RELATED}
    />
  );
}

export default DataExtractionPage;
