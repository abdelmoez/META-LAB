/**
 * Prisma2020Page — public route /resources/prisma-2020-explained.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources", path: "/resources"}, {label: "PRISMA 2020 explained"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/what-is-a-systematic-review': 'the method PRISMA reports on',
  '/resources/title-and-abstract-screening': 'where the flow-diagram numbers are generated',
  '/resources/prisma-flow-diagram-guide': 'the diagram box by box',
  '/features/manuscript': 'PRISMA counts derived from the record ledger',
};

export function Prisma2020Page() {
  return (
    <ArticlePage
      slug="resources/prisma-2020-explained"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default Prisma2020Page;
