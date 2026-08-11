/**
 * RiskOfBiasGuidePage — public route /resources/risk-of-bias-assessment.
 *
 * 113.md W1-B — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{ label: 'Home', path: '/' }, { label: 'Resources', path: '/resources' }, { label: 'Risk of bias assessment' }];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/how-to-conduct-a-systematic-review': 'where appraisal sits in the workflow',
  '/resources/data-extraction-for-systematic-reviews': 'the study data you appraise alongside',
  '/resources/forest-plots-and-heterogeneity': 'using risk of bias in the synthesis',
  '/features/risk-of-bias': 'the assessment workspace in PecanRev',
};

export function RiskOfBiasGuidePage() {
  return (
    <ArticlePage
      slug="resources/risk-of-bias-assessment"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default RiskOfBiasGuidePage;
