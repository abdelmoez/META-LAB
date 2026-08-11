/**
 * AiSystematicReviewPage — public route /ai-systematic-review.
 *
 * 113 W1-A. Thin route component in the 111.md §§8/9 shape: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and SSR-safe
 * so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "AI in systematic reviews"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/screening': 'where relevance ranking runs',
  '/features/data-extraction': 'where the extraction assistant runs',
  '/systematic-review-software': 'the whole workflow, mostly deterministic',
  '/resources/title-and-abstract-screening': 'the method the model assists',
};

export function AiSystematicReviewPage() {
  return (
    <ArticlePage
      slug="ai-systematic-review"
      eyebrow="Transparency"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default AiSystematicReviewPage;
