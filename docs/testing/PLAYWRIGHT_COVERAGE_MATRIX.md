# PecanRev — Playwright E2E Coverage Matrix

Generated for the suite under `e2e/`. **706 tests (all projects) across 53 spec files** (chromium full
coverage; `@smoke` also runs on firefox + webkit + mobile/tablet; the manuscript table + figure files
run in FULL under `webkit-manuscript`). Counted with `npx playwright test --list` at the 119.md r2 round.
Validated serially
(`--workers=1`): all green, with the documented `test.skip`s below for preconditions not
reachable via the current fixtures. How to run: see `e2e/README.md`.

Legend: ✅ covered · ⏭️ documented skip (TODO) · 🔒 permission boundary asserted.

| Area | Routes / Surface | Roles tested | Main flows covered | Edge / negative cases | Documented gaps (skips) |
|---|---|---|---|---|---|
| **Auth & onboarding** (`auth/`) | `/`, `/login`, `/register`, `/terms`, `/privacy` | anon, admin, fresh user | ✅ login (UI) → `/app`; register validation (UI); session persists across reload; sign-out → `/login`; PublicRoute redirects authed→`/app` | invalid creds banner; empty-submit blocked; bad email; pw<8; pw mismatch; terms required | ⏭️ onboarding intro asserted only when questions exist (gate disabled globally; re-enabled in a serial block) |
| **Dashboard** (`dashboard/`) | `/app?view=overview\|mywork\|activity\|invitations\|archived\|resources` | admin | ✅ KPI cards; view switching updates `?view=`; view persists on reload; search filter; status/role filters (count==cards); recency ordering | no-match empty state; 0-count filter empty state | — |
| **Projects** (`projects/`) | `/app`, `/app/project/:id?tab=overview`, `/public/synthesis/:token` | admin, anon | ✅ create (toast+card); rename (persists); archive↔restore; delete name-match confirm; open→overview; long-name ellipsis; dashboard persistence; 68.md P8: publish → anonymous public page → unpublish clean-unavailable lifecycle; flag OFF hides /api/synthesis (404) | title required (empty/whitespace); rename empty guard; delete disabled until exact case/trim match | — |
| **Ops console** (`ops/`) | `/ops` (legacy chrome) | admin, mod, anon | ✅ loads + nav sections reachable (count derived from `OPS_SECTION_IDS`); **design rollout default-mode round-trips** (save→persist→restore); flag toggle persists+restores through the 109.md confirm modal; settings form loads; 67.md Tiers section (three tier cards, separation note, enforcement toggle; anon 404-cloaked); **109.md Research Governance** (`ops/research-governance.spec.ts`): every sub-tab renders, duplicate-detection health badge resolves, env-managed worker knobs are read-only, a safe governance setting round-trips + restores, a guarded setting needs the confirm modal, settings search finds by concept, and the proportion compatibility guard has no off switch | 🔒 mod sees only users+messages; admin-only navs (incl. `research`) absent for mod; cancelling a flag confirm writes nothing | ⏭️ 109 research-governance spec authored but not executed in this round (no client dev server was running; W3 runs it) |
| **Permissions & roles** (`permissions/`) | `/ops`, `/sift-beta`, `/app`, project APIs | admin, mod, normal, anon | 🔒 normal 404-cloaked on `/ops`+`/sift-beta`; anon→`/login` on `/app`; account-menu "Ops Console" staff-only; mod 403 on admin API + can't change roles; non-member can't read/delete a project | existence-hidden 404 (not `/login`) for anon on `/ops` | ⏭️ viewer/reviewer UI-blocked-decision (no viewer browser session via current fixtures) |
| **Branding & nav** (`branding/`) | `/`, `/app`, project, `/ops`, `/login` | admin, normal | ✅ "PecanRev" on landing/login/dashboard/overview, no legacy leaks; **65.md governance**: non-admin lands on Stitch by default with no priming; `?ui=legacy` is INERT for a non-admin while `allowLegacyFallback` is off; no theme-switch control anywhere (Ops-only governance); admin `?ui=legacy` escape works; `/ops` forced legacy; theme (day/night) toggle persists; rail nav routes correct | non-admin legacy deep-link attempt stays on Stitch | — |
| **API** (`api/`) | `/api/settings/public`, `/api/auth/*`, `/api/admin/*`, projects, screening, invites | admin, anon, normal | ✅ public-settings shape; `/me` 401 anon / admin authed; admin endpoints 401/403 unauth + non-admin, 200 admin; flags PUT round-trip; design-settings validation (400/200); projects CRUD; member invite token; bogus invite not-ok | invalid `defaultMode` → 400 | — |
| **Responsive** (`responsive/`) | `/app`, project workspace | admin | ✅ <1024px desktop-nav hidden + drawer toggle; drawer opens (dialog) + Escape/backdrop close; ≥1024px rail visible; pin reflow flips `data-pinned` | no horizontal overflow at mobile/tablet/laptop/desktop | — |
| **Accessibility** (`a11y/`) | landing, login, dashboard, project overview | anon, admin | ✅ axe serious/critical gate (per-page baseline); active nav `aria-current`; stepper status via `data-status` (not colour); modal focus-trap + Escape; shell buttons have names | baseline: landing `color-contrast` (documented design debt) | — |
| **Screening** (`screening/`) | `/app/project/:id?tab=screening&screen=…` | admin | ✅ T&A workbench + seeded records; overview roll-up; sub-stepper status+nav; include/exclude moves counts; search+status filter; import/duplicates/conflicts/second-review/export sub-views; AI engine enabled (API); **108.md §1** abstract chords (Ctrl/Cmd+I·E add + `defaultPrevented`, cross-engine); **108.md §4** decision + keyword undo/redo re-read from the API after every step, and after a reload; **108.md §§18-21** right-click keyword menu (open / Escape / click-outside / delete / undo / redo / both lists / editor chip + its ≥24px ×) | no-selection and Ctrl+Shift+I chords left to the browser; a `default`-origin keyword gets NO PecanRev menu (§19); Ctrl+Z with empty history is a silent no-op (§26); **§26 race**: the first decision POST delayed via `page.route`, Ctrl+Z pressed mid-flight, final persisted value is the undone one | ⏭️ in-UI AI score "why this score" (hidden under the 50-decision gate — too slow to seed); ⏭️ the §19 default-origin case self-skips if the probe seed term leaves `defaultKeywords.js` |
| **Risk of Bias** (`rob/`) | `/app/project/:id?tab=rob`, `/rob/:id` | admin, non-owner | ✅ flag exposed; RoB2 5-domain instrument; owner endpoints shapes; `?tab=rob` surface; empty/setup state; Extract sub-step; manual study → "Assess a result"; standalone `/rob/:id` | 🔒 non-owner 404 on owner-scoped endpoint (existence hidden) | ⏭️ domain-judgment override + finalise/reopen persistence; ⏭️ read-only-member "View only" UI |
| **Data extraction** (`extraction/`) | `/app/project/:id?tab=extraction` | admin | ✅ setup/empty state; rail+submenu reflect Extract stage; not screening-locked; loads with screening records; add/remove study; 2×2 calculator rejects incomplete/double-zero; 66.md P5/P6: `extractionAssist` flag OFF hides the structured toggle, ON opens the structured workspace setup state + returns to classic; `livingReview` flag OFF shows the Living Review disabled note at `?tab=living`, ON renders the dashboard sections | invalid 2×2 inputs rejected | ⏭️ extraction-edit autosave-persist (when not reachable via manual add); populated dual-extraction/adjudication + living update-run flows (need Pecan run fixtures) |
| **Meta-analysis** (`meta-analysis/`) | `?tab=analysis\|forest\|nma\|…` | admin | ✅ Analyze stepper + Meta-Analysis active; insufficient-data empty state; Forest stage; NMA stage reachable (flag ON) + not-ready empty + Run disabled | — | ⏭️ populated NMA run (forest/P-score/heterogeneity) + CSV/JSON export (needs seeded arm data) |
| **Search / PICO / Protocol** (`search/`) | `?tab=pico\|search\|prospero` | admin | ✅ server-backed PICO accepts input + persists; 3-step Define→Build→Run; Define↔Build nav; keyword → selected term; Pecan estimate enabled (pecanSearch ON); Run mounts Pecan surface; strategy autosave persists; PROSPERO editor renders | — | — |
| **Waitlist / beta** (`waitlist/`) | `/beta-waitlist`, `/` (flag ON) | anon, admin | ✅ preview form + questionnaire; empty/invalid email inline error; public count endpoint; unique submission + duplicate-safe; confirmation panel; flag ON gates `/` for anon; authed bypass | duplicate email detected without status leak | — |
| **Invites & notifications** (`invites/`) | `/invite/:token`, `/register?invite=`, `/app?view=invitations` | anon, admin, fresh user | ✅ public + logged-in landing; `GET /api/invites/:token` sanitized info; register-with-invite → active member + token consumed; notifications bell in shell; invitations view + invited-user pending reflection | invalid/unknown token → fallback card | — |
| **Files & PDF** (`files/`) | screening record PDF panel (AppPdfViewer) | admin | ✅ per-record PDF empty/upload state; panel stays inside main content (no overflow); non-PDF file rejected client-side | invalid file type rejected | ⏭️ loaded-PDF open/zoom/search/page-nav (no PDF-attachment fixture available) |
| **Visual** (`visual/`) | landing, app rail, dashboard, project rail, Ops sidebar | anon, admin | ✅ 5 masked screenshot baselines (dynamic content masked) | — | baselines committed (`*-chromium-win32.png`); regenerate with `--update-snapshots` |
| **Manuscript** (`manuscript/`) | `/app/project/:id?tab=manuscript` (flag `manuscriptEditor` set EXPLICITLY per-test; default is ON since 117.md §K.2) | admin | ✅ WYSIWYG editor (paper page + toolbar, NO textarea/markdown help); typing + Bold → real `<strong>`, no `**`/`[[cite:` ever visible; Generate All → real heading elements (no `#` tokens) + structured abstract editor with live word count; save pill reaches Saved; one-click Word export downloads a real `.docx` | flag OFF keeps the legacy drafter (kill switch, not a rollout gate — the degrade path stays supported) | — |
| **SEO / public surface** (`seo/`) | 16 indexable public routes, `/privacy`, `/app`, `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/__prerender/**` | anon | ✅ **111.md**, 3 groups / 30 chromium tests, all green: **(1) runtime head** on `:3000` for the 4 routes whose component calls `usePageHead`, gated on `og:url` (web-first — the pages are `lazy()`, so a bare `page.title()` races hydration); **(2) crawler-visible head** on `:3001` for all 16 prerendered routes — distinct `<title>`, meta description, absolute canonical on `SITE_ORIGIN`, exactly one `<h1>`, parseable JSON-LD, titles unique across all 16; **(3) server-owned semantics** on `:3001` — unknown path is a real 404 (not a soft 404), 301 `/privacy`→`/terms#privacy`, slash/case 301s, `X-Robots-Tag: noindex` on `/app`, `sitemap.xml` XML listing `/features/screening`, `robots.txt` `Disallow: /ops` + `Sitemap:`, `llms.txt` 200, prerendered page crawlable with JS off | `/App` (unknown spelling) stays 404 instead of being canonicalised into a 200; `/__prerender/terms/index.html` 404s (no duplicate URL space); `/login`+`/register` exempt from the JSON-LD requirement (registry has none by design) | ⏭️ groups 2+3 self-skip (with reason) when `:3001` does not serve a built `robots.txt` — the Vite dev server implements none of it; ⏭️ group 1 covers only 4 of 16 routes: `ArticlePage`/`PageShell` never call `usePageHead`, so the 12 content pages have no runtime head (app gap, see `docs/seo-overhaul-111.md` §5.7 — extend `RUNTIME_HEAD_PATHS` when fixed) |
| **Smoke** (`smoke/`) | core + public surfaces | admin, anon | ✅ Stitch renders; project route; flags exposed; landing; login form — runs on **chromium + firefox + webkit** | — | — |

## Cross-cutting coverage
- **Roles**: admin, mod, project owner (intrinsic), leader/reviewer/viewer (seeded via members API), normal user, unauthenticated — all exercised; permission boundaries asserted in `permissions/` + per-area.
- **Engines behind flags**: `aiScreening`, `rob_engine_v2`, `networkMetaAnalysis`, `searchEngine`, `pecanSearch`, `serverBackedWorkflowState` are enabled in `global-setup`; `betaWaitlist` flipped in-scope by the waitlist spec.
- **Branding**: PecanRev verified on every user-facing surface; no `Meta Lab` / `META·LAB` / `META·SIFT` / `Research OS` leaks (internal cookie `metalab_session` intentionally retained, not user-facing).
- **Responsive**: mobile / tablet / laptop / desktop breakpoints (mobile-chrome + tablet projects run the responsive specs).
- **Determinism**: validated serially; CI runs `--workers=1`. A few specs mutate global state (designSettings, betaWaitlist, onboarding) and restore it; see `e2e/README.md › Determinism note`.

## Documented skips (acceptance, not silent mutes)
| Spec | Skip | Reason / TODO |
|---|---|---|
| screening | AI "why this score" panel | Hidden until ≥50 screened decisions (or admin override); seeding 50 decisions is too slow for E2E. |
| screening (`keywordContextMenu`) | §19 "a generated (default) keyword gets NO menu" | Self-skips when the probe term (`randomized controlled trial`) is no longer in `defaultKeywords.js` — the assertion needs a term whose resolved origin really is `default`. |
| rob | domain-judgment persistence; read-only-member UI | Needs seeded studies/results + a read-only-member browser session (no fixture yet). |
| meta-analysis | populated NMA run + export | Needs seeded arm/contrast data (no fixture yet). |
| files | loaded-PDF open/zoom/search/page-nav | No PDF-attachment fixture; empty/upload + layout-containment are covered. |
| permissions | viewer UI-blocked decision | No viewer browser session via current fixtures (server boundary covered via API). |
| extraction | edit autosave-persist (some paths) | Reachable only past a full screening flow. |
| branding | login PecanRev wordmark | `fixme` — login still shows legacy META·LAB wordmark (intentional per rebrand notes). |
| seo | the "crawler-visible head" + "server crawler semantics" groups | Self-skip when `:3001` does not answer a built `/robots.txt`. Those behaviours (prerendered head, real 404s, slash/case 301s, `X-Robots-Tag`, sitemap/llms) belong to `server/middleware/publicPages.js` + `npm run build`; the Vite dev server mirrors only the `/privacy` 301. |
| seo | runtime head for the 12 content pages | Not a skip but a scoped list: `RUNTIME_HEAD_PATHS` holds only the 4 routes that call `usePageHead`. `ArticlePage` → `PageShell` never calls it, so those 12 keep the shell head on the dev server and after client-side nav. App fix is one call in `PageShell`; then widen the list to all 16. |

## Real-Safari manual QA — OUTSTANDING (119.md §10 scenario 1 / §11)

119.md §10 is explicit: **"Do not treat Playwright WebKit as the only proof of real
Safari compatibility."** This section records what the automation does and does not
prove, so the remaining gap is a named, actionable item rather than a silence.

**What IS proven automatically.** The `webkit-manuscript` Playwright project runs the
manuscript TABLE and FIGURE specs in FULL under WebKit (not just `@smoke`):
`e2e/manuscript/manuscript-tables-119.spec.ts` (empty-title caret: click → type,
select, cut/paste, undo; click on the derived number; one-gesture-one-table including
the rapid double click; whole-table Delete/Backspace with undo AND redo) and
`e2e/manuscript/manuscript-figures-119.spec.ts` (insert → number → cross-reference →
replace → delete → native undo; and the r2 regression that removing a figure leaves a
cross-reference chip in the following paragraph alone). `webkit-search` and
`webkit-pdf` do the same for their areas.

**What is NOT proven by it.** Playwright's WebKit is a build of the WebKit engine, not
Safari. It does not carry Safari's own text-caret heuristics, its page-zoom and
text-size behaviour, its IME/dictation input path, VoiceOver, Safari extensions, or
iOS/iPadOS soft-keyboard selection. The §2(a) defect lives in exactly that area —
caret placement in an empty inline-block editing island — so a fix that is green here
can still be wrong in the browser the defect was reported in.

**Status:** NOT DONE in the 119 rounds. Reason, stated rather than papered over: the
build and review environment is Windows-only, so no real Safari (or macOS/iOS) was
available to any agent in this work. No one should read the green WebKit project as a
Safari sign-off.

**The checklist a Safari owner must run** (macOS Safari 17+, and once on iPadOS):
1. Insert a table; click into the still-EMPTY title; type — every character must land.
2. Click the derived "Table 1." NUMBER — the caret must go to the title, not nowhere.
3. In the title: select-all, cut, paste, then Cmd+Z twice — text and selection behave.
4. Insert a second table with the caret still parked in the first title — exactly one
   new table, nothing nested, and both survive a reload.
5. Drag-select a whole table, press Delete — table AND caption go; Cmd+Z restores both
   with the title and number; Cmd+Shift+Z removes them again.
6. Insert a picture, cross-reference it in the paragraph directly below, remove the
   picture — the sentence and its chip must be untouched; Cmd+Z restores the picture.
7. Repeat 1-2 at 150% page zoom and with a non-default text size.
Record the result (version, OS, pass/fail per step) in the round's report before any
claim of "Safari is fixed" is made in user-facing copy.

## Fullscreen coverage is Chromium-only — by harness, not by choice (121.md §2)

`e2e/focus/fullscreen.spec.ts` has always skipped outside Chromium: fullscreen grants
depend on the window manager, and the Firefox and WebKit harnesses refuse or hang on a
headless `requestFullscreen` (WebKit is the worst of the three — a headless grant
simply never resolves). 121.md §2's two new measurements inherit that limit and say so
in their own `test.skip`:

* `manuscript-pdf-split.spec.ts` → "…and in REAL browser fullscreen it fills the
  screen" and "the divider drags under REAL fullscreen too";
* `manuscript-export-reveal-121.spec.ts` → "real fullscreen: the reveal works in the
  focused, chrome-less layout too".

**What still holds in every engine.** The layout itself is engine-neutral flex inside a
height-bounded column (no `vh` arithmetic anywhere any more), and it is pinned in
`tests/unit/manuscript/pdfSplit121.test.jsx`. The WINDOWED half of both measurements —
"the split fills the workspace, no dead strip", the real mouse drag, the double-click
reset, the ratio persistence, and the whole export-reveal matrix (Section × Continuous
× normal × split × narrow stacked) — runs with no fullscreen at all and is therefore
engine-portable; it is Chromium today only because these files are not enrolled in a
WebKit project.

**Status:** no real-Safari verification of the fullscreen split layout was possible in
this round, for the same Windows-only reason recorded above. A Safari owner should add
to the checklist: open the Manuscript Editor's PDF View, confirm the browser does NOT
go fullscreen on its own, then use the focus bar's "Enter full screen" and confirm the
PDF pane fills the screen with no strip at the bottom or right, and that dragging the
divider still resizes live.

These are the natural next coverage increments: add a study/result seeding helper (unlocks
RoB deep flows + populated meta-analysis), a PDF-attachment helper (unlocks the loaded-PDF
viewer flows), and per-role login sessions for project members (unlocks viewer/reviewer UI).
