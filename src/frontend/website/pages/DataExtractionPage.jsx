/**
 * DataExtractionPage — public route /features/data-extraction.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Data extraction"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/meta-analysis': 'what the extracted values feed',
  '/features/screening': 'the stage before extraction',
  '/features/case-series': 'many patients from one publication',
  '/resources/data-extraction-for-systematic-reviews': 'designing and piloting the form',
  '/resources/what-is-a-systematic-review': 'extraction in the context of the full method',
};

export function DataExtractionPage() {
  return (
    <ArticlePage
      slug="features/data-extraction"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default DataExtractionPage;
