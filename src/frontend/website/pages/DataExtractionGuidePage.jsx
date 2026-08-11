/**
 * DataExtractionGuidePage — public route /resources/data-extraction-for-systematic-reviews.
 *
 * 113.md W1-B — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{ label: 'Home', path: '/' }, { label: 'Resources', path: '/resources' }, { label: 'Data extraction' }];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/how-to-conduct-a-systematic-review': 'where extraction sits in the workflow',
  '/resources/risk-of-bias-assessment': 'the appraisal that runs alongside it',
  '/resources/how-to-run-a-meta-analysis': 'what the extracted data feeds',
  '/features/data-extraction': 'the extraction workspace in PecanRev',
};

export function DataExtractionGuidePage() {
  return (
    <ArticlePage
      slug="resources/data-extraction-for-systematic-reviews"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default DataExtractionGuidePage;
