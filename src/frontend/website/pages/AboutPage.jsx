/**
 * AboutPage — public route /about.
 *
 * 111.md §8/§9 — thin route component: the copy lives in
 * src/frontend/website/content/, the chrome in PageShell.jsx. Pure and
 * SSR-safe so the build-time prerenderer can render it with react-dom/server.
 */

import { ArticlePage } from '../ArticlePage.jsx';

const TRAIL = [{label: "Home", path: "/"}, {label: "About"}];

const RELATED = [{label: "Features", path: "/features", note: "the full feature set"}, {label: "Resources", path: "/resources", note: "methodology guides"}];

export function AboutPage() {
  return (
    <ArticlePage
      slug="about"
      eyebrow="Company"
      trail={TRAIL}
      relatedTitle="Explore"
      related={RELATED}
    />
  );
}

export default AboutPage;
