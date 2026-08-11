/**
 * AboutPage — public route /about.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "About"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features': 'the full feature set',
  '/resources': 'methodology guides',
  '/systematic-review-software': 'what the platform covers, stage by stage',
  '/compare': 'how PecanRev sits beside other tools',
};

export function AboutPage() {
  return (
    <ArticlePage
      slug="about"
      eyebrow="Company"
      trail={TRAIL}
      relatedTitle="Explore"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default AboutPage;
