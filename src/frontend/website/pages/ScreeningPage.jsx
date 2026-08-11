/**
 * ScreeningPage — public route /features/screening.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Screening"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/search-engine': 'where the records come from',
  '/features/data-extraction': 'what happens to included studies',
  '/features/prisma-flow-diagram': 'where screening decisions become counts',
  '/ai-systematic-review': 'what the relevance model may and may not do',
  '/resources/title-and-abstract-screening': 'a practical guide to screening decisions',
};

export function ScreeningPage() {
  return (
    <ArticlePage
      slug="features/screening"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default ScreeningPage;
