/**
 * CompareRayyanPage — public route /compare/pecanrev-vs-rayyan.
 *
 * 113 W1-A. Thin route component in the 111.md §§8/9 shape: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Compare", path: "/compare"}, {label: "PecanRev vs Rayyan"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/compare': 'every comparison in one place',
  '/compare/pecanrev-vs-covidence': 'the other comparison in this section',
  '/features/screening': 'the stage both tools cover',
  '/ai-systematic-review': 'what the relevance model may and may not do',
  '/systematic-review-software': 'the full workflow',
};

export function CompareRayyanPage() {
  return (
    <ArticlePage
      slug="compare/pecanrev-vs-rayyan"
      eyebrow="Compare"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default CompareRayyanPage;
