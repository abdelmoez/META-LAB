# Stitch full-integration parity matrix (design4.md)

Goal of design4.md: make the Stitch theme a complete, production-ready interface for
**every part of PecanRev**, with all engines feeling like native parts of ONE
application (no "separate app" / "back to the main app" experience) while the
backend engines stay separate at the service level.

This matrix is the implementation checklist. Status legend:
- **native** — renders inside the unified Stitch project workspace shell (rail +
  header + presence), no design flip, full functional parity (the proven engine
  component is mounted with the exact legacy props).
- **native-page** — a purpose-built native Stitch page (dashboard/overview/profile).
- **legacy-shell** — still renders the legacy chrome (documented boundary below).
- **by-design-legacy** — intentionally legacy (pre-auth; the admin design switch is a
  per-user setting resolved only AFTER login, so pre-auth screens have no Stitch user
  yet).

## Project workflow stages (the heart of design4 — "Current Problem to Fix")

All of these now open at `/app/project/:id?tab=<stage>` inside `StitchProjectWorkspace`,
sharing the collapsible workflow rail, the page header (breadcrumb + stage title +
live online-member presence + next-step), loading/error/permission states and the one
shared export dialog. Each mounts the SAME engine component the legacy `Workspace.jsx`
renders, with identical props — so behaviour is identical and there is zero data
duplication (same `Project.data` blob via `useStitchProjectDoc`, or each tool's own
server module / API).

| Stage | Route (`?tab=`) | Engine component (reused) | Source of truth | Presence | Status |
|---|---|---|---|---|---|
| Project Overview | (bare) | StitchProjectOverview (native) | project + screening overview | yes | native-page |
| Project Control | `control` | ControlTab + ProjectMembersPanel | ScreenProject + blob | yes | native |
| PICO / Question | `pico` | PICODispatcher | `protocol` module / `project.pico` | yes | native |
| Plan & Protocol | `prospero` | PlanProtocolDispatcher | `planProtocol` module / `project.prospero` | yes | native |
| Search Builder | `search` | SearchDispatcher → SearchBuilderTab | `/api/search-builder` (flag) / blob | yes | native |
| Search & Discovery | `discovery` | DiscoveryDispatcher → PecanSearchTab | `/api/pecan-search` (flag) | yes | native |
| **Screening** | `screening` | ScreeningWorkspaceFrame → SiftProject `embedded` | screening engine (`/api/screening`) | yes | **native** (full-bleed) |
| PRISMA Flow | `prisma` | PRISMATab | `project.prisma` (+ screening sync) | yes | native |
| Data Extraction | `extraction` | ExtractionTab | blob (`updateProject`) | yes | native |
| **Risk of Bias** | `rob` | RoBTab → ProjectRobPanel → RobWorkspace | RoB engine (`/api/rob`) | yes | **native** (split, full-bleed when a study is open) |
| Meta-analysis | `analysis` | AnalysisTab | blob (`updateProject`) | yes | native |
| Forest Plot | `forest` | ForestTab | blob (read) | yes | native |
| Sensitivity & Bias | `sensitivity` | SensitivityTab | blob (read) | yes | native |
| Subgroup Analysis | `subgroup` | SubgroupTab | blob (read) | yes | native |
| GRADE Certainty | `grade` | GRADETab | blob (`upd`) | yes | native |
| Manuscript Draft | `manuscript` | ManuscriptTab | blob (`upd`) | yes | native |
| Reports / Export | `report` | ReportTab + shared ExportDialog | blob (`upd`) | yes | native |
| Methods & Equations | `methods` | MethodsTab (reference) | static engine catalogue | yes | native |

The screening engine runs **embedded** (`SiftProject embedded`) so it drops its own
global header/sidebar/account-menu and reads the collision-free `?screen=` param for
its own sub-navigation (Import / Duplicates / Title & Abstract / Conflicts / Final
Review / Settings / Export) — exactly as the legacy workspace embeds it. RoB renders
its assessment list, then a PDF + assessment split when a study is opened (full-bleed).

## Backend engine separation — preserved

No engine's backend logic, database, service boundary, API or domain responsibility
was combined. The integration is purely a frontend shell concern: each `?tab=` mounts
the engine's own React component, which talks to its own API
(`/api/screening`, `/api/rob`, `/api/search-builder`, `/api/pecan-search`, the project
blob autosave, the server-backed `protocol`/`planProtocol` modules). NO server file was
changed by design4.

## Global / account / admin surfaces

| Surface | Route | Status | Notes |
|---|---|---|---|
| Dashboard (Command Center) | `/app` | native-page | StitchDashboard hub (`?view=` overview/mywork/activity/invitations/archived/resources) |
| Profile & settings | `/profile` | native-page | StitchProfile |
| Ops Console (overview/health/flags) | `/ops` | native-page | StitchOpsConsole; deep admin CRUD opens the legacy console (boundary #3) |
| Notifications | bell (global) | native | reused NotificationsBell in the Stitch top header |
| Invitations / Activity | `/app?view=` | native | reused notificationsApi |

## Resolved in the recs pass

- **Dashboard quick-links to screening** (`MyWork` / `Activity` / `Invitations` rows) now
  route **PecanRev-linked** screening through the unified workspace
  (`/app/project/:id?tab=screening`) using the linked project id the list/notification
  payloads already carry. **Standalone** screening projects (created directly in the
  screening dashboard, with no PecanRev parent) legitimately keep the `/sift-beta` route
  — they have no `/app/project/:id` to host them.
- **Project Overview presence strip** — the overview now shows the same live,
  project-scoped online-members strip (`StitchProjectPresence`) as the deep-tool pages.

## Documented boundaries (remaining, non-blocking)

1. **Ops Console deep admin tools** — the native Stitch Ops page covers overview /
   health / flags; the dense admin CRUD (users, projects, audit, waitlist, email,
   policies) opens the legacy console via `/ops?ui=legacy`. It shares auth + role
   guards; a fully-native dense admin surface is a separate, larger effort.
2. **Pre-auth screens** (landing, login, register, verify, onboarding, beta waitlist)
   remain legacy **by design**: the design switch is a per-user admin preference
   resolved only after login, so there is no Stitch user context before auth. The beta
   waitlist page already uses Stitch tokens.
3. **Editor bodies** reuse the proven legacy/feature editors (harmonized to Stitch via
   the `--t-*` token remap) rather than bespoke native-Stitch-styled form layouts. This
   guarantees full functional parity + zero data-corruption risk; fully native-styled
   card forms are a follow-up visual refinement, not a functional gap.

## Verification

- `npm run test:ci` → all unit + screening tests green (2276 at design4 baseline + new).
- `npx vite build` → green; every engine body is a separate lazy chunk (overviewTabs,
  screeningTabs, extractionTabs, analysisTabs, reportTabs, SiftProject, ProjectRobPanel,
  protocolTabs), so non-admins download none of it and the workspace module stays light.
- Legacy theme unchanged: `Workspace.jsx` still renders every tab inline; the standalone
  `/sift-beta` and `/rob` routes still work for the legacy/standalone entry points.
