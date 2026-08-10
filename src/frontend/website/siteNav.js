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
  { label: 'Search engine', path: '/features/search-engine' },
  { label: 'Screening', path: '/features/screening' },
  { label: 'Data extraction', path: '/features/data-extraction' },
  { label: 'Meta-analysis', path: '/features/meta-analysis' },
  { label: 'Manuscript editor', path: '/features/manuscript' },
];

export const RESOURCE_LINKS = [
  { label: 'What is a systematic review?', path: '/resources/what-is-a-systematic-review' },
  { label: 'PRISMA 2020 explained', path: '/resources/prisma-2020-explained' },
  { label: 'Title & abstract screening', path: '/resources/title-and-abstract-screening' },
  { label: 'How to run a meta-analysis', path: '/resources/how-to-run-a-meta-analysis' },
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
  { label: 'About', path: '/about' },
];

/** Every internal path referenced by the navigation, for orphan/coverage tests. */
export function allNavPaths() {
  return [...FEATURE_LINKS, ...RESOURCE_LINKS, ...COMPANY_LINKS, ...PAGE_NAV_LINKS]
    .map(l => l.path)
    .filter((p, i, arr) => arr.indexOf(p) === i);
}
