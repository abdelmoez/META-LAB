/**
 * SearchStrategyGuidePage — public route /resources/systematic-review-search-strategy.
 *
 * 113.md W1-B — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{ label: 'Home', path: '/' }, { label: 'Resources', path: '/resources' }, { label: 'Search strategy' }];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/how-to-conduct-a-systematic-review': 'where the search sits in the workflow',
  '/resources/title-and-abstract-screening': 'what happens to the records you retrieve',
  '/resources/prisma-flow-diagram-guide': 'reporting the counts your search produced',
  '/features/search-engine': 'the strategy builder in PecanRev',
};

export function SearchStrategyGuidePage() {
  return (
    <ArticlePage
      slug="resources/systematic-review-search-strategy"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default SearchStrategyGuidePage;
