/**
 * ScreeningGuidePage — public route /resources/title-and-abstract-screening.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources", path: "/resources"}, {label: "Title & abstract screening"}];

const RELATED = [{label: "PRISMA 2020 explained", path: "/resources/prisma-2020-explained", note: "reporting the selection process"}, {label: "What is a systematic review?", path: "/resources/what-is-a-systematic-review", note: "the whole method in context"}, {label: "Screening", path: "/features/screening", note: "the screening workspace"}];

export function ScreeningGuidePage() {
  return (
    <ArticlePage
      slug="resources/title-and-abstract-screening"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      related={RELATED}
    />
  );
}

export default ScreeningGuidePage;
