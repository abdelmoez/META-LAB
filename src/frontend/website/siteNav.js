/**
 * siteNav.js — the public website's internal-link map.
 *
 * 111.md §23 — one source of truth for the footer/nav link groups so no public
 * page is orphaned. Kept separate from publicPages entries (which describe head
 * metadata) because navigation is an editorial decision, not a routing one.
 *
 * Pure data. No imports, no window access — safe for the build prerenderer.
 */

export const FEATURE_LINKS = [
  // 113 W1-A — the two top-level commercial pages lead the Product column: they
  // are the entry points to the workflow, not stages within it.
  { label: 'Systematic review software', path: '/systematic-review-software' },
  { label: 'AI in systematic reviews', path: '/ai-systematic-review' },
  { label: 'Search engine', path: '/features/search-engine' },
  { label: 'Screening', path: '/features/screening' },
  { label: 'Data extraction', path: '/features/data-extraction' },
  { label: 'Risk of bias', path: '/features/risk-of-bias' },
  { label: 'Meta-analysis', path: '/features/meta-analysis' },
  { label: 'Network meta-analysis', path: '/features/network-meta-analysis' },
  { label: 'PRISMA flow diagram', path: '/features/prisma-flow-diagram' },
  { label: 'Case series mode', path: '/features/case-series' },
  { label: 'Manuscript editor', path: '/features/manuscript' },
];

/**
 * The Learn column. Ordered as a reader would work through a review rather than
 * alphabetically: definition, workflow, then one guide per stage in the order the
 * stages happen. 113 W1-B added the eight stage guides; every entry here is a
 * registered public page (pinned by contentPages.test.jsx), and every markdown
 * guide must appear in one of these groups or the orphan test fails.
 */
export const RESOURCE_LINKS = [
  { label: 'What is a systematic review?', path: '/resources/what-is-a-systematic-review' },
  { label: 'How to conduct a systematic review', path: '/resources/how-to-conduct-a-systematic-review' },
  { label: 'Search strategy', path: '/resources/systematic-review-search-strategy' },
  { label: 'Title & abstract screening', path: '/resources/title-and-abstract-screening' },
  { label: 'Data extraction', path: '/resources/data-extraction-for-systematic-reviews' },
  { label: 'Risk of bias assessment', path: '/resources/risk-of-bias-assessment' },
  { label: 'How to run a meta-analysis', path: '/resources/how-to-run-a-meta-analysis' },
  { label: 'Forest plots & heterogeneity', path: '/resources/forest-plots-and-heterogeneity' },
  { label: 'Publication bias', path: '/resources/publication-bias' },
  { label: 'Network meta-analysis', path: '/resources/network-meta-analysis-explained' },
  { label: 'PRISMA 2020 explained', path: '/resources/prisma-2020-explained' },
  { label: 'PRISMA flow diagram', path: '/resources/prisma-flow-diagram-guide' },
];

/**
 * 113 W1-A — the /compare section. Its own group rather than a row in Product,
 * because a comparison page answers a different question (which tool) from a
 * feature page (what does this one do), and the footer heading should say so.
 */
export const COMPARE_LINKS = [
  { label: 'Compare platforms', path: '/compare' },
  { label: 'PecanRev vs Covidence', path: '/compare/pecanrev-vs-covidence' },
  { label: 'PecanRev vs Rayyan', path: '/compare/pecanrev-vs-rayyan' },
];

export const COMPANY_LINKS = [
  { label: 'About PecanRev', path: '/about' },
  { label: 'All features', path: '/features' },
  { label: 'Resources', path: '/resources' },
  { label: 'Terms & privacy', path: '/terms' },
];

/** Compact top-navigation set used by content pages (the homepage keeps its own admin-editable nav). */
export const PAGE_NAV_LINKS = [
  { label: 'Features', path: '/features' },
  { label: 'Resources', path: '/resources' },
  { label: 'Compare', path: '/compare' },
  { label: 'About', path: '/about' },
];

/**
 * 113 §3 — the three paths PageShell's chrome links that no LINK GROUP contains:
 * the wordmark/logo (`/`, in both the navbar and the footer brand) and the two
 * account buttons in the navbar. They are hardcoded in PageShell.jsx because each is
 * a styled button rather than a footer row, so they would otherwise look orphaned to
 * the coverage test even though every content page links them. Pinned by a source
 * scan over PageShell.jsx in tests/unit/seo/publicPagesRegistry.test.js — if one of
 * those buttons is ever removed or re-pointed, this list fails rather than quietly
 * certifying a page as reachable.
 */
export const CHROME_LINKS = [
  { label: 'Home', path: '/' },
  { label: 'Sign in', path: '/login' },
  { label: 'Get started', path: '/register' },
];

/** Every internal path referenced by the navigation, for orphan/coverage tests. */
export function allNavPaths() {
  return [...FEATURE_LINKS, ...RESOURCE_LINKS, ...COMPARE_LINKS, ...COMPANY_LINKS,
    ...PAGE_NAV_LINKS, ...CHROME_LINKS]
    .map(l => l.path)
    .filter((p, i, arr) => arr.indexOf(p) === i);
}
