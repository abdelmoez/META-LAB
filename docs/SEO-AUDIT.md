# SEO Audit — before / after

Audit of PecanRev's public discoverability, covering the state before 111.md and the
state after it shipped. Architecture detail: [`SEO-ARCHITECTURE.md`](./SEO-ARCHITECTURE.md).
Externally-owned follow-up: [`SEO-GROWTH-PLAN.md`](./SEO-GROWTH-PLAN.md).

---

## 1. Before

PecanRev was a client-rendered SPA served by Express with a single `serveSpa` handler.
The consequences, in severity order:

| # | Finding | Severity | Why it mattered |
|---|---|---|---|
| 1 | **Universal soft 404.** Every non-API GET returned `dist/index.html` with HTTP 200 — including typos, dead backlinks and crawler probes. The body said "Page not found"; the status said "this is a page." | **Critical** | The site's URL space looked infinite. Crawl budget was spent on nonexistent URLs and index quality signals were poisoned. |
| 2 | **Two indexable routes in practice.** `/` and `/terms` were the only public content. Everything else was the authenticated app. | **Critical** | Nothing to rank for any of the ~45 target queries in 111.md §1. |
| 3 | **A single static `<head>`.** `index.html` carried one title, one description, no canonical, and every route inherited them. | **Critical** | No route could ever have a distinct snippet, and duplicate titles across a site are treated as duplicate pages. |
| 4 | **No `sitemap.xml`.** | High | No way to declare the URL set or its freshness. |
| 5 | **No JSON-LD anywhere.** No `Organization`, `SoftwareApplication`, `BreadcrumbList`, `FAQPage` or `Article`. | High | No entity understanding — the failure mode that also blinds answer engines. |
| 6 | **No OG image, no Twitter card.** Every share rendered as a bare link. | High | Zero social/AI preview surface. |
| 7 | **No `llms.txt`, no prerendering.** Crawlers that do not execute JavaScript saw an empty `<div id="root">`. | High | AI/answer-engine crawlers got nothing at all. |
| 8 | **No `X-Robots-Tag`.** The authenticated app, the token URLs and the staff consoles relied on nothing but obscurity. | Medium | Token URLs (`/invite/:token`, `/reset?token=`) were indexable in principle. |
| 9 | **`/privacy` was a client-side `<Navigate>`.** | Medium | A soft 200 where a 301 belonged; link equity from any inbound `/privacy` link was lost. |
| 10 | **No canonicalisation.** `/terms/`, `/Terms` and `/terms` were three 200s. | Medium | Self-inflicted duplicate content. |
| 11 | **`robots.txt` present but static and drifting** from the real route table. | Medium | A rule list nobody could verify. |
| 12 | **No public product or methodology content.** | High | Nothing citation-worthy; no basis for organic authority. |

---

## 2. After — shipped inventory

### Routing and status codes
- Real **HTTP 404** for any path `src/App.jsx` does not declare, with the SPA shell as
  the body so `<NotFound/>` still renders.
- **301** `/privacy → /terms#privacy` (query preserved), mirrored into the Vite dev
  server from the same table.
- **301** canonicalisation of trailing-slash and upper-case spellings, **registry paths
  only** — `/App` stays an honest 404.
- `/__prerender/**` returns 404: the build artefacts are not a public URL space.
- Decision logic is a pure function (`classifyRequest`) unit-tested over a full path
  matrix.

### Indexability
- **17 registry entries; 16 indexable**, one (`/beta-waitlist`) explicitly not.
- `X-Robots-Tag: noindex, nofollow` on all authenticated, tokenised, staff and
  `indexable: false` surfaces, plus a matching `<meta name="robots">` at runtime.
- `/login` and `/register` kept indexable-but-low-priority on purpose.

### Metadata
- Per-page `<title>`, meta description, canonical, OG and Twitter tags from one
  registry, applied by the prerenderer at build time for all 17 entries and by
  `usePageHead.js` at runtime for all 16 indexable routes (5 components call it directly,
  the rest inherit the call from `PageShell` — see gap #4 below, now closed).
- `og-image.png` plus `favicon.svg`, `icon-192.png`, `icon-512.png`,
  `apple-touch-icon.png` and `site.webmanifest`.

### Structured data
- `Organization` + `SoftwareApplication` on `/`; `BreadcrumbList` on every nested page;
  `FAQPage` built from the *visible* homepage FAQ (`HOMEPAGE_FAQ`, shared with the
  Landing component); `Article` on the four guides. `/login` and `/register` carry none,
  deliberately.

### Prerendering
- `dist/__prerender` — **17/17** pages rendered at build time, served by the Express
  edge. Guarded by a **CSP inline-script byte-identity** check and a **one-`<h1>`**
  check; an indexable page that fails to render fails the build.

### Crawler files
- `sitemap.xml` (16 URLs, honest `lastmod` from git or omitted), `robots.txt`
  (Disallow list generated from `NON_INDEXABLE_PATTERNS` + a `Sitemap:` line),
  `llms.txt` (plain-language capability description).

### Content
- **12 public content pages**: 5 feature pages, 4 cornerstone guides
  (`what-is-a-systematic-review`, `prisma-2020-explained`,
  `title-and-abstract-screening`, `how-to-run-a-meta-analysis`), the `/features` and
  `/resources` hubs, and `/about` — built on a content-data + minimal-markdown
  infrastructure with real, checkable citations and a hub/spoke internal-link graph.

### Tests
- `tests/unit/seo/` — 9 suites: registry, middleware path matrix, generators, head
  builder, SSR head string, markdown renderer, content pages, content registry entries,
  assets.
- `e2e/seo/seo.spec.ts` — 3 groups / 30 chromium tests: runtime head, crawler-visible
  head for all 16 routes, and the server-owned crawler semantics. The last two
  self-skip against a dev-only target. **30/30 green** against a live stack.

---

## 3. Before → after at a glance

| Signal | Before | After |
|---|---|---|
| Indexable public routes | 2 | 16 |
| Unknown-URL status | 200 (soft 404) | 404 |
| Distinct `<title>`/description | 1 for the whole site | 16 distinct |
| Canonical links | 0 | 16 |
| JSON-LD blocks | 0 | 14 pages |
| Prerendered HTML | 0 | 17 |
| `sitemap.xml` | absent | 16 URLs |
| `llms.txt` | absent | present |
| `robots.txt` | static, drifting | generated from the route table |
| OG image / Twitter card | absent | present sitewide |
| `X-Robots-Tag` on private surfaces | absent | 12 pattern families |
| Permanent redirects | 0 (one client-side `<Navigate>`) | 1 × 301 + case/slash canonicalisation |
| SEO unit tests | 0 | 9 suites |
| SEO E2E spec files | 0 | 1 |

---

## 4. Verification commands

```bash
# Unit suites (includes tests/unit/seo/)
npm run test:ci
npm run lint

# Full build: vite build → prerender 17/17 + sitemap.xml + robots.txt + llms.txt.
# Fails hard on a CSP inline-script drift or a page without exactly one <h1>.
npm run build

# Artefacts
ls dist/__prerender                    # 17 index.html files (incl. the root)
grep -c '<url>' dist/sitemap.xml       # 16
grep 'Disallow: /ops' dist/robots.txt
head -5 dist/llms.txt

# E2E (needs a running stack; the server-owned half needs Express + a build)
npx playwright test --list e2e/seo/seo.spec.ts
npx playwright test e2e/seo/seo.spec.ts

# Live HTTP spot-checks against the Express server (:3001)
curl -sI http://localhost:3001/nope-does-not-exist   | head -1   # 404
curl -sI http://localhost:3001/privacy               | head -3   # 301 → /terms#privacy
curl -sI http://localhost:3001/app | grep -i x-robots-tag        # noindex, nofollow
curl -sI http://localhost:3001/__prerender/terms/index.html | head -1  # 404
```

---

## 5. Remaining gaps

Technical, in the code:

1. **The prerendered `/` ignores the runtime `betaWaitlist` flag.** The build renders
   the Landing page; if the flag is later switched on, anonymous visitors are gated
   client-side while the prerendered bytes still show the landing markup. Acceptable
   today (the flag is off, and the head is identical either way), but a flag flip needs
   a rebuild.
2. **12 of 16 sitemap entries have no `<lastmod>`.** The content files were untracked
   when the sitemap was generated, and the generator refuses to invent a date. This
   self-heals on the first build after the files are committed.
3. **No `hreflang`.** There is no translated content; the architecture supports it later.
4. ~~**The twelve content pages never call `usePageHead`.**~~ **Fixed.** `ArticlePage` →
   `PageShell` rendered without it, so their head existed only in the prerendered
   document: crawlers were fine, but the dev server and any client-side navigation showed
   the shell's head — twelve identical titles in the browser. Found by
   `e2e/seo/seo.spec.ts`; `PageShell` now looks its own entry up from `useLocation()` and
   calls `usePageHead`, so all 16 indexable routes manage their head at runtime. See
   `SEO-ARCHITECTURE.md` §2.
5. **The markdown renderer has no table support.** Content needing a comparison table
   currently needs a JSX page rather than a content module.
6. **Coverage gaps in Tier-2 keywords with real product behind them** — risk of bias,
   network meta-analysis, PRISMA flow diagram, case-series extraction, living reviews —
   have no dedicated page yet. See `SEO-GROWTH-PLAN.md` §2.

Policy, recorded rather than resolved:

7. **The admin 404-cloak vs. the anti-cloaking rule.** `/ops` and `/sift-beta` serve a
   404 to non-admins including crawlers. This differentiates on *identity*, not
   user-agent — an anonymous browser sees exactly what a crawler sees — and it is a
   pre-existing security control. Kept deliberately; see `SEO-ARCHITECTURE.md` §3.

Externally owned, documented but **not implemented** (see `SEO-GROWTH-PLAN.md`):

8. Google Search Console and Bing Webmaster Tools registration, sitemap submission,
   analytics, backlink and PR strategy, content cadence, and all monitoring. Nothing in
   the codebase performs or simulates any of these.
