/**
 * ResourcesIndexPage — public route /resources.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features': 'what PecanRev does, stage by stage',
  '/systematic-review-software': 'the workflow as one page',
  '/ai-systematic-review': 'which steps are model-assisted',
  '/compare': 'how PecanRev sits beside other tools',
};

export function ResourcesIndexPage() {
  return (
    <ArticlePage
      slug="resources"
      eyebrow="Learn"
      trail={TRAIL}
      relatedTitle="Product"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default ResourcesIndexPage;
