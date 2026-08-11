/**
 * FeaturesIndexPage — public route /features.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/systematic-review-software': 'the workflow as one page',
  '/compare': 'how PecanRev sits beside other tools',
  '/resources/how-to-conduct-a-systematic-review': 'the method these features implement',
  '/resources/what-is-a-systematic-review': 'the definition behind the method',
  '/about': 'who builds this, and how',
};

export function FeaturesIndexPage() {
  return (
    <ArticlePage
      slug="features"
      eyebrow="Product"
      trail={TRAIL}
      relatedTitle="Explore next"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default FeaturesIndexPage;
