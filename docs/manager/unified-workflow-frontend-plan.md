# Phase 5 — Frontend UX Plan

[FROM: Frontend UX & Workflow Designer]
[TO: Team]
[TOPIC: Unify META·LAB + META·SIFT into one "Review Project" with Screening as a single in-app tab]
[MESSAGE: The two-apps feeling is entirely a frontend problem — the backend is already a Review Workspace. This plan removes every "link / open in META·SIFT" surface and embeds the whole SiftProject UI inside one new monolith Screening tab. No schema change.]
[FILES I OWN: `src/frontend/screening/pages/SiftProject.jsx`, `src/frontend/screening/pages/SiftImport.jsx`, `meta-lab-3-patched.jsx` (TABS, content-router, OverviewTab, PRISMATab, ControlTab, create-modal, sidebar chip), `src/frontend/pages/AppWorkspace.jsx`, `src/frontend/pages/ProjectLanding.jsx`, `src/frontend/components/UserMenu.jsx`]
[WHAT I NEED FROM YOU:
- Backend (Eng 2): `GET /api/screening/metalab/:mlpid/workspace` returning `{ screenProjectId, created, repaired }` — the Screening tab calls this once on first open to resolve/ensure the embedded `pid`. Confirm shape + error codes (403 no-access, 503 kill-switch).
- Backend (Eng 2): confirm `screeningApi.getProject(pid)` already returns the per-user `access` flags used by the embedded tabs (`canScreen`, `canResolveConflicts`, `isLeader`, `blindMode`) so embedded mode needs no new client perms call.
- Methods (Eng 4): confirm the PRISMA rollup endpoint stays `GET /api/screening/metalab/:mlpid/summary` so `MetaSiftPrismaSync` keeps auto-filling after the CTA is removed.
- QA (Eng 5): deep-link matrix — `?tab=screening`, legacy `/sift-beta/...` deep-links (must still resolve for admin/back-compat), and a user with no screening access opening the tab.]

---

## 0. The honest problem statement

The backend is **already** one Review Workspace: `POST /api/projects {createLinkedSift:true}` auto-creates the linked `ScreenProject`; members on the `ScreenProject` already get META·LAB access (`metalabAccess.js`); accepted second-review records already hand off to `Project.data.studies[]`; PRISMA already rolls up via `/api/screening/metalab/:mlpid/summary`. There is **nothing methodologically "two apps" about the system.**

The "two apps" feeling is **100% frontend chrome**. We currently expose the seam in **nine** places, all of which use the words *link / linked / Open in META·SIFT*:

| # | Surface | Exact location |
|---|---------|----------------|
| 1 | Two dashboards | `/app` (ProjectLanding) + `/sift-beta` (SiftDashboard) |
| 2 | Overview "Linked META·SIFT / Open in META·SIFT →" card | `meta-lab-3-patched.jsx` L7060–7076 |
| 3 | PRISMA "Create & link META·SIFT project" + "Open META·SIFT →" CTA | `meta-lab-3-patched.jsx` L2683–2704 (`MetaSiftPrismaSync` L2619) |
| 4 | Project Control manual create/link flow + "Open in META·SIFT →" | `meta-lab-3-patched.jsx` L7525–7541 |
| 5 | Sidebar project chip "⬡ Sift" → `/sift-beta/...` | `meta-lab-3-patched.jsx` L8293–8302 |
| 6 | SiftProject `LinkBadge` (🔗 link/unlink modal) | `SiftProject.jsx` L135, L200–291 |
| 7 | ProjectLanding "Open META·SIFT" action + "Linked META·SIFT" KPI + create checkbox | `ProjectLanding.jsx` L374, L1292, L650–654 |
| 8 | UserMenu "Open META·SIFT" cross-app item | `UserMenu.jsx` L116–118 |
| 9 | Create-project modal "Create linked META·SIFT screening project" checkbox | `meta-lab-3-patched.jsx` L8133–8138 |

**Target:** the user sees **one** list of Review Projects and, inside a project, **one** top-level **Screening** button. Everything META·SIFT lives inside that button. The words *link / linked / Open in META·SIFT* disappear from normal UX. META·SIFT branding survives only as small admin/footer/debug wording ("Internal screening engine").

---

## 1. Information architecture (before → after)

### Before
```
/app            ProjectLanding  ─ list of Review Projects (+ "Open META·SIFT" action, "Linked META·SIFT" KPI)
/sift-beta      SiftDashboard   ─ SEPARATE list of screening projects
/app/project/:id  Monolith      ─ tabs incl. "Screening & PRISMA" (which only links OUT to /sift-beta)
/sift-beta/projects/:pid  SiftProject ─ Overview/Screening/Second Review/Duplicates/Conflicts/Control/Export + 🔗 LinkBadge
/sift-beta/projects/:pid/import  SiftImport ─ full-page importer
```

### After
```
/app                         ProjectLanding  ─ ONE list of Review Projects (no Sift cards, no link KPI, no checkbox)
/app/project/:id             Monolith        ─ Screen phase now has a real "Screening" tab (num:4)
                                                that EMBEDS the entire SiftProject experience.
/app/project/:id?tab=screening                ─ deep-link straight to the embedded screening surface

(kept, hidden from normal nav — back-compat + admin/debug only)
/sift-beta                   SiftDashboard
/sift-beta/projects/:pid     SiftProject (full-chrome standalone mode)
/sift-beta/projects/:pid/import  SiftImport (full-page)
```

No router changes are required to *delete* the old routes — they stay for deep-links and ops. We simply stop **pointing users at them**.

---

## 2. The embedded-mode contract (the load-bearing piece)

`SiftProject.jsx` becomes dual-mode. Standalone behaviour is untouched; a new **embedded** mode is selected by props.

### Props contract
```jsx
// SiftProject.jsx — new optional props
SiftProject({
  embedded   = false,   // true → no page chrome, becomes a panel inside the monolith
  embeddedPid = null,   // the resolved ScreenProject id (from /workspace endpoint); overrides useParams().pid
  initialTab  = null,   // optional sub-tab to open (e.g. 'screening' | 'import' | 'conflicts')
  onClose     = null,   // unused in embed; reserved
})
```
- `const { pid: routePid } = useParams(); const pid = embedded ? embeddedPid : routePid;` — in embedded mode the id comes from the parent, never from the URL.
- **Tab state in embedded mode must NOT touch `useSearchParams`.** The monolith owns the URL (`?tab=screening`). Embedded sub-tab state moves to a local `useState`, seeded from `initialTab || 'overview'`. (Currently L47–49 + `setTab` L97 use `useSearchParams` — gate this on `!embedded`.) This prevents the embedded shell from fighting the monolith over `?tab=`.

### What embedded mode HIDES (chrome strip-down)
The whole header block `SiftProject.jsx` L114–145 is wrapped `{!embedded && (...)}`. Specifically removed in embed:
- The page-level `← Projects` back button + title + `BetaBadge` + progress badges (L116–128) — the monolith already shows the project title and a back-to-projects affordance.
- **`UserMenu`** (L143) — the monolith's AppWorkspace already renders one fixed top-right (`context="metalab"`). Two account menus is the current Sift-page smell; embed must show zero.
- **`NotificationsBell`** (L142) — same reason; AppWorkspace owns it.
- **`LinkBadge`** (L135) — deleted from the rendered tree in **both** modes (see §3); the component definition L200–291 is removed entirely.
- The standalone `↑ Import` header button (L136–139) — replaced by an embedded sub-tab (see below).
- `GlobalStyle` (L112) — keep it ONLY if its selectors are scoped; if it injects global resets, gate it `{!embedded && <GlobalStyle/>}` to avoid stomping monolith styles. (Action item: Eng 5 to confirm `GlobalStyle` scope.)
- The fixed `100vh` flex column (L111) becomes `height:100%` in embedded mode so it fills the monolith content area, not the viewport.

### What embedded mode KEEPS
- The **tab bar** (L148–167) — but it is now the **Screening sub-navigation**, rendered inside the monolith content pane. Same tabs, same icons, same `setTab`.
- All seven tab components (Overview / Screening / Second Review / Duplicates / Conflicts / Project Control / Export) render exactly as today via `ActiveComp` (L185–188). They are unaware of embed; no per-tab changes needed.
- `ChatLauncher` (L141) — keep; the shared chat is a feature, not a seam. (It already works off `pid`.)
- Realtime subscriptions (L89–95) — keep; they refetch via the authorized `getProject`.

### Import becomes an inline embedded sub-tab
Today Import is a full-page route (`/sift-beta/projects/:pid/import` → `SiftImport`) reached by the header button (L136). In embed there is no route to navigate to. Two acceptable shapes — **pick (A)**:
- **(A) Recommended — Import as a sub-tab.** Add `{ key:'import', label:'Import', icon:'upload', Comp: SiftImport }` to the embedded TABS list (or render it conditionally). `SiftImport` already reads `useParams().pid` (L71) and `useNavigate` (L73) — refactor it to accept the same `embedded`/`embeddedPid` props and, on success, call a passed `onImported()` (which switches the sub-tab to `screening`) instead of `navigate(...)`. This keeps the importer inline with no page transition.
- (B) Modal overlay — rejected: a full-screen importer modal re-introduces "leaving the page" feel.

`SiftImport.jsx` changes: props `{ embedded, embeddedPid, onImported }`; `const pid = embedded ? embeddedPid : useParams().pid;`; replace post-import `navigate` calls with `embedded ? onImported?.() : navigate(...)`; drop its own page header when `embedded`.

### Failure-state UX inside the embed
- **No access** (403 from `getProject`): render a quiet in-tab panel "You don't have screening access on this review. Ask the project leader." — never bounce to `/sift-beta` (the standalone `revalidateAccess` L84 redirect must be gated `!embedded`).
- **Kill-switch** (503 `disabled`): keep the existing "META·SIFT is temporarily unavailable" panel (L173–179) but reword to **"Screening is temporarily unavailable"** (no product name leak to end users).
- **Module not ready** (workspace endpoint still creating): show a small "Setting up screening…" loader while the parent resolves `embeddedPid`.

---

## 3. Monolith integration (`meta-lab-3-patched.jsx`)

### 3.1 TABS config — add the Screening tab (L6735–6757)
Insert a real workflow tab in the **Screen** phase, **before** the demoted PRISMA tab, and renumber:
```js
{id:"prisma",     ... label:"Screening & PRISMA", phase:"Screen", num:4},   // BEFORE
// AFTER:
{id:"screening",  icon:"filter", label:"Screening",          phase:"Screen", num:4},
{id:"prisma",     icon:"flow",   label:"PRISMA Flow",         phase:"Screen", num:5},
{id:"extraction", icon:"table",  label:"Data Extraction",     phase:"Extract",num:6},
// …renumber rob→7, analysis→8, forest→9, sensitivity→10, subgroup→11, grade→12, report→13, manuscript→14
```
Notes:
- `icon:"filter"` matches the Screen phase icon (`PHASE_ICON.Screen:"filter"` L6760) and the standalone Sift Screening tab — visual consistency.
- This makes Screening a first-class step in the workflow map, the progress denominator, and the "Next step" walker (all filter on `t.phase`, L8604). Methodologically correct: Screening → PRISMA → Extraction is the real order (coordinate the renumber with Eng 4).
- **Single source for the new tab id string:** use `"screening"` everywhere (deep-link param, OverviewTab `setTab`, ProjectLanding deep-link).

### 3.2 Content router — render the embedded SiftProject (L8586–8601)
Add one line in the `{tab==="X" && <XTab/>}` ladder:
```jsx
{tab==="screening" && <ScreeningStage project={project} activeId={activeId}/>}
```
`ScreeningStage` is a thin new monolith-local wrapper (defined near the other tab components) that:
1. On mount, calls `GET /api/screening/metalab/${activeId}/workspace` → `{ screenProjectId, created, repaired }` (lazy ensure/repair — Eng 2's endpoint).
2. While resolving: shows "Setting up screening…".
3. On success: renders `<SiftProject embedded embeddedPid={screenProjectId} initialTab="overview" />`.
4. On 503: "Screening is temporarily unavailable." On 403: the no-access panel.

`SiftProject` must be imported into the monolith (it currently lives in `src/frontend/screening/pages/SiftProject.jsx`). Confirm the monolith's import path style and that bundling the whole screening tree into the monolith chunk is acceptable (Eng 5 / Lead — bundle-size note; lazy `React.lazy` import is the clean option so screening code only loads when the tab opens).

### 3.3 OverviewTab — Screening progress card (L7060–7076)
Replace the "Linked META·SIFT / Open in META·SIFT →" card with a **Screening** card that:
- Title: **Screening** (no product name).
- Body: live progress pulled from the workspace/summary rollup — e.g. "X records · Y screened · Z to full-text review" (numbers from the same summary the PRISMA sync uses). If the module is empty: "No references imported yet."
- Primary action: **"Continue screening →"** (or "Start screening →" when empty) → `setTab("screening")`. **In-app tab switch, never `window.location.href`.**
- Delete the `lid`/`linkedTitle`/`/sift-beta/...` branch entirely (L7063–7075). The card no longer cares whether a link "exists" — Screening always exists.
- The adjacent Team card (L7079–7093) currently says "Members are managed through the linked META·SIFT workspace — link one in Project Control." Reword to "Members are managed in Project Control." (drop "linked … workspace" language).

### 3.4 PRISMATab — demote to PRISMA flow only (L2702–2724, `MetaSiftPrismaSync` L2619)
- Tab label already renamed to **"PRISMA Flow"** in TABS (§3.1).
- `SectionHeader` (L2723) reword: "PRISMA 2020 flow diagram. Counts auto-fill from the Screening stage." Remove "Link a META·SIFT project…".
- In `MetaSiftPrismaSync` (L2619): **remove the create CTA** (L2683–2689: "+ Create & link META·SIFT project" / "Open META·SIFT →"). Since the module is now always auto-ensured, the "not linked" branch should essentially never render; if it does (module mid-creation), show "Screening is being set up — open the **Screening** tab to begin." with a button → `setTab("screening")` (pass `setTab` into PRISMATab; the content-router call at L8591 currently passes `updateProject`/`activeId` — add `setTab`).
- "Linked to META·SIFT — PRISMA auto-filled" header (L2695) → "PRISMA auto-filled from Screening". "Open …" buttons (L2698, L2678) → either remove or replace with `setTab("screening")`.
- Keep the actual PRISMA SVG, the editable fields, and "Sync now" — these are the legitimate PRISMA deliverable.

### 3.5 ControlTab — remove the create/link flow (L7321–7604)
- Delete the **"Create & link META·SIFT"** section (L7533–7541: heading L7533, blurb L7535, button L7541) — module is auto-created.
- Delete the **"Open in META·SIFT →"** button (L7527).
- Keep the **members / roles / permissions** management (this is the genuine shared-membership control surface and the right home for it). Reword the preset explainer (L7354) and InfoBox (L7604) to drop "the META·SIFT link" / "(the META·SIFT project)" → "the shared Review Workspace".
- The "Members are managed through the linked META·SIFT workspace. Create the link above…" empty-state (L7561) is dead once the module always exists — replace with the normal member roster.
- `linkedSiftId(project)` (L6942) and `MetaSiftPrismaSync`'s create call can be retired from UX, but keep `linkedSiftId` as an internal resolver if other code reads it; it just stops driving any user-visible "linked?" branch.

### 3.6 Sidebar project chip — remove the "⬡ Sift" deep-link (L8293–8302)
Delete the chip entirely. A project no longer has a separate "Sift" identity to jump to; Screening is a tab within the already-open project. (Keep the "Shared"/"View" role chip at L8285–8291.)

### 3.7 Create-project modal — always create, drop the checkbox (L8133–8138, L8777–8798)
- Remove the "Create linked META·SIFT screening project" checkbox (L8133–8138).
- The create handler (~L8777–8798) currently sends `createLinkedSift:true` only when checked. Change to **always** send `createLinkedSift:true` (the unified create path; coordinate with Eng 2 so server forces it on too). Remove the `withSift` conditional and its warning-copy branch (L8798) — or keep the warning text but reword to "Screening module could not be set up; it will be repaired on first open."

---

## 4. ProjectLanding (`src/frontend/pages/ProjectLanding.jsx`)

This becomes the **one** list of Review Projects.

| Line(s) | Now | Change |
|---------|-----|--------|
| L374 | action `Open META·SIFT` → `handlers.openSift` | → **`Screening`** action, icon `filter`, `onClick: () => navigate('/app/project/'+id+'?tab=screening')` |
| L451–510 | card "linked META·SIFT" badge + `META·SIFT` open button | Remove the separate META·SIFT badge/button. Optionally show a small neutral **"Screening: N to review"** stat sourced from the summary rollup (nice-to-have; coordinate count source with Eng 4). |
| L608, L620, L650–654 | create-modal `createLinkedSift` checkbox (default true) | **Remove the checkbox.** Hard-code `createLinkedSift: true` in the create body (L620). The module is always created. |
| L1126, L1292 | KPI `linked = projects.filter(_linkedMetaSift)` + `<KpiTile label="Linked META·SIFT">` | **Remove the "Linked META·SIFT" KPI tile** (it counts an internal artifact users shouldn't think about). Replace with a meaningful tile if desired (e.g. "In screening") or just drop it. |
| L1178 | `openSift: navigate('/sift-beta/projects/'+id)` | Repurpose to `openScreening: (p) => navigate('/app/project/'+p.id+'?tab=screening')`. |
| L1450 | empty-state copy "…META·SIFT handles collaborative citation screening… link a screening workspace in one click." | Reword: "META·LAB is your evidence-synthesis workspace; screening, extraction, and analysis all live inside one Review Project. Create your first project to get started." |
| L729, L738, L754–766, L805, L847, L863 | archive/delete/transfer copy referencing "linked META·SIFT workspace" | Reword to "its screening data" / "the shared Review Workspace" — keep the safety facts (data is archived/deleted/transferred alongside) but drop the "two apps" framing. |

The `_linkedMetaSift` field can still arrive in the payload (back-compat), but the landing UI **stops branching on its existence** — every Review Project is assumed to have a screening module.

---

## 5. AppWorkspace (`src/frontend/pages/AppWorkspace.jsx`) — pass the initial tab

Currently `/app/project/:projectId` seeds `initialProjectId` (L44). Add deep-link support for `?tab=screening`:
```jsx
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
const [params] = useSearchParams();
const initialTab = params.get('tab') || null;          // 'screening', 'overview', etc.
// …
<MetaLab initialProjectId={projectId || null} initialTab={initialTab}
         onProjectChange={onProjectChange} onBackToProjects={onBackToProjects} />
```
The monolith already seeds `tab` from `useState("overview")`; add an `initialTab` prop that seeds it instead (mirroring how `initialProjectId` seeds `activeId`). Validate the incoming tab against the TABS id list; ignore unknown values. This makes `/app/project/:id?tab=screening` open straight into the embedded screening surface (the link ProjectLanding and OverviewTab now use). AppWorkspace already keeps the URL in sync for project id (L30–32) — leave `?tab` as a read-on-mount seed only (no continuous URL sync needed for v1; the monolith's own back/next walker drives tabs after open).

---

## 6. UserMenu (`src/frontend/components/UserMenu.jsx`) — gate "Open META·SIFT" to staff

L116–118 currently always shows the cross-app item. Change:
```jsx
import { useAuth } from '../context/AuthContext.jsx';
const { user } = useAuth();                       // already imported L19
const isStaff = user?.role === 'admin' || user?.isModerator;  // confirm flag names with Eng 2/5
// …
{context === 'metasift'
  ? <Item icon="flask" label="Open META·LAB" onClick={...navigate('/app')} />
  : (isStaff && <Item icon="hexagon" label="Open screening engine (admin)" onClick={...navigate('/sift-beta')} />)}
```
- Normal users: **no** cross-app item in the META·LAB menu (there is no second app to go to).
- Staff: keep a deep-link to `/sift-beta`, relabelled **"Open screening engine (admin)"** — internal wording, the only place META·SIFT-as-a-place survives in nav.
- The `metasift` branch ("Open META·LAB" from the standalone Sift shell) stays for the back-compat standalone route.

---

## 7. Vocabulary: removed labels → replacements

| Removed (user-facing) | Replacement |
|---|---|
| "Linked META·SIFT" / "Linked to META·SIFT" | (gone) — Screening is intrinsic |
| "Open in META·SIFT →" / "Open META·SIFT" | "Continue screening →" / "Screening" tab |
| "Create & link META·SIFT project" / "Create linked META·SIFT screening project" | (gone) — auto-created |
| "Link META·LAB" / 🔗 LinkBadge / "Change link" / "Unlink" | (gone) |
| "Screening & PRISMA" tab | "Screening" (new tab) + "PRISMA Flow" (demoted tab) |
| "META·SIFT is temporarily unavailable" (kill-switch) | "Screening is temporarily unavailable" |
| ProjectLanding "Linked META·SIFT" KPI | removed (or "In screening") |
| "the linked META·SIFT workspace" (archive/delete/transfer copy) | "the shared Review Workspace" / "its screening data" |

**META·SIFT branding survives ONLY as:** small admin/debug wording ("Internal screening engine", UserMenu staff item), the standalone `/sift-beta` shell (admin/back-compat), ops health cards (Eng 2), and optional footer/about credits. The `siftOrigin` study tag (L3174 "⬡ META·SIFT") may stay as a provenance marker or be reworded to "⬡ Screening" — recommend rewording for consistency.

---

## 8. Exact file → change map (deliverable checklist)

| File | Lines / symbols | Change |
|---|---|---|
| `src/frontend/screening/pages/SiftProject.jsx` | L44 props; L47–49 + L97 tab-state; L78–87 redirect; L111 sizing; L112 GlobalStyle; L114–145 header; L135 + L200–291 LinkBadge; L136–139 import btn; L173–179 503 copy; L185–188 body | Add `embedded`/`embeddedPid`/`initialTab` props; local tab state when embedded; hide header+UserMenu+NotificationsBell; **delete LinkBadge**; Import → sub-tab; reword 503; gate access-redirect |
| `src/frontend/screening/pages/SiftImport.jsx` | L70–73, post-import navigates | Add `embedded`/`embeddedPid`/`onImported`; resolve pid from props; replace navigate with `onImported` in embed; drop page header in embed |
| `meta-lab-3-patched.jsx` | L6735–6757 TABS | Add `screening` (num:4), demote `prisma`→"PRISMA Flow" (num:5), renumber 6–14 |
| `meta-lab-3-patched.jsx` | L8586–8601 router | Add `{tab==="screening" && <ScreeningStage .../>}`; new `ScreeningStage` wrapper (workspace ensure → embedded SiftProject) |
| `meta-lab-3-patched.jsx` | L7060–7076 OverviewTab | Replace linked card → **Screening progress card** → `setTab("screening")`; reword L7083 Team copy |
| `meta-lab-3-patched.jsx` | L2619 `MetaSiftPrismaSync`, L2683–2704, L2723 | Remove create/open CTAs; reword headers; pass `setTab` (router L8591) |
| `meta-lab-3-patched.jsx` | L7321–7604 ControlTab | Delete create/link section (L7527, L7533–7541); keep members/roles/perms; reword L7354/L7561/L7604 |
| `meta-lab-3-patched.jsx` | L8293–8302 sidebar chip | Delete "⬡ Sift" chip |
| `meta-lab-3-patched.jsx` | L8133–8138 + create handler ~L8777–8798 | Remove checkbox; always `createLinkedSift:true` |
| `src/frontend/pages/AppWorkspace.jsx` | L24, L44 | Read `?tab`; pass `initialTab` to `<MetaLab>` |
| `src/frontend/pages/ProjectLanding.jsx` | L374, L451–510, L608/620/650–654, L1126/1178/1292, L1450, archive/delete/transfer copy | Action→Screening deep-link; remove Sift badge/button; remove create checkbox (always create); remove "Linked META·SIFT" KPI; reword empty-state + safety copy |
| `src/frontend/components/UserMenu.jsx` | L116–118 | Gate cross-app item to staff; relabel "Open screening engine (admin)" |

---

## 9. Deep-linking & back-compat (must-keep)

- **New:** `/app/project/:id?tab=screening` → opens embedded Screening (AppWorkspace seeds `initialTab`).
- **Kept:** `/sift-beta`, `/sift-beta/projects/:pid`, `/sift-beta/projects/:pid/import` all still resolve in **standalone** mode for admin/debug and any old bookmarks. SiftProject standalone path is unchanged because every new behaviour is gated on `embedded`.
- **No router deletions.** We hide entry points, not routes. This is the lowest-risk way to satisfy "hidden from normal nav, kept for back-compat/admin".

---

## 10. Theme / build gotchas (carry from project conventions)

- Use `--t-*` tokens via the `alpha()` / `themeAlpha()` helper — **no hex string concatenation** (the existing linked-card code already uses `themeAlpha("var(--t-teal)","40")` correctly; the new Screening card must too).
- The embedded SiftProject uses the screening `ui/theme.js` `C` tokens, the monolith uses `--t-*`. They both re-skin from the same root CSS vars, so the embed should match — but Eng 5 should screenshot day+night to confirm the screening palette tokens resolve to the monolith's `--t-*` and don't show a color seam at the tab boundary.
- PS-saved files keep BOM; vitest unit runs via PowerShell `--pool=forks --poolOptions.forks.singleFork=true`.
- Recommend `React.lazy` for the embedded `SiftProject`/`SiftImport` import inside the monolith so the screening bundle only loads when the Screening tab is opened (keeps the initial monolith chunk from ballooning).

---

## 11. Honest risks & open questions

1. **Two theme systems at one boundary.** The embed mixes `ui/theme.js` `C` and monolith `--t-*`. Low risk (both read root vars) but the #1 thing to eyeball. If a seam appears, the fix is to make `ui/theme.js` `C` alias the `--t-*` vars, not to restyle the tabs.
2. **`useSearchParams` collision.** If embedded SiftProject keeps writing `?tab=`, it will fight AppWorkspace/monolith over the URL. The contract (§2) hard-requires local tab state in embed — this is the single biggest correctness item for me.
3. **Bundle size / circular imports.** Monolith importing the whole screening tree. Mitigate with `React.lazy`. Flag to Lead if the monolith chunk is already large.
4. **"Project Control" appears twice.** The monolith has its own ControlTab (members/roles) AND the embedded SiftProject has a "Project Control" sub-tab. After §3.5, the monolith ControlTab is the canonical member surface; the embedded one is redundant. **Recommendation:** hide the embedded "Project Control" + "Overview" sub-tabs in embed mode (they duplicate the monolith Overview/Control), leaving the embedded sub-nav as: Import · Duplicates · Screening (Title/Abstract) · Conflicts · Second Review (Full Text) · Included · Export. Needs Lead sign-off — it changes the embedded TABS list.
5. **Sub-tab naming for end users.** Recommend user-facing relabels inside the embed: "Screening" → **"Title & Abstract"**, "Second Review" → **"Full Text Review"** (clearer to reviewers; matches PRISMA stages). Internal keys unchanged. Needs Eng 4 (methods naming) sign-off.
6. **Counts on cards** (Overview Screening card, ProjectLanding stat) need a cheap count source. Confirm the `/summary` rollup is light enough to call on the landing list, or expose a count on the existing `/api/projects` payload (Eng 2).
