/**
 * WhatIsSystematicReviewPage — public route /resources/what-is-a-systematic-review.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources", path: "/resources"}, {label: "What is a systematic review?"}];

const RELATED = [{label: "PRISMA 2020 explained", path: "/resources/prisma-2020-explained", note: "how to report what you did"}, {label: "Title & abstract screening", path: "/resources/title-and-abstract-screening", note: "the stage that consumes most of the time"}, {label: "How to run a meta-analysis", path: "/resources/how-to-run-a-meta-analysis", note: "if you plan to pool"}];

export function WhatIsSystematicReviewPage() {
  return (
    <ArticlePage
      slug="resources/what-is-a-systematic-review"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      related={RELATED}
    />
  );
}

export default WhatIsSystematicReviewPage;
