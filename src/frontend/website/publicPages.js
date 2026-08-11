/**
 * publicPages.js — 111.md §1 — THE public-route registry.
 *
 * ONE source of truth consumed by FOUR independent consumers:
 *   1. the client head manager  (src/frontend/website/usePageHead.js)
 *   2. the build-time prerenderer + sitemap/robots/llms.txt generators
 *      (scripts/prerender-public.mjs)
 *   3. the Express edge middleware (server/middleware/publicPages.js)
 *   4. the SEO test suite (tests/unit/seo/*)
 *
 * This module is DELIBERATELY dependency-free and side-effect-free: it is
 * imported by browser code, by Node build scripts, by the Express server, and
 * by vite.config.js. Never import React, `process`, `fs`, or any app module
 * from here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENTRY CONTRACT (stable — other agents append entries against this shape)
 * ─────────────────────────────────────────────────────────────────────────────
 *   path           REQUIRED  string  Exact, lowercase, no trailing slash ('/' is
 *                                    the only path that is a bare slash). This is
 *                                    what the router and the middleware match.
 *   title          REQUIRED  string  Full <title> text (already includes the brand).
 *   description    REQUIRED  string  meta[name=description]. Honest, 110-165 chars.
 *                                    HARD BOUND, not a suggestion: pinned by
 *                                    tests/unit/seo/publicPagesRegistry.test.js.
 *                                    Google truncates around 155-160, so anything
 *                                    longer loses its tail in the SERP.
 *   canonicalPath  REQUIRED  string  Site-relative path the canonical <link> points
 *                                    at. Usually === path; a duplicate/preview page
 *                                    points at its canonical original.
 *   component      REQUIRED  string  Repo-root-relative module path rendered by the
 *                                    prerenderer, e.g. 'src/frontend/pages/Terms.jsx'.
 *                                    Default export is the page component.
 *   indexable      REQUIRED  boolean false → excluded from sitemap.xml, served with
 *                                    `X-Robots-Tag: noindex, nofollow` + a robots
 *                                    meta, but STILL a known route (never a 404).
 *   ogType         optional  string  Open Graph type. Default 'website'.
 *   jsonLd         optional  fn      (ctx) => object | object[]. ctx is
 *                                    { origin, path, entry }. Returned objects are
 *                                    emitted as <script type="application/ld+json">.
 *   changefreq     optional  string  sitemap.xml <changefreq>.
 *   priority       optional  number  sitemap.xml <priority>, 0.0-1.0.
 *   lastmodSource  optional  string  Repo-relative file whose LAST GIT COMMIT DATE
 *                                    is the honest <lastmod>. NEVER fabricate a
 *                                    date; when this is absent the generator must
 *                                    omit <lastmod> rather than invent one.
 *   componentProps optional  object  Props passed to the component when prerendering.
 *   ogImage        optional  string  Site-relative image. Default DEFAULT_OG_IMAGE.
 *   navLabel       optional  string  Short label for footer/nav internal linking.
 *   navGroup       optional  string  Footer/nav grouping key. Also the llms.txt section.
 *   sitemap        optional  boolean Default true. `false` keeps the page INDEXABLE —
 *                                    crawlable, self-canonical, listed in llms.txt —
 *                                    but drops it from sitemap.xml. Use it for pages
 *                                    that answer a navigational query and have no
 *                                    content worth submitting for crawl (see /login).
 *                                    NOT a substitute for `indexable: false`.
 *   related        optional  string[] 113 §5 — the onward links this page offers, as
 *                                    registry paths, in display order. THE source of
 *                                    truth for the RelatedLinks block: ArticlePage
 *                                    resolves it (see resolveRelated) so the rendered
 *                                    links and the internal-link graph cannot diverge.
 *                                    REQUIRED (3-5 entries) on every page whose
 *                                    component renders that block; see RELATED_EXEMPT
 *                                    in tests/unit/seo/publicPagesRegistry.test.js for
 *                                    the four documented exceptions.
 *   relatedLabel   optional  string  Label used when THIS page is listed in someone
 *                                    else's `related`. Only needed when `navLabel` is
 *                                    ambiguous without its footer column heading
 *                                    (e.g. two pages both labelled "Data extraction").
 *
 * INVARIANTS enforced by tests/unit/seo/publicPagesRegistry.test.js:
 *   - `path` and `canonicalPath` are lowercase, start with '/', and carry no
 *     trailing slash (except the root '/').
 *   - Among INDEXABLE entries, `title`, `description` and `canonicalPath` are
 *     each unique (non-indexable entries may share a canonical with their
 *     original — that is the point of a canonical).
 *   - No registry path may also match NON_INDEXABLE_PATTERNS.
 *   - Every registry path is covered by KNOWN_SPA_PREFIXES.
 *   - Every `description` is 110-165 characters long.
 *   - Every `related` path is a real registry path, is never the page itself, and
 *     every indexable page is reachable from the navigation ∪ the related graph.
 */

/* ─────────────────────────────── site facts ─────────────────────────────── */

/** Production origin. Absolute URLs in canonical/OG/JSON-LD are built from this. */
export const SITE_ORIGIN = 'https://pecanrev.com';

/** Brand name used in JSON-LD + og:site_name. */
export const SITE_NAME = 'PecanRev';

/**
 * Default social share image. Site-relative; resolved against the origin.
 * The asset itself is authored separately (111.md §6) — referencing it here is
 * intentional so the head contract is stable before the PNG lands.
 */
export const DEFAULT_OG_IMAGE = '/og-image.png';

/** Dimensions of DEFAULT_OG_IMAGE (og:image:width/height). */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

/** The `X-Robots-Tag` / robots-meta value used for every non-indexable surface. */
export const NOINDEX_DIRECTIVE = 'noindex, nofollow';

/**
 * The product description reused by index.html, the manifest, and the '/' entry.
 * Kept byte-identical to index.html's meta description so a crawler that sees the
 * un-prerendered app shell and one that sees the prerendered '/' read the same text.
 */
export const SITE_DESCRIPTION =
  'PecanRev is a systematic review and meta-analysis platform: search building, screening, '
  + 'data extraction, risk of bias, and project collaboration in one workflow.';

/* ─────────────────────────── path helpers (pure) ────────────────────────── */

/** Strip a trailing slash ('/' itself is preserved). */
export function stripTrailingSlash(pathname) {
  if (typeof pathname !== 'string' || pathname.length <= 1) return pathname || '/';
  return pathname.endsWith('/') ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

/**
 * The canonical spelling of a path: lowercase + no trailing slash.
 * NOTE: only used to decide REGISTRY redirects. Case folding is deliberately NOT
 * applied when testing KNOWN_SPA_PREFIXES — React Router is case-sensitive, so
 * `/App` genuinely is an unknown route and must earn a real 404.
 */
export function normalizePath(pathname) {
  if (typeof pathname !== 'string' || !pathname) return '/';
  return stripTrailingSlash(pathname.toLowerCase());
}

/** Join an origin and a site-relative path into an absolute URL. */
export function absoluteUrl(pathname, origin = SITE_ORIGIN) {
  const base = String(origin || SITE_ORIGIN).replace(/\/+$/, '');
  if (!pathname || pathname === '/') return `${base}/`;
  return base + (pathname.startsWith('/') ? pathname : `/${pathname}`);
}

/**
 * Match one `{ pattern, kind }` rule against a path.
 *  - kind 'exact'  → the path is the pattern (trailing slash tolerated)
 *  - kind 'prefix' → the path is the pattern OR lives underneath it
 * Case-SENSITIVE by design (see normalizePath).
 */
export function matchPattern(pathname, rule) {
  if (!rule || typeof rule.pattern !== 'string') return false;
  const p = stripTrailingSlash(pathname || '');
  if (p === rule.pattern) return true;
  if (rule.kind === 'prefix') return p.startsWith(`${rule.pattern}/`);
  return false;
}

/* ───────────────────────── known SPA route surface ──────────────────────── */

/**
 * 111.md §5 — every route prefix declared in src/App.jsx.
 *
 * A GET path that matches NOTHING here is a genuinely unknown URL and gets a real
 * HTTP 404 (with the SPA shell body, so <NotFound/> still renders). This list is
 * PINNED by a source scan over src/App.jsx: adding a <Route> without adding it
 * here fails tests/unit/seo/publicPagesRegistry.test.js, so a new route can never
 * silently start 404-ing.
 *
 * `kind: 'prefix'` covers the route AND everything under it, which is how the
 * parameterised families (/app/project/:id, /rob/:projectId, …) are expressed.
 *
 * `registryGated: true` narrows a prefix to the children the registry actually
 * declares. /features and /resources have NO parameterised child in src/App.jsx —
 * every real child is an exact registry path — so a bare prefix would hand a 200
 * with the <NotFound/> body to /features/<anything>, i.e. an unbounded indexable
 * URL space under the only two subtrees the sitemap invites crawlers into. That is
 * the soft-404 server/middleware/publicPages.js exists to kill. The prefix is kept
 * (so a new /features/<page> route only has to be added to PUBLIC_PAGES, and so the
 * App.jsx↔registry source scans still pass), but the classifier 404s any child that
 * is not a registry path. Pinned by tests/unit/seo/publicPagesRegistry.test.js.
 */
export const KNOWN_SPA_PREFIXES = [
  { pattern: '/', kind: 'exact' },                       // Landing (BetaWaitlistGate)
  { pattern: '/beta-waitlist', kind: 'exact' },
  { pattern: '/terms', kind: 'exact' },
  // 111.md §8 — feature landing pages. Registry-gated: unknown children are 404s.
  { pattern: '/features', kind: 'prefix', registryGated: true },
  // 111.md §9 — methodology guides. Registry-gated: unknown children are 404s.
  { pattern: '/resources', kind: 'prefix', registryGated: true },
  // 113 W1-A — the two top-level commercial pages and the comparison section.
  // /compare is registry-gated for the same reason /features is: every child is a
  // static route, so a bare prefix would hand a 200 to /compare/<anything>.
  { pattern: '/systematic-review-software', kind: 'exact' },
  { pattern: '/ai-systematic-review', kind: 'exact' },
  { pattern: '/compare', kind: 'prefix', registryGated: true },
  { pattern: '/about', kind: 'exact' },                  // 111.md §11 — E-E-A-T
  // NOTE: /privacy is deliberately absent — it is no longer an App.jsx route. It is
  // owned by PERMANENT_REDIRECTS (301 → /terms#privacy), which is evaluated first.
  { pattern: '/login', kind: 'exact' },
  { pattern: '/register', kind: 'exact' },
  { pattern: '/invite', kind: 'prefix' },                // /invite/:token
  { pattern: '/accept-invitation', kind: 'exact' },
  { pattern: '/reset', kind: 'exact' },
  { pattern: '/verify-email', kind: 'exact' },
  { pattern: '/onboarding', kind: 'exact' },
  { pattern: '/app', kind: 'prefix' },                   // /app, /app/project/:projectId
  { pattern: '/profile', kind: 'exact' },
  { pattern: '/ops', kind: 'exact' },                    // 404-cloaked by AdminRoute
  { pattern: '/sift-beta', kind: 'prefix' },             // 404-cloaked by AdminRoute
  { pattern: '/rob', kind: 'prefix' },                   // /rob, /rob/:projectId
  { pattern: '/public/synthesis', kind: 'prefix' },      // /public/synthesis/:token
  { pattern: '/embed/synthesis', kind: 'prefix' },       // /embed/synthesis/:token
];

/**
 * 111.md §1 — surfaces that must NEVER be indexed.
 *
 * Every rule here corresponds to a real authenticated / tokenised / cloaked route
 * in src/App.jsx (pinned by source scan). Used for three things at once:
 *   - `X-Robots-Tag: noindex, nofollow` on the response (server/middleware/publicPages.js)
 *   - exclusion from sitemap.xml
 *   - the Disallow list in robots.txt
 *
 * SECURITY NOTE: /ops and /sift-beta are 404-CLOAKED by AdminRoute + requireAdmin.
 * The noindex header and the robots.txt Disallow are SEO hygiene layered on top of
 * that control — robots.txt is never the access control (111.md prohibitions).
 *
 * /login and /register are deliberately NOT here: they are permanently public,
 * distinct pages that answer navigational queries. They are indexable-but-low
 * priority (see the registry entries).
 */
export const NON_INDEXABLE_PATTERNS = [
  { pattern: '/onboarding', kind: 'exact', reason: 'authenticated onboarding questionnaire' },
  { pattern: '/app', kind: 'prefix', reason: 'authenticated workspace' },
  { pattern: '/profile', kind: 'exact', reason: 'authenticated profile' },
  { pattern: '/rob', kind: 'prefix', reason: 'authenticated risk-of-bias workspace' },
  { pattern: '/ops', kind: 'exact', reason: 'internal admin console (404-cloaked)' },
  { pattern: '/sift-beta', kind: 'prefix', reason: 'staff-only screening engine (404-cloaked)' },
  { pattern: '/invite', kind: 'prefix', reason: 'single-use invite token in the URL' },
  { pattern: '/accept-invitation', kind: 'exact', reason: 'single-use activation token in the query' },
  { pattern: '/reset', kind: 'exact', reason: 'password-reset token in the query' },
  { pattern: '/verify-email', kind: 'exact', reason: 'email-verification token in the query' },
  { pattern: '/public/synthesis', kind: 'prefix', reason: 'share-token synthesis page' },
  { pattern: '/embed/synthesis', kind: 'prefix', reason: 'chrome-less embed of a share-token page' },
];

/**
 * 111.md §5 — permanent redirects owned by the edge middleware (and mirrored by the
 * Vite dev server so dev/e2e behave like production). `to` MAY carry a fragment, in
 * which case the query string is NOT re-appended.
 */
export const PERMANENT_REDIRECTS = [
  { from: '/privacy', to: '/terms#privacy', status: 301 },
];

/* ─────────────────────────── JSON-LD builders ───────────────────────────── */
/*
 * HONESTY RULES (111.md prohibitions): only fields whose value is verifiable from
 * the visible page or from real product facts. NO aggregateRating, NO review, NO
 * offers/price (the product is not publicly priced), NO invented founding dates,
 * NO employee counts, NO awards.
 */

/** Stable @id anchors so the graph nodes can reference each other. */
export const JSONLD_IDS = {
  organization: '#organization',
  website: '#website',
  software: '#software',
};

/** Organization node — name, url, logo, description only. */
export function organizationJsonLd({ origin = SITE_ORIGIN } = {}) {
  return {
    '@type': 'Organization',
    '@id': absoluteUrl('/', origin) + JSONLD_IDS.organization,
    name: SITE_NAME,
    url: absoluteUrl('/', origin),
    logo: absoluteUrl('/favicon.svg', origin),
    description: SITE_DESCRIPTION,
  };
}

/** WebSite node. No SearchAction — the public site has no search endpoint. */
export function webSiteJsonLd({ origin = SITE_ORIGIN } = {}) {
  return {
    '@type': 'WebSite',
    '@id': absoluteUrl('/', origin) + JSONLD_IDS.website,
    name: SITE_NAME,
    url: absoluteUrl('/', origin),
    description: SITE_DESCRIPTION,
    inLanguage: 'en',
    publisher: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.organization },
  };
}

/**
 * Capability list used by the SoftwareApplication node. Deliberately phrased at the
 * CAPABILITY level (not marketing copy) so it stays true even when an admin edits
 * the landing feature-card wording through Ops › Content.
 */
export const PRODUCT_FEATURES = [
  'Search strategy building',
  'Duplicate detection across citation sources',
  'Title/abstract and full-text screening with dual reviewers',
  'Structured data extraction',
  'Risk-of-bias assessment',
  'Meta-analysis with heterogeneity, subgroup and sensitivity analyses',
  'PRISMA 2020 flow diagram and checklist export',
  'Multi-user project collaboration',
];

/** SoftwareApplication node. No `offers` (no public price) and no ratings. */
export function softwareApplicationJsonLd({ origin = SITE_ORIGIN } = {}) {
  return {
    '@type': 'SoftwareApplication',
    '@id': absoluteUrl('/', origin) + JSONLD_IDS.software,
    name: SITE_NAME,
    url: absoluteUrl('/', origin),
    description: SITE_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Research software',
    operatingSystem: 'Web',
    browserRequirements: 'Requires a modern browser with JavaScript enabled.',
    featureList: PRODUCT_FEATURES,
    publisher: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.organization },
  };
}

/** A minimal, honest WebPage node bound to the site graph. */
export function webPageJsonLd(entry, { origin = SITE_ORIGIN } = {}) {
  return {
    '@type': 'WebPage',
    '@id': `${absoluteUrl(entry.canonicalPath || entry.path, origin)}#webpage`,
    name: entry.title,
    url: absoluteUrl(entry.canonicalPath || entry.path, origin),
    description: entry.description,
    inLanguage: 'en',
    isPartOf: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.website },
  };
}

/**
 * BreadcrumbList helper for nested pages (feature/resource pages, 111.md §9).
 * @param {{name:string, path:string}[]} trail ordered, root first
 */
export function breadcrumbJsonLd(trail, { origin = SITE_ORIGIN } = {}) {
  const items = (trail || []).filter((t) => t && t.name && t.path);
  if (items.length < 2) return null; // a one-item breadcrumb is noise, not data
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: absoluteUrl(t.path, origin),
    })),
  };
}

/**
 * FAQPage helper. ONLY use when the questions and answers are VISIBLE on the page —
 * schema that diverges from visible content is a hard prohibition (111.md).
 * @param {{question:string, answer:string}[]} faqs
 */
export function faqJsonLd(faqs) {
  const items = (faqs || []).filter((f) => f && f.question && f.answer);
  if (!items.length) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

/** Wrap one or more nodes into a single @graph document. */
export function jsonLdGraph(nodes) {
  const list = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
  if (!list.length) return null;
  return { '@context': 'https://schema.org', '@graph': list };
}

/* ─────────────────── W1-B: content-page helpers (111.md §9) ─────────────── */

/**
 * 111.md §7 — the homepage FAQ.
 *
 * SINGLE SOURCE OF TRUTH: src/frontend/pages/Landing.jsx imports this array and
 * renders it verbatim, and the '/' entry's jsonLd builds FAQPage from the same
 * array. That is deliberate — FAQPage schema that does not match visible copy is
 * a hard prohibition, and the only reliable way to guarantee parity is to make
 * divergence impossible rather than to check for it.
 *
 * These are questions researchers actually ask when evaluating review software.
 * Answers must stay factually true of the shipped product.
 */
export const HOMEPAGE_FAQ = [
  {
    question: 'What is PecanRev?',
    answer:
      'PecanRev is an end-to-end platform for systematic reviews and meta-analyses. One project '
      + 'carries the research question, protocol, search strategy, screening decisions, extracted data, '
      + 'risk-of-bias assessments, statistical synthesis, PRISMA reporting and the manuscript draft, so '
      + 'every number in the write-up can be traced back to the record it came from.',
  },
  {
    question: 'Which databases can PecanRev search?',
    answer:
      'A single strategy compiles to paste-ready queries for sixteen databases, including PubMed/MEDLINE, '
      + 'Embase, the Cochrane Library (CENTRAL), CINAHL, PsycINFO, Scopus, Web of Science, Europe PMC, '
      + 'ClinicalTrials.gov and the WHO ICTRP. Seven can also be run automatically from inside PecanRev: '
      + 'PubMed, Europe PMC, ClinicalTrials.gov, Crossref, DOAJ, OpenAlex and Semantic Scholar. The rest are '
      + 'compile-and-paste, and the interface says so.',
  },
  {
    question: 'Does the AI decide which studies to include?',
    answer:
      'No. The optional screening model reorders the queue by estimated relevance; there is no code path by '
      + 'which it can record a decision. AI extraction produces suggestions that become data only when a person '
      + 'accepts or edits them, and the acceptance is recorded as such. Human validation is enforced in code, '
      + 'not as a setting that can be switched off.',
  },
  {
    question: 'Does PecanRev generate the PRISMA flow diagram?',
    answer:
      'Yes. PRISMA 2020 counts are derived from the actual screening and import ledger rather than typed in, '
      + 'so the diagram reconciles with the decisions in the project. A database that returned zero results is '
      + 'reported as zero rather than dropped, and a case series is counted as one publication even when several '
      + 'patient cases are extracted from it.',
  },
  {
    question: 'Which meta-analysis methods are supported?',
    answer:
      'Fixed-effect and random-effects pooling for every analysis, eight tau-squared estimators including '
      + 'DerSimonian-Laird, REML and Paule-Mandel, Hartung-Knapp-Sidik-Jonkman intervals, Q, tau-squared, '
      + 'I-squared and prediction intervals, forest and funnel plots, Egger’s test, trim-and-fill, subgroup '
      + 'analysis, meta-regression, leave-one-out and influence diagnostics, and frequentist network '
      + 'meta-analysis. The feature page also lists, by name, the methods that are not implemented.',
  },
  {
    question: 'Can several reviewers work on the same review?',
    answer:
      'Yes. Projects are multi-user with role-based permissions. Screening supports blind review, which hides '
      + 'peers’ decisions and notes at read time; data extraction supports two independent extractors plus an '
      + 'adjudicator whose consensus is stored without overwriting either original; and risk-of-bias assessment '
      + 'supports two assessors plus a consensus row.',
  },
  {
    question: 'Can I export the review to Word?',
    answer:
      'Yes. The manuscript exports to Word, with every project fact resolved against freshly fetched data at '
      + 'export time so the exported numbers match what the editor showed. Native Word track changes is not '
      + 'implemented, and network meta-analysis plots are not included in the Word export.',
  },
  {
    question: 'Is my data sent to an external AI provider?',
    answer:
      'Not by default. The default extraction assistant is a deterministic heuristic that runs on the server, and '
      + 'the screening relevance model is a lexical model trained on your own project labels, not a large language '
      + 'model. An external LLM provider is optional and must be configured by an administrator; when it is, '
      + 'requests are proxied by the server and provider credentials never reach the browser. Text recognition for '
      + 'scanned PDFs runs entirely in your browser.',
  },
];

/**
 * Article node for the methodology guides (111.md §§31, 36).
 * `author` is the organisation, never an invented person.
 */
export function contentArticleJsonLd(entry, { origin = SITE_ORIGIN } = {}) {
  const url = absoluteUrl(entry.canonicalPath || entry.path, origin);
  const node = {
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: entry.articleHeadline || entry.title,
    description: entry.description,
    url,
    inLanguage: 'en',
    isPartOf: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.website },
    author: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/', origin) },
    publisher: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.organization },
  };
  if (entry.datePublished) node.datePublished = entry.datePublished;
  if (entry.dateModified) node.dateModified = entry.dateModified;
  return node;
}

/** Breadcrumb trail shorthand for a two-level content page. */
function trail(...parts) {
  return [{ name: 'Home', path: '/' }, ...parts];
}

/* ──────────────────────────── the registry ──────────────────────────────── */

/**
 * PUBLIC_PAGES — append-only. W1-B adds marketing/content entries here; nothing
 * else in this file needs to change for a new page.
 */
export const PUBLIC_PAGES = [
  {
    path: '/',
    title: 'PecanRev — Systematic Review & Meta-Analysis Platform',
    description: SITE_DESCRIPTION,
    canonicalPath: '/',
    component: 'src/frontend/pages/Landing.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'weekly',
    priority: 1.0,
    lastmodSource: 'src/frontend/pages/Landing.jsx',
    navLabel: 'Home',
    navGroup: 'product',
    // Entity home: Organization + WebSite + SoftwareApplication in one graph so the
    // three nodes resolve to each other instead of floating independently.
    // The FAQPage node is built from HOMEPAGE_FAQ, which Landing.jsx renders
    // verbatim — schema and visible copy cannot diverge (111.md §17).
    jsonLd: (ctx) => jsonLdGraph([
      organizationJsonLd(ctx),
      webSiteJsonLd(ctx),
      softwareApplicationJsonLd(ctx),
      faqJsonLd(HOMEPAGE_FAQ),
    ]),
  },
  {
    path: '/terms',
    title: 'Terms of Service & Privacy Policy — PecanRev',
    description:
      'How PecanRev may be used and how your data is handled: accounts and acceptable use, '
      + 'third-party bibliographic sources, data retention, security, and your rights.',
    canonicalPath: '/terms',
    component: 'src/frontend/pages/Terms.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'yearly',
    priority: 0.3,
    lastmodSource: 'src/frontend/pages/Terms.jsx',
    navLabel: 'Terms & Privacy',
    navGroup: 'legal',
    jsonLd: (ctx) => jsonLdGraph([webPageJsonLd(ctx.entry, ctx)]),
  },
  {
    path: '/login',
    title: 'Sign in — PecanRev',
    description:
      'Sign in to your PecanRev account to continue a systematic review: search building, '
      + 'screening, data extraction, risk of bias, and meta-analysis.',
    canonicalPath: '/login',
    component: 'src/frontend/pages/Login.jsx',
    // Indexable ON PURPOSE. /login is a permanent, genuinely public page that answers
    // the navigational query "PecanRev login"; noindexing it hands that query to third
    // parties. It is thin, so it carries a low sitemap priority rather than a noindex.
    // It exposes no user data (PublicRoute only bounces ALREADY-authenticated sessions,
    // and a crawler is always anonymous).
    indexable: true,
    changefreq: 'monthly',
    priority: 0.3,
    lastmodSource: 'src/frontend/pages/Login.jsx',
    navLabel: 'Sign in',
    navGroup: 'account',
    // Indexable but NOT in sitemap.xml (113): a sitemap is a list of pages worth
    // crawling for their content, and an auth form has none. It stays indexable so
    // the navigational query "PecanRev login" resolves here rather than to a third
    // party, and it stays in llms.txt so an assistant can tell a user where to sign in.
    sitemap: false,
  },
  {
    path: '/register',
    title: 'Create your PecanRev account',
    description:
      'Create a PecanRev account to start a systematic review: build searches, screen studies '
      + 'with a co-reviewer, extract data and run meta-analyses in one workspace.',
    canonicalPath: '/register',
    component: 'src/frontend/pages/Register.jsx',
    // Same reasoning as /login.
    indexable: true,
    changefreq: 'monthly',
    priority: 0.3,
    lastmodSource: 'src/frontend/pages/Register.jsx',
    navLabel: 'Create account',
    navGroup: 'account',
    // Indexable but NOT in sitemap.xml (113): a sitemap is a list of pages worth
    // crawling for their content, and an auth form has none. It stays indexable so
    // the navigational query "PecanRev login" resolves here rather than to a third
    // party, and it stays in llms.txt so an assistant can tell a user where to sign in.
    sitemap: false,
  },

  /* ── 111.md §8 — feature landing pages (W1-B) ── */
  {
    path: '/features',
    title: 'PecanRev Features — The Systematic Review Workflow End to End',
    description:
      'How PecanRev connects search strategy, screening, extraction, meta-analysis and manuscript '
      + 'writing into one project where every number traces back to its source.',
    canonicalPath: '/features',
    component: 'src/frontend/website/pages/FeaturesIndexPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/features-index.js',
    navLabel: 'All features',
    navGroup: 'product',
    related: [
      '/systematic-review-software',
      '/compare',
      '/resources/how-to-conduct-a-systematic-review',
      '/resources/what-is-a-systematic-review',
      '/about',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }), ctx),
    ]),
  },
  {
    path: '/features/search-engine',
    title: 'Systematic Review Search Strategy Builder | PecanRev Search Engine',
    description:
      'Build a systematic review search from your research question, add MeSH terms with full '
      + 'scope notes, and compile paste-ready queries for 16 databases.',
    canonicalPath: '/features/search-engine',
    component: 'src/frontend/website/pages/SearchEnginePage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/features-search-engine.js',
    navLabel: 'Search engine',
    navGroup: 'product',
    related: [
      '/features/screening',
      '/features/manuscript',
      '/resources/systematic-review-search-strategy',
      '/resources/what-is-a-systematic-review',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Search engine', path: '/features/search-engine' }), ctx),
    ]),
  },
  {
    path: '/features/screening',
    title: 'Title, Abstract & Full-Text Screening Software | PecanRev',
    description:
      'Screen citations in a keyboard-first workbench with criteria-driven highlighting, '
      + 'server-side duplicate detection, and optional relevance ranking.',
    canonicalPath: '/features/screening',
    component: 'src/frontend/website/pages/ScreeningPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/features-screening.js',
    navLabel: 'Screening',
    navGroup: 'product',
    related: [
      '/features/search-engine',
      '/features/data-extraction',
      '/features/prisma-flow-diagram',
      '/ai-systematic-review',
      '/resources/title-and-abstract-screening',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Screening', path: '/features/screening' }), ctx),
    ]),
  },
  {
    path: '/features/data-extraction',
    title: 'Systematic Review Data Extraction Software | PecanRev',
    description:
      'Extract study data beside the PDF, capture values by clicking them, convert medians and '
      + 'confidence intervals with cited formulas, and extract case series.',
    canonicalPath: '/features/data-extraction',
    component: 'src/frontend/website/pages/DataExtractionPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/features-data-extraction.js',
    navLabel: 'Data extraction',
    navGroup: 'product',
    related: [
      '/features/meta-analysis',
      '/features/screening',
      '/features/case-series',
      '/resources/data-extraction-for-systematic-reviews',
      '/resources/what-is-a-systematic-review',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Data extraction', path: '/features/data-extraction' }), ctx),
    ]),
  },
  {
    path: '/features/meta-analysis',
    title: 'Meta-Analysis Software for Systematic Reviews | PecanRev',
    description:
      'Pool effect sizes with fixed and random-effects models, eight tau-squared estimators, HKSJ '
      + 'intervals, subgroup analysis, meta-regression and network meta-analysis.',
    canonicalPath: '/features/meta-analysis',
    component: 'src/frontend/website/pages/MetaAnalysisPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/features-meta-analysis.js',
    navLabel: 'Meta-analysis',
    navGroup: 'product',
    related: [
      '/features/data-extraction',
      '/features/network-meta-analysis',
      '/features/manuscript',
      '/resources/how-to-run-a-meta-analysis',
      '/resources/forest-plots-and-heterogeneity',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Meta-analysis', path: '/features/meta-analysis' }), ctx),
    ]),
  },
  {
    path: '/features/manuscript',
    title: 'Systematic Review Manuscript Editor with Live PRISMA Facts | PecanRev',
    description:
      'Write your review in an editor where study counts, PRISMA numbers and pooled estimates are '
      + 'live tokens from project data, with change tracking and Word export.',
    canonicalPath: '/features/manuscript',
    component: 'src/frontend/website/pages/ManuscriptPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/features-manuscript.js',
    navLabel: 'Manuscript editor',
    navGroup: 'product',
    related: [
      '/features/meta-analysis',
      '/features/screening',
      '/features/prisma-flow-diagram',
      '/resources/prisma-2020-explained',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Manuscript editor', path: '/features/manuscript' }), ctx),
    ]),
  },

  /* ── 111.md §9 — cornerstone methodology guides (W1-B) ── */
  {
    path: '/resources',
    title: 'Systematic Review Methodology Guides | PecanRev Resources',
    // 113 §6 — this used to name only the four 111.md guides. The hub now carries
    // twelve, so it describes the COVERAGE rather than enumerating titles that go
    // stale every time a guide is added.
    description:
      'Cited, practical guides to every stage of a systematic review: protocol and search, '
      + 'screening, data extraction, risk of bias, meta-analysis and PRISMA reporting.',
    canonicalPath: '/resources',
    component: 'src/frontend/website/pages/ResourcesIndexPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.7,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/resources-index.js',
    navLabel: 'Resources',
    navGroup: 'resources',
    related: [
      '/features',
      '/systematic-review-software',
      '/ai-systematic-review',
      '/compare',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }), ctx),
    ]),
  },
  {
    path: '/resources/what-is-a-systematic-review',
    title: 'What Is a Systematic Review? Definition, Steps and Standards',
    description:
      'A systematic review answers a defined question with a pre-specified, reproducible method. '
      + 'What separates it from a literature review, its steps and its standards.',
    canonicalPath: '/resources/what-is-a-systematic-review',
    component: 'src/frontend/website/pages/WhatIsSystematicReviewPage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/resources-what-is-a-systematic-review.js',
    navLabel: 'What is a systematic review?',
    navGroup: 'resources',
    related: [
      '/resources/how-to-conduct-a-systematic-review',
      '/resources/prisma-2020-explained',
      '/resources/title-and-abstract-screening',
      '/resources/how-to-run-a-meta-analysis',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'What is a systematic review?', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'What is a systematic review?', path: '/resources/what-is-a-systematic-review' }), ctx),
    ]),
  },
  {
    path: '/resources/prisma-2020-explained',
    title: 'PRISMA 2020 Explained: Checklist, Flow Diagram and Common Mistakes',
    description:
      'What changed in PRISMA 2020, what the 27-item checklist asks for, how to build the flow '
      + 'diagram correctly, and the reporting errors reviewers catch most often.',
    canonicalPath: '/resources/prisma-2020-explained',
    component: 'src/frontend/website/pages/Prisma2020Page.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/resources-prisma-2020-explained.js',
    navLabel: 'PRISMA 2020 explained',
    navGroup: 'resources',
    related: [
      '/resources/what-is-a-systematic-review',
      '/resources/title-and-abstract-screening',
      '/resources/prisma-flow-diagram-guide',
      '/features/manuscript',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'PRISMA 2020 explained', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'PRISMA 2020 explained', path: '/resources/prisma-2020-explained' }), ctx),
    ]),
  },
  {
    path: '/resources/title-and-abstract-screening',
    title: 'Title and Abstract Screening: A Practical Guide',
    description:
      'How to pilot eligibility criteria, choose between single and dual screening, resolve '
      + 'conflicts, and record decisions so PRISMA reporting works.',
    canonicalPath: '/resources/title-and-abstract-screening',
    component: 'src/frontend/website/pages/ScreeningGuidePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/resources-title-and-abstract-screening.js',
    navLabel: 'Title & abstract screening',
    navGroup: 'resources',
    related: [
      '/resources/what-is-a-systematic-review',
      '/resources/how-to-conduct-a-systematic-review',
      '/resources/prisma-2020-explained',
      '/features/screening',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'Title and abstract screening: a practical guide', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'Title & abstract screening', path: '/resources/title-and-abstract-screening' }), ctx),
    ]),
  },
  {
    path: '/resources/how-to-run-a-meta-analysis',
    title: 'How to Run a Meta-Analysis: Models, Heterogeneity and Interpretation',
    description:
      'A practical guide to choosing an effect measure, picking a fixed-effect or random-effects '
      + 'model, reading I-squared honestly, and knowing when not to pool.',
    canonicalPath: '/resources/how-to-run-a-meta-analysis',
    component: 'src/frontend/website/pages/MetaAnalysisGuidePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/resources-how-to-run-a-meta-analysis.js',
    navLabel: 'How to run a meta-analysis',
    navGroup: 'resources',
    related: [
      '/resources/what-is-a-systematic-review',
      '/resources/forest-plots-and-heterogeneity',
      '/resources/prisma-2020-explained',
      '/features/meta-analysis',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'How to run a meta-analysis', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'How to run a meta-analysis', path: '/resources/how-to-run-a-meta-analysis' }), ctx),
    ]),
  },

  /* ── 111.md §11 — E-E-A-T (W1-B) ── */
  {
    path: '/about',
    title: 'About PecanRev — Who We Build For and How We Build',
    description:
      'PecanRev is an end-to-end systematic review and meta-analysis platform. What it is, the '
      + 'principles behind how it handles evidence and AI, and where its limits are.',
    canonicalPath: '/about',
    component: 'src/frontend/website/pages/AboutPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.6,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/about.js',
    navLabel: 'About PecanRev',
    navGroup: 'company',
    related: [
      '/features',
      '/resources',
      '/systematic-review-software',
      '/compare',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'About', path: '/about' }), ctx),
    ]),
  },
  {
    path: '/beta-waitlist',
    title: 'Join the PecanRev Beta Waitlist',
    description:
      'Request early access to PecanRev — a professional workspace for systematic reviews: search '
      + 'building, screening, data extraction, risk of bias and meta-analysis.',
    // This route is a PREVIEW of the page that BetaWaitlistGate swaps onto '/' when the
    // betaWaitlist flag is on. It is the same content under a second URL, so it is
    // noindex AND canonicalises to '/'.
    canonicalPath: '/',
    component: 'src/frontend/pages/waitlist/BetaWaitlistPage.jsx',
    componentProps: { preview: true },
    indexable: false,
    lastmodSource: 'src/frontend/pages/waitlist/BetaWaitlistPage.jsx',
  },

  // ── 113 W1-A entries (commercial + feature + compare pages) ──────────────
  //
  // FAQ PARITY: entries carrying an `faq` array render that SAME array as visible
  // copy — the content document interpolates content/faqSection.js, which reads it
  // back off this entry. Divergence between FAQPage schema and the page is
  // therefore impossible by construction, exactly as HOMEPAGE_FAQ is for '/'.
  {
    path: '/systematic-review-software',
    title: 'Systematic Review Software for the Whole Workflow | PecanRev',
    description:
      'Systematic review software that carries one project from search strategy through screening, '
      + 'extraction, risk of bias, meta-analysis, PRISMA and the manuscript.',
    canonicalPath: '/systematic-review-software',
    component: 'src/frontend/website/pages/SystematicReviewSoftwarePage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.9,
    lastmodSource: 'src/frontend/website/content/systematic-review-software.js',
    navLabel: 'Systematic review software',
    navGroup: 'product',
    related: [
      '/features',
      '/ai-systematic-review',
      '/compare',
      '/resources/how-to-conduct-a-systematic-review',
      '/resources/what-is-a-systematic-review',
    ],
    faq: [
      {
        question: 'What is systematic review software?',
        answer:
          'It is the tooling a review team uses to run a protocol-driven evidence synthesis: building and '
          + 'recording the search, screening records against eligibility criteria, extracting data, assessing '
          + 'risk of bias, pooling results where appropriate, and reporting the whole process to a standard '
          + 'such as PRISMA 2020. Some tools cover one stage; PecanRev covers the chain.',
      },
      {
        question: 'Does PecanRev cover the whole systematic review workflow?',
        answer:
          'Yes. One project carries the research question, the search strategy, deduplication, title and '
          + 'abstract and full-text screening, data extraction, risk-of-bias assessment, meta-analysis, the '
          + 'PRISMA flow diagram and the manuscript draft. There is no export boundary between extraction and '
          + 'analysis, and the write-up reads project data rather than transcribed numbers.',
      },
      {
        question: 'Can two reviewers screen independently?',
        answer:
          'Yes. Projects are multi-user with role-based permissions. Blind review mode suppresses peers ratings, '
          + 'notes and decisions when scores are computed and when data is read, not merely in the interface. '
          + 'Data extraction supports two independent extractors plus an adjudicator whose consensus is stored '
          + 'without overwriting either original.',
      },
      {
        question: 'Does PecanRev generate the PRISMA 2020 flow diagram?',
        answer:
          'Yes, and it derives the counts from the project record ledger rather than asking you to type them in. '
          + 'Every record carries where it came from and what happened to it, the diagram is computed from those '
          + 'two facts, and structural identities are checked before you see it. A database that returned zero '
          + 'results is reported as zero rather than dropped.',
      },
      {
        question: 'Can I export a systematic review to Word?',
        answer:
          'Yes. The manuscript exports to Word with every project fact resolved against freshly fetched data at '
          + 'export time, so exported numbers match what the editor showed. Two limits worth knowing before you '
          + 'plan around them: native Word track changes is not implemented, and network meta-analysis plots are '
          + 'not included in the Word export.',
      },
      {
        question: 'Does PecanRev replace a statistics package?',
        answer:
          'For the methods it implements, yes: pooling, eight between-study variance estimators, HKSJ intervals, '
          + 'heterogeneity statistics, forest and funnel plots, small-study effects, subgroup analysis, '
          + 'meta-regression, sensitivity analysis and frequentist network meta-analysis run in the project. '
          + 'Bivariate diagnostic-accuracy models and Bayesian methods are not implemented, so those need a package.',
      },
      {
        question: 'Which kinds of review is PecanRev built for?',
        answer:
          'Intervention reviews with a quantitative synthesis, prevalence and proportion reviews using single-arm '
          + 'pooling, and reviews of case reports and case series, where several patients from one publication are '
          + 'extracted separately while the counts still report publications. Reviews that stop at narrative '
          + 'synthesis are supported too: nothing forces you to pool.',
      },
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      softwareApplicationJsonLd(ctx),
      faqJsonLd(ctx.entry.faq),
      breadcrumbJsonLd(trail({ name: 'Systematic review software', path: '/systematic-review-software' }), ctx),
    ]),
  },
  {
    path: '/ai-systematic-review',
    title: 'AI for Systematic Reviews: Exactly What Is Automated | PecanRev',
    description:
      'Which parts of PecanRev involve a model and which are deterministic: relevance ranking that '
      + 'cannot decide, optional extraction suggestions, and nothing else.',
    canonicalPath: '/ai-systematic-review',
    component: 'src/frontend/website/pages/AiSystematicReviewPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    lastmodSource: 'src/frontend/website/content/ai-systematic-review.js',
    navLabel: 'AI in systematic reviews',
    navGroup: 'product',
    related: [
      '/features/screening',
      '/features/data-extraction',
      '/systematic-review-software',
      '/resources/title-and-abstract-screening',
    ],
    faq: [
      {
        question: 'Does AI decide which studies to include?',
        answer:
          'No. The optional screening model reorders the queue by estimated relevance and there is no route by '
          + 'which it can record a decision — human final decision is enforced in code rather than as a setting. '
          + 'Extraction suggestions become data only when a person accepts or edits them, and the acceptance is '
          + 'recorded as such.',
      },
      {
        question: 'Is the screening model a large language model?',
        answer:
          'No. It is a deterministic lexical model: a TF-IDF representation of title, abstract, keywords, MeSH '
          + 'terms and journal feeding a class-weighted logistic regression trained on your own project labels, '
          + 'fused with a cold-start prior, a semantic centroid, a keyword signal and a citation-graph signal. '
          + 'No text is generated and no language model is involved.',
      },
      {
        question: 'Is my data sent to an external AI provider?',
        answer:
          'Not by default. Both external extraction paths are off unless a site administrator enables the feature '
          + 'and server-side credentials are configured, and the screening model runs in-process. When an external '
          + 'provider is enabled the server makes the request, the browser never holds credentials, and the '
          + 'citation-graph signal sends only DOIs and PMIDs.',
      },
      {
        question: 'Can a model extract data from a PDF on its own?',
        answer:
          'No. Anything a model maps is written as a draft that marks the study as needing review, only fields '
          + 'that genuinely exist on a study can be written, enumerated values are validated or dropped into a '
          + 'note, and a suggestion whose quoted evidence does not literally occur in the submitted text is '
          + 'discarded before you see it. Denominator and action-status judgements are excluded entirely.',
      },
      {
        question: 'Can I turn every model-assisted feature off?',
        answer:
          'Yes, and they start off. Screening relevance ranking, the server-proxied extraction endpoint and the '
          + 'external extraction provider are each off by default, hidden when off, and governed by a site '
          + 'administrator. The screening engine additionally has a global kill switch that overrides every other '
          + 'toggle, and text recognition for scanned PDFs runs entirely in your browser.',
      },
      {
        question: 'Is model-assisted screening acceptable in a systematic review?',
        answer:
          'Prioritisation that changes reading order while a human makes every decision is widely used, and PRISMA '
          + '2020 asks you to report any automation tools used in the process. That is why PecanRev documents what '
          + 'the model is, what it was trained on, what it may not do, and reports held-out validation metrics with '
          + 'confidence intervals rather than a single figure.',
      },
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      faqJsonLd(ctx.entry.faq),
      breadcrumbJsonLd(trail({ name: 'AI in systematic reviews', path: '/ai-systematic-review' }), ctx),
    ]),
  },
  {
    path: '/features/risk-of-bias',
    title: 'Risk of Bias Software: RoB 2, ROBINS-I and Newcastle-Ottawa | PecanRev',
    description:
      'Assess risk of bias with RoB 2, ROBINS-I and the Newcastle-Ottawa Scale: signalling questions, '
      + 'computed domain judgements you can override, and honest star scoring.',
    canonicalPath: '/features/risk-of-bias',
    component: 'src/frontend/website/pages/RiskOfBiasPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    lastmodSource: 'src/frontend/website/content/features-risk-of-bias.js',
    navLabel: 'Risk of bias',
    navGroup: 'product',
    related: [
      '/features/data-extraction',
      '/features/meta-analysis',
      '/features/manuscript',
      '/resources/risk-of-bias-assessment',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Risk of bias', path: '/features/risk-of-bias' }), ctx),
    ]),
  },
  {
    path: '/features/prisma-flow-diagram',
    title: 'PRISMA Flow Diagram Generator for Systematic Reviews | PecanRev',
    description:
      'PecanRev derives the PRISMA 2020 flow diagram from the source and disposition of every record, '
      + 'checks the counts reconcile, and exports SVG, PNG and the checklist.',
    canonicalPath: '/features/prisma-flow-diagram',
    component: 'src/frontend/website/pages/PrismaFlowDiagramPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    lastmodSource: 'src/frontend/website/content/features-prisma-flow-diagram.js',
    navLabel: 'PRISMA flow diagram',
    navGroup: 'product',
    related: [
      '/features/screening',
      '/features/search-engine',
      '/features/case-series',
      '/resources/prisma-flow-diagram-guide',
      '/resources/prisma-2020-explained',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'PRISMA flow diagram', path: '/features/prisma-flow-diagram' }), ctx),
    ]),
  },
  {
    path: '/features/network-meta-analysis',
    title: 'Network Meta-Analysis Software for Systematic Reviews | PecanRev',
    description:
      'A frequentist network meta-analysis engine with league tables, P-score ranking, node-splitting, '
      + 'design-by-treatment inconsistency and a contribution matrix.',
    canonicalPath: '/features/network-meta-analysis',
    component: 'src/frontend/website/pages/NetworkMetaAnalysisPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    lastmodSource: 'src/frontend/website/content/features-network-meta-analysis.js',
    navLabel: 'Network meta-analysis',
    navGroup: 'product',
    related: [
      '/features/meta-analysis',
      '/features/data-extraction',
      '/resources/network-meta-analysis-explained',
      '/resources/how-to-run-a-meta-analysis',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Network meta-analysis', path: '/features/network-meta-analysis' }), ctx),
    ]),
  },
  {
    path: '/features/case-series',
    title: 'Case Series Systematic Review Software | PecanRev',
    description:
      'Extract many patients from one paper as separate cases, with PRISMA still counting publications, '
      + 'an honest clustering warning, and a per-patient CSV export.',
    canonicalPath: '/features/case-series',
    component: 'src/frontend/website/pages/CaseSeriesPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.8,
    lastmodSource: 'src/frontend/website/content/features-case-series.js',
    navLabel: 'Case series mode',
    navGroup: 'product',
    related: [
      '/features/data-extraction',
      '/features/prisma-flow-diagram',
      '/features/meta-analysis',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Case series', path: '/features/case-series' }), ctx),
    ]),
  },
  /* ── the /compare section. Policy lives in content/compare-index.js. ── */
  {
    path: '/compare',
    title: 'Compare Systematic Review Software | PecanRev',
    description:
      'How PecanRev compares with the systematic review tools research teams already use, what each is '
      + 'genuinely good at, and how to choose between them.',
    canonicalPath: '/compare',
    component: 'src/frontend/website/pages/CompareIndexPage.jsx',
    indexable: true,
    ogType: 'website',
    changefreq: 'monthly',
    priority: 0.7,
    lastmodSource: 'src/frontend/website/content/compare-index.js',
    navLabel: 'Compare platforms',
    navGroup: 'compare',
    related: [
      '/compare/pecanrev-vs-covidence',
      '/compare/pecanrev-vs-rayyan',
      '/systematic-review-software',
      '/features',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Compare', path: '/compare' }), ctx),
    ]),
  },
  {
    path: '/compare/pecanrev-vs-covidence',
    title: 'PecanRev vs Covidence: Systematic Review Software Compared',
    description:
      'An honest comparison of two systematic review platforms: what Covidence is known for, how '
      + 'PecanRev differs, and which one fits the review you are running.',
    canonicalPath: '/compare/pecanrev-vs-covidence',
    component: 'src/frontend/website/pages/CompareCovidencePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.6,
    lastmodSource: 'src/frontend/website/content/compare-pecanrev-vs-covidence.js',
    navLabel: 'PecanRev vs Covidence',
    navGroup: 'compare',
    related: [
      '/compare',
      '/compare/pecanrev-vs-rayyan',
      '/features/meta-analysis',
      '/features/prisma-flow-diagram',
      '/systematic-review-software',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Compare', path: '/compare' }, { name: 'PecanRev vs Covidence', path: '/compare/pecanrev-vs-covidence' }), ctx),
    ]),
  },
  {
    path: '/compare/pecanrev-vs-rayyan',
    title: 'PecanRev vs Rayyan: Screening Tool or Review Platform?',
    description:
      'Rayyan is a fast collaborative screening app; PecanRev is an end-to-end review platform. What '
      + 'each does well and how to choose between them.',
    canonicalPath: '/compare/pecanrev-vs-rayyan',
    component: 'src/frontend/website/pages/CompareRayyanPage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.6,
    lastmodSource: 'src/frontend/website/content/compare-pecanrev-vs-rayyan.js',
    navLabel: 'PecanRev vs Rayyan',
    navGroup: 'compare',
    related: [
      '/compare',
      '/compare/pecanrev-vs-covidence',
      '/features/screening',
      '/ai-systematic-review',
      '/systematic-review-software',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Compare', path: '/compare' }, { name: 'PecanRev vs Rayyan', path: '/compare/pecanrev-vs-rayyan' }), ctx),
    ]),
  },

  // ── 113 W1-B entries (educational guides) ────────────────────────────────
  //
  // Eight methodology guides under the registry-gated /resources prefix. Each is
  // backed by a markdown body in content/, carries an Article node with honest
  // datePublished/dateModified, and is linked from RESOURCE_LINKS (siteNav.js) so
  // the orphan test in contentPages.test.jsx passes. They deliberately do NOT
  // re-cover the four 111.md guides: the flow-diagram guide is the DIAGRAM, not
  // the PRISMA 2020 checklist; forest-plots is READING a plot, not running an
  // analysis. Titles/descriptions are byte-identical to the content frontmatter
  // (pinned by contentRegistryEntries.test.js).
  {
    path: '/resources/how-to-conduct-a-systematic-review',
    title: 'How to Conduct a Systematic Review: A Step-by-Step Guide',
    description:
      'An operational eight-step walkthrough of running a systematic review, from protocol and '
      + 'search through screening, extraction, appraisal and reporting.',
    canonicalPath: '/resources/how-to-conduct-a-systematic-review',
    component: 'src/frontend/website/pages/ConductSystematicReviewPage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    // Honest lastmod: the markdown body is the thing that actually changes.
    lastmodSource: 'src/frontend/website/content/resources-how-to-conduct-a-systematic-review.js',
    navLabel: 'How to conduct a systematic review',
    navGroup: 'resources',
    related: [
      '/resources/what-is-a-systematic-review',
      '/resources/systematic-review-search-strategy',
      '/resources/data-extraction-for-systematic-reviews',
      '/resources/risk-of-bias-assessment',
      '/resources/prisma-flow-diagram-guide',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'How to conduct a systematic review', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'How to conduct a systematic review', path: '/resources/how-to-conduct-a-systematic-review' }), ctx),
    ]),
  },
  {
    path: '/resources/systematic-review-search-strategy',
    title: 'Systematic Review Search Strategy: PubMed, MeSH and Boolean Logic',
    description:
      'How to turn a review question into a reproducible search: concept blocks, MeSH and free '
      + 'text, Boolean logic, database translation and PRISMA-S documentation.',
    canonicalPath: '/resources/systematic-review-search-strategy',
    component: 'src/frontend/website/pages/SearchStrategyGuidePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    lastmodSource: 'src/frontend/website/content/resources-systematic-review-search-strategy.js',
    navLabel: 'Search strategy',
    navGroup: 'resources',
    related: [
      '/resources/how-to-conduct-a-systematic-review',
      '/resources/title-and-abstract-screening',
      '/resources/prisma-flow-diagram-guide',
      '/features/search-engine',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'How to build a systematic review search strategy', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'Search strategy', path: '/resources/systematic-review-search-strategy' }), ctx),
    ]),
  },
  {
    path: '/resources/data-extraction-for-systematic-reviews',
    title: 'Data Extraction for Systematic Reviews: Forms, Outcomes and Arms',
    description:
      'How to design and pilot an extraction form, handle continuous and dichotomous outcomes, '
      + 'multi-arm trials and case series, and keep every value traceable.',
    canonicalPath: '/resources/data-extraction-for-systematic-reviews',
    component: 'src/frontend/website/pages/DataExtractionGuidePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    lastmodSource: 'src/frontend/website/content/resources-data-extraction-for-systematic-reviews.js',
    navLabel: 'Data extraction',
    relatedLabel: 'Data extraction for systematic reviews',
    navGroup: 'resources',
    related: [
      '/resources/how-to-conduct-a-systematic-review',
      '/resources/risk-of-bias-assessment',
      '/resources/how-to-run-a-meta-analysis',
      '/features/data-extraction',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'Data extraction for systematic reviews', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'Data extraction', path: '/resources/data-extraction-for-systematic-reviews' }), ctx),
    ]),
  },
  {
    path: '/resources/risk-of-bias-assessment',
    title: 'Risk of Bias Assessment: RoB 2, ROBINS-I and Newcastle-Ottawa',
    description:
      'How to appraise included studies per outcome: the five RoB 2 domains, ROBINS-I for '
      + 'non-randomised designs, Newcastle-Ottawa scoring, and where GRADE fits.',
    canonicalPath: '/resources/risk-of-bias-assessment',
    component: 'src/frontend/website/pages/RiskOfBiasGuidePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    lastmodSource: 'src/frontend/website/content/resources-risk-of-bias-assessment.js',
    navLabel: 'Risk of bias assessment',
    navGroup: 'resources',
    related: [
      '/resources/how-to-conduct-a-systematic-review',
      '/resources/data-extraction-for-systematic-reviews',
      '/resources/forest-plots-and-heterogeneity',
      '/features/risk-of-bias',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'Risk of bias assessment in systematic reviews', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'Risk of bias assessment', path: '/resources/risk-of-bias-assessment' }), ctx),
    ]),
  },
  {
    path: '/resources/forest-plots-and-heterogeneity',
    title: 'Forest Plots and Heterogeneity: How to Read a Meta-Analysis',
    description:
      'How to read every element of a forest plot, what I-squared, tau-squared and Q measure, and '
      + 'why the fixed-effect and random-effects diamonds differ.',
    canonicalPath: '/resources/forest-plots-and-heterogeneity',
    component: 'src/frontend/website/pages/ForestPlotsGuidePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    lastmodSource: 'src/frontend/website/content/resources-forest-plots-and-heterogeneity.js',
    navLabel: 'Forest plots & heterogeneity',
    navGroup: 'resources',
    related: [
      '/resources/how-to-run-a-meta-analysis',
      '/resources/publication-bias',
      '/resources/network-meta-analysis-explained',
      '/features/meta-analysis',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'How to read a forest plot', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'Forest plots & heterogeneity', path: '/resources/forest-plots-and-heterogeneity' }), ctx),
    ]),
  },
  {
    path: '/resources/publication-bias',
    title: "Publication Bias: Funnel Plots, Egger's Test and Trim-and-Fill",
    description:
      "What publication bias is, how to read a funnel plot, when Egger's and Begg's tests are "
      + 'informative, and what trim-and-fill can and cannot correct.',
    canonicalPath: '/resources/publication-bias',
    component: 'src/frontend/website/pages/PublicationBiasGuidePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    lastmodSource: 'src/frontend/website/content/resources-publication-bias.js',
    navLabel: 'Publication bias',
    navGroup: 'resources',
    related: [
      '/resources/forest-plots-and-heterogeneity',
      '/resources/how-to-run-a-meta-analysis',
      '/resources/systematic-review-search-strategy',
      '/features/meta-analysis',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'Publication bias and small-study effects', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'Publication bias', path: '/resources/publication-bias' }), ctx),
    ]),
  },
  {
    path: '/resources/network-meta-analysis-explained',
    title: 'Network Meta-Analysis Explained: Geometry and Indirect Evidence',
    description:
      'What a network meta-analysis estimates, how indirect evidence is formed, why transitivity '
      + 'matters, how consistency is tested and how to read rankings.',
    canonicalPath: '/resources/network-meta-analysis-explained',
    component: 'src/frontend/website/pages/NetworkMetaAnalysisGuidePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    lastmodSource: 'src/frontend/website/content/resources-network-meta-analysis-explained.js',
    navLabel: 'Network meta-analysis',
    relatedLabel: 'Network meta-analysis explained',
    navGroup: 'resources',
    related: [
      '/resources/how-to-run-a-meta-analysis',
      '/resources/forest-plots-and-heterogeneity',
      '/resources/data-extraction-for-systematic-reviews',
      '/features/network-meta-analysis',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'Network meta-analysis explained', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'Network meta-analysis', path: '/resources/network-meta-analysis-explained' }), ctx),
    ]),
  },
  {
    path: '/resources/prisma-flow-diagram-guide',
    title: 'PRISMA Flow Diagram Guide: Boxes, Counts and Common Mistakes',
    description:
      'Which PRISMA 2020 flow template to use, what each box counts, where every number comes '
      + 'from, and the arithmetic errors peer reviewers catch most often.',
    canonicalPath: '/resources/prisma-flow-diagram-guide',
    component: 'src/frontend/website/pages/PrismaFlowDiagramGuidePage.jsx',
    indexable: true,
    ogType: 'article',
    changefreq: 'monthly',
    priority: 0.7,
    lastmodSource: 'src/frontend/website/content/resources-prisma-flow-diagram-guide.js',
    navLabel: 'PRISMA flow diagram',
    relatedLabel: 'PRISMA flow diagram guide',
    navGroup: 'resources',
    related: [
      '/resources/prisma-2020-explained',
      '/resources/title-and-abstract-screening',
      '/resources/systematic-review-search-strategy',
      '/features/prisma-flow-diagram',
    ],
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'How to build the PRISMA 2020 flow diagram', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'PRISMA flow diagram', path: '/resources/prisma-flow-diagram-guide' }), ctx),
    ]),
  },
];

/* ─────────────────────────── registry lookups ───────────────────────────── */

const BY_PATH = new Map(PUBLIC_PAGES.map((e) => [e.path, e]));

/** Exact-match lookup. Trailing slashes are NOT tolerated — they 301 instead. */
export function getPublicPage(pathname) {
  return BY_PATH.get(pathname);
}

/** True when `pathname` is exactly a registry path. */
export function isRegistryPath(pathname) {
  return BY_PATH.has(pathname);
}

/** Entries a crawler may index — the llms.txt set, and the base for sitemapPages(). */
export function indexablePages() {
  return PUBLIC_PAGES.filter((e) => e.indexable !== false);
}

/**
 * Entries listed in sitemap.xml — indexable AND not opted out with `sitemap: false`.
 *
 * 113 §2: a sitemap is a submission for crawling, not an inventory of every URL that
 * happens to answer 200. /login and /register are permanently public and stay
 * indexable (the navigational query "PecanRev login" should resolve here, not to a
 * third party) but they carry no content a crawler benefits from fetching, and a
 * sitemap full of auth forms dilutes the signal for the pages that do. They remain in
 * llms.txt, where "where do I sign in" is a question worth answering.
 */
export function sitemapPages() {
  return indexablePages().filter((e) => e.sitemap !== false);
}

/**
 * The label another page uses when it links to `entry` from a related-links block.
 * `navLabel` is written for a footer column whose heading disambiguates it, so an
 * entry may override it with `relatedLabel` (see the ENTRY CONTRACT).
 */
export function relatedLabelFor(entry) {
  if (!entry) return '';
  return entry.relatedLabel || entry.navLabel || entry.title;
}

/**
 * 113 §5 — resolve one page's `related` paths into renderable links.
 *
 * THE registry is the single source of membership and order; `notes` supplies only
 * the editorial one-liner each link carries (keyed by target path, authored next to
 * the page that shows it). A path with no registry entry is dropped rather than
 * rendered as a dead link — but tests/unit/seo/publicPagesRegistry.test.js fails the
 * build long before that can ship, so the guard is belt-and-braces, not a policy.
 *
 * @param {string} pathname the page doing the linking
 * @param {Record<string,string>} [notes] targetPath → note
 * @returns {{path:string,label:string,note?:string}[]}
 */
export function resolveRelated(pathname, notes) {
  const entry = getPublicPage(pathname);
  if (!entry || !Array.isArray(entry.related)) return [];
  const out = [];
  for (const target of entry.related) {
    const to = getPublicPage(target);
    if (!to) continue;
    const note = notes && typeof notes[target] === 'string' ? notes[target] : undefined;
    out.push({ path: target, label: relatedLabelFor(to), ...(note ? { note } : {}) });
  }
  return out;
}

/** True when the path must carry `X-Robots-Tag: noindex, nofollow`. */
export function isNonIndexablePath(pathname) {
  const entry = getPublicPage(pathname);
  if (entry) return entry.indexable === false;
  return NON_INDEXABLE_PATTERNS.some((r) => matchPattern(pathname, r));
}

/**
 * The KNOWN_SPA_PREFIXES rule a path matches, or null.
 *
 * The classifier needs the RULE, not just a boolean, because a `registryGated`
 * prefix only covers the children PUBLIC_PAGES declares (see KNOWN_SPA_PREFIXES).
 */
export function matchSpaRule(pathname) {
  return KNOWN_SPA_PREFIXES.find((r) => matchPattern(pathname, r)) || null;
}

/**
 * True when the path is covered by a route src/App.jsx actually declares.
 *
 * NOTE: this is ROUTE COVERAGE, not "is a real page" — a registry-gated prefix
 * answers true for its unknown children too. `isServeableSpaPath` is the question
 * the edge middleware asks.
 */
export function isKnownSpaPath(pathname) {
  return matchSpaRule(pathname) != null;
}

/**
 * True when the SPA shell should be served for this path with a 200.
 *
 * Differs from isKnownSpaPath on exactly one case: a child of a `registryGated`
 * prefix that PUBLIC_PAGES does not declare (/features/bogus, /resources/nope,
 * /features/screening/x) is NOT serveable — it is a genuine 404.
 */
export function isServeableSpaPath(pathname) {
  const rule = matchSpaRule(pathname);
  if (!rule) return false;
  if (!rule.registryGated) return true;
  return isRegistryPath(stripTrailingSlash(pathname));
}

/** The permanent-redirect rule for a path, if any (case/slash-insensitive). */
export function findRedirect(pathname) {
  const p = normalizePath(pathname);
  return PERMANENT_REDIRECTS.find((r) => r.from === p) || null;
}
