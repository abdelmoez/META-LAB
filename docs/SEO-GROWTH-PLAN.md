# SEO Growth Plan

**Status: nothing in this document is implemented.** Every item here is externally
owned — it needs an account, a human, a publication decision, or elapsed time. It is
written down so the work is visible and so nobody later assumes the code already does
it. The shipped system is described in [`SEO-ARCHITECTURE.md`](./SEO-ARCHITECTURE.md).

Ground rule, from 111.md §66: no black-hat tactics. No purchased links, no link
schemes, no doorway pages, no automated outreach, no fake reviews or ratings. There is
no legitimate way to guarantee rankings or force an AI system to recommend PecanRev.
What follows maximises legitimate signals; it promises nothing.

---

## 1. Registration and verification (do first — blocks all measurement)

| Task | Owner | Notes |
|---|---|---|
| Google Search Console — verify `pecanrev.com` | whoever owns DNS | Prefer a DNS TXT record (covers all subdomains) over the HTML-file method, which would need a new static asset. Submit `https://pecanrev.com/sitemap.xml` after verification. |
| Bing Webmaster Tools | same | Supports "import from GSC", which is the fastest path. Also feeds Copilot. |
| Google Analytics 4 or a privacy-respecting alternative | product | Needed for the "organic registrations" metric below. Check the cookie/consent posture first — PecanRev handles research data and the privacy stance is a product decision, not an SEO one. |
| Google Business / entity profile, if PecanRev has a registered business identity | founder | Only if truthful. Skip otherwise. |

Until GSC exists there is **no** impression, click, position, or index-coverage data.
Everything in §5 is blocked on this row.

---

## 2. Keyword clusters (expansion from 111.md §1)

The 16 indexable pages currently cover the shaded rows. The rest is the roadmap.

### Tier 1 — Category ownership (covered / partially covered)
`systematic review software` · `meta-analysis software` · `systematic review tools` ·
`systematic review platform` · `AI systematic review software` · `AI meta-analysis
software` · `evidence synthesis software` · `evidence synthesis platform` ·
`literature review software`

→ Served today by `/`, `/features`, the feature pages, and (since 113) the flagship
`/systematic-review-software` commercial page and the dedicated `/ai-systematic-review`
page (which scopes exactly which parts of the product use external models and which are
deterministic — the honest version of the "AI systematic review" claim).

### Tier 2 — Feature ownership (partially covered)
`systematic review screening software` · `title and abstract screening` · `full-text
screening` · `abstract screening` · `literature screening tools` · `research screening
software` · `systematic review search strategy` · `PubMed search builder` · `MeSH
search builder` · `database search strategy generator` · `systematic review data
extraction` · `meta-analysis data extraction` · `case series extraction` · `case report
meta-analysis` · `PRISMA flow diagram` · `PRISMA 2020 software` · `risk of bias tools` ·
`network meta-analysis` · `NMA software` · `forest plot software` · `systematic review
manuscript writing` · `research manuscript generator`

→ Since 113: `/features/risk-of-bias`, `/features/network-meta-analysis`,
`/features/prisma-flow-diagram` and `/features/case-series` cover the four largest of
these gaps. **Still open:** forest plots as a feature page, living reviews,
dual/independent extraction and adjudication as its own page.

### Tier 3 — Educational authority (12 guides shipped)
Shipped in 111: what a systematic review is · PRISMA 2020 explained · title & abstract
screening · how to run a meta-analysis. Shipped in 113: how to conduct a systematic
review (cornerstone) · search strategy (PubMed/MeSH/Boolean) · data extraction · risk
of bias assessment · forest plots & heterogeneity · publication bias · network
meta-analysis explained · PRISMA flow diagram guide.

Still open, in rough priority order: inter-rater reliability and Cohen's kappa ·
GRADE certainty · PROSPERO registration · deduplication across databases · full-text
retrieval logistics · scoping vs systematic vs rapid reviews.

### Tier 4 — Long-tail
Hundreds of specific methodological questions ("how many reviewers do you need for
title and abstract screening?", "what counts as a duplicate record?"). Each is a
candidate FAQ block on an existing guide before it is a candidate page. Prefer
strengthening a cornerstone page over minting a thin one.

**Prioritisation rubric** for anything above: relevance to what PecanRev actually does ·
search intent (informational vs. commercial) · competition · conversion potential ·
and — the veto — *can PecanRev give a genuinely better answer than what already ranks?*
If not, do not publish the page.

---

## 3. Content cadence

The infrastructure makes a new page cheap; use it deliberately, not to inflate a count.

**To add a page** (≈ the cost of one PR):
1. `src/frontend/website/content/<slug>.js` — the content data module.
2. `src/frontend/website/pages/<Name>Page.jsx` — usually `ArticlePage` + the content module.
3. A route in `src/App.jsx` and an entry in `KNOWN_SPA_PREFIXES` if it is a new prefix.
4. A `PUBLIC_PAGES` entry (title, description, `indexable`, `changefreq`, `priority`,
   `lastmodSource`, `jsonLd`).
5. A link from the relevant hub in `siteNav.js` — an orphan page is a page nobody finds.
6. `npm run build` — the prerender, sitemap, robots and llms.txt update themselves.

**Suggested cadence:** one substantive Tier-2 or Tier-3 page per fortnight while the
Tier-2 gaps above are open, then one per month. Publishing less and revising more beats
publishing thin pages. Revisit each cornerstone guide roughly every 6 months —
`lastmod` comes from the git commit date of the content file, so a genuine revision
updates the sitemap honestly and a cosmetic one does not.

**Quality bar per page:** a single `<h1>`; a definition-first opening paragraph that
answers the query in the first 40 words; real citations to primary sources; internal
links to at least one hub and one sibling; no claim about PecanRev that the product
does not do today.

---

## 4. Off-site authority

Code cannot create legitimate backlinks. It can create things worth linking to. The
guides under `/resources` are the seed; the strongest additions would be genuinely
useful free assets — a PRISMA flow-diagram builder, a screening sample-size/kappa
calculator, database-syntax translation tables, downloadable extraction-form templates.

Legitimate placement opportunities, none of which involve outreach automation:

- **University library research guides** (LibGuides). Librarians maintain systematic
  review pages and link to tools they have evaluated. Approach: make the comparison and
  methodology pages accurate and neutral, then let a librarian find them.
- **Research-software directories** and registries where PecanRev genuinely qualifies.
- **Methodological communities** — Cochrane-adjacent groups, evidence-synthesis
  mailing lists, the systematic-review methods community. Participate honestly; do not
  drop links.
- **Academic blogs and newsletters** in evidence synthesis, when there is something real
  to say.
- **Conferences** — Cochrane Colloquium, Evidence Synthesis Hackathon, GESI, relevant
  informatics and library-science meetings. A poster or workshop is a durable citation.
- **Open source on GitHub**, if any component is genuinely open-sourceable. A real
  repository is one of the few backlinks that is both legitimate and permanent.
- **Academic collaborations** — a methods paper or a validation study describing the
  screening or extraction approach, if the evidence supports one.
- **Journal / methodology resource pages** that list evidence-synthesis tooling.

Do **not**: buy links, run guest-post networks, spam comments, or solicit reviews with
incentives.

---

## 5. AI / entity visibility

The goal is corroborating public evidence that PecanRev is a real, useful platform —
the same signals that help a human evaluator help an answer engine.

- Consistent name, description, and URL everywhere PecanRev is listed (the `llms.txt`
  copy is the canonical phrasing — reuse it verbatim).
- Public documentation and a public changelog.
- Third-party reviews and mentions that arise naturally; never solicited-with-incentive.
- University and conference mentions (§4).
- Keep `llms.txt` and the JSON-LD `SoftwareApplication` description in sync with what
  the product actually does. Drift here is the fastest way to be described wrongly by
  an answer engine.

---

## 6. Measurement and monitoring cadence

Once §1 is done:

| Cadence | Check |
|---|---|
| **Weekly** | GSC Coverage: new "Crawled – currently not indexed" or "Soft 404" entries. A soft-404 regression is the single most important alarm — it is the exact class of bug 111.md fixed. |
| **Weekly** | GSC Performance: impressions/clicks by page and by query; watch the Tier-1 and Tier-2 terms. |
| **Monthly** | Sitemap submitted-vs-indexed count. It should be 16 until a page is added. |
| **Monthly** | Core Web Vitals (field data in GSC once there is traffic; lab data via Lighthouse meanwhile). |
| **Monthly** | Referral traffic from AI surfaces (`chat.openai.com`, `perplexity.ai`, `claude.ai`, Copilot) in analytics. |
| **Quarterly** | Re-run the audit in `SEO-AUDIT.md` §"Verification commands". Re-read each cornerstone guide for factual drift. |
| **Per release** | `npm run build` must stay green — the CSP byte-identity guard and the one-`<h1>` guard are the regression net. |

**Leading indicator to trust:** indexed page count reaching 16 and staying there.
**Lagging indicator to trust:** organic registrations. Rankings on their own are vanity.

---

## 7. Future experiments (not commitments)

- An internal SEO panel in the Ops console (111.md §70) — only metrics that can be
  computed accurately from the registry and the build: indexable page count, sitemap
  freshness, pages missing metadata, orphan pages, last audit date. Do not build a
  dashboard that shows numbers it cannot verify.
- `hreflang` / localisation. The architecture supports it (per-entry canonical and an
  origin-aware `absoluteUrl`), but there is no translated content, so shipping
  `hreflang` today would be a claim about pages that do not exist.
- An RSS or JSON feed for the resources hub, if the cadence in §3 is sustained.
- Structured `HowTo` schema on the guides — only where the page really is a procedure,
  and only if the visible page matches the markup step for step.

---

## 8. 113 update — production diagnosis, demand map, and the user checklist (2026-08-10)

### 8.1 Why the 111 work produced no visible result (root-cause diagnosis)

Live fetches of pecanrev.com on 2026-08-10 found the 111 build **deployed but not
served**: every route — including `/features/screening` — returned the SPA shell with
the homepage's default title, no meta description, no H1 article content and no JSON-LD.
The production nginx serves `dist/` statically with an SPA fallback, so
`server/middleware/publicPages.js` (which serves `dist/__prerender/<path>/index.html`)
never runs for page routes. Consequences observed:

- crawlers saw an empty application shell on every URL (the exact Phase-40 failure);
- a garbage URL returned the shell (soft-404) instead of the middleware's real 404;
- `www.pecanrev.com` presents a TLS certificate covering only the apex + a nip.io name
  — hard cert error, no www→apex redirect;
- a branded web search for "PecanRev" returned **zero** pecanrev.com results (new
  domain + no Search Console submission + shell-only HTML + no backlinks);
- the sitemap contained `/login` and `/register` (removed in 113 via `sitemap: false`).

The fix is in the repo (nginx recipes in the deployment docs: preferred proxy-to-node
config, plus a static `try_files /__prerender$uri/index.html` fallback), and the Ops ›
SEO console now has an externally-observed serving check so this failure mode is
detectable at a glance forever. **The deploy-side change must be applied by whoever
operates the server.**

### 8.2 Demand map — one canonical page per cluster (Phase 41)

| Cluster | Representative intents | Canonical page |
|---|---|---|
| Brand | pecanrev, pecan rev, pecanrev login | `/` (`/login` for the navigational query) |
| Commercial: category | systematic review software/tool/platform, evidence synthesis platform | `/systematic-review-software` |
| Commercial: AI | AI systematic review, AI literature screening, automate systematic review | `/ai-systematic-review` |
| Commercial: analysis | meta-analysis software, forest plot software | `/features/meta-analysis` |
| Workflow: search | systematic review search strategy, PubMed/MeSH search builder | `/features/search-engine` (guide: `/resources/systematic-review-search-strategy`) |
| Workflow: screening | screening software, title/abstract screening, dual reviewers | `/features/screening` (guide: `/resources/title-and-abstract-screening`) |
| Workflow: extraction | data extraction software/templates, case series extraction | `/features/data-extraction`, `/features/case-series` |
| Workflow: RoB | risk of bias tool, RoB 2, Newcastle-Ottawa | `/features/risk-of-bias` (guide: `/resources/risk-of-bias-assessment`) |
| Workflow: PRISMA | PRISMA flow diagram software/generator | `/features/prisma-flow-diagram` (guide: `/resources/prisma-flow-diagram-guide`) |
| Workflow: NMA | network meta-analysis software | `/features/network-meta-analysis` (guide: `/resources/network-meta-analysis-explained`) |
| Educational: SR | how to conduct a systematic review | `/resources/how-to-conduct-a-systematic-review` |
| Educational: MA | how to perform meta-analysis, heterogeneity, I² | `/resources/how-to-run-a-meta-analysis`, `/resources/forest-plots-and-heterogeneity` |
| Educational: bias | publication bias, funnel plots | `/resources/publication-bias` |
| Comparison | alternative to Covidence / Rayyan, PecanRev vs X | `/compare/pecanrev-vs-covidence`, `/compare/pecanrev-vs-rayyan` |

Rule: new intents join an existing cluster's canonical page unless the intent is
genuinely distinct (Phase 42 — intent > keyword count). Never mint sibling pages for
rewordings of the same intent.

### 8.3 What only a human can do — the verification checklist (Phases 18/37/38/39)

Blocking (do these first — indexing cannot start reliably without them):
1. **Apply the nginx serving fix** from `docs/manager/deployment-readiness.md` (either
   recipe) and verify with:
   `curl -s https://pecanrev.com/features/screening | grep -o '<title>[^<]*'` — must show
   the screening page's own title, not the homepage default.
2. **Google Search Console**: DNS-TXT-verify `pecanrev.com`, submit
   `https://pecanrev.com/sitemap.xml`, then use URL Inspection → Request indexing for
   `/`, `/systematic-review-software`, `/features/screening`.
3. **Bing Webmaster Tools**: import from GSC (also feeds Copilot).
4. **www**: add `www.pecanrev.com` to DNS + the TLS certificate SAN, enable the
   301 www→apex server block already provided in the nginx example.

High-value, non-blocking:
5. IndexNow key (Bing/Yandex instant indexing) — optional, low cost.
6. Consistent public profiles when ready (LinkedIn, X, GitHub) using the exact name
   "PecanRev" + https://pecanrev.com — no fake profiles, no purchased anything.
7. Software directories with honest listings: AlternativeTo, Capterra/G2 (when
   pricing/positioning is settled), library-science tool lists (§4 targets).
8. Academic outreach per §4: methods librarians, systematic-review course pages,
   university LibGuides — the guides under `/resources` are the linkable assets.

Nothing in this checklist can be done from the repository, and none of it is claimed
as done anywhere in the codebase or the Ops console.
