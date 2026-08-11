/**
 * ConductSystematicReviewPage — public route /resources/how-to-conduct-a-systematic-review.
 *
 * 113.md W1-B — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{ label: 'Home', path: '/' }, { label: 'Resources', path: '/resources' }, { label: 'How to conduct a systematic review' }];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/what-is-a-systematic-review': 'the definition this guide assumes',
  '/resources/systematic-review-search-strategy': 'step 3 in detail',
  '/resources/data-extraction-for-systematic-reviews': 'step 5 in detail',
  '/resources/risk-of-bias-assessment': 'step 6 in detail',
  '/resources/prisma-flow-diagram-guide': 'step 8 in detail',
};

export function ConductSystematicReviewPage() {
  return (
    <ArticlePage
      slug="resources/how-to-conduct-a-systematic-review"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default ConductSystematicReviewPage;
