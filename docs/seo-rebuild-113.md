# 113 — SEO/AEO/GEO Rebuild (v4.18.0)

Round report for `.claude/Prompts/113.md` (50 phases). Builds on the 111 foundation
(registry → prerender → generators → middleware) and answers 113's central demand:
**diagnose why the previous SEO work produced no visible result, then rebuild.**

## The diagnosis (Phase 1/40 — the main deliverable)

Live inspection of pecanrev.com (2026-08-10) found the 111 build **deployed but not
served**:

1. **Every route returned the SPA shell.** `/features/screening` served the homepage's
   default title, no meta description, no H1, no article text, no JSON-LD. The
   production nginx serves `dist/` statically with an SPA fallback (`try_files …
   /index.html`), so `server/middleware/publicPages.js` — which serves
   `dist/__prerender/<path>/index.html` — never ran for page routes. Crawlers saw an
   empty application shell on every URL. This single line of nginx config is the root
   cause of "the SEO didn't work."
2. **Zero index presence.** A branded search for "PecanRev" returned no pecanrev.com
   results: new domain, no Search Console property, no backlinks, and shell-only HTML.
3. **www.pecanrev.com is broken.** The TLS cert covers only the apex (+ a nip.io name);
   www hard-fails with no redirect.
4. **Production soft-404s.** Garbage URLs return the shell instead of the middleware's
   real 404.
5. **Sitemap contained /login and /register.**

Items 1, 4, 5 are fixed in-repo this round; items 2, 3 need the operator (checklist in
`SEO-GROWTH-PLAN.md` §8.3). The Ops › SEO console's live check now detects the
serving failure externally — it already reproduces it against production today.

## What shipped

### Serving fix (`deploy/nginx/pecanrev.conf.example`, deployment-readiness.md)
Two documented recipes: **A (preferred)** — proxy all non-asset traffic to node so the
middleware does prerender/404/301/X-Robots-Tag; **B (static fallback)** —
`try_files /__prerender$uri/index.html $uri /index.html` with an honest list of what
static serving loses. Both include a www→apex 301 block + cert-SAN warning, gzip for
XML, and curl verification steps.

### Content architecture (17 new pages, ~34 total, all prerendered)
- **Commercial:** `/systematic-review-software` (flagship, 2.3k words) and
  `/ai-systematic-review` — the honest AI page: scopes the two external-model paths
  (Anthropic-proxied `aiExtraction`, OpenAI-compatible `extractionAssist`) and the
  optional embedding sub-signal in `aiScreening`; everything else labeled
  deterministic; explicit "what PecanRev does not automate" section.
- **Feature pages:** `/features/risk-of-bias`, `/features/prisma-flow-diagram`,
  `/features/network-meta-analysis`, `/features/case-series` — each verified against
  the actual engines, with "what this does not do" honesty sections.
- **Comparisons:** `/compare` + `/compare/pecanrev-vs-covidence` + `/compare/
  pecanrev-vs-rayyan` — factual, conservative, dated ("verified as of August 2026"),
  registry-gated prefix (unknown /compare/* children 404+noindex).
- **Guides:** 8 new under `/resources/*` (1.8–2k words each): how-to-conduct-a-
  systematic-review (cornerstone), search strategy, data extraction, risk of bias,
  forest plots & heterogeneity, publication bias, NMA explained, PRISMA flow diagram.
  Real citations only (PRISMA 2020/E&E/-S, Cochrane Handbook, JBI, RoB 2, ROBINS-I,
  NOS, GRADE, DerSimonian-Laird, Higgins, Egger, Duval-Tweedie, Salanti, Bucher…).
  Definition-first openings, question-oriented H2s (AEO), product-connection sections
  naming real engine behaviour *and its limits*.

### Internal linking engine
Registry entries carry `related: []` (+ optional `relatedLabel`); ArticlePage renders
via one shared `resolveRelated()`; hierarchical clusters (home → category → feature →
guide → product CTA); orphan test enforces reachability; e2e `INDEXABLE_PATHS` now
derives from the registry (16 → 33 pages asserted).

### Brand (Phases 5/8/25)
Landing H1 now leads with the brand: *"PecanRev: from screening to meta-analysis, one
clean workspace for systematic reviews."* Titles/H1/schema/OG/footer use "PecanRev"
verbatim. `/login`+`/register` stay indexable (navigational queries) but left the
sitemap (`sitemap: false` registry flag).

### Ops › SEO console (Phase 33) + first-party analytics (Phase 19)
Three sharply separated panels: **Repository validation** (registry inventory, counts,
pass/fail checks: unique titles/descriptions, description length, canonicals, dist
prerender presence + generation time, sitemap/robots/llms.txt state); **Externally
observed** (on-demand live check: fetches the canonical domain and verifies per-page
title + H1 + JSON-LD are actually served — the anti-regression for this round's root
cause; GSC/Bing shown as "Not configured", never fabricated); **Landing analytics** —
privacy-safe first-party beacon (path + referrer class only, no cookies, no UA/IP/user
retention, registry-allowlisted paths, daily `SeoPageView` aggregates, readers SUM).
Mods get `view_seo_status`; four-place section sync green.

### Docs
`SEO-GROWTH-PLAN.md` §8: the production diagnosis, the Phase-41 demand map (one
canonical page per intent cluster), and the human-only checklist (nginx fix, GSC DNS
verification + sitemap submission, Bing import, www cert SAN + 301, IndexNow optional,
directories/profiles). `privacy-ai-providers.md` §2.3 de-staled (it denied the
extraction-LLM endpoint existed).

## Validation
test:ci 480 files / 8679 tests green · lint clean · build prerenders 34/34 with CSP
byte-identity + exactly-one-h1 guards · e2e seo suite derives all 33 indexable pages ·
ops e2e includes the new SEO section spec.

## Known limitations
- The serving fix requires the operator to apply the nginx config — the repo cannot
  deploy itself; until then production keeps serving the shell (the Ops live check
  shows this in red).
- The beacon fires only on PageShell-rendered pages: `/`, `/terms`, `/login`,
  `/register` are uncounted (disclosed in the Analytics tab).
- Comparison pages cover Covidence and Rayyan only; RevMan/DistillerSR/EPPI etc. are
  named in the demand map as future candidates.
- No hreflang (no multilingual content), no /pricing (none public), no public /docs
  yet (growth-plan item), Search Console/Bing data absent until verified externally.
