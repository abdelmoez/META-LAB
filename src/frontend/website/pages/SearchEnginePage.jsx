/**
 * SearchEnginePage — public route /features/search-engine.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Search engine"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/screening': 'where the retrieved records go',
  '/features/manuscript': 'where the search paragraph is generated',
  '/resources/systematic-review-search-strategy': 'concept blocks, MeSH and Boolean logic',
  '/resources/what-is-a-systematic-review': 'how a systematic search fits the wider method',
};

export function SearchEnginePage() {
  return (
    <ArticlePage
      slug="features/search-engine"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Next in the workflow"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default SearchEnginePage;
