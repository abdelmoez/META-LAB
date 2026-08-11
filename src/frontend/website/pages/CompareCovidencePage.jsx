/**
 * CompareCovidencePage — public route /compare/pecanrev-vs-covidence.
 *
 * 113 W1-A. Thin route component in the 111.md §§8/9 shape: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Compare", path: "/compare"}, {label: "PecanRev vs Covidence"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/compare': 'every comparison in one place',
  '/compare/pecanrev-vs-rayyan': 'the other comparison in this section',
  '/features/meta-analysis': 'the stage that follows extraction here',
  '/features/prisma-flow-diagram': 'how the counts are derived',
  '/systematic-review-software': 'the full workflow',
};

export function CompareCovidencePage() {
  return (
    <ArticlePage
      slug="compare/pecanrev-vs-covidence"
      eyebrow="Compare"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default CompareCovidencePage;
