/**
 * PrismaFlowDiagramGuidePage — public route /resources/prisma-flow-diagram-guide.
 *
 * 113.md W1-B — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{ label: 'Home', path: '/' }, { label: 'Resources', path: '/resources' }, { label: 'PRISMA flow diagram' }];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/resources/prisma-2020-explained': 'the checklist the diagram belongs to',
  '/resources/title-and-abstract-screening': 'where the screening counts come from',
  '/resources/systematic-review-search-strategy': 'where the identification counts come from',
  '/features/prisma-flow-diagram': 'the generator PecanRev ships',
};

export function PrismaFlowDiagramGuidePage() {
  return (
    <ArticlePage
      slug="resources/prisma-flow-diagram-guide"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default PrismaFlowDiagramGuidePage;
