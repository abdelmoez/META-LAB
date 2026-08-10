# SEO Architecture

The shipped discoverability system for PecanRev (111.md). This document describes
what exists in the codebase today. Anything aspirational lives in
[`SEO-GROWTH-PLAN.md`](./SEO-GROWTH-PLAN.md); the before/after ledger lives in
[`SEO-AUDIT.md`](./SEO-AUDIT.md).

---

## 1. One registry, four consumers

Everything starts at **`src/frontend/website/publicPages.js`**. It is a plain ESM
module with no React and no server imports, which is why all four consumers can
read the same object graph:

| Consumer | File | What it takes from the registry |
|---|---|---|
| Runtime head manager | `src/frontend/website/usePageHead.js` | title, description, canonical, OG/Twitter, JSON-LD, robots meta |
| Express edge middleware | `server/middleware/publicPages.js` | path membership, `indexable`, `NON_INDEXABLE_PATTERNS`, `PERMANENT_REDIRECTS`, `KNOWN_SPA_PREFIXES` |
| Build-time prerenderer | `scripts/prerender-public.mjs` | the list of pages to render + their head |
| Crawler-file generators | `scripts/seo/generators.js` (called by the prerenderer) | sitemap entries, robots Disallow list, llms.txt inventory |

`PUBLIC_PAGES` holds **17 entries** — 16 `indexable: true` and one
(`/beta-waitlist`) `indexable: false`. Each entry carries `path`, `title`,
`description`, `indexable`, optional `canonicalPath`, `changefreq`, `priority`,
`ogType`/`ogImage`, `lastmodSource`, and a `jsonLd(ctx)` builder.

Because the registry is the single source of truth, adding a public page is one
object literal plus a route: the sitemap, robots policy, prerender, canonical,
OG tags and the `<h1>`/head contract all follow automatically. There is no second
list to forget.

### Registry helpers

- `normalizePath(p)` — canonical spelling: lowercase, no trailing slash.
- `isRegistryPath` / `getPublicPage` / `indexablePages()`.
- `isNonIndexablePath(p)` — pattern match over `NON_INDEXABLE_PATTERNS`.
- `isKnownSpaPath(p)` — `KNOWN_SPA_PREFIXES`, the routes `src/App.jsx` really
  declares. Route COVERAGE only.
- `isServeableSpaPath(p)` — the question the edge middleware actually asks, and the
  one that separates "an app route we simply do not prerender" from "a URL that does
  not exist". It differs from `isKnownSpaPath` on one case: a rule marked
  `registryGated: true` covers only the children `PUBLIC_PAGES` declares. `/features`
  and `/resources` are gated because neither has a parameterised route, so
  `/features/bogus` is a real 404 instead of a 200 shell. Parameterised families
  (`/app/project/:id`, `/invite/:token`, `/rob/:projectId`, …) are ungated — their
  unknown-looking children are genuine routes.
- `findRedirect(p)` — `PERMANENT_REDIRECTS`.
- `absoluteUrl(p)` over `SITE_ORIGIN` (`https://pecanrev.com`).
- JSON-LD builders: `jsonLdGraph`, `organizationJsonLd`, `softwareApplicationJsonLd`,
  `webPageJsonLd`, `breadcrumbJsonLd`, `faqJsonLd`, `articleJsonLd`, plus the shared
  `HOMEPAGE_FAQ` constant — the same array feeds the visible FAQ on the Landing page
  and the `FAQPage` schema, so the two can never disagree (schema that is not on the
  page is exactly the "fake schema" 111.md §66 prohibits).

---

## 2. Metadata architecture (runtime)

`usePageHead.js` is a small, dependency-free head manager. It:

- looks the entry up by path, builds the full tag set, and applies it to
  `document.head`;
- marks everything it owns with `data-pagehead` so it can remove **only** its own
  tags on unmount/navigation — the shell's charset, viewport, theme-color, icons,
  manifest and preconnects are never touched;
- restores the previous value of a tag it overwrote rather than deleting a shell tag;
- emits `<script type="application/ld+json" data-pagehead>` — this is *data*, not an
  executable script, so it needs no CSP hash;
- emits `<meta name="robots" content="noindex, nofollow">` for `indexable: false`
  entries, mirroring the header the server sends.

The same builder is exported in a string form used by the prerenderer, so the
server-rendered head and the client-rendered head come from one function.

**Who calls it.** Landing (`/`), Terms, Login, Register and BetaWaitlist call
`usePageHead` directly. Every other public page — the twelve content pages under
`pages/`, via `ArticlePage` → `PageShell` — gets it from `PageShell`, which resolves the
entry from the route itself:

```jsx
const { pathname } = useLocation();
usePageHead(getPublicPage(stripTrailingSlash(pathname)) || null);
```

So all 16 indexable routes manage their own head at runtime, not just in the prerendered
document. `stripTrailingSlash` matches the registry's canonical spelling (`getPublicPage`
is an exact-match lookup) and an unregistered path resolves to `null`, which `usePageHead`
treats as "leave the head alone". This closes the gap that `e2e/seo/seo.spec.ts` found and
that earlier revisions of this section recorded; see `docs/seo-overhaul-111.md` §5.7.

`/login` and `/register` deliberately carry **no** JSON-LD: there is nothing
truthful to say about them in schema.org terms.

---

## 3. Indexability architecture (the Express edge)

`server/middleware/publicPages.js` mounts **after `express.static`, before
`serveSpa`**. Its pure core, `classifyRequest`, is unit-tested against a full path
matrix (`tests/unit/seo/publicPagesMiddleware.test.js`). Decision order:

1. **Permanent redirect** — `PERMANENT_REDIRECTS`, currently `/privacy → /terms#privacy`
   (301, query preserved). This replaces a client-side `<Navigate>`, which could only
   ever produce a soft 200.
2. **Canonical spelling** — a trailing slash or a non-lowercase spelling of a
   **registry** path 301s to the canonical form. Restricting this to registry paths is
   the whole point: `/App` stays an honest 404 instead of being laundered into a 200.
3. **Unknown path → real HTTP 404.** The body is still the SPA shell, so `<NotFound/>`
   renders exactly as before — only the status tells the truth now.
4. **`X-Robots-Tag: noindex, nofollow`** on every `NON_INDEXABLE_PATTERNS` match and on
   registry entries flagged `indexable: false`.
5. **Prerendered HTML** from `dist/__prerender/<path>/index.html` when it exists, with
   the same brand/theme injection and `Cache-Control: no-cache` as the shell.

For the `spa` and `not-found` outcomes the middleware only sets headers/status and
calls `next()`; `serveSpa` writes the body. There is exactly one shell-rendering path.

`blockPrerenderDir` mounts **before** `express.static` and 404s
`/__prerender/**`. Those are real files inside `dist/`, so static would otherwise
serve a byte-identical duplicate of every page under a second URL. A 404 makes the
duplicates not exist; a robots.txt `Disallow` would only be a request.

### What stays noindexed, and why

| Pattern | Reason |
|---|---|
| `/app/**`, `/profile`, `/onboarding`, `/rob/**` | authenticated workspace — 111.md §65: the app's screens are not landing pages |
| `/ops`, `/sift-beta/**` | internal/staff consoles, 404-cloaked by `AdminRoute` + `requireAdmin` |
| `/invite/**`, `/accept-invitation`, `/reset`, `/verify-email` | single-use tokens live in the URL |
| `/public/synthesis/**`, `/embed/synthesis/**` | share-token pages belonging to a user's project |
| `/beta-waitlist` | thin conversion surface, `indexable: false` in the registry |

`/login` and `/register` are **not** on this list. They are permanently public pages
that answer real navigational queries ("PecanRev login"); noindexing them hands those
queries to third parties. They are indexable with a low sitemap priority instead.

**Security note.** `robots.txt` and `X-Robots-Tag` are SEO hygiene layered on top of
access control — never the access control itself. Nothing in this middleware is
consulted for authorization.

### Documented conflict: the admin 404-cloak vs. the anti-cloaking rule

111.md §66 prohibits *cloaking* — serving different content to crawlers than to
users. PecanRev's `/ops` and `/sift-beta` routes serve a **404 to everyone who is not
an admin**, including crawlers. Formally that is content that differs by requester.

We kept the cloak, deliberately:

- The differentiator is **identity, not user-agent**. A crawler and a logged-out human
  get byte-identical 404s. Classic cloaking keys off the crawler; this keys off
  authorization, and an anonymous browser sees exactly what Googlebot sees.
- It is **existence-hiding as a security control** that predates this round
  (`AdminRoute` + `requireAdmin`), and it is asserted by the permissions E2E suite.
- Weakening it to satisfy an SEO guideline would trade a real security property for
  zero ranking benefit, since the pages must never be indexed anyway.

This is recorded as a conscious, permanent exception rather than silently resolved.

---

## 4. Prerendering (`scripts/prerender-public.mjs`)

Runs immediately after `vite build` (see the `build` script). Renders the real React
page for every registry entry and writes `dist/__prerender/<path>/index.html` — **17/17**
today. Three rules it exists to enforce:

1. **`dist/index.html` is never written.** It is the app shell and the CSP hash source;
   a prerendered page is an *additional* artefact, never a replacement. (Writing the
   homepage there would make every SPA route serve the landing markup.)
2. **The document is the freshly built shell with exactly five head-tag families
   removed** (`title`, `meta[name=description]`, `link[rel=canonical]`,
   `meta[property^=og:]`, `meta[name^=twitter:]`) and the per-page head spliced in
   before `</head>`. Everything else stays byte-exact so the SPA **boots** on a
   prerendered page exactly as it boots on the shell. Note the word: `src/main.jsx`
   mounts with `createRoot`, not `hydrateRoot`, so the markup below is what a non-JS
   crawler reads and what the visitor sees before the route chunk lands — React then
   re-renders the same tree over it. main.jsx preloads the matched route first so that
   re-render is synchronous and nothing flashes; see `docs/seo-overhaul-111.md` §5.11
   for why true hydration would mean restructuring both trees.
3. **The CSP inline-script byte-identity guard.** `server/security/csp.js` computes
   `script-src` SHA-256 hashes from `dist/index.html` and applies them to every HTML
   response, including prerendered ones. If a prerendered page's inline scripts diverged
   by one byte, the browser would refuse to run the theme bootstrap. The guard compares
   the extracted inline script bodies and exits nonzero on any mismatch. **Do not weaken
   it.** (The JSON-LD block is exempt: `type="application/ld+json"` is never executed, so
   `script-src` does not apply, and it legitimately differs per page.)

An **exactly-one-`<h1>` guard** fails the build if a page renders zero or multiple
`<h1>`s — it counts matches, and `e2e/seo/seo.spec.ts` counts them on the served
document too.
An indexable page that fails to render is a **hard build failure** — no silent skips,
because a missing prerender is invisible in the UI and only surfaces weeks later as a
page that never got indexed.

---

## 5. Crawler files (`scripts/seo/generators.js`)

Pure, dependency-free, unit-tested builders for the three files a crawler reads
*before* it reads a page. Written to `dist/` by the prerenderer.

- **`sitemap.xml`** — indexable entries only, absolute `loc`, optional `lastmod`,
  `changefreq`, `priority`. 16 URLs.
- **`robots.txt`** — `User-agent: *` plus a `Disallow` per non-indexable pattern
  (`/api/`, `/app`, `/ops`, `/sift-beta`, `/invite/`, `/reset`, `/verify-email`,
  `/accept-invitation`, `/embed/`, `/public/synthesis/`, `/__prerender/`) and a
  `Sitemap:` line. `public/robots.txt` holds a byte-identical copy so a dev instance
  without a build is not silently missing it.
- **`llms.txt`** — a plain-language capability description of the product for
  answer engines. No superlatives, no unverifiable claims.

### Honest-`lastmod` policy

`<lastmod>` is emitted **only** when the generator has a real date, obtained from
`git log -1 --format=%cI <lastmodSource>`. No git, a shallow clone, or an untracked
file yields an empty string and the element is **omitted**. The generator never falls
back to `new Date()`: an invented `lastmod` tells a crawler the page changed when it
did not, and the crawler eventually stops believing the file. The build logs
`N URLs (M with a real git <lastmod>)` so the ratio is visible.

---

## 6. Content architecture

Twelve public content pages live under `src/frontend/website/pages/` — 5 feature
pages, 4 cornerstone guides, 2 hub pages and About — composed from:

- **`content/*.js`** — one data module per page (headings, prose, FAQ arrays, citation
  lists). Content is data, so a copy change is a diff in one file and never touches JSX.
- **`markdown/parseMarkdown.js` + `MarkdownContent.jsx`** — a small, deliberately
  minimal renderer (headings, paragraphs, lists, links, inline code/emphasis). No HTML
  passthrough, so content files cannot inject markup.
- **`PageShell.jsx` / `ArticlePage.jsx`** — shared layout, breadcrumb, one-`<h1>`
  discipline, and the `usePageHead` call.
- **`siteNav.js`** — the internal-linking graph (hub → spoke → sibling), so cornerstone
  pages are reachable in one or two clicks from `/`.

Citations in the guides are honest: real, checkable references (PRISMA 2020, Cochrane
Handbook, and similar) rather than invented authority.

---

## 7. AI / GEO architecture

- `llms.txt` at the origin root, describing capabilities in plain language.
- JSON-LD `Organization` + `SoftwareApplication` on `/`, `BreadcrumbList` on every
  nested page, `FAQPage` from the *visible* homepage FAQ, `Article` on the guides.
- Prerendered HTML means answer-engine crawlers that do not execute JavaScript still
  get the full head and body.
- Cornerstone guides are written to be quotable: definition-first paragraphs, explicit
  question headings, self-contained answers.

No gimmicks: there is no way to guarantee an AI system recommends PecanRev, and nothing
here pretends otherwise.

---

## 8. Privacy rules

No user, project, or share-token URL is ever emitted into the sitemap, llms.txt, or a
prerendered page. The prerenderer only ever walks the static registry — it has no
database access. Every tokenised surface is in `NON_INDEXABLE_PATTERNS`.

---

## 9. Dev vs. prod — behavior differences

This trips people up, so it is spelled out. **The Vite dev server implements almost
none of the SEO edge.**

| Behavior | Express (`:3001`, after `npm run build`) | Vite dev (`:3000`) |
|---|---|---|
| Unknown path | real **404** | 200 SPA shell (soft 404) |
| `/privacy` → `/terms#privacy` | **301** | **301** (mirrored by `permanentRedirectsPlugin` in `vite.config.js`, from the same `PERMANENT_REDIRECTS` table) |
| Trailing-slash / case 301s | yes | no |
| `X-Robots-Tag` | yes | no |
| Prerendered HTML | served from `dist/__prerender` | not served (no build artefacts) |
| `sitemap.xml` / `llms.txt` | served from `dist/` | absent |
| `robots.txt` | from `dist/` | from `public/` (identical copy) |
| Per-page `<title>`/description/canonical/JSON-LD/one-`<h1>` | yes, all 16 (prerendered) | yes, all 16 (applied at runtime by `usePageHead` — see §2) |

`e2e/seo/seo.spec.ts` encodes this split in three groups: runtime head against
`baseURL` for the routes that manage it, crawler-visible head for all 16 against the
Express origin, and the server-owned semantics through a request context on `API_URL`.
The last two share one `GET /robots.txt` probe and self-skip (with the reason) if it
does not come back built.

---

## 10. Test coverage

- `tests/unit/seo/` — registry shape and indexable count, `classifyRequest` path matrix,
  generator serialisation, head builder + SSR string form, markdown renderer, content
  registry entries, asset presence.
- `e2e/seo/seo.spec.ts` — the HTTP-level wiring (see §9).

## 11. Change log discipline

Any change to redirects, robots policy, the indexable set, the JSON-LD graph, or the
prerender/CSP guard should be recorded in the round report for the release that makes
it (`docs/seo-overhaul-111.md` is the first) and reflected here. The CSP byte-identity
guard and the one-`<h1>` guard are load-bearing; treat a failing build from either as a
real defect, never as a guard to relax.
