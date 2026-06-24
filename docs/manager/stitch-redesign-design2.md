# Stitch experience redesign (design2.md) — implementation report

**Scope:** A thorough redesign of the information architecture, navigation, dashboard
and project workspace of the **Stitch** presentation layer (admin-only parallel design
over the same PecanRev application), preserving every legacy feature, permission,
workflow, route and piece of state. The legacy UI and the internal admin design-switch
are untouched and remain the rollback path.

Builds on the v3.48.0 Stitch design layer. CI: **2275 tests green** (2261 prior + 14 new);
production `vite build` succeeds.

---

## 1. Architecture discovered
Two orthogonal nav layers: **app routes** (`src/App.jsx`, each route pairs a legacy page
with an optional lazy Stitch page via `DesignRoute`) and **workspace tabs** (the 18 SR
steps inside the legacy monolith `Workspace.jsx`). Only four routes have a Stitch-native
page: `/app`, `/app/project/:id`, `/profile`, `/ops`. Deep workflow tools are legacy.
Design mode is admin-only (`designMode.js` forces `legacy` for non-admins; server refuses
to persist `stitch` for non-admins).

## 2. Legacy navigation structure
Project rail (from `projectHelpers.js` TABS, top→bottom): **Project** group (Overview,
Project Control) → **Workflow** phases `Plan & Protocol` (PICO, Protocol), `Search`
(Search Builder, Search & Discovery), `Screen` (Screening, PRISMA Flow), `Extract` (Data
Extraction, Risk of Bias), `Analyze` (Meta-Analysis, Forest, Sensitivity, Subgroup),
`Report` (GRADE, PRISMA Checklist, Manuscript) → **Reference** (Methods & Equations).
Screening sub-nav (embedded): Overview, Import, Duplicates, Title & Abstract, Conflicts,
Final Review, Settings, Export (`?screen=`/`?tab=`).

## 3. Previous Stitch navigation structure
Purple rail launched **standalone engines** (Dashboard, Screening `/sift-beta`, Risk of
Bias `/rob`, Ops). The dashboard white column duplicated the **project list** + a sidebar
**New Project** button under a `Research OS` / "Welcome" subtitle. The project page reused
the same global rail and deep-linked phases with a visible **"Open classic workspace"**
button (`?ui=legacy`).

## 4. Final global dashboard navigation (purple rail)
Global, application-level destinations only — **no standalone engines**: **Dashboard**,
**Activity**, **Invitations** (badge), **Help & Feedback**; PecanRev "PR" monogram top;
profile avatar + a **subtle real version label** at the bottom. Tooltips (hover + focus),
`aria-current`, green active indicator bar. `src/frontend/stitch/shell/shellParts.jsx`.

## 5. Final dashboard white-column menu
A workspace **menu** (no duplicated project list, no sidebar New-Project button — creation
stays in the main content): **Workspace Overview**, **My Work**, **Invitations** (badge),
**Archived Projects**, and a lower **Resources** (Support) section. Header shows brand
**PecanRev** + a prominent **"Welcome, [first name]"** (graceful fallback, never
`undefined`/email). Version label in the footer. Each item is a real `?view=` of the hub.

## 6. Final project workflow navigation (purple rail)
`StitchProjectRail` — icon-only when collapsed (72px), expands to full labels as an
**overlay** (page never reflows) on hover, keyboard focus-within, or an explicit toggle.
Contains **Project Overview, Project Control**, every legacy workflow stage grouped by
phase, and **Methods** — in the exact legacy order, by user-facing workflow name. Per-step
status pips reuse `stepStatus`. Profile + version at the bottom. Each stage opens its real
destination (Screening/RoB engines; other stages the classic workspace tab).

## 7. Final contextual submenu structure
`StitchWorkflowNav` — a reusable, config-driven vertical stepper (status icon + connector
+ live count + deep link). On the project overview it renders the **Screening pipeline**
(the 8 canonical subpages with live counts from `getOverview`, deep-linking into the real
engine). Hidden when the project has no linked screening (design2.md: hide unless there is
meaningful sub-navigation). Collapsible; omitted from the mobile drawer to avoid two
sidebars.

## 8. Functional parity matrix
Derived in `.claude/Engine/design2-audit/E-overview-parity.md` (56 rows). Brought into the
Stitch overview: next-step CTA, PICO + PROSPERO/study-design, methodology audit summary
(`auditProject`), screening funnel + included/conflicts, owner identity, read-only/shared
banner, Project Control entry, realtime refetch, workflow progress (6 phases) + X/15 steps,
readiness, team roster, export. See §10 for intentional non-migrations.

## 9. Overview features migrated
Project identity/metadata, lifecycle status, workflow progress (phase bars + steps-done),
readiness check, **next suggested step**, **PICO summary + PROSPERO ID + study-design**,
**methodology audit** (severity-graded, deep-jump), screening metrics + funnel, **owner**,
**read-only/shared banner**, team roster, project details, **Project Control** entry,
**Export** (JSON), RoB permission-gated entry.

## 10. Items intentionally NOT migrated (and why)
- **Inline rename, status select, screening/collab settings, archive/delete danger zone,
  Report-PDF/Journal-ZIP/R-validation exports** — these live in **Project Control** and the
  Report stage, reachable from the rail by workflow name. Re-implementing them natively in
  Stitch would fork heavy export engines / mutation logic; they remain in their existing,
  tested home. Documented, not lost.
- **Deep workflow tool *pages*** (PICO editor, Search Builder, Extraction tables, Analysis,
  PRISMA, Manuscript) render in their existing engine, reached by workflow name. They are
  not yet Stitch-native (the established v3.48.0 architecture decision).

## 11. Standalone-engine links removed
The purple global rail no longer launches Screening, Risk of Bias, Search or Data
Extraction as standalone apps. Those areas are reachable only inside a project context (the
project rail), as connected stages of one workflow.

## 12. Classic-view links removed
Removed the **"Open classic workspace"** button and the **"Opens in the classic workspace"**
notes from the Stitch project overview. The internal admin **design switch** remains
(header segmented control, admin-only) for testing/rollback. No user-facing
classic/legacy/return-to-old links anywhere in the Stitch UI.

## 13. Manrope implementation
Manrope is loaded once (`index.html` Google Fonts, weights 400–800) and applied across the
whole Stitch theme via `html[data-ui-design="stitch"] body` + a new
`html[data-ui-design="stitch"] .stitch-scope { font-family: Manrope }` rule that also
reaches **portaled** overlays (modals, menus, dropdowns, tooltips, toasts, drawers — all
carry `.stitch-scope`). Set on the scope container only, so explicitly monospaced technical
fields keep their monospace font. No duplicate font loads; system fallback stack; legacy
theme unaffected (all rules scoped under the design root).

## 14. Version source and display behavior
`GET /api/version` → render `.version` only (e.g. `v3.49.1`), never the commit hash
(withheld from the component regardless of role). Module-level cache (endpoint is
`no-store`); silent fallback (renders nothing) on failure — never a hard-coded number.
`src/frontend/stitch/shell/useAppVersion.js`. Shown beneath the profile in both rails and
in the dashboard menu footer, with tooltip "PecanRev version 3.49.1".

## 15. Ops Console permission behavior
Added an **Ops Console** item to the account dropdown in a divided **Administration**
section, shown only to **admin/mod** (`isStaff`) — the same roles `AdminRoute` admits.
Hiding is presentation-only: `/ops` and the server remain authoritative, so a non-staff
user cannot reach it by any means. Reuses the existing `/ops` route (no second console).

## 16. Project deletion changes
The delete modal now shows the project name as **immutable plain text**; a **separate,
initially-empty** input requires typing the exact name; **Delete stays disabled until it
matches** (whitespace-trimmed, case-sensitive, Unicode/Arabic/long-name safe via
`deleteConfirmMatches`). Warns about permanence + linked-screening cascade (only claimed
when actually linked). Focus enters the modal, Escape closes (blocked while busy),
double-submit guarded, loading/error states, server permission unchanged.

## 17. Responsive behavior
Desktop: 72px rail (project rail expands as overlay) + 280px contextual column, visible
down to **1024px** (small laptop / tablet landscape). At **< 1024px** the contextual
column hides exactly where the off-canvas **drawer** takes over (opened from the header
hamburger), so there is never a band where nav is hidden with no way to reopen it. The
project rail renders **static/full-label** in the drawer; the secondary column is omitted
there (no two stacked sidebars). Content max-width keeps comfortable padding. Reduced-motion
respected.

## 18. Accessibility improvements
Icon-only rail controls have `aria-label`s + focus-reachable tooltips; `aria-current` on
active items; explicit rail expand control (not hover-only) + keyboard focus-within expand;
modal focus-trap + restore (existing primitive); deletion confirm is fully labeled with
`aria-describedby`; reduced-motion disables rail/label transitions; status never by color
alone (icon + text). Account menu is a `role="menu"` with `menuitem`s and Escape/outside-
click close.

## 19. Files changed
NEW: `stitch/nav/navConfig.js`, `stitch/shell/{useAppVersion.js, useInvitations.js,
StitchProjectRail.jsx, StitchWorkflowNav.jsx}`, `stitch/pages/dashboard/{MyWorkView,
ActivityView, InvitationsView, ResourcesView}.jsx`, `tests/unit/stitchNavRedesign.test.jsx`.
MODIFIED: `stitch/pages/{StitchDashboard, StitchProjectOverview}.jsx`,
`stitch/shell/{StitchAppShell, shellParts}.jsx`, `stitch/primitives/overlay.jsx`,
`stitch/theme/stitchTokens.js`, `tests/unit/stitchPagesWave1.test.jsx`.

## 20. Shared components created or updated
Created: `navConfig` (centralized nav model), `useAppVersion`, `useInvitations`,
`StitchProjectRail`, `StitchWorkflowNav`, four dashboard views. Updated: `StitchAppShell`
(pluggable primary rail + mobile context control), `shellParts` (global rail, account menu,
header bell), `StitchTooltip` (right/left placement), `stitchTokens` (rail palette/width +
Manrope-portal rule + rail CSS).

## 21. Routes preserved
All existing routes are reused unchanged: `/app`, `/app/project/:id` (`?view=`/`?tab=`),
`/sift-beta/projects/:linkedId` (+ `/import`), `/rob/:id`, `/profile`, `/ops`. Deep links
and refresh resolve the correct active state (parsed from `useLocation().search`, not
`useSearchParams`, to stay SSR-safe). No new routes introduced.

## 22. Tests added
`tests/unit/stitchNavRedesign.test.jsx` (14): nav config (no engines in rail; menu has no
project list; project nav mirrors legacy TABS; stage/screening hrefs; active matching;
deletion match incl. whitespace/case/Unicode; welcome fallback incl. email guard) + SSR
chrome (global rail destinations present, engines absent, PecanRev + "Welcome, [name]",
menu labels, no "Research OS"). Updated `stitchPagesWave1` for the project rail label.

## 23. Test results
`npm run test:ci` → **2275 passed** (150 files). `vite build` → success. Stitch SSR suites
green.

## 24. Screenshots / visual-regression references
A Playwright config + e2e harness exists in the repo (`playwright.config.ts`, `e2e/`).
SSR render output captured in the test run confirms the chrome (rail destinations, menu,
branding, welcome). Live visual capture is the recommended next step (§26).

## 25. Remaining limitations
- Deep workflow tool *pages* are still legacy (reached by workflow name). Opening a
  monolith stage uses `?ui=legacy`, which (per the existing admin design system) persists
  the legacy preference for the admin until they switch back via the header control —
  Screening/RoB do not, since they are separate routes.
- Project Control mutations (status, collab settings, danger zone) and heavy exports live
  in their existing home rather than duplicated into the Stitch overview.
- Live cross-device visual-regression baselines not yet captured.

## Adversarial review fixes (4-dimension workflow: correctness/security/SSR/parity)
An 11-agent review (find → adversarially verify) surfaced and we fixed: **(HIGH)** project
Restore was a no-op (`api.projects.update({_archived})` → now `api.projects.unarchive()`);
**(HIGH)** a 1024–1279px responsive dead-zone hiding the menu with no reopen (context-rail
breakpoint moved to <1024px); **(MED)** `stepStatus`/`auditProject` could crash on a blob
missing `studies` (now normalized once); **(MED)** realtime subscribed to a non-existent
`screening.handoff` event (→ `handoff.updated`); plus low-severity cleanups (invitations
cache cleared on user switch, `goStage` memo stabilized, `activeGlobalKey` simplified,
My Work role/label softened, contextual disabled-steps made focusable, test mock aligned).
All confirmed findings resolved; 2275 tests green; build green.

## 26. Recommended next design improvements
1. Promote one or two deep tools (e.g. PICO, Project Control) to Stitch-native pages so the
   `?ui=legacy` hand-off shrinks further.
2. Add native Stitch danger-zone (archive/delete/status) to a Stitch Project Control page.
3. Capture Playwright visual baselines for the dashboard, project overview, rail
   collapsed/expanded, screening contextual column, deletion modal, and mobile.
4. Consider a dedicated `/api/me/work` aggregate endpoint to remove the My Work N+1.
