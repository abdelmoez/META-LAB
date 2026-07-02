# PecanRev — Playwright E2E Coverage Matrix

Generated for the suite under `e2e/`. **169 tests across 19 spec files** (chromium full
coverage; `@smoke` also runs on firefox + webkit + mobile/tablet). Validated serially
(`--workers=1`): all green, with the documented `test.skip`s below for preconditions not
reachable via the current fixtures. How to run: see `e2e/README.md`.

Legend: ✅ covered · ⏭️ documented skip (TODO) · 🔒 permission boundary asserted.

| Area | Routes / Surface | Roles tested | Main flows covered | Edge / negative cases | Documented gaps (skips) |
|---|---|---|---|---|---|
| **Auth & onboarding** (`auth/`) | `/`, `/login`, `/register`, `/terms`, `/privacy` | anon, admin, fresh user | ✅ login (UI) → `/app`; register validation (UI); session persists across reload; sign-out → `/login`; PublicRoute redirects authed→`/app` | invalid creds banner; empty-submit blocked; bad email; pw<8; pw mismatch; terms required | ⏭️ onboarding intro asserted only when questions exist (gate disabled globally; re-enabled in a serial block) |
| **Dashboard** (`dashboard/`) | `/app?view=overview\|mywork\|activity\|invitations\|archived\|resources` | admin | ✅ KPI cards; view switching updates `?view=`; view persists on reload; search filter; status/role filters (count==cards); recency ordering | no-match empty state; 0-count filter empty state | — |
| **Projects** (`projects/`) | `/app`, `/app/project/:id?tab=overview` | admin | ✅ create (toast+card); rename (persists); archive↔restore; delete name-match confirm; open→overview; long-name ellipsis; dashboard persistence | title required (empty/whitespace); rename empty guard; delete disabled until exact case/trim match | — |
| **Ops console** (`ops/`) | `/ops` (legacy chrome) | admin, mod | ✅ loads + all 16 nav sections reachable; **design rollout default-mode round-trips** (save→persist→restore); flag toggle persists+restores; settings form loads | 🔒 mod sees only users+messages; admin-only navs absent for mod | — |
| **Permissions & roles** (`permissions/`) | `/ops`, `/sift-beta`, `/app`, project APIs | admin, mod, normal, anon | 🔒 normal 404-cloaked on `/ops`+`/sift-beta`; anon→`/login` on `/app`; account-menu "Ops Console" staff-only; mod 403 on admin API + can't change roles; non-member can't read/delete a project | existence-hidden 404 (not `/login`) for anon on `/ops` | ⏭️ viewer/reviewer UI-blocked-decision (no viewer browser session via current fixtures) |
| **Branding & nav** (`branding/`) | `/`, `/app`, project, `/ops` | admin, normal | ✅ "PecanRev" on landing/dashboard/overview, no legacy leaks; rollout default → non-admin also Stitch; `allowAllUsers=false` → non-admin legacy, admin Stitch; `?ui=legacy`; `/ops` forced legacy; theme toggle persists; rail nav routes correct | login page still shows legacy META·LAB wordmark (documented `fixme`, intentional per rebrand) | — |
| **API** (`api/`) | `/api/settings/public`, `/api/auth/*`, `/api/admin/*`, projects, screening, invites | admin, anon, normal | ✅ public-settings shape; `/me` 401 anon / admin authed; admin endpoints 401/403 unauth + non-admin, 200 admin; flags PUT round-trip; design-settings validation (400/200); projects CRUD; member invite token; bogus invite not-ok | invalid `defaultMode` → 400 | — |
| **Responsive** (`responsive/`) | `/app`, project workspace | admin | ✅ <1024px desktop-nav hidden + drawer toggle; drawer opens (dialog) + Escape/backdrop close; ≥1024px rail visible; pin reflow flips `data-pinned` | no horizontal overflow at mobile/tablet/laptop/desktop | — |
| **Accessibility** (`a11y/`) | landing, login, dashboard, project overview | anon, admin | ✅ axe serious/critical gate (per-page baseline); active nav `aria-current`; stepper status via `data-status` (not colour); modal focus-trap + Escape; shell buttons have names | baseline: landing `color-contrast` (documented design debt) | — |
| **Screening** (`screening/`) | `/app/project/:id?tab=screening&screen=…` | admin | ✅ T&A workbench + seeded records; overview roll-up; sub-stepper status+nav; include/exclude moves counts; search+status filter; import/duplicates/conflicts/second-review/export sub-views; AI engine enabled (API) | export action enabled; duplicates detect action present | ⏭️ in-UI AI score "why this score" (hidden under the 50-decision gate — too slow to seed) |
| **Risk of Bias** (`rob/`) | `/app/project/:id?tab=rob`, `/rob/:id` | admin, non-owner | ✅ flag exposed; RoB2 5-domain instrument; owner endpoints shapes; `?tab=rob` surface; empty/setup state; Extract sub-step; manual study → "Assess a result"; standalone `/rob/:id` | 🔒 non-owner 404 on owner-scoped endpoint (existence hidden) | ⏭️ domain-judgment override + finalise/reopen persistence; ⏭️ read-only-member "View only" UI |
| **Data extraction** (`extraction/`) | `/app/project/:id?tab=extraction` | admin | ✅ setup/empty state; rail+submenu reflect Extract stage; not screening-locked; loads with screening records; add/remove study; 2×2 calculator rejects incomplete/double-zero | invalid 2×2 inputs rejected | ⏭️ extraction-edit autosave-persist (when not reachable via manual add) |
| **Meta-analysis** (`meta-analysis/`) | `?tab=analysis\|forest\|nma\|…` | admin | ✅ Analyze stepper + Meta-Analysis active; insufficient-data empty state; Forest stage; NMA stage reachable (flag ON) + not-ready empty + Run disabled | — | ⏭️ populated NMA run (forest/P-score/heterogeneity) + CSV/JSON export (needs seeded arm data) |
| **Search / PICO / Protocol** (`search/`) | `?tab=pico\|search\|prospero` | admin | ✅ server-backed PICO accepts input + persists; 3-step Define→Build→Run; Define↔Build nav; keyword → selected term; Pecan estimate enabled (pecanSearch ON); Run mounts Pecan surface; strategy autosave persists; PROSPERO editor renders | — | — |
| **Waitlist / beta** (`waitlist/`) | `/beta-waitlist`, `/` (flag ON) | anon, admin | ✅ preview form + questionnaire; empty/invalid email inline error; public count endpoint; unique submission + duplicate-safe; confirmation panel; flag ON gates `/` for anon; authed bypass | duplicate email detected without status leak | — |
| **Invites & notifications** (`invites/`) | `/invite/:token`, `/register?invite=`, `/app?view=invitations` | anon, admin, fresh user | ✅ public + logged-in landing; `GET /api/invites/:token` sanitized info; register-with-invite → active member + token consumed; notifications bell in shell; invitations view + invited-user pending reflection | invalid/unknown token → fallback card | — |
| **Files & PDF** (`files/`) | screening record PDF panel (AppPdfViewer) | admin | ✅ per-record PDF empty/upload state; panel stays inside main content (no overflow); non-PDF file rejected client-side | invalid file type rejected | ⏭️ loaded-PDF open/zoom/search/page-nav (no PDF-attachment fixture available) |
| **Visual** (`visual/`) | landing, app rail, dashboard, project rail, Ops sidebar | anon, admin | ✅ 5 masked screenshot baselines (dynamic content masked) | — | baselines committed (`*-chromium-win32.png`); regenerate with `--update-snapshots` |
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
| rob | domain-judgment persistence; read-only-member UI | Needs seeded studies/results + a read-only-member browser session (no fixture yet). |
| meta-analysis | populated NMA run + export | Needs seeded arm/contrast data (no fixture yet). |
| files | loaded-PDF open/zoom/search/page-nav | No PDF-attachment fixture; empty/upload + layout-containment are covered. |
| permissions | viewer UI-blocked decision | No viewer browser session via current fixtures (server boundary covered via API). |
| extraction | edit autosave-persist (some paths) | Reachable only past a full screening flow. |
| branding | login PecanRev wordmark | `fixme` — login still shows legacy META·LAB wordmark (intentional per rebrand notes). |

These are the natural next coverage increments: add a study/result seeding helper (unlocks
RoB deep flows + populated meta-analysis), a PDF-attachment helper (unlocks the loaded-PDF
viewer flows), and per-role login sessions for project members (unlocks viewer/reviewer UI).
