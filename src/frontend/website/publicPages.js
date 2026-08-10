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
 *   description    REQUIRED  string  meta[name=description]. Honest, ~110-165 chars.
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
 *   navGroup       optional  string  Footer/nav grouping key.
 *
 * INVARIANTS enforced by tests/unit/seo/publicPagesRegistry.test.js:
 *   - `path` and `canonicalPath` are lowercase, start with '/', and carry no
 *     trailing slash (except the root '/').
 *   - Among INDEXABLE entries, `title`, `description` and `canonicalPath` are
 *     each unique (non-indexable entries may share a canonical with their
 *     original — that is the point of a canonical).
 *   - No registry path may also match NON_INDEXABLE_PATTERNS.
 *   - Every registry path is covered by KNOWN_SPA_PREFIXES.
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
  'PecanRev is a systematic review and meta-analysis platform with screening, data extraction, '
  + 'risk of bias, search building, project collaboration, and a complete review workflow.';

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
 */
export const KNOWN_SPA_PREFIXES = [
  { pattern: '/', kind: 'exact' },                       // Landing (BetaWaitlistGate)
  { pattern: '/beta-waitlist', kind: 'exact' },
  { pattern: '/terms', kind: 'exact' },
  { pattern: '/features', kind: 'prefix' },              // 111.md §8 — feature landing pages
  { pattern: '/resources', kind: 'prefix' },             // 111.md §9 — methodology guides
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
    '@id': absoluteUrl('/', origin) + JSONLD_IDS.organization.slice(1),
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
    '@id': absoluteUrl('/', origin) + JSONLD_IDS.website.slice(1),
    name: SITE_NAME,
    url: absoluteUrl('/', origin),
    description: SITE_DESCRIPTION,
    inLanguage: 'en',
    publisher: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.organization.slice(1) },
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
    '@id': absoluteUrl('/', origin) + JSONLD_IDS.software.slice(1),
    name: SITE_NAME,
    url: absoluteUrl('/', origin),
    description: SITE_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Research software',
    operatingSystem: 'Web',
    browserRequirements: 'Requires a modern browser with JavaScript enabled.',
    featureList: PRODUCT_FEATURES,
    publisher: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.organization.slice(1) },
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
    isPartOf: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.website.slice(1) },
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
    isPartOf: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.website.slice(1) },
    author: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/', origin) },
    publisher: { '@id': absoluteUrl('/', origin) + JSONLD_IDS.organization.slice(1) },
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
  },
  {
    path: '/register',
    title: 'Create your PecanRev account',
    description:
      'Create a PecanRev account to start a systematic review project: build searches, screen '
      + 'studies with a co-reviewer, extract data, and run meta-analyses in one workspace.',
    canonicalPath: '/register',
    component: 'src/frontend/pages/Register.jsx',
    // Same reasoning as /login.
    indexable: true,
    changefreq: 'monthly',
    priority: 0.3,
    lastmodSource: 'src/frontend/pages/Register.jsx',
    navLabel: 'Create account',
    navGroup: 'account',
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
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }), ctx),
    ]),
  },
  {
    path: '/features/search-engine',
    title: 'Systematic Review Search Strategy Builder | PecanRev Search Engine',
    description:
      'Build a systematic review search from your research question, add MeSH terms with full scope '
      + 'notes, and compile paste-ready queries for 16 databases with honest per-database vocabulary '
      + 'warnings.',
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
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Search engine', path: '/features/search-engine' }), ctx),
    ]),
  },
  {
    path: '/features/screening',
    title: 'Title, Abstract & Full-Text Screening Software | PecanRev',
    description:
      'Screen citations with a keyboard-first workbench, keyword highlighting drawn from your '
      + 'eligibility criteria, server-side duplicate detection, and optional relevance ranking that '
      + 'never records a decision for you.',
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
      + 'confidence intervals with cited formulas, and extract many patient cases from a single case '
      + 'series.',
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
      + 'intervals, subgroup and meta-regression, leave-one-out diagnostics and frequentist network '
      + 'meta-analysis.',
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
      + 'live tokens resolved from project data, with change tracking, provenance and Word export.',
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
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Features', path: '/features' }, { name: 'Manuscript editor', path: '/features/manuscript' }), ctx),
    ]),
  },

  /* ── 111.md §9 — cornerstone methodology guides (W1-B) ── */
  {
    path: '/resources',
    title: 'Systematic Review Methodology Guides | PecanRev Resources',
    description:
      'Practical, cited guides to systematic review methodology — what a systematic review is, '
      + 'PRISMA 2020 reporting, title and abstract screening, and running a meta-analysis.',
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
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }), ctx),
    ]),
  },
  {
    path: '/resources/what-is-a-systematic-review',
    title: 'What Is a Systematic Review? Definition, Steps and Standards',
    description:
      'A systematic review answers a defined question using a pre-specified, reproducible method. '
      + 'This guide explains what separates it from a literature review, the standard steps, and the '
      + 'reporting rules that govern it.',
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
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'What is a systematic review?', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'What is a systematic review?', path: '/resources/what-is-a-systematic-review' }), ctx),
    ]),
  },
  {
    path: '/resources/prisma-2020-explained',
    title: 'PRISMA 2020 Explained: Checklist, Flow Diagram and Common Mistakes',
    description:
      'What changed in PRISMA 2020, what the 27-item checklist actually asks for, how to build the '
      + 'flow diagram correctly, and the reporting errors that reviewers catch most often.',
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
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'PRISMA 2020 explained', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'PRISMA 2020 explained', path: '/resources/prisma-2020-explained' }), ctx),
    ]),
  },
  {
    path: '/resources/title-and-abstract-screening',
    title: 'Title and Abstract Screening: A Practical Guide',
    description:
      'How to pilot eligibility criteria, decide between single and dual screening, resolve '
      + 'conflicts, use screening automation responsibly, and record decisions so PRISMA reporting '
      + 'works.',
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
    jsonLd: (ctx) => jsonLdGraph([
      contentArticleJsonLd({ ...ctx.entry, articleHeadline: 'Title and abstract screening: a practical guide', datePublished: '2026-08-09', dateModified: '2026-08-09' }, ctx),
      breadcrumbJsonLd(trail({ name: 'Resources', path: '/resources' }, { name: 'Title & abstract screening', path: '/resources/title-and-abstract-screening' }), ctx),
    ]),
  },
  {
    path: '/resources/how-to-run-a-meta-analysis',
    title: 'How to Run a Meta-Analysis: Models, Heterogeneity and Interpretation',
    description:
      'A practical guide to choosing an effect measure, deciding between fixed-effect and '
      + 'random-effects models, reading I-squared honestly, and knowing when not to pool at all.',
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
      'PecanRev is an end-to-end systematic review and meta-analysis platform. This page explains '
      + 'what it is, the principles behind how it handles evidence and AI, and where its limits are.',
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
    jsonLd: (ctx) => jsonLdGraph([
      webPageJsonLd(ctx.entry, ctx),
      breadcrumbJsonLd(trail({ name: 'About', path: '/about' }), ctx),
    ]),
  },
  {
    path: '/beta-waitlist',
    title: 'Join the PecanRev Beta Waitlist',
    description:
      'Request early access to PecanRev — a professional workspace for systematic reviews and '
      + 'meta-analyses: search building, screening, data extraction, risk of bias, and meta-analysis.',
    // This route is a PREVIEW of the page that BetaWaitlistGate swaps onto '/' when the
    // betaWaitlist flag is on. It is the same content under a second URL, so it is
    // noindex AND canonicalises to '/'.
    canonicalPath: '/',
    component: 'src/frontend/pages/waitlist/BetaWaitlistPage.jsx',
    componentProps: { preview: true },
    indexable: false,
    lastmodSource: 'src/frontend/pages/waitlist/BetaWaitlistPage.jsx',
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

/** Entries eligible for sitemap.xml / llms.txt. */
export function indexablePages() {
  return PUBLIC_PAGES.filter((e) => e.indexable !== false);
}

/** True when the path must carry `X-Robots-Tag: noindex, nofollow`. */
export function isNonIndexablePath(pathname) {
  const entry = getPublicPage(pathname);
  if (entry) return entry.indexable === false;
  return NON_INDEXABLE_PATTERNS.some((r) => matchPattern(pathname, r));
}

/** True when the path is a route src/App.jsx actually declares. */
export function isKnownSpaPath(pathname) {
  return KNOWN_SPA_PREFIXES.some((r) => matchPattern(pathname, r));
}

/** The permanent-redirect rule for a path, if any (case/slash-insensitive). */
export function findRedirect(pathname) {
  const p = normalizePath(pathname);
  return PERMANENT_REDIRECTS.find((r) => r.from === p) || null;
}
