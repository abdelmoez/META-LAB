# SEO, AEO, GEO & AI Discoverability Overhaul — 111.md

Round report. The system itself is documented in
[`SEO-ARCHITECTURE.md`](./SEO-ARCHITECTURE.md); the before/after ledger in
[`SEO-AUDIT.md`](./SEO-AUDIT.md); the externally-owned follow-up in
[`SEO-GROWTH-PLAN.md`](./SEO-GROWTH-PLAN.md).

---

## 1. What was inspected before anything was written

111.md §3 asks for a full audit before architectural decisions, so the round started
read-only:

- **Rendering + routing** — `index.html`, `src/main.jsx`, `src/App.jsx` (the complete
  route table, including which routes are cloaked and which are token-scoped),
  `vite.config.js`.
- **The serving edge** — `server/index.js` mount order, `serveSpa`, `spaTheme.js`
  (brand/theme injection), `server/security/csp.js` (where the inline-script hashes
  come from and when they are computed).
- **The existing public surface** — the Landing page, `/terms`, the auth pages, and the
  `<Navigate>` that stood in for `/privacy`.
- **Static assets** — `public/`, the manifest, the icon set, the font loading strategy.
- **Test infrastructure** — `tests/unit/**` conventions and the Playwright suite's
  fixtures (`anonTest`, `helpers/env.ts`) so the new work matched them.

Two findings shaped everything after: (a) **every** non-API GET returned the shell with
HTTP 200, so the whole site was a soft 404 generator; and (b) the head was a single
static block, so no route could ever differ from another. Both are structural, so the
fix had to be structural — one registry, consumed everywhere — rather than per-page tags.

---

## 2. Architecture chosen

**One registry, four consumers.** `src/frontend/website/publicPages.js` is plain ESM
with no React and no server imports, which is the property that lets the runtime head
manager, the Express middleware, the build-time prerenderer and the crawler-file
generators all read the same objects. Adding a public page is one object literal plus a
route; sitemap, robots, prerender, canonical, OG and JSON-LD follow automatically.

The alternatives were rejected deliberately: per-page `<Helmet>`-style tags drift from
the sitemap; a hand-maintained sitemap drifts from the router; adopting a meta-framework
would have been a rewrite of a working SPA for a documentation problem.

Three guards make the system self-defending rather than self-documenting:

1. **CSP inline-script byte-identity** — a prerendered page whose inline scripts differ
   from `dist/index.html` by one byte would be blocked by `script-src` at runtime and
   flash the wrong theme. The prerenderer compares them and exits nonzero.
2. **Exactly one `<h1>` per page** — counted at build time, not left to review. (It
   asserted only *presence* until review caught it; a page emitting two h1s shipped
   green. `e2e/seo/seo.spec.ts` now counts the served document too.)
3. **`classifyRequest` is pure** — the entire 404/301/noindex decision is a function
   over a path, unit-tested across a full matrix, with no Express objects in it.

A fourth guard was added after review: `KNOWN_SPA_PREFIXES` rules carry
`registryGated`, and `tests/unit/seo/publicPagesRegistry.test.js` asserts a prefix is
gated **exactly when** it has no parameterised child in `src/App.jsx`. `/features` and
`/resources` have none, so an unknown child (`/features/bogus`) is a real 404 rather
than a 200 shell — see §5.10.

---

## 3. Deliverables vs. 111.md's demands

| 111.md | Demand | Delivered |
|---|---|---|
| §1, §69 | Discoverability for the systematic-review / meta-analysis query space | 16 indexable routes; 12 content pages across Tier 1–3 clusters; remaining clusters mapped in `SEO-GROWTH-PLAN.md` §2 |
| §2, §67 | AEO / GEO / entity signals | `llms.txt`; `Organization` + `SoftwareApplication` + `BreadcrumbList` + `FAQPage` + `Article` JSON-LD; prerendered HTML so non-JS crawlers see real content |
| §3 | Audit first | §1 above; findings table in `SEO-AUDIT.md` §1 |
| §5 | Status codes, redirects, canonicalisation | `server/middleware/publicPages.js`: real 404s, 301 `/privacy → /terms#privacy`, registry-only slash/case 301s, `/__prerender/**` 404 |
| §5 | Indexability control | `NON_INDEXABLE_PATTERNS` → `X-Robots-Tag` + robots.txt Disallow + sitemap exclusion, from one list |
| — | Per-page metadata | `usePageHead.js`; identical builder used by the prerenderer |
| §3 | Rendering for crawlers | `scripts/prerender-public.mjs`, 17/17, CSP + one-`<h1>` guards |
| — | Crawler files | `scripts/seo/generators.js` → `sitemap.xml`, `robots.txt`, `llms.txt`; honest-`lastmod` policy |
| — | Content | 5 feature pages, 4 cornerstone guides, 2 hubs, `/about`, on a content-data + markdown infrastructure with real citations |
| — | Assets | `og-image.png`, icon set, `site.webmanifest`, preconnected + subsetted web fonts |
| §65 | Do not index the app | 12 pattern families noindexed; zero app states in the sitemap |
| §66 | No black-hat | No hidden text, no doorway pages, no invented schema. `FAQPage` is built from the FAQ that is visibly on the page. `<lastmod>` is omitted rather than invented. The one formal tension — the admin 404-cloak — is documented, not hidden (§5 below) |
| §68, §69 | Brand signal + content roadmap | `SEO-GROWTH-PLAN.md` §§2–5, explicitly marked unimplemented |
| §70 | Ops SEO panel | **Not built.** 111.md says "only implement what can be accurate and maintainable"; a panel needs GSC data that does not exist yet. Scoped in `SEO-GROWTH-PLAN.md` §7 |
| §71 | Changelog / versioning | This report + `SEO-ARCHITECTURE.md` §11 |
| §72 | Three documents | `SEO-ARCHITECTURE.md`, `SEO-GROWTH-PLAN.md`, `SEO-AUDIT.md` |
| §73 | Closing audit | `SEO-AUDIT.md` §§2–5 |

---

## 4. Verification

| Check | Command | Result |
|---|---|---|
| Unit suites | `npm run test:ci` | **474 files / 8351 tests green** (incl. 10 suites under `tests/unit/seo/`) |
| Lint | `npm run lint` | **clean** |
| Build + prerender | `npm run build` | **17/17** prerendered; CSP byte-identity guard passed; exactly-one-`<h1>` guard passed |
| Sitemap | `grep -c '<url>' dist/sitemap.xml` | **16** |
| Robots | `grep 'Disallow: /ops' dist/robots.txt` | present, plus `Sitemap:` |
| llms.txt | `head dist/llms.txt` | present, plain-language |
| E2E executed | `npx playwright test e2e/seo --project=chromium --workers=1` | **44/44 passed** against a live stack (`:3000` Vite + `:3001` built server) |

`e2e/seo/seo.spec.ts` is split into three groups, and the split is a finding, not a
style choice (see §5.7).

1. **Runtime head** on `baseURL`, for all 16 indexable routes (every one of them applies
   `usePageHead` — directly, or through `PageShell`), ending with one real click-through
   from `/` to `/features/screening`. Every read is retry-based: these components are `lazy()`, so the
   effect runs *after* the load event `page.goto()` resolves on, and a bare
   `page.title()` reads index.html's shell defaults. The gate is a web-first assertion
   on `og:url` — the shell ships `https://pecanrev.com` (no trailing slash) and
   usePageHead overwrites it with the canonical, which is `https://pecanrev.com/` even
   for `/`, so the applied value differs from the shell for every path. No fixed waits
   anywhere in the file.
2. **Crawler-visible head** for all 16 routes, navigated against the Express origin
   where the prerendered document is served: distinct title, description, canonical,
   exactly one `<h1>`, parseable JSON-LD.
3. **Server-owned semantics** through a request context on `API_URL` with
   `maxRedirects: 0` (a followed 301 is an unasserted 301): 404s, the 301s,
   `X-Robots-Tag`, sitemap/robots/llms, the no-JS prerender check, and the
   `/__prerender/**` 404.

Groups 2 and 3 share one `GET /robots.txt` probe in a file-level `beforeAll` and
self-skip with the reason if it does not come back built, so a dev-only run is green
rather than red. Everything is logged-out (`anonTest`) — `PublicRoute` bounces an
authenticated session off `/`, `/login` and `/register`.

---

## 5. Known limitations / follow-ups

1. **The prerendered `/` ignores the runtime `betaWaitlist` flag.** The build always
   renders Landing. With the flag on, an anonymous visitor is gated client-side while
   the prerendered bytes still describe the landing page. The head is identical either
   way and the flag is currently off, so this is latent — but flipping the flag for
   real needs a rebuild, not just a settings save.
2. ~~**12 of the 16 sitemap entries carry no `<lastmod>`.**~~ **Resolved, as predicted.**
   `lastmod` comes from `git log -1 --format=%cI <lastmodSource>`, and the content files
   were untracked when the sitemap was first generated; the generator omits the element
   rather than inventing a date. Now that they are committed, `npm run build` reports
   `sitemap.xml: 16 URLs (16 with a real git <lastmod>)`.
3. **The admin 404-cloak vs. §66's anti-cloaking prohibition.** `/ops` and `/sift-beta`
   serve a 404 to everyone who is not an admin, crawlers included. We kept it: the
   differentiator is *identity, not user-agent* (an anonymous browser sees exactly what
   Googlebot sees), it is a pre-existing security control asserted by the permissions
   E2E suite, and the pages must never be indexed anyway. Recorded as a permanent,
   conscious exception in `SEO-ARCHITECTURE.md` §3 rather than quietly resolved.
4. **No `hreflang`.** There is no translated content, so emitting it would be a claim
   about pages that do not exist. The architecture (per-entry canonical, origin-aware
   `absoluteUrl`) supports adding it when there is something to point at.
5. **Search-Console-class work is documented, not implemented.** GSC/Bing registration,
   sitemap submission, analytics wiring, backlink and PR strategy, content cadence and
   all monitoring are externally owned. `SEO-GROWTH-PLAN.md` opens by saying so; no code
   in this round performs or simulates any of it, and nothing claims a ranking outcome.
6. **The markdown renderer has no table support.** `markdown/parseMarkdown.js` covers
   headings, paragraphs, lists, links and inline emphasis/code, with no HTML passthrough
   (deliberate — content files must not be able to inject markup). A page that needs a
   comparison table has to be JSX today. Comparison tables are a Tier-2 content
   opportunity, so this is the first thing likely to need extending.
7. **The twelve content pages never called `usePageHead` — found by the E2E run,
   FIXED in this round.** Only five components did: Landing, Terms, Login, Register,
   BetaWaitlist. The content pages render through `ArticlePage` → `PageShell`, and
   neither called it, so their head existed **only** in the prerendered document.
   Crawlers were unaffected throughout — they receive the prerendered HTML — but the
   runtime head was wrong on the Vite dev server and after any client-side navigation:
   all twelve inherited index.html's shell title/description/canonical, so twelve pages
   looked identical in the browser tab and to anything reading the head post-hydration.

   `PageShell` now resolves its own entry and applies it:

   ```jsx
   const { pathname } = useLocation();
   usePageHead(getPublicPage(stripTrailingSlash(pathname)) || null);
   ```

   That is safe in every renderer PageShell runs in: `usePageHead`'s effect never fires
   under `renderToStaticMarkup`, a null entry is a no-op, and `scripts/prerender-public.mjs`
   already wraps each route in a `MemoryRouter`, so `useLocation` resolves there too. The
   cost is that PageShell is no longer hook-free — its header comment says so.
   `RUNTIME_HEAD_PATHS` in `e2e/seo/seo.spec.ts` is now `= INDEXABLE_PATHS`, which is the
   acceptance test, plus one click-through from `/` into `/features/screening`.
8. **Ops SEO panel (§70) not built** — see the table in §3.
9. **Tier-2 keyword gaps with real product behind them** — risk of bias, network
   meta-analysis, PRISMA flow diagram, case-series extraction, living reviews — have no
   public page yet. Prioritised list in `SEO-GROWTH-PLAN.md` §2.

10. **`/features/*` and `/resources/*` were still soft-404 generators — found by
    review, FIXED.** Both were declared `kind: 'prefix'` in `KNOWN_SPA_PREFIXES`, but
    neither has a parameterised route in `src/App.jsx`: every real child is an exact
    registry path. So `classifyRequest('/features/bogus')` returned
    `{kind:'spa', noindex:false}` — HTTP 200, the `<NotFound/>` body, no
    `X-Robots-Tag`, and `NotFound.jsx` does not call `usePageHead`, so the shell's
    title and description too. An unbounded set of duplicate, indexable-looking URLs,
    open on exactly the two subtrees `sitemap.xml` invites crawlers into.

    Flipping the two rules to `kind: 'exact'` would have been wrong: the
    registry↔router source scans need the prefix to cover
    `/features/search-engine` and friends. Instead the rules carry
    `registryGated: true`, and the classifier asks `isServeableSpaPath` — a
    registry-gated prefix covers only the children `PUBLIC_PAGES` declares.
    Parameterised families (`/app/project/:id`, `/invite/:token`, …) are untouched.

11. **Prerendered markup is discarded and re-rendered, not hydrated — the visible
    flash is fixed, the double render is not.** `src/main.jsx` mounts with
    `createRoot`, which clears `#root` on its first commit, so the server's markup is
    thrown away rather than adopted. Review found the consequence: fifteen of the
    seventeen prerendered routes render through `lazy()`, so that first render
    *suspended* and the same commit painted the `minHeight: 100vh` `<RouteFallback/>`
    spinner over the article — content → spinner → content on every content page.

    Fixed by `preloadableLazy` + `preloadPublicRoute` (`src/App.jsx`): when the
    document arrives with markup in `#root`, main.jsx resolves the matched route's
    chunk *before* mounting, and the wrapper then renders the component
    synchronously, so nothing suspends and nothing flashes. Pinned by
    `tests/unit/seo/prerenderPreload.test.js`.

    **What remains:** this is not hydration. React still renders the whole tree a
    second time and replaces identical DOM. True `hydrateRoot` needs the SSR tree and
    the client tree to be the same tree, and today they are not —
    `scripts/prerender-public.mjs` renders `MemoryRouter > ThemeProvider >
    AuthProvider > Component`, while the client renders `StrictMode >
    AppErrorBoundary > BrowserRouter > App`, where `App` adds `DesignModeProvider`,
    `FocusModeProvider`, `GlobalPresence` and the `Suspense`/`Routes` pair. Making
    them match means an SSR entry that renders `App` itself with a router injected —
    a real change to both, worth doing on its own, not as a rider here. The cost of
    not doing it is one redundant client render on 17 routes; the flash, which was
    the user-visible half, is gone.
