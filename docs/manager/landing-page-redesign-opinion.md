# Landing Page Redesign — Design Opinion & Direction (prompt8)

**Author:** Main Claude (manager/integrator), with input from the Website and Frontend agents
**Date:** 2026-06-10
**Scope:** `src/frontend/pages/Landing.jsx` (full overhaul), no new runtime dependencies

---

## 1. What is wrong with the current landing page

The current page (the prompt7 "v4 institutional" design) is *competent but anonymous*. Reading it
cold, as a designer, these are the honest problems:

1. **The skeleton is a SaaS template.** Split hero (copy left / screenshot right), eyebrow pill,
   trust strip, centered section headers, 3-column feature card grid, footer columns. Every
   B2B product site made since 2021 has this exact shape. Even with research-flavored content,
   the *structure* says "generic startup," not "institutional research instrument."
2. **The page is dead after the first second.** All motion is entrance animation (`lpFadeUp`,
   forest-plot rows easing in once on mount). After load, nothing moves, responds, or breathes.
   "Alive with subtle motion" requires *ambient* and *scroll-driven* motion, not a one-shot fade.
3. **The best asset is framed as a static screenshot.** The forest plot preview is genuinely good
   domain content, but it sits in a fake window chrome like a marketing screenshot. It doesn't
   *demonstrate* anything — it's wallpaper.
4. **No narrative arc.** A systematic review has an inherently dramatic story: 1,284 records
   enter, 38 survive, one pooled estimate comes out. That funnel IS the product. The current
   page lists features side by side instead of walking the visitor down that pipeline.
5. **Timid typography.** One large wordmark, then uniform 14–29px text everywhere. There is no
   editorial hierarchy, no moment where the page raises its voice.
6. **Nothing ownable.** Close your eyes after visiting: what do you remember? There is no visual
   signature — no identity element that could only belong to META·LAB.

## 2. Recommended design direction

**"The page is a systematic review, running in slow motion."**

A premium, night-first, editorial-scientific page in which the visitor *descends through the
evidence pipeline*: records appear, get screened, converge, and pool — and each landing section
is one stage of that pipeline. Visuals are real method artifacts (forest plot, PRISMA flow,
heterogeneity statistics), drawn live, never stock illustrations. Tone: an instrument, not an ad.
The closest aesthetic references are Linear's restraint, Stripe's typographic discipline, and the
figure standards of a Cochrane review — *not* an AI-SaaS gradient party.

This direction is right for the audience (hospitals, universities, review teams) because those
buyers trust **evidence of method**, not adjectives. Showing the method working — accurately —
is the most credible marketing this product can do.

## 3. The visual metaphor

**Records converging into evidence.** One continuous idea threads the page:

- **Hero:** a slow ambient canvas of faint drifting points (citations in the void) above which
  the headline sits. A subset of points drifts toward an axis and settles into confidence-interval
  rows — chaos becoming a forest plot. Slow (60–90s feel), low-contrast, monochrome-blue.
- **The evidence spine:** a thin vertical line that runs down the page between sections (the
  audit trail made visible). Section markers sit on the spine like PRISMA flow nodes, with the
  stage number and count.
- **Self-drawing forest plot:** when scrolled into view, whiskers extend, squares scale by weight,
  the pooled diamond lands last. The plot is the *climax* of the scroll narrative, not a screenshot.
- **PRISMA funnel:** counts tick up (1,284 → 1,022 → 164 → 38) as the band enters the viewport.

Everything else (cards, type, spacing) stays quiet so the metaphor carries the page.

## 4. Animations / moving parts

| Element | Motion | Technique | Cost |
|---|---|---|---|
| Hero particle field | slow drift + convergence into CI rows | Canvas 2D, rAF, ~120 points, paused when tab hidden / off-screen | < 1ms/frame |
| Evidence spine | draws downward as you scroll | SVG `stroke-dashoffset` driven by IntersectionObserver | trivial |
| Forest plot | rows draw in, diamond lands, I² counts up | CSS keyframes triggered by `.in-view` class | trivial |
| PRISMA counts | numbers count up once in view | rAF count-up hook, tabular-nums | trivial |
| Section reveals | 12px rise + fade, 80ms stagger | IntersectionObserver + CSS | trivial |
| Linked-products beam | a pulse travels the link line META·LAB ⇄ META·SIFT | SVG `stroke-dasharray` animation | trivial |
| Buttons/cards | existing hover lift/glow, kept | CSS | trivial |

Hard rules: CSS-first; one canvas max; no animation library; everything honors
`prefers-reduced-motion` (static fallbacks, counts render final values); no layout-shifting
animation (transforms/opacity only).

## 5. How it stays professional, not flashy

- **Motion has meaning:** every animation depicts a real method step (screening, pooling,
  auditing). Nothing moves for decoration; nothing loops aggressively in the reading path.
- **Restraint budget:** max one ambient layer (hero canvas); scroll animations fire once,
  then rest. No parallax, no gradient meshes, no 3D, no tilt cards.
- **Honest numbers only:** the sample forest plot is labeled as illustrative; product claims
  stick to real capabilities (PRISMA 2020, RoB 2, HKSJ, GRADE). No fake logos, fake testimonials,
  or invented install counts.
- **Editorial typography:** IBM Plex Sans/Mono kept (it's a strength — lab-notebook DNA), with a
  real scale (12 / 14 / 17 / 24 / 40 / 64-clamp) and generous whitespace.

## 6. How it attracts institutions

- A dedicated **"Built for institutions"** band: multi-user workspaces, role/permission model,
  owner–leader–member governance, audit trail, server-side data isolation — the things research
  offices and IRBs actually ask about — presented as a quiet specification table, not marketing
  cards.
- **Standards-first credibility strip** (PRISMA 2020, Cochrane RoB 2.0, GRADE, PROSPERO, HKSJ)
  kept and tightened.
- **Methodological accuracy everywhere:** the forest plot has correct anatomy (weights, CIs,
  I², pooled diamond); the PRISMA counts are arithmetically consistent. Reviewers notice.
- Sober copy: short declarative sentences, zero hype adjectives.

## 7. Sections kept / removed / redesigned

| Current | Decision |
|---|---|
| Sticky nav + auth-aware CTAs | **Keep** (works), refine visual weight |
| Announcement / maintenance banners | **Keep** (admin contract) |
| Split hero + static forest panel | **Redesign** → full-bleed narrative hero with particle convergence + headline + CTAs |
| Trust strip | **Keep**, restyle on the spine |
| 6 feature cards | **Redesign** → "Evidence workflow" pipeline narrative (3 acts: Define & Search / Screen & Extract / Synthesize & Report) on the spine |
| 14-step workflow grid | **Keep but compress** → horizontal stage rail (the 14 stages as spine nodes), less vertical bulk |
| AppFrame mockup | **Redesign** → cleaner product frame, night-mode app preview with live mini-charts |
| "Why rigor" 2-col | **Merge** into credibility band with standards card |
| About | **Keep**, tightened |
| — (new) | **META·LAB ⇄ META·SIFT linked-workspace section** with animated link beam |
| — (new) | **Institution-grade security/governance band** |
| Contact form | **Keep** (admin-gated contract) |
| Footer | **Keep**, restyle |

**Contracts that must not break:** every `useLandingSettings()` key (heroHeadline, heroSubtitle,
ctaText, featureCards, workflowTitle, whyStandards, aboutText*, contact*, footerLinks, seo*,
banners) keeps working; `#features/#workflow/#about/#contact` anchors keep existing nav links
valid; CTAs route to `/register`, `/login`, `/app`; theme tokens only (`C` + `alpha()`, no
hex-concat on vars); day mode must remain fully polished.

## 8. Why this design is better

1. **It is ownable.** The records-converging-to-a-diamond identity belongs to this product alone;
   no template can reproduce it because it *is* the product's function.
2. **It demonstrates rather than asserts.** The page proves methodological seriousness by
   executing the method in front of the visitor — the strongest possible signal for an academic
   buyer.
3. **It is alive but disciplined.** Ambient + scroll-driven motion gives the "moving pieces"
   the brief asks for, within a strict restraint budget that keeps it institutional.
4. **It has a narrative spine,** so the visitor is guided down one story instead of grazing
   parallel feature cards — better comprehension, better scroll depth, better conversion to CTA.
5. **It costs nothing in weight.** No new dependencies, one small canvas, CSS/SVG everywhere
   else; perf and reduced-motion are first-class, so it stays fast and accessible.
