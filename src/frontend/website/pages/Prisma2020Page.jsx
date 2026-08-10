/**
 * Prisma2020Page — public route /resources/prisma-2020-explained.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources", path: "/resources"}, {label: "PRISMA 2020 explained"}];

const RELATED = [{label: "What is a systematic review?", path: "/resources/what-is-a-systematic-review", note: "the method PRISMA reports on"}, {label: "Title & abstract screening", path: "/resources/title-and-abstract-screening", note: "where the flow-diagram numbers are generated"}, {label: "Manuscript editor", path: "/features/manuscript", note: "PRISMA counts derived from the record ledger"}];

export function Prisma2020Page() {
  return (
    <ArticlePage
      slug="resources/prisma-2020-explained"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      related={RELATED}
    />
  );
}

export default Prisma2020Page;
