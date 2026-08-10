/**
 * FeaturesIndexPage — public route /features.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features"}];

const RELATED = [{label: "What is a systematic review?", path: "/resources/what-is-a-systematic-review", note: "the method these features implement"}, {label: "PRISMA 2020 explained", path: "/resources/prisma-2020-explained", note: "the reporting standard"}];

export function FeaturesIndexPage() {
  return (
    <ArticlePage
      slug="features"
      eyebrow="Product"
      trail={TRAIL}
      relatedTitle="Methodology guides"
      related={RELATED}
    />
  );
}

export default FeaturesIndexPage;
