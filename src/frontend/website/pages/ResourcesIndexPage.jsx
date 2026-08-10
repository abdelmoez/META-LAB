/**
 * ResourcesIndexPage — public route /resources.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources"}];

const RELATED = [{label: "Features", path: "/features", note: "what PecanRev does,  stage by stage"}];

export function ResourcesIndexPage() {
  return (
    <ArticlePage
      slug="resources"
      eyebrow="Learn"
      trail={TRAIL}
      relatedTitle="Product"
      related={RELATED}
    />
  );
}

export default ResourcesIndexPage;
