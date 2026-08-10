/**
 * MetaAnalysisGuidePage — public route /resources/how-to-run-a-meta-analysis.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "Resources", path: "/resources"}, {label: "How to run a meta-analysis"}];

const RELATED = [{label: "What is a systematic review?", path: "/resources/what-is-a-systematic-review", note: "the review that a meta-analysis sits inside"}, {label: "PRISMA 2020 explained", path: "/resources/prisma-2020-explained", note: "reporting the synthesis"}, {label: "Meta-analysis", path: "/features/meta-analysis", note: "the models PecanRev implements"}];

export function MetaAnalysisGuidePage() {
  return (
    <ArticlePage
      slug="resources/how-to-run-a-meta-analysis"
      eyebrow="Guide"
      trail={TRAIL}
      relatedTitle="Continue reading"
      related={RELATED}
    />
  );
}

export default MetaAnalysisGuidePage;
