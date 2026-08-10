/**
 * ScreeningPage — public route /features/screening.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Screening"}];

const RELATED = [{label: "Title & abstract screening", path: "/resources/title-and-abstract-screening", note: "a practical guide to screening decisions"}, {label: "Search engine", path: "/features/search-engine", note: "where the records come from"}, {label: "Data extraction", path: "/features/data-extraction", note: "what happens to included studies"}];

export function ScreeningPage() {
  return (
    <ArticlePage
      slug="features/screening"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      related={RELATED}
    />
  );
}

export default ScreeningPage;
