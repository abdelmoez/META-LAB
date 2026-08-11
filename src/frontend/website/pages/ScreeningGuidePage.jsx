/**
 * ScreeningGuidePage — public route /resources/title-and-abstract-screening.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources", path: "/resources"}, {label: "Title & abstract screening"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/what-is-a-systematic-review': 'the whole method in context',
  '/resources/how-to-conduct-a-systematic-review': 'the step-by-step walkthrough',
  '/resources/prisma-2020-explained': 'reporting the selection process',
  '/features/screening': 'the screening workspace',
};

export function ScreeningGuidePage() {
  return (
    <ArticlePage
      slug="resources/title-and-abstract-screening"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default ScreeningGuidePage;
