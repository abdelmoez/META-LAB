/**
 * PrismaFlowDiagramPage — public route /features/prisma-flow-diagram.
 *
 * 113 W1-A. Thin route component in the 111.md §§8/9 shape: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Features", path: "/features"}, {label: "PRISMA flow diagram"}];

/**
 * Editorial notes for the related-links block. 113 §5 — the registry entry's
 * `related` array owns WHICH pages are listed and in what order (so the rendered
 * links and the internal-link graph cannot drift); this map only supplies the
 * one-line "why you would click this" beside each.
 */
const RELATED_NOTES = {
  '/features/screening': 'where the dispositions are recorded',
  '/features/search-engine': 'where the identification counts come from',
  '/features/case-series': 'publications versus cases in the counts',
  '/resources/prisma-flow-diagram-guide': 'what each box counts, and why',
  '/resources/prisma-2020-explained': 'the reporting standard behind the diagram',
};

export function PrismaFlowDiagramPage() {
  return (
    <ArticlePage
      slug="features/prisma-flow-diagram"
      eyebrow="Feature"
      trail={TRAIL}
      relatedTitle="Related"
      relatedNotes={RELATED_NOTES}
    />
  );
}

export default PrismaFlowDiagramPage;
