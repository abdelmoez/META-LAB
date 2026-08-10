/**
 * ManuscriptPage — public route /features/manuscript.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Manuscript editor"}];

const RELATED = [{label: "PRISMA 2020 explained", path: "/resources/prisma-2020-explained", note: "the reporting standard the draft targets"}, {label: "Meta-analysis", path: "/features/meta-analysis", note: "where the pooled numbers come from"}, {label: "Screening", path: "/features/screening", note: "where the PRISMA counts come from"}];

export function ManuscriptPage() {
  return (
    <ArticlePage
      slug="features/manuscript"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      related={RELATED}
    />
  );
}

export default ManuscriptPage;
