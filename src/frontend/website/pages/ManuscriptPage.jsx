/**
 * ManuscriptPage — public route /features/manuscript.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "Manuscript editor"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/meta-analysis': 'where the pooled numbers come from',
  '/features/screening': 'where the PRISMA counts come from',
  '/features/prisma-flow-diagram': 'the diagram the draft embeds',
  '/resources/prisma-2020-explained': 'the reporting standard the draft targets',
};

export function ManuscriptPage() {
  return (
    <ArticlePage
      slug="features/manuscript"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default ManuscriptPage;
