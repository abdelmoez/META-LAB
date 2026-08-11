/**
 * RiskOfBiasPage — public route /features/risk-of-bias.
 *
 * 113 W1-A. Thin route component in the 111.md §§8/9 shape: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Risk of bias"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/data-extraction': 'where the studies being assessed come from',
  '/features/meta-analysis': 'sensitivity and subgroup analysis by risk of bias',
  '/features/manuscript': 'how assessments reach the write-up',
  '/resources/risk-of-bias-assessment': 'the domains and how to judge them',
};

export function RiskOfBiasPage() {
  return (
    <ArticlePage
      slug="features/risk-of-bias"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default RiskOfBiasPage;
