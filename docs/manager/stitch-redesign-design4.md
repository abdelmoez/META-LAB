# Stitch full platform integration — implementation report (design4.md)

design4.md asked for the Stitch theme to become a complete, production-ready interface
for **every part of PecanRev**, with all specialized engines feeling like native parts
of ONE unified application — while keeping the backend engines separate at the service
level. Its central, repeatedly-emphasized "Current Problem to Fix" was that opening an
engine (Screening, RoB, …) sent the user into what felt like a separate application
they had to navigate "back" from.

**That problem is solved.** Every project workflow stage — Project Control, PICO, Plan &
Protocol, Search Builder, Search & Discovery, **Screening**, PRISMA, Data Extraction,
**Risk of Bias**, **Meta-analysis** (+ Forest / Sensitivity / Subgroup), GRADE, Manuscript,
Reports/Export and the Methods reference — now renders inside ONE shared Stitch project
workspace at `/app/project/:id?tab=<stage>`. No stage escapes to a standalone engine
shell (`/sift-beta`, `/rob`) or to the classic monolith (`?ui=legacy`). The user keeps
the same rail, the same header, live online-member presence and project context across
the whole systematic-review workflow.

## 1. Architecture implemented

`StitchProjectWorkspace` (the `?tab=`-routed project workspace) was extended from the 5
design3 deep tools to **all 17 workflow stages**. Each `?tab=` mounts the *exact* engine
component the legacy `Workspace.jsx` orchestrator renders, with the *exact* same props —
so behaviour is identical by construction. The Stitch layer only supplies chrome:

- the collapsible **workflow rail** (`StitchProjectRail`) — now every stage routes
  in-shell because `navConfig.projectStageHref` emits `?tab=<id>` for all stages;
- a **page header** (breadcrumb + stage title + role/save badges + live presence +
  next-step button);
- **full-bleed** mode for the engines that need the whole viewport (Screening always;
  RoB while a per-study assessment is open) — the header collapses to a slim bar and the
  engine fills the height with its own internal scroll (mirrors the legacy
  `inScreening`/`robFullbleed`);
- the one shared **ExportDialog**, registered via the existing `exportDialogBridge`
  trampoline, so every export button (Analysis / Report / PRISMA / journal ZIP) works;
- shared **loading / error / read-only** states.

State flows through the SAME backend as the legacy UI — the `Project.data` blob via the
`useStitchProjectDoc` autosave bridge (now exposing the canonical `updateProject(id,
updater)` write choke point the monolith tabs expect), or each tool's own server module
/ engine API. **Zero data duplication.**

## 2. Full route inventory (project workflow) + parity matrix

See `.claude/implementation-plans/stitch-full-integration-parity.md`. Every stage is
**native** (renders in the unified shell) with full functional parity and presence.

## 3. Shared components created / improved

- `useStitchProjectDoc` — added `updateProject(id, updater)` (the native equivalent of
  the legacy workspace's write choke point); `upd`/`updNested` now funnel through it.
- `StitchProjectWorkspace` — full-bleed layout model, shared ExportDialog mount +
  registration, RoB-in-workspace state, the complete stage→component dispatch.
- `navConfig` — `projectStageHref` unified to always route in-shell; `screeningSubHref`
  now deep-links the embedded screening via `?tab=screening&screen=<key>`; routing
  contract documentation updated; `stageKind` collapsed (every stage is `'stitch'`).

## 4. Pages / engines integrated this pass

Screening (embedded, full-bleed), PRISMA, Data Extraction, Risk of Bias (split view),
Meta-analysis, Forest Plot, Sensitivity & Bias, Subgroup Analysis, GRADE, Manuscript,
Reports/Export, Methods. (Control / PICO / Protocol / Search / Discovery were already
native from design3.)

## 5. Backend engine boundaries — preserved

No server file was changed. Each engine keeps its own API, service and database
boundary; the integration is entirely a frontend shell concern. Screening still talks to
`/api/screening`, RoB to `/api/rob`, search to `/api/search-builder`, discovery to
`/api/pecan-search`, blob stages to the project autosave endpoint, PICO/Protocol to their
server-backed modules.

## 6. APIs / backend files changed

None.

## 7. Tests added / changed

- `tests/unit/stitchNavRedesign.test.jsx` — rewritten routing assertions: every stage
  (including screening / rob / extraction / analysis / prisma / report / methods) now
  resolves to `/app/project/:id?tab=<stage>`; `screeningSubHref` asserts the in-shell
  `?tab=screening&screen=<key>` form.
- `tests/unit/stitchProjectWorkspace.test.jsx` — SSR smoke still green (deep-tool stage
  mounts the shared shell in its loading state without pulling lazy bodies).

## 8. Test + build results

- `npm run test:ci` → **2276 passed** (151 files).
- `npx vite build` → success; engine bodies code-split (each tab module is its own
  chunk, lazily loaded only when its stage is opened).

## 9. Accessibility / responsive

The shared shell already carries the a11y + responsive behaviour (focusable rail, ARIA
labels, off-canvas drawer < 1024px, reduced-motion). Full-bleed engines keep their own
internal scroll so no controls go off-screen; the page header wraps. Engines reused as-is
retain their existing a11y.

## 10. Recs/limitations pass (addressed) + remaining boundaries

**Addressed in the recs pass (2nd commit):**
- **Dashboard quick-links to screening** — `MyWork` / `Activity` / `Invitations` now route
  PecanRev-**linked** screening through the unified workspace
  (`/app/project/:id?tab=screening`) using the linked project id those payloads already
  carry, so following a screening notification/work item keeps you in the PecanRev shell.
  Standalone screening projects (no PecanRev parent) legitimately keep `/sift-beta`.
- **Project Overview presence strip** — the overview now shows the same live,
  project-scoped online-members strip (`StitchProjectPresence`) as every deep-tool page.

**Remaining boundaries (documented, non-blocking):** Ops deep admin CRUD opens the legacy
console (`/ops?ui=legacy`; native Stitch Ops covers overview/health/flags); pre-auth
screens are legacy by design (the switch is a post-login per-user preference); editor
bodies reuse the proven editors harmonized via the `--t-*` token remap rather than bespoke
native form layouts (functional parity, not a gap — a visual refinement follow-up).

## 11. How to verify locally

1. `npm run test:ci` and `npx vite build` — both green.
2. As an admin, switch to the Stitch design (top-header design switch).
3. Open a project → use the workflow rail to move through Control → PICO → Protocol →
   Search → Discovery → Screening → PRISMA → Extraction → Risk of Bias → Meta-analysis →
   Forest → Sensitivity → Subgroup → GRADE → Manuscript → Report → Methods. Confirm the
   purple rail, header, presence and project context stay put the whole way — you never
   land in a separate screening/RoB application and never see a "back to the main app".
4. Confirm deep links work: paste `/app/project/<id>?tab=screening` (and `?tab=rob`,
   `?tab=analysis`, …) directly.
5. Confirm legacy is untouched: `?ui=legacy` still renders the classic workspace; the
   standalone `/sift-beta` and `/rob` routes still work.
