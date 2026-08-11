/**
 * SystematicReviewSoftwarePage — public route /systematic-review-software.
 *
 * 113 W1-A. Thin route component in the 111.md §§8/9 shape: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and SSR-safe
 * so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Systematic review software"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features': 'the same workflow, stage by stage',
  '/ai-systematic-review': 'exactly which steps are model-assisted',
  '/compare': 'how PecanRev sits beside other tools',
  '/resources/how-to-conduct-a-systematic-review': 'the method, step by step',
  '/resources/what-is-a-systematic-review': 'the method, before the software',
};

export function SystematicReviewSoftwarePage() {
  return (
    <ArticlePage
      slug="systematic-review-software"
      eyebrow="Platform"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default SystematicReviewSoftwarePage;
