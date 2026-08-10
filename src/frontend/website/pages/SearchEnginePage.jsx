/**
 * SearchEnginePage — public route /features/search-engine.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Search engine"}];

const RELATED = [{label: "Screening", path: "/features/screening", note: "where the retrieved records go"}, {label: "Manuscript editor", path: "/features/manuscript", note: "where the search paragraph is generated"}, {label: "What is a systematic review?", path: "/resources/what-is-a-systematic-review", note: "how a systematic search fits the wider method"}];

export function SearchEnginePage() {
  return (
    <ArticlePage
      slug="features/search-engine"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Next in the workflow"
      related={RELATED}
    />
  );
}

export default SearchEnginePage;
