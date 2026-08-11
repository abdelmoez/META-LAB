/**
 * WhatIsSystematicReviewPage — public route /resources/what-is-a-systematic-review.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources", path: "/resources"}, {label: "What is a systematic review?"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/how-to-conduct-a-systematic-review': 'the same method as an eight-step walkthrough',
  '/resources/prisma-2020-explained': 'how to report what you did',
  '/resources/title-and-abstract-screening': 'the stage that consumes most of the time',
  '/resources/how-to-run-a-meta-analysis': 'if you plan to pool',
};

export function WhatIsSystematicReviewPage() {
  return (
    <ArticlePage
      slug="resources/what-is-a-systematic-review"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default WhatIsSystematicReviewPage;
