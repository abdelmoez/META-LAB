/**
 * CompareIndexPage — public route /compare.
 *
 * 113 W1-A. Parent of the registry-gated /compare/<slug> prefix: without it an
 * unknown child would be the only thing under /compare, and the section would
 * have no crawlable hub. Thin route component in the 111.md §§8/9 shape.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Compare"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/compare/pecanrev-vs-covidence': 'screening and extraction, beside end to end',
  '/compare/pecanrev-vs-rayyan': 'a screening app, beside a review platform',
  '/systematic-review-software': 'what PecanRev covers, stage by stage',
  '/features': 'the feature set behind the comparison',
};

export function CompareIndexPage() {
  return (
    <ArticlePage
      slug="compare"
      eyebrow="Compare"
      trail={TRAIL}
      relatedTitle="Comparisons"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default CompareIndexPage;
