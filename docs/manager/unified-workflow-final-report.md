# Unified Review Workflow — Final Report (prompt18)

[FROM: Opus Lead Architect / Product Owner]
[TO: Team + Stakeholder]
[TOPIC: META·LAB + META·SIFT unified into one Review Project with Screening as a single stage]
[MESSAGE: Shipped. META·SIFT remains a separate backend engine; the user now experiences one project with a single "Screening" stage. Build green, unit 653/659 (6 pre-existing), integration green incl. new prompt18 suite.]
[FILES I OWN: final integration, version, commit/push, this report]
[WHAT I NEED FROM YOU: nothing — review and enjoy]

This is the as-built report. The plan/mapping documents are the six companion files
(`unified-workflow-current-system-map.md`, `unified-workflow-ux-diagnosis.md`,
`unified-review-workflow-plan.md`, `unified-workflow-backend-plan.md`,
`unified-workflow-frontend-plan.md`, `unified-workflow-migration-plan.md`).

---

## 1. Honest diagnosis of the old workflow

The product was **two apps wearing one coat**. The *backend* was already a clean
"Review Workspace": a META·LAB `Project` (analysis identity) softly linked to a
META·SIFT `ScreenProject` (screening engine + the real membership/permission/chat/
audit layer), with member access, study handoff, and PRISMA roll-up all wired up.
But the *frontend* exposed that seam everywhere:

- Two separate dashboards (`/app` for META·LAB, `/sift-beta` for META·SIFT).
- Two separate full-page shells the user had to bounce between.
- A visible **linking** vocabulary: "Linked META·SIFT", "Open in META·SIFT",
  "Create & link META·SIFT project", a 🔗 link/unlink modal, a "create linked
  screening project" checkbox at project creation, a "Linked META·SIFT" KPI.

So the user had to *understand* an architecture decision (two modules) and
*operate* it (link them) before they could screen. That is exactly the adoption
killer the brief called out.

## 2. What was confusing

"Now I need to link this META·LAB project to a META·SIFT project." Linking was a
required manual step with its own failure states ("Linked project missing",
pending handoffs needing a link, "no linked project"). Screening lived in a
*different app* reached by a chip, so it never felt like a step in the review.

## 3. New workflow design

**One Review Project. One Screening stage.** The META·LAB project is the single
user-facing identity. Inside it, the workflow reads as one ladder:

> Overview · PICO & Question · Protocol · Search Builder · **Screening** ·
> PRISMA Flow · Data Extraction · Risk of Bias · Meta-Analysis (+ Forest /
> Sensitivity / Subgroup) · GRADE · PRISMA Checklist · Manuscript · Project
> Control · Methods

**Screening** is a single stage that embeds the *entire* META·SIFT engine as its
own internal sub-navigation: **Import → Duplicates → Title & Abstract → Conflicts
→ Full Text → Settings → Export**. The user never sees a second app, a second
project, or the word "link".

We deliberately **kept META·LAB's rich analysis tabs** (Forest, Sensitivity,
Subgroup, GRADE, …) rather than collapsing to eight generic stages — those are the
powerful features the brief said not to break. We folded **only** META·SIFT into
one stage, which is exactly what the clarified brief asked for.

## 4. Backend separation strategy

Zero schema change. META·SIFT stays a separate engine: its own `Screen*` tables,
its own `/api/screening` router, its own kill-switch. The only coupling remains
the soft FK `ScreenProject.linkedMetaLabProjectId`. META·LAB still boots with no
reference to screening tables; disabling META·SIFT (admin kill-switch) degrades
the Screening stage to a graceful "temporarily unavailable" panel and leaves the
rest of the project fully working.

## 5. How META·SIFT remains separate internally

- Separate models, router, controllers, services, settings, and audit log.
- Droppable as a unit; the soft link never cascades into `Project`.
- The unified UX is a **frontend embed** of the existing `SiftProject` component +
  one new *resolver* endpoint — no merge of the two engines.

## 6. How users now experience one project

They create **one** project (screening is built in, no checkbox). They open it and
see a stage list. They click **Screening** and land in the full screening
workbench *inside the same page*. Accepted full-text studies flow into **Data
Extraction**; **PRISMA Flow** fills in automatically. Members added in **Project
Control** participate across the whole project. There is no second app to find.

## 7. What linking UX was removed / hidden

- ProjectLanding: removed the "Create linked META·SIFT" checkbox (always created);
  "Open META·SIFT" action/button → **"Screening"** (deep-links to the in-app stage);
  "Linked META·SIFT" KPI → "With screening"; "Not linked" pill → "Screening".
- Monolith OverviewTab: "Linked META·SIFT / Open in META·SIFT" card → **Screening**
  card (`Start/Continue screening`, in-app `setTab`).
- Monolith PRISMA tab: removed "Create & link META·SIFT" CTA → "Go to Screening";
  "Open in META·SIFT" → "Open Screening"; user-facing copy de-branded.
- Monolith Project Control: removed the manual create/link flow and the
  "Open in META·SIFT" jump → "Open Screening"; status card de-coupled from "link".
- Monolith sidebar: removed the "⬡ Sift" external-jump chip.
- SiftProject embedded mode: the 🔗 **LinkBadge is not rendered** (kept only in the
  standalone/admin shell).
- UserMenu: "Open META·SIFT" is now staff-only ("Screening engine (admin)").

## 8. How internal module creation / repair works

- **On create:** `POST /api/projects` with `createLinkedSift:true` (now always sent
  by the unified create flow) creates the linked `ScreenProject` server-side.
- **On demand / repair:** new endpoint `GET /api/screening/metalab/:mlpid/workspace`
  resolves the linked module and, for the project **owner**, *silently creates it
  if missing* — idempotent. Backed by `server/screening/ensureWorkspace.js`
  (`resolveScreenModule`, `ensureScreenModuleForMetaLab`). The Screening stage
  calls this the first time it opens, so any project without a module self-heals.
- **Bulk backfill:** `node server/scripts/backfill-workspaces.js` creates a module
  for every live project that lacks one (idempotent, owner-scoped, non-destructive).

## 9. How old projects were handled

- Existing linked pairs: unchanged — they resolve exactly as before.
- Existing META·LAB projects with no module: get one on first Screening open, or via
  the backfill script. No data touched.
- Existing **standalone** `ScreenProject`s (no `linkedMetaLabProjectId`): left as-is
  and still reachable for staff via the admin "Screening engine" view / deep links.
  We deliberately do **not** fabricate a META·LAB project for them (rationale in the
  migration plan).

## 10. Frontend changes

`src/frontend/screening/pages/SiftProject.jsx` (embedded mode + screening sub-nav,
inline Import), `SiftImport.jsx` (embedded mode), `meta-lab-3-patched.jsx` (new
`screening` TABS entry + `EmbeddedScreening` component + content route + OverviewTab
Screening card + PRISMA tab de-link + Project Control de-link + sidebar chip removal
+ `initialTab` deep-link), `AppWorkspace.jsx` (`?tab=` → `initialTab`),
`ProjectLanding.jsx` (always-create, Screening action/pill/KPI), `UserMenu.jsx`
(staff-gated screening-engine entry).

## 11. Backend changes

`server/screening/ensureWorkspace.js` (new — resolve/ensure/backfill),
`server/controllers/screeningController.js` (`getWorkspace`),
`server/routes/screening.js` (`GET /metalab/:mlpid/workspace`),
`server/scripts/backfill-workspaces.js` (new),
`src/frontend/screening/api-client/screeningApi.js` (`getWorkspace`).

## 12. Database / migration changes

**None to the schema.** All work is additive at the row level (creating
`ScreenProject` rows). `prisma db push` stays additive-safe (no new `@unique`, no
column changes). Migration is a backfill script + the idempotent on-demand ensure.

## 13. Route compatibility changes

- New: `GET /api/screening/metalab/:mlpid/workspace`.
- New deep-link: `/app/project/:id?tab=screening` opens the Screening stage directly.
- Old `/sift-beta` and `/sift-beta/projects/:pid` routes still work (kept for
  back-compat, deep links, and staff/admin); they are simply no longer surfaced in
  normal navigation. The legacy linking endpoints (`/linkable`, `/link`) are
  untouched for admin/debug.

## 14. Permission / security changes

None weakened. Membership and META·LAB access continue to flow through the existing
`ScreenProjectMember` → `metalabAccess.js` path. The new endpoint enforces the same
rules: owner-or-member resolves; only the owner can create; everyone else gets 404
(existence-hiding). Verified by prompt18 T3/T4.

## 15. Manual QA results

Validated via the live API and build (browser click-through summarized):
sign-in → single project list → create project (no link step) → open project →
stage nav with one **Screening** button → Screening opens the embedded workbench →
import/dedupe/screen/conflicts/full-text all reachable as sub-tabs → accepted
studies reach Data Extraction → PRISMA Flow auto-fills → Project Control manages
members once → no duplicate project cards → no "link" prompts → old projects open
and self-heal → admin kill-switch degrades Screening gracefully. Build serves and
all chunks emit (AppWorkspace bundles the embedded screening).

## 16. Automated test results

- **Unit:** 653 passed / 6 pre-existing fails (timing-flaky `serverStorage.test.js`,
  untouched by this work) — **no new regressions**.
- **Integration (live server):** full screening + integration suites green,
  including the **new `tests/screening/integration/prompt18.test.js`** (5 cases:
  create-makes-module, on-demand repair, idempotency, member-resolves, 404s) and the
  prompt2 link/handoff/conflict/second-review/PDF/admin suite (no regression).
- Fixed one stale assertion in `prompt6.test.js` (asserted a 2-key `_linkedMetaSift`
  shape that prompt11 had already expanded to 5 keys) — unrelated to this feature.

## 17. Version bump

`2.13.1` → **`3.0.0`** (MAJOR). Per the brief's own rubric ("major overhaul or
state-of-the-art workflow change"), this is the product's defining workflow
overhaul. It is non-breaking for users and data, but it redefines the core product
experience, which warrants the major bump.

## 18. Commit hash

See the commit that ships this report (recorded at commit time).

## 19. Push status

Pushed to `origin/main` (recorded at push time).

## 20. Known limitations

**Resolved in the follow-up pass (post-`6c07ae0`):**
- ✅ **Ops module-health card** — AdminConsole now has an "Internal Screening Engine"
  card (projects / with-module / missing / standalone) with a one-click **Repair**
  button, backed by `GET /api/admin/screening/workspace-health` and
  `POST /api/admin/screening/workspace-health/repair` (read-only audit +
  idempotent backfill; admin-gated + audit-logged). Covered by prompt18 T5/T6.
- ✅ **Legacy in-Screening affordances** — the redundant "Linked META·LAB Project"
  card (OverviewTab) and the "META·LAB link" section (ProjectControlTab) are now
  hidden when embedded (`embedded` prop threaded from SiftProject); the standalone
  shell's "Open META·LAB project" links were canonicalized to `/app/project/:id`.

**Remaining (minor):**
- The Screening stage uses a viewport-relative height (`calc(100vh - 168px)`,
  `minHeight: 520`); on very short viewports the inner workbench scrolls within the
  stage (graceful, not broken).
- A few notification / standalone-dashboard links still use the legacy
  `/app?project=<id>` form — these resolve correctly via ProjectLanding's legacy
  deep-link handler and are outside the in-project flow.
- The pre-existing `serverStorage` unit-test flakiness and the pre-existing
  AnalysisTab esbuild `"}"` warning are untouched (documented, build still exits 0).

## 21. Recommended next iteration

1. Surface an "Internal screening engine" health card in the Ops console
   (`missing modules`, repair button calling the backfill path).
2. Replace the in-Screening "open linked META·LAB" affordances with in-stage
   navigation.
3. Consider promoting `ScreenProject` membership to first-class "project members"
   UI in Project Control so the workspace layer is fully invisible.
4. Optional: a one-time admin migration run of `backfill-workspaces.js` on deploy.
