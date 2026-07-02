I have all load-bearing details confirmed. Producing the consolidated plan.

---

# PecanRev Playwright E2E — Consolidated Discovery & Spec-Authoring Plan

Confirmed API facts (verified against `server/routes/*.js` + `screeningMemberController.js`): feature flags = `GET|PUT /api/admin/feature-flags` (requireAdmin, body = full flags object merged over defaults); theme = `PATCH /api/admin/settings/theme`; app settings = `GET|PUT /api/admin/settings`; console allow-list = `GET /api/admin/console`; global role = `PATCH /api/admin/users/:id/role` (requireAdmin); project roles = `POST /api/screening/projects/:pid/members` (body `{email, preset|role, modules}`); auth = `POST /api/auth/{register,login,logout}`, `GET /api/auth/me`; invites = `GET /api/invites/:token`, `POST /api/invites/:token/accept`.

---

## 1. CONSOLIDATED data-testid PLAN

Rule: a file appears in exactly ONE author's column. Files used by ≥2 spec areas are pulled into **SHARED/CORE** and owned by the foundation author; feature authors consume those testids read-only and never edit those files.

### 1A. SHARED / CORE (foundation author only — edit once, centrally)

App chrome / global nav shell — `src/frontend/stitch/shell/shellParts.jsx` + `StitchAppShell.jsx`:

| testid | file | element |
|---|---|---|
| `stitch-app-shell` | StitchAppShell.jsx:46 | root flex container |
| `stitch-main-content` | StitchAppShell.jsx:96 | `<main>` scroll region |
| `stitch-primary-rail` | shellParts.jsx:89 | `nav[aria-label='Primary']` |
| `stitch-home-button` | shellParts.jsx:104 | monogram home button |
| `stitch-global-nav-item-{key}` | shellParts.jsx:114 | dashboard/activity/invitations/help rail buttons |
| `stitch-profile-button` | shellParts.jsx:129 | avatar button |
| `stitch-account-menu` | shellParts.jsx:176 | `div[role='menu']` |
| `stitch-account-menu-item-{key}` | shellParts.jsx:176+ | profile / theme / ops-console / signout |
| `stitch-context-rail` | shellParts.jsx:149 | `aside` white submenu |
| `stitch-context-rail-title` | shellParts.jsx:159 | submenu title |
| `stitch-context-rail-collapse` | shellParts.jsx (onCollapse) | collapse button |
| `stitch-top-header` | shellParts.jsx:1 | utility header |
| `stitch-breadcrumb` | StitchAppShell.jsx:95 | breadcrumb nav |
| `stitch-drawer-toggle` | StitchAppShell.jsx:86 | mobile hamburger |
| `stitch-drawer` | StitchAppShell.jsx:86 | `aside[role='dialog']` mobile nav |

Workspace nav (used by screening, rob, extraction, meta-analysis, search, branding-nav, responsive, a11y → MUST be shared):

| testid | file | element |
|---|---|---|
| `stitch-project-rail` | StitchProjectRail.jsx | `nav[data-pinned]` |
| `stitch-pin-control` | StitchProjectRail.jsx | pin button (mirror state to `data-pinned`) |
| `stitch-back-to-projects` | StitchProjectRail.jsx | back link |
| `stitch-project-category-{key}` | StitchProjectRail.jsx:64 | overview/control/… category rows |
| `stitch-workflow-step-{stageId}` | StitchProjectRail.jsx:101 | step rows — use stage id (pico,search,screening,extraction,rob,analysis,grade,report) NOT a numeric index |
| `stitch-workflow-stepper` | StitchWorkflowStepper.jsx:1 | stepper container |
| `stitch-stepper-step-{stageId}` | StitchWorkflowStepper.jsx:39 | step row (add `data-status="done|partial|attention|empty"` + `data-disabled`) |
| `stitch-screening-subnav` | StitchProjectSubnav.jsx:1 | screening context aside |
| `stitch-screening-subnav-item-{screenKey}` | StitchProjectSubnav.jsx | overview/import/duplicates/screening/conflicts/second-review/control/export |

Universal project header — `src/frontend/workspace/tabs/overviewTabs.jsx` (ProjectHeaderBar, renders on every project page):

| testid | line | element |
|---|---|---|
| `header-menu-toggle` | 158 | rail collapse chevron |
| `header-project-title` | 165 | clickable title |
| `header-section-label` | 168 | breadcrumb stage label |
| `header-projects-link` | 194 | Projects nav |
| `header-presence` | 198 | presence indicator |
| `header-chat` / `header-notifications` / `header-user-menu` | 199–201 | utility cluster |

Cross-cutting primitives (add generically so every modal/toast is selectable) — `src/frontend/stitch/primitives/`:

| testid | element |
|---|---|
| `stitch-modal` (+ `data-modal="{name}"`) | StitchModal root `[role='dialog']` |
| `stitch-modal-title` / `stitch-modal-close` / `stitch-modal-confirm` / `stitch-modal-cancel` | modal parts |
| `stitch-toast` (+ `data-tone="success|error|info"`) | toast container |
| `stitch-form-error` | inline form error span |
| `stitch-loading` / `stitch-error-state` / `stitch-empty-state` | state primitives |

> Shared owner also adds `data-status`/`data-disabled` to stepper pips so a11y/visual authors assert status without color sniffing.

### 1B. PER-FEATURE-AREA (one author per file — no overlap)

- **Auth author** — `Login.jsx`, `Register.jsx`, `VerifyEmail.jsx`, `Onboarding.jsx`, `Profile.jsx`, `UserMenu.jsx`, `ResetPassword.jsx`, `InvitePage.jsx`. Testids: `login-{email,password,submit,error,register-link,forgot-link}`; `register-{name,email,password,confirm,terms-checkbox,submit,error,signin-link,invite-notice}`; `verify-email-{status,message,resend,signin}`; `onboarding-{progress,prompt,text-input,number-input,date-input,select,submit,skip,skip-all,error}`; `profile-{avatar,edit-name,save,change-password,pw-current,pw-new,pw-confirm}`; `usermenu-{avatar,dropdown,profile,logout,theme-toggle}`.
- **Dashboard+Projects author** (single owner of `StitchDashboard.jsx` — it hosts BOTH dashboard views AND project CRUD modals) — plus `StitchProjectOverview.jsx`, `dashboard/*View.jsx`. Testids: `dashboard-menu-{view}`; `kpi-{active-projects,owned,studies,records}`; `progress-ring-overall`; `card-recently-updated`; `filter-{all,active,inprogress,completed,owned}`; `project-search-input`; `button-new-project`(+`-empty`); `project-card` (+ `data-project-id`), `project-card-{title,status,role,open,rename,archive,delete}`; modals reuse shared `stitch-modal` with `data-modal="create|rename|archive|restore|delete"` + `np-title`,`np-desc`,`rn`,`del-confirm` inputs; `empty-state-{no-projects,no-match,no-archived}`; overview `project-title`,`button-export`,`button-project-control`,`badge-status`,`badge-role`.
- **Ops author** — `src/frontend/pages/admin/AdminConsole.jsx` only. Testids: `nav-{overview,users,onboarding,projects,sift,rob,searchProviders,waitlist,content,settings,style,flags,messages,security,health,engineVersions}`; `flag-toggle-{key}`, `flags-save`; `appearance-{hex-input,color-picker,save,reset}`; `settings-{appname,defaulttheme,registration,save}`; `overview-{brand-swatch,refresh}`; `messages-unread-badge`.
- **Screening author** — `ScreeningTab.jsx`, `SiftImport.jsx`, `ExportTab.jsx`, `DuplicatesTab.jsx`, `ConflictsTab.jsx`, `SecondReviewTab.jsx`, `ai/AiAssist.jsx`. Testids per the map's `suggestedTestId` set (`screening-search-input`, `decision-{include,exclude,maybe,undo}`, `exclusion-reason-select`, `keyword-checkbox-{kw}`, `import-confirm`, `export-button`, `export-filter-{key}`, `detect-duplicates`, `ai-why-score-toggle`, `record-row-{id}`, etc.).
- **RoB author** — `src/frontend/rob/*` (RobPage + domain nav). Testids TBD from a RoB-area map (not in inputs — see §5 gap).
- **Extraction / Meta-analysis / Search authors** — own their respective `workspace/tabs/*` lazy panels; no map supplied yet (§5 gap).
- **Waitlist author** — `pages/waitlist/BetaWaitlistPage.jsx` + `BetaWaitlistGate`. Testids TBD (§5 gap).

### 1C. CONFLICT-RISK FILES (flagged — do NOT let two authors edit)

| File | Wanted by | Resolution |
|---|---|---|
| `shellParts.jsx`, `StitchAppShell.jsx` | every Stitch area | SHARED owner |
| `StitchProjectRail.jsx`, `StitchWorkflowStepper.jsx`, `StitchProjectSubnav.jsx` | screening, rob, extraction, meta-analysis, search, branding-nav, responsive, a11y | SHARED owner |
| `overviewTabs.jsx` (ProjectHeaderBar) | projects + every workflow area | SHARED owner |
| `StitchDashboard.jsx` | dashboard view tests AND project-CRUD tests | ONE dashboard-projects author |
| `AdminConsole.jsx` | ops spec + (flag toggling needed by all areas) | Ops author owns testids; all other areas flip flags via **API** (§2), never via this file |
| `stitch/primitives/*` | every modal/toast assertion | SHARED owner |
| `Profile.jsx` / `UserMenu.jsx` | auth + branding-nav (theme toggle) | Auth author owns; branding-nav reuses `usermenu-theme-toggle` |

---

## 2. FEATURE-FLAG ENABLEMENT RECIPE (test setup)

All engine flags live in ONE `featureFlags` SiteSetting; the API merges your partial body over server defaults. Enable in `global-setup` (admin session) with a single authenticated request — flags persist server-side for the whole run.

```
// helper: enableFlags(adminRequest, { ...partial })
GET  /api/admin/feature-flags        // requireAdmin → current object
PUT  /api/admin/feature-flags        // requireAdmin → body = MERGED full object
     body: { ...current, aiScreening:true, rob_engine_v2:true,
             networkMetaAnalysis:true, searchEngine:true, pecanSearch:true,
             serverBackedWorkflowState:true, betaWaitlist:false }
```

| Flag | Enable via | Notes for specs |
|---|---|---|
| `aiScreening` | PUT feature-flags `aiScreening:true` | ALSO project-level opt-in + gated at 50 screened decisions (admin override). Detect ON via `GET /api/screening/:pid/ai/status` (404 ⇒ OFF). |
| `rob_engine_v2` | `rob_engine_v2:true` | unlocks `?tab=rob` + `/rob` |
| `networkMetaAnalysis` | `networkMetaAnalysis:true` | unlocks NMA tab |
| `searchEngine` | `searchEngine:true` | required dependency of pecanSearch |
| `pecanSearch` | set `searchEngine:true` FIRST, then `pecanSearch:true` | dependency-gated; UI shows "Inactive: enable X first" if dep off |
| `serverBackedWorkflowState` | `serverBackedWorkflowState:true` | server-persisted workflow state |
| `betaWaitlist` | `betaWaitlist:true` | flips public `/` to waitlist for UNAUTH only |
| `requireEmailVerification` | `PUT /api/admin/settings` (appSettings), not feature-flags | gates register→/verify-email |

NO dedicated endpoint exists for: **`designSettings.allowAllUsers` / `designSettings.defaultMode`** (Stitch rollout governance). The key is read by `resolveDesignMode` but has no Ops form and no admin PUT. ⇒ Specs needing all-users-Stitch must `test.skip('TODO: no designSettings write endpoint — set Stitch per-user via /api/profile uiDesignMode instead')`.

Recommended fixture: `enableFlags()` runs once in `global-setup.ts`; an optional per-test `withFlags(overrides)` fixture PUTs overrides then restores prior state in teardown so flag-toggle tests don't leak.

---

## 3. ROLE-SEEDING RECIPE (fixtures)

Two distinct role systems — keep them separate:

**(a) Global account roles** (`admin` / `mod` / `normal`) — control `/ops`, `/sift-beta`, AdminRoute cloaking.

```
1. POST /api/auth/register { name, email, password }        // → normal user + session cookie
2. (promote) as an ADMIN session:
   PATCH /api/admin/users/:id/role { role: 'admin' | 'mod' } // requireAdmin
```
Bootstrapping the FIRST admin (no admin exists yet): run `server/scripts/seedAdmins.js` or DB `UPDATE User SET role='admin'`. `global-setup.ts` should create/login this admin, store `storageState` → `.playwright/auth/admin.json`, set Stitch via `PUT /api/profile { uiDesignMode:'stitch' }` + localStorage `metalab_ui_design=stitch`. Create `mod.json` and `normal.json` session states the same way (register → promote/leave).

**(b) Project collaboration roles** (`owner` / `leader` / `reviewer`(=member) / `viewer`) — control workspace + screening permissions.

```
owner   : intrinsic — the user who POST /api/projects (createLinkedSift:true). Not assignable.
leader  : POST /api/screening/projects/:pid/members { email, preset:'leader' }
          ↳ 403 unless caller isOwner (leaders cannot mint leaders)
reviewer: POST /api/screening/projects/:pid/members { email, preset:'reviewer' }   // the "member"
viewer  : POST /api/screening/projects/:pid/members { email, preset:'viewer' }
scope   : optional body { modules: 'metalab' | 'metasift' | 'both' }
mutate  : PATCH /api/screening/projects/:pid/members/:mid   { preset|role, ... }
remove  : DELETE /api/screening/projects/:pid/members/:mid
```
If the invited email is unregistered, the endpoint returns a one-time `inviteToken` (plaintext only in that response) → use it to drive `/invite/:token` and `POST /api/invites/:token/accept` invite-acceptance specs. `owner` is rejected (400) by this endpoint.

Fixtures: `adminUser`, `modUser`, `normalUser` (storageState-based); `ownerProject` (admin-owned, linked sift); `tmpProject` (auto-create+delete per test); `projectWithMembers(roles[])` that seeds a leader/reviewer/viewer via the members API for permissions + multi-rater screening tests.

---

## 4. AREA → SPEC-FILE ASSIGNMENT

Each spec uses the shared `ShellNav` page object plus its own. Default session = admin+Stitch unless noted.

| Spec file | Routes | Key behaviors to assert | Flags / seeding | Page object |
|---|---|---|---|---|
| **auth.spec** | `/`, `/login`, `/register`, `/reset`, `/verify-email`, `/terms`, `/privacy` | login success→/app; invalid creds→`login-error`; register validation (mismatch/short/invalid-email/terms); register→onboarding/verify branch; PublicRoute redirects authed→/app; session persistence via `/api/auth/me`; logout→/ | `requireEmailVerification` on (settings) for verify path; freshUser fixture; unverified-email seed | `AuthPage` |
| **dashboard.spec** | `/app?view={overview,mywork,activity,invitations,archived,resources}` | default overview; KPI cards; filters (All/Active/…); live search; view persists on reload; recently-updated ordering; empty states | adminUser + ≥3 seed projects (varied status); invitation seed for badge | `DashboardPage` |
| **projects.spec** | `/app`, `/app/project/:id`, `?tab=overview` | create (title-required, description, linked-sift, loading, success toast); rename (empty guard); archive↔restore; delete (exact case-sensitive name match, whitespace-trim, button-enable, linked-workspace warning, input clears on reopen); overview load/error/retry; title ellipsis | `tmpProject` per test (never touch seed); long-name seed | `DashboardPage`+`ProjectOverviewPage` |
| **ops.spec** | `/ops`, `/sift-beta` | 16-tab nav (admin) vs users+messages only (mod); appearance live-preview + save + reset + persist; flags toggle+save+persist+dependency-warning; settings load/save + load-failed disabled-save; messages unread badge; engine-versions history modal | adminUser + modUser; betaWaitlist applicant seed; unread ContactMessage seed | `OpsPage` |
| **screening.spec** | `/sift-beta/projects/:pid`, `/app/project/:id?tab=screening&screen=*` | 3-col layout; import per format + async progress; duplicate detect/merge; search+filter; open→decision (I/E/M/undo); exclusion reason; labels/notes; keyboard shortcuts (blocked in inputs); quorum; conflict resolution; AI score + "why this score"; export filters | `serverBackedWorkflowState` on; `projectWithMembers([leader,reviewer×2])`; imported-records seed; `aiScreening` on + ≥50 decisions OR admin override | `ScreeningPage` |
| **rob.spec** | `/rob`, `/rob/:id`, `?tab=rob` | RoB step appears only when flag on; domain nav; assessment entry; perms (canAssessRiskOfBias) | `rob_engine_v2:true`; project + study seed | `RobPage` (TODO map) |
| **extraction.spec** | `?tab=extraction` | step disabled until screening set up (lock icon, aria-disabled); panel loads when records reach extraction | linked-sift project past screening | `ProjectPage` (TODO map) |
| **meta-analysis.spec** | `?tab=analysis,forest,sensitivity,subgroup,nma,grade` | forest/analysis render; NMA tab gated by flag | `networkMetaAnalysis:true`; extracted-data seed | `MetaAnalysisPage` (TODO map) |
| **search.spec** | `?tab=search` (Define→Build→Run wizard) | wizard 3 steps; live hit-status; pecan providers gated | `searchEngine:true` (+`pecanSearch:true` for pecan); PICO seed | `SearchPage` (TODO map) |
| **waitlist.spec** | `/` (unauth), `/beta-waitlist` | flag-on gates UNAUTH `/`→waitlist; authed bypass; `/beta-waitlist` preview renders regardless; submit→Contact/Applicant | `betaWaitlist:true`; unauth context (no storageState) | `WaitlistPage` (TODO map) |
| **permissions.spec** | `/ops`, `/sift-beta`, project routes | AdminRoute 404-cloaks normal/mod for admin-only; non-owner hides rename/archive/delete; viewer read-only screening; ProtectedRoute→/login when unauth | adminUser, modUser, normalUser; `projectWithMembers` | `ShellNav` + per-area |
| **invites-notifications.spec** | `/invite/:token`, `/register?invite=`, `/app?view=invitations` | invite landing signed-in & out; register auto-accept→project; expired→fallback; notifications bell; invitations badge count | unregistered-email member seed → `inviteToken` | `AuthPage`+`DashboardPage` |
| **files-pdf.spec** | `?tab=screening` (PDF panel), AppPdfViewer | PDF render/fit-width; worker chunk loads (no "Could not load"); upload | project with attached PDF | `ScreeningPage` |
| **responsive.spec** | `/app`, `/app/project/:id` | <1024px: drawer toggle + stacked nav, `.stitch-desktop-nav` hidden; ≥1024px: rail hover 72→248px, pin reflow; mobile drawer Escape-close | viewport projects; `data-pinned` assert | `ShellNav` |
| **a11y.spec** | all major routes | axe scans; `aria-current` on active nav/step; stepper status via `data-status` (not color); focus trap in modals; Escape closes | per-route seeds | `ShellNav` (+ axe util) |
| **api.spec** | `/api/*` | `/api/publicFlags` shape; `/api/auth/me` 401 unauth; admin endpoints 403 for non-admin; feature-flags PUT round-trip | adminUser request context | (request-only) |
| **visual.spec** | dashboard, project overview, ops appearance | screenshot snapshots; theme light/dark; brand-color preview | stable seed (fixed project names) | `ShellNav` |
| **branding-nav.spec** | `/app`, `/app/project/:id`, `/ops` | admin Stitch↔legacy toggle (`html[data-ui-design='stitch']`); non-admin never Stitch; `/ops` forced legacy; theme toggle persists; design mode doesn't leak across routes | adminUser vs normalUser; `uiDesignMode` via `/api/profile` | `ShellNav`+`OpsPage` |

---

## 5. CROSS-CUTTING RISKS / GAPS & test.skip plan

**Must `test.skip` with reason:**
1. **All-users-Stitch governance** — no write endpoint for `designSettings.allowAllUsers`/`defaultMode`. `test.skip('TODO: designSettings has no admin API; only per-user uiDesignMode is settable')`.
2. **RoB, Extraction, Meta-analysis, Search, Waitlist** — no discovery map supplied. Their spec files should `test.skip('TODO: awaiting area discovery map — selectors/behaviors unmapped')` until maps + testids land. Author the page-object shells now, body later.
3. **AI scoring gate** — when `aiScreening` is on but <50 decisions and no admin override, AI panel is intentionally hidden ⇒ `test.skip` the AI-explanation tests unless the 50-decision/override seed runs (slow). Provide an override seed path; skip if unavailable.

**Risks the foundation author must absorb (otherwise two authors collide):**
- `StitchDashboard.jsx`, `shellParts.jsx`, `StitchProjectRail/Stepper/Subnav.jsx`, `overviewTabs.jsx`, `stitch/primitives/*`, `AdminConsole.jsx` are each wanted by multiple areas — locked to single owners per §1C. Land ALL shared testids + the `enableFlags`/role fixtures in a **Phase 0 foundation PR** before any feature author starts, or merge conflicts are guaranteed.

**Selector/architecture hazards:**
- Stitch components are **inline-styled, no classes** — brittle `[style*=…]` selectors everywhere; testids are mandatory, not optional.
- `?screen=` deep-link is parsed **inside SiftProject**, not the router — assert SiftProject reacts, don't assert at route level.
- Feature flags are **server-fetched**, not client-toggleable — only the API path in §2 works; no localStorage shortcut.
- `useSidebarPin` persists to localStorage (`stitch-sidebar-pinned`) — responsive specs should reset it in `beforeEach` to avoid cross-test bleed; mirror state to `data-pinned`.
- `GlobalPresence` renders `null` — assert via network interception on `/api/presence/ping`, never DOM.
- Real-time (`decision.saved`, `project.updated`, `members.changed`) updates have no stable DOM signal — assert via network spy or poll, expect silent (no loading flash) refresh.
- Modal focus-trap has no testid for focus state — assert `aria-modal`, focus location, and Escape behavior indirectly.
- `StitchErrorBoundary` impl not provided — error-recovery assertions are unverified until that file is mapped.
- Lazy code-split tabs (`LazyControl`, `LazyScreening`, …) — allow for chunk-load waits; don't assume synchronous mount.

**Page-object inventory to build in Phase 0:** `ShellNav` (rail, context rail, account menu, drawer, stepper, project header), `AuthPage`, `DashboardPage`, `ProjectOverviewPage`, `OpsPage`, `ScreeningPage`, plus stubs `RobPage`/`MetaAnalysisPage`/`SearchPage`/`WaitlistPage`. Fixtures: `adminUser`/`modUser`/`normalUser`, `enableFlags`/`withFlags`, `tmpProject`, `projectWithMembers`, `seed`.