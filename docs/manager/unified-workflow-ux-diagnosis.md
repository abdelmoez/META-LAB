# Phase 2 — UX Diagnosis (honest + critical)

[FROM: Frontend UX & Workflow Designer]
[TO: Team]
[TOPIC: Why META·LAB + META·SIFT feels like two apps, and the path to one workflow]
[MESSAGE: This is an honest, screen-by-screen diagnosis of the "two-apps" friction. I endorse the locked target design: Screening becomes ONE stage inside the Review Project; all META·SIFT lives inside it; every "link" word disappears from normal UX.]
[FILES I OWN (this phase): SiftProject.jsx (embedded mode), the new monolith "Screening" tab integration, removal of linking UX across OverviewTab/PRISMATab/ControlTab/sidebar-chip/ProjectLanding/UserMenu, nav unification.]
[WHAT I NEED FROM YOU: Backend — the `GET /api/screening/metalab/:mlpid/workspace` endpoint + `ensureScreenModuleForMetaLab` helper so the Screening tab can resolve/repair the screen project on first open without showing me a "create link" button. Research/Methods — confirm the screening→full-text→extraction→PRISMA handoff still fires when the user never leaves /app. QA — confirm hiding /sift-beta from nav does not break deep-links/permissions.]

---

## 0. Scope and method

I oriented via graphify first (`graphify query` for monolith TABS, SiftProject, ProjectLanding, OverviewTab/PRISMATab/ControlTab, UserMenu), then confirmed exact lines in source. Every claim below is grounded in a real screen, with file + line references so the Lead and the rest of the team can verify. I have NOT softened anything: the current product genuinely makes a single systematic review feel like two products glued together, and a researcher pays for that with confusion and lost trust.

Surfaces inspected:
- `src/frontend/pages/ProjectLanding.jsx` — the `/app` project list (the user's home).
- `meta-lab-3-patched.jsx` — the monolith: TABS config (L6735), OverviewTab (L6991), PRISMATab + MetaSiftPrismaSync (L2619 / L2708), ControlTab link card (L7515), sidebar "⬡ Sift" chip (L8294), the legacy in-monolith `ScreeningModule` (L2450), and the in-app create-link CTAs (L2688, L7541).
- `src/frontend/screening/pages/SiftProject.jsx` — the META·SIFT project shell, its TABS (L25), header chrome (UserMenu/NotificationsBell/Import L136-143), and the `LinkBadge` 🔗 modal (L200).
- `src/frontend/components/UserMenu.jsx` — the cross-app "Open META·SIFT" item (L118).

---

## The 11 questions

### 1. Why does the workflow feel cluttered?

Because **one review is physically split across two top-level destinations, and the seam between them is exposed as UI** instead of being hidden plumbing.

A systematic review is a single linear job: PICO → protocol → search → **screen** → extract → risk-of-bias → analyse → report. The user perceives that as one timeline. But the app renders it as:

- META·LAB at `/app` → `/app/project/:id` (the monolith, 14 workflow tabs).
- META·SIFT at `/sift-beta` → `/sift-beta/projects/:pid` (a *second* tabbed shell with its own Overview/Screening/Second Review/Duplicates/Conflicts/Project Control/Export).

The clutter is not "too many features" — the features are good. The clutter is **duplication of shell-level concepts**: two dashboards, two project headers, two "Overview" tabs, two "Project Control"/members surfaces, two notification bells, two account menus, two export flows. The user has to re-learn "where am I and what does this chrome mean" every time they cross the seam. On top of that, the monolith bolts on *link management* widgets (the 🔗 LinkBadge at SiftProject.jsx L200, the "Linked META·SIFT" Overview card at L7060, the ControlTab "Create & link" card at L7531) — these are pure plumbing made visible. None of them advance the science; they only describe the join between two databases the user never asked to know about.

There is also genuine dead weight: a **second, fully-built title/abstract screener still lives inside the monolith** (`ScreeningModule`, L2450) with its own dual-reviewer buttons, conflict resolution, and "Update PRISMA counts". It is no longer rendered (the code comment at L2617 admits it), but its conceptual ghost survives in PRISMATab copy and in the fact that the engine that *is* used (META·SIFT) is a click away in another app. Two screeners for one job is the definition of clutter.

### 2. Where does the user get confused?

The confusion is concentrated at **the boundary crossings**, and it is real:

- **"Where do I screen?"** PRISMATab says "Title/abstract screening is handled in META·SIFT" (L2723) and offers a button that *navigates away* to `/sift-beta`. The user clicks a tab inside their project and is ejected into a different-looking app. That is a context loss, not a navigation.
- **"Are these the same project?"** The link is shown as an explicit relationship the user must understand and maintain: "Not linked" pills (ProjectLanding L459), "Linked project missing" (LinkBadge L239), "Create & link META·SIFT project" (L7541). A non-technical researcher reads "link" and reasonably asks *why are these two things, and what happens if they come unlinked?* That anxiety is entirely manufactured by the UI.
- **"Which Overview / which Control / which members list is authoritative?"** Both apps have an Overview and a members/Project-Control surface. The monolith ControlTab even says members are managed "through the linked META·SIFT workspace" (L7561) — i.e. it tells the user the *other app* owns the data this screen is showing. That is confusing on its face.
- **"Did my screening decisions reach my analysis?"** The handoff is correct under the hood (MetaSiftPrismaSync L2619 pulls PRISMA numbers and accepted studies), but because it spans two apps the user has no continuous mental thread that "the includes I just accepted are now in Data Extraction." They have to trust an invisible sync and a "Sync now" button (L2697).

### 3. Which screens carry too many concepts at once?

- **Monolith OverviewTab (L6991).** It simultaneously presents: project identity, team (sourced from the *other* app), a "Linked META·SIFT" card with cross-app open/create actions (L7060), PICO, progress, readiness, and "next step." The "linked" card is a foreign concept dropped into an otherwise clean project summary.
- **Monolith ControlTab (L7321).** It mixes real project settings with **link lifecycle management** — create-link, open-link, "only the owner can create the linked screening project" (L7544), plus members that are explicitly described as living elsewhere. It is asking the user to administer a database join.
- **SiftProject header (L115-145).** In one bar it carries: ← Projects (to a *third* list), title, Beta badge, blind/progress badges, record/member counts, the 🔗 LinkBadge, an Import button, a chat launcher, a notifications bell, and an account menu. That is a lot of distinct concepts, several of which (LinkBadge, the second account menu, the second bell) only exist because this is a separate app.
- **PRISMATab (L2708).** It blends an auto-fill panel ("Linked to META·SIFT — PRISMA auto-filled", L2695), a create-link CTA when unlinked (L2688), AND manually-editable PRISMA number fields. Three different mental models of "where do these numbers come from" on one screen.

### 4. Which labels should disappear entirely?

Every label that names the *plumbing* rather than the *task*. Specifically, retire from normal UX:

- "Linked META·SIFT" / "Open in META·SIFT →" (OverviewTab L7062/L7068, ControlTab L7527, MetaSiftPrismaSync L2695).
- "Create & link META·SIFT project" / "+ Create & link META·SIFT project" (ControlTab L7533/L7541, MetaSiftPrismaSync L2688).
- "Link META·LAB" / "Link project" / "Change link" / "Unlink" / "Linked project missing" (LinkBadge L239, L280-281).
- "Not linked" pill (ProjectLanding L459), the "⬡ Sift" sidebar chip (L8300), the "META·SIFT · Workspace" pill (ProjectLanding L456), the "META·SIFT" ghost button (ProjectLanding L510).
- "Open META·SIFT" in the account menu (UserMenu L118) — for normal users.
- The **"META·SIFT" and "META·LAB" product names themselves**, anywhere the user is inside a single review. The user owns a "Review Project"; the engine names are internal. Methods/credits pages may keep them; the workflow must not.

Replacement vocabulary is task-first: **"Screening"**, "Title & abstract", "Full text", "Conflicts", "Included → Extraction". That is language a reviewer already owns.

### 5. Which steps should be merged into one?

- **Merge the two screening surfaces into one "Screening" stage.** Today: monolith PRISMATab (auto-fill + manual numbers) + the entire SiftProject app + the dead in-monolith ScreeningModule. Target: a single "Screening" tab in the monolith's Screen phase that embeds the SiftProject experience; PRISMATab demotes to the PRISMA *diagram/flow* only, fed by the Screening stage.
- **Merge the two "Overview"s.** The monolith OverviewTab is the project's home; SiftProject's Overview becomes a sub-view inside the Screening stage (or folds into it), not a competing project home.
- **Merge the two members/Project-Control surfaces.** One membership/permission model already exists on the ScreenProject and already grants ML access (per the verified backend); the UI must present *one* members panel, not two that point at each other.
- **Merge the two project lists.** `/app` (ProjectLanding) and `/sift-beta` (SiftDashboard) must collapse to one list of Review Projects.
- **Merge "create project" and "create screening".** Project creation must always create the screening module server-side (the locked design forces `createLinkedSift` on the unified path), so there is never a second "now create screening" step.

### 6. Which technical concepts should be hidden from the user?

- The existence of **two backend models** (`Project` vs `ScreenProject`) and the **soft FK** `linkedMetaLabProjectId`. The user should never know a join exists.
- The **link/unlink lifecycle** (create-link, change-link, unlink, "linked project missing", "only the owner can link").
- **Manual PRISMA-count entry as the primary path** — numbers should arrive from the Screening stage; manual editing becomes an "override" affordance, not a front-door.
- **The "Beta" framing** of screening (BetaBadge in SiftProject L125) inside the unified flow — screening is core, not a beta side-app.
- **Cross-app routing** (`/sift-beta/...`, `window.location.href` hard navigations at L2678, L2689, L7066, L7527, L8296). Hard `window.location.href` jumps are themselves a tell that the user is leaving the SPA — they cause a full reload and a visible app-switch. These must become in-app `setTab("screening")` transitions.

### 7. Which actions are redundant and should be removed?

- **"Sync now" (L2697)** as a user action — sync should be automatic and invisible; a manual sync button advertises that the data is *not* automatically trustworthy.
- **"Create linked META·SIFT" checkbox at project creation** (ProjectLanding L650-657) — always-on per the locked design; a checkbox for a thing that must always happen is a trap (the user can turn off the only screening path).
- **Two "Open" actions per project** — "Open Project" *and* the "META·SIFT" ghost button (ProjectLanding L496-512), plus the "⬡ Sift" sidebar chip (L8300) and the ActionMenu "Open META·SIFT" (L374). One project, one open.
- **The LinkBadge 🔗 entirely** (SiftProject L200) — it is unlink/relink management with no place in a unified product.
- **The dead in-monolith ScreeningModule (L2450)** — it should be removed from the codebase path (or clearly quarantined) so it can never resurface as a second screener.
- **Duplicate chrome** in embedded mode: the second NotificationsBell, the second UserMenu, the "← Projects" back-button, and the Import-as-page button (SiftProject L117, L136, L142, L143) are redundant once SiftProject renders inside the monolith. (Import moves inline.)

### 8. Which nav items should be replaced with workflow stages?

The whole `/sift-beta` top-level navigation should be replaced by **one stage inside the review**:

| Today (separate META·SIFT nav) | Target (one stage in the Review Project) |
|---|---|
| `/sift-beta` dashboard | (gone from normal nav) — projects live only at `/app` |
| SiftProject "Overview" tab | folds into the Screening stage entry view |
| SiftProject "Screening" tab | "Screening → Title & Abstract" sub-nav |
| SiftProject "Second Review" tab | "Screening → Full Text" sub-nav |
| SiftProject "Duplicates" tab | "Screening → Duplicates" sub-nav |
| SiftProject "Conflicts" tab | "Screening → Conflicts" sub-nav |
| SiftProject "Project Control" tab | unified into the monolith's Project Control (one members/permission panel) |
| SiftProject "Export" tab | "Screening → Export" sub-nav (review-level export stays in the monolith) |
| Import (separate page `/import`) | inline panel inside the Screening stage |
| UserMenu "Open META·SIFT" | removed for users; staff-only debug |

The monolith's TABS phase list (L6741-6753) gains one entry in the **Screen** phase — a real "Screening" workflow step — and the existing "Screening & PRISMA" (L6744) is relabeled to the PRISMA flow only. The user's left rail now reads as one uninterrupted pipeline: PICO → Protocol → Search → **Screening** → PRISMA → Extraction → RoB → Analysis → … → Manuscript.

### 9. What should a NEW user see first?

A new user should land at **`/app`: a single list titled "Review Projects" (or "My Reviews"), with one obvious "+ New Review" button** — no app-switcher, no "META·SIFT" vocabulary, no "linked / not linked" pills, no "create screening?" checkbox. Creating a review silently provisions screening.

On opening a review, they should see the **monolith Overview as the one home**, with a **"Screening" progress card** (replacing today's "Linked META·SIFT" card, L7060) that says, in task language, "Screening — 0 of N screened" and a button **"Go to Screening"** that switches the tab *in place* (`setTab("screening")`). No mention that screening is a different engine. The first-run empty state (ProjectLanding L1450) must drop the "you can link a screening workspace in one click" sentence — there is nothing to link.

The mental model we want to plant on day one: *"I have a Review. It has stages. One of them is Screening. I never leave my Review."*

### 10. What should an EXPERIENCED user see (and be able to do fast)?

- **Deep-link straight to a stage:** `/app/project/:id?tab=screening` (and, ideally, to a screening sub-view like Conflicts). The ProjectLanding ActionMenu "Open META·SIFT" should become a **"Screening" deep-link** to exactly that (replacing L374 / L1178's openSift). Experienced users live on keyboard + URL; the deep-link must land them inside the unified review, never in `/sift-beta`.
- **At-a-glance stage progress** on each project card: screened/total, conflicts outstanding, included count — using the data already present (ProjectLanding L473-475 already shows studies/records/members; reframe it as stage progress, drop the "META·SIFT ·" prefix).
- **No relearning on cross-stage moves:** moving from Screening to Data Extraction must keep the same header, same theme, same membership, same chat — because it is the same shell. Today crossing into screening swaps the entire chrome; that tax falls hardest on power users who do it dozens of times a day.
- **Trust without ceremony:** accepted includes appear in Data Extraction automatically (the handoff already exists, MetaSiftPrismaSync L2646); the experienced user should never touch "Sync now."
- **Escape hatch for staff only:** the standalone `/sift-beta` route and the LinkBadge stay reachable for admin/debug (back-compat + ops health), gated behind staff — invisible to normal experienced users.

### 11. How do we make it feel like ONE coherent workflow?

Five moves, all UI-only on top of the already-unified backend:

1. **One shell, one chrome.** The monolith is the only project shell. SiftProject gains an `embedded` mode (no GlobalStyle page-frame, no `← Projects`, no second UserMenu/NotificationsBell, no BetaBadge, **no LinkBadge**; its TABS at L25 become the Screening sub-navigation; Import renders inline instead of routing to `/import`). The user feels the same header, theme, and account context across every stage.
2. **One vocabulary.** Replace all "META·SIFT / linked / link / Sift" labels (Q4 list) with task words: Screening, Title & Abstract, Full Text, Conflicts, Included. Internal engine names live only in Methods/Admin.
3. **One entry, auto-provisioned.** Creation always makes the screening module (drop the checkbox, L650); first open of the Screening tab lazily ensures/repairs it via the new `workspace` endpoint, so the user never meets a "create link" button. A "missing module" state is a silent repair, not a user task.
4. **In-place transitions, never app-switches.** Every cross-app `window.location.href` (L2678, L2689, L7066, L7527, L8296) becomes an in-SPA `setTab(...)`/`navigate('/app/project/:id?tab=...')`. No full reloads, no chrome swap.
5. **One continuous progress thread.** The left-rail phase map (already in TABS L6741) is the single source of "where am I in my review." Screening sits between Search and PRISMA as a first-class step with its own progress dot; PRISMA numbers and Data-Extraction studies flow forward automatically so the timeline reads as cause-and-effect, not as two databases that happen to sync.

---

## Endorsement of the locked target design

I fully endorse the Lead's locked design: **the META·LAB `Project` is the single user-facing "Review Project," and Screening becomes one stage/tab inside it that embeds the entire META·SIFT experience, while META·SIFT remains a separate backend engine.**

This is the right call, and it is honest about the trade-offs:

- It **removes the seam the user never wanted** (the link) without removing the engine separation the system depends on. Critically, this is achievable **without a schema change** — the soft FK, the shared membership/ML-access path, the handoff, and the PRISMA rollup are already built (verified backend). The work is almost entirely the *removal* of accidental UX, plus an embedded render mode and an ensure/repair endpoint. Lower risk than it looks.
- It **kills the duplicate-screener ambiguity** by making the real engine the only screener the user can reach, and demoting the dead in-monolith ScreeningModule.
- It **respects the experienced user and ops** by keeping `/sift-beta` and the link controls alive behind a staff gate for deep-links, back-compat, and module-health inspection.

My one caution to the team, stated plainly: the win lives or dies on **embedded mode being truly chrome-free and the transitions being truly in-place**. If the embedded SiftProject still shows its own header, its own bell/account menu, or triggers a full-page navigation, the user will still feel "two apps" even though we technically merged them. The seam is psychological before it is technical — we have to erase it pixel by pixel, not just route by route. That is the part I own, and I will hold the line on it.
