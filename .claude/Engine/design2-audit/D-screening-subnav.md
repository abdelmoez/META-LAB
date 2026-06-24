# TOPIC D — Canonical Screening engine sub-navigation (white contextual column)

Audit of the real screening frontend so the Stitch contextual column can reproduce
the screening sub-nav exactly. Read-only; no app code changed.

## 0. TL;DR / the load-bearing facts

- There are **only 3 React Router routes** for the screening engine (`src/App.jsx:222-224`):
  - `/sift-beta` → `SiftDashboard`
  - `/sift-beta/projects/:pid` → `SiftProject` (the tabbed shell)
  - `/sift-beta/projects/:pid/import` → standalone `SiftImport`
- **Subpages are NOT path segments.** They are driven by a **query param**, read back from
  the URL (URL = single source of truth). The param name differs by host:
  - **Standalone** `/sift-beta/projects/:pid` → **`?tab=<key>`**
  - **Embedded** (inside the PecanRev/META·LAB workspace Screening stage) → **`?screen=<key>`**
  - Default when the param is absent → `overview`.
  - Source: `SiftProject.jsx:104-106` — `const tabParam = embedded ? 'screen' : 'tab'; const rawTab = params.get(tabParam) || 'overview';`
- **design2.md's target order matches the EMBEDDED tab set, not the standalone one.** The
  standalone `TABS` and the embedded `EMBEDDED_TABS` are two DIFFERENT arrays with different
  order AND different labels (see §1 vs §2). The white contextual column must reproduce
  **`EMBEDDED_TABS`** (`SiftProject.jsx:57-66`).
- **There are NO per-subpage availability/lock rules.** Every tab in the set is always
  rendered and always clickable. There is no "Conflicts only when conflicts exist" gate and
  no "Final Review gating" in the navigation. Tabs handle empty / permission states
  *internally* (e.g. ConflictsTab renders a "No conflicts found" empty state but is never
  hidden or disabled). The only project-wide block is a 503 feature-flag `disabled` banner
  that replaces the whole body, not individual tabs (`SiftProject.jsx:111,119,272-278`).
- **The body-level subpage routing is NOT React Router** — it is `react-router-dom`'s
  `useSearchParams` query state. Clicking a tab calls `setTab` →
  `setParams(...,{replace:true})` (`SiftProject.jsx:170`), which mutates the query string in
  place (no history push). Deep-linking + refresh both land on the right subpage because the
  active tab is *read back* from the param on every render.

---

## 1. STANDALONE tab set — `TABS` (`SiftProject.jsx:30-38`)

Route host: `/sift-beta/projects/:pid?tab=<key>`. Param: **`?tab=`**.

| # | key (`?tab=`) | user-facing label | icon | Component |
|---|---|---|---|---|
| 1 | `overview` | Overview | grid | OverviewTab |
| 2 | `screening` | Screening | filter | ScreeningTab |
| 3 | `second-review` | Final Review | checkSquare | SecondReviewTab |
| 4 | `duplicates` | Duplicates | copy | DuplicatesTab |
| 5 | `conflicts` | Conflicts | alert | ConflictsTab |
| 6 | `control` | Project Control | sliders | ProjectControlTab |
| 7 | `export` | Export | upload | ExportTab |

Note: standalone has **no `import` tab** (Import is a separate full page at
`/sift-beta/projects/:pid/import`, reached via the `↑ Import` button `SiftProject.jsx:326-329`).
Standalone order ≠ design2.md order.

---

## 2. EMBEDDED tab set — `EMBEDDED_TABS` (`SiftProject.jsx:57-66`) — THIS IS THE CANONICAL ONE

Route host: PecanRev workspace `/app/project/:id?tab=screening&screen=<key>`. Param: **`?screen=`**.
This set's order and labels **exactly match design2.md's target**:
Overview, Import, Duplicates, Title & Abstract, Conflicts, Final Review, Settings, Export.

| # | key (`?screen=`) | user-facing label | icon | Component | Notes |
|---|---|---|---|---|---|
| 1 | `overview` | Overview | grid | OverviewTab | |
| 2 | `import` | Import | upload | (inline `SiftImport`, `Comp:null`) | renders `<SiftImport embedded>` inline (`SiftProject.jsx:283-288`); on done → `setTab('duplicates')` |
| 3 | `duplicates` | Duplicates | copy | DuplicatesTab | |
| 4 | `screening` | **Title & Abstract** | filter | ScreeningTab | full-bleed (`isFullBleed`, `SiftProject.jsx:181`) |
| 5 | `conflicts` | Conflicts | alert | ConflictsTab | |
| 6 | `second-review` | **Final Review** | checkSquare | SecondReviewTab | internal/DB key stays `second-review` (stage = `full_text`) |
| 7 | `control` | **Settings** | sliders | ProjectControlTab | |
| 8 | `export` | Export | download | ExportTab | |

The white contextual column must render these 8 items in THIS order with THESE labels.
The Stitch column param target is `?screen=<key>` (see §5).

---

## 3. The route table / mechanism (quoted)

`src/App.jsx:222-224`:
```
<Route path="/sift-beta"                      element={<ProtectedRoute><OnboardingGate><SiftDashboard /></OnboardingGate></ProtectedRoute>} />
<Route path="/sift-beta/projects/:pid"        element={<ProtectedRoute><OnboardingGate><SiftProject /></OnboardingGate></ProtectedRoute>} />
<Route path="/sift-beta/projects/:pid/import" element={<ProtectedRoute><OnboardingGate><SiftImport /></OnboardingGate></ProtectedRoute>} />
```

Active-tab resolution (`SiftProject.jsx:104-106`):
```
const tabParam = embedded ? 'screen' : 'tab';
const rawTab = params.get(tabParam) || 'overview';
const tab = TAB_ALIASES[rawTab] || rawTab;
```

Tab write (`SiftProject.jsx:170`):
```
const setTab = (key) => setParams(prev => { const n = new URLSearchParams(prev); n.set(tabParam, key); return n; }, { replace: true });
```

Active component select (`SiftProject.jsx:178-180`):
```
const tabSet = embedded ? EMBEDDED_TABS : TABS;
const active = tabSet.find(t => t.key === tab) || tabSet[0];
```

### Deep-link aliases (`SiftProject.jsx:43-48`) — accepted alternate param values
```
const TAB_ALIASES = {
  members: 'control',
  'final-review': 'second-review',
  'full-text': 'second-review',
  'title-abstract': 'screening',
};
```
So `?screen=final-review`, `?screen=title-abstract`, `?screen=full-text`, `?tab=members`
all resolve to their canonical keys. Stitch links may use either the canonical key or the
friendly alias — both work.

---

## 4. Availability / lock rules per subpage — **NONE in the nav**

Verified across `SiftProject.jsx`, `ConflictsTab.jsx`, `SecondReviewTab.jsx`:

- No `tabSet.filter(...)`, no `hidden`, no `disabled`, no per-tab `gate`/`lock`. The
  `tabSet.map(navCol)` (`SiftProject.jsx:256`) / `TABS.map(...)` (`SiftProject.jsx:340`)
  render **every** tab unconditionally.
- "Conflicts only when conflicts exist" — **does NOT exist.** The Conflicts tab is always
  present; when there are no conflicts, `ConflictsTab.jsx:91` renders an `EmptyState`
  ("No conflicts found"). Conflict *resolution* is permission-gated inside the tab
  (`ConflictsTab.jsx:26` `const canResolve = access.isLeader || access.canResolveConflicts;`),
  but the tab itself is never hidden/locked.
- "Final Review gating" — **does NOT exist** at the nav level. SecondReviewTab is always
  reachable; it shows its own empty/pending states and gates buttons by `access.canScreen` /
  `access.isLeader` internally (e.g. `SecondReviewTab.jsx:304,612,646`).
- The only blocking state is **project-wide**, not per-tab: a 503 with `data.disabled`
  (feature flag off) sets `disabled` and replaces the entire body with a "Screening is
  temporarily unavailable" panel (`SiftProject.jsx:111,119,272-278,364-369`). 404/403 →
  error banner / bounce to `/sift-beta` (`SiftProject.jsx:120,149-156`).

**Implication for Stitch:** render all 8 contextual items, always enabled. Do NOT
conditionally hide Conflicts/Final Review. (Optional cosmetic: show a count badge — see §5.)

---

## 5. Count / progress source per step

All step counts come from **one endpoint**: `GET /api/screening/projects/:pid/overview`.

- API client: `screeningApi.getOverview(pid)` → `screeningApi.js:104`:
  `getOverview: (pid) => req('GET', `/projects/${pid}/overview`)`
- SiftProject fetches it into `summary = o.dataSummary` (`SiftProject.jsx:131-135`):
  `const o = await screeningApi.getOverview(pid); setSummary(o?.dataSummary || null);`
- Server builder: `server/controllers/screeningOverviewController.js` returns `dataSummary`
  with (verified `screeningOverviewController.js:28-119`):
  `totalArticles`, `unresolvedDuplicateGroups`, `duplicateDetectionRun`, `titleAbstractPending`,
  `eligibleSecondReview`, `acceptedToExtraction`, `rejectedSecond`, `conflicts`
  (= `unresolvedConflicts`).
- The summary is transformed into per-step descriptors by the **pure** function
  `buildScreeningSteps(summary)` in `src/frontend/screening/ui/screeningSteps.js:19-73`
  (NOTE: imported in `SiftProject.jsx:28` as `from '../ui/Stepper.jsx'` — re-exported there;
  the real definition is `screeningSteps.js`). It returns `{id, screen, label, icon, status,
  hint, count}` where `status ∈ 'done'|'active'|'attention'|'pending'`.

Per-step count mapping (from `screeningSteps.js`), keyed by the SAME `?screen=` key:

| key | count string source | status logic |
|---|---|---|
| `import` | `${total} records` / "Not started" | done if `total>0` else active |
| `duplicates` | `${unresolvedDups} unresolved` / "Resolved" / "Pending" / "—" | `attention` if `unresolvedDups>0`; else done if `dupRun` |
| `screening` (Title & Abstract) | `${taPending} remaining` / "Complete" / "In progress" | from `titleAbstractPending` |
| `conflicts` | `${conflicts} conflicts` / "Resolved" / "None" / "—" | `attention` if `conflicts>0` |
| `second-review` (Final Review) | `${finalRemaining} pending` / `${accepted} sent` / "Complete" | from `eligibleSecondReview` − decided |
| `extraction` (status-only, `screen:null`, no tab) | `${accepted} sent` / "Pending" | done if `accepted>0` |

Stale-prevention: summary refetched on realtime `decision.saved` and on
`refreshProject` (`SiftProject.jsx:159-168`). The stepper is read-only and lives under each
embedded tab (`SiftProject.jsx:202-248`); standalone TABS do NOT render the stepper.

**Important for the Stitch column:** there is NO "Overview"/"Settings"/"Export" count — those
tabs have `screen:null`/no step in `buildScreeningSteps`, so only Import, Duplicates,
Title & Abstract, Conflicts, Final Review carry a count/status. Overview, Settings, Export
are navigation-only.

---

## 6. Project-id resolution (linkedSiftId vs project id)

Two distinct ids are in play:

- **Standalone** `/sift-beta/projects/:pid` — `pid` IS the `ScreenProject` id directly
  (`SiftProject.jsx:91-92` `const pid = embedded ? embeddedPid : routeParams.pid;`).
- **Embedded** — the host passes a **PecanRev/META·LAB `Project.id`**, NOT the screen id.
  `overviewTabs.jsx:220-242` `EmbeddedScreening` resolves it:
  1. `const lid = linkedSiftId(project);` — if the PecanRev project already has a linked
     screen id, use it directly (`overviewTabs.jsx:221,228`).
  2. Else call `screeningApi.getWorkspace(pid)` → `screeningApi.js:142`
     `getWorkspace: (mlpid) => req('GET', `/metalab/${mlpid}/workspace`)`, which
     returns `{ screenProjectId }` (auto-creates/repairs the linked screen project for the
     owner) — `overviewTabs.jsx:231-234`.
  3. The resolved `screenProjectId` (`spId`) is passed as `embeddedPid` to
     `<SiftProject embedded embeddedPid={spId} .../>` (`overviewTabs.jsx:242`).

So the embedded SiftProject always operates on the **ScreenProject id**, derived from the
PecanRev `Project.id` via the linked id or `/metalab/:mlpid/workspace`.

---

## 7. How an EXTERNAL Stitch contextual link deep-links each subpage

Two paths depending on whether Stitch lands the user on the standalone screening shell or the
embedded Screening stage. **The embedded form is the canonical one** (matches design2.md).

### 7a. EMBEDDED (recommended — inside the PecanRev workspace)
Navigation target string (replace `<PID>` with the PecanRev `Project.id`):
```
/app/project/<PID>?tab=screening&screen=<key>
```
- `?tab=screening` makes `AppWorkspace` seed the monolith stage to "screening"
  (`AppWorkspace.jsx:27` `const initialTab = searchParams.get('tab') || null;`), which mounts
  `EmbeddedScreening` → embedded `SiftProject`.
- `?screen=<key>` is read by the embedded SiftProject's own `useSearchParams`
  (`SiftProject.jsx:95,104-106`) on the SAME URL — so the sub-tab opens directly.
- Refresh-safe: AppWorkspace reflects the stage into `?tab=` and *preserves* `?screen=`
  while in screening, only deleting it when leaving (`AppWorkspace.jsx:32-39`,
  `if (tabId !== 'screening') n.delete('screen')`). Browser back/forward also move stages
  (`Workspace.jsx:355-362`).

Exact per-subpage targets (embedded):
| design2 label | target |
|---|---|
| Overview | `/app/project/<PID>?tab=screening&screen=overview` |
| Import | `/app/project/<PID>?tab=screening&screen=import` |
| Duplicates | `/app/project/<PID>?tab=screening&screen=duplicates` |
| Title & Abstract | `/app/project/<PID>?tab=screening&screen=screening` (alias `screen=title-abstract`) |
| Conflicts | `/app/project/<PID>?tab=screening&screen=conflicts` |
| Final Review | `/app/project/<PID>?tab=screening&screen=second-review` (alias `screen=final-review`) |
| Settings | `/app/project/<PID>?tab=screening&screen=control` (alias `?tab=...&screen=members` is NOT aliased for screen — use `control`) |
| Export | `/app/project/<PID>?tab=screening&screen=export` |

Caveat: `<PID>` here is the **PecanRev `Project.id`**, not the screen id. If Stitch only has
the screen id, it must use the standalone form (7b).

Edge note: design2.md lists "Settings" between Final Review and Export. The key is `control`.
The alias `members → control` only applies to the **`?tab=`** param (standalone), not
`?screen=` (`TAB_ALIASES` is consulted for both, `SiftProject.jsx:106`, so `?screen=members`
actually DOES resolve to `control` too — both work).

### 7b. STANDALONE (`/sift-beta`) — uses `?tab=`, needs the ScreenProject id `<SID>`
```
/sift-beta/projects/<SID>?tab=<key>
```
But note standalone uses the **`TABS`** set (§1), whose order/labels differ and which has NO
`import` tab. Per-subpage:
| design2 label | standalone target | works? |
|---|---|---|
| Overview | `/sift-beta/projects/<SID>?tab=overview` | yes |
| Import | `/sift-beta/projects/<SID>/import` | **separate route, not a `?tab=`** |
| Duplicates | `/sift-beta/projects/<SID>?tab=duplicates` | yes |
| Title & Abstract | `/sift-beta/projects/<SID>?tab=screening` (label shows "Screening") | yes |
| Conflicts | `/sift-beta/projects/<SID>?tab=conflicts` | yes |
| Final Review | `/sift-beta/projects/<SID>?tab=second-review` | yes |
| Settings | `/sift-beta/projects/<SID>?tab=control` | yes (label "Project Control") |
| Export | `/sift-beta/projects/<SID>?tab=export` | yes |

---

## 8. Subpages that cannot be cleanly deep-linked / gotchas

1. **Import has two different homes.** Embedded: `?screen=import` is an *inline* sub-view
   (`Comp:null`, renders `<SiftImport embedded>`, `SiftProject.jsx:283-288`) — deep-linkable.
   Standalone: Import is **not** a `?tab=` value; it is the separate page
   `/sift-beta/projects/:pid/import` (`App.jsx:224`). A standalone `?tab=import` would fall
   back to `tabSet[0]` = Overview (no `import` key in `TABS`).
2. **`?screen=` alone does nothing without `?tab=screening`.** In the embedded host, the
   sub-tab only renders when the monolith stage is "screening". A link with `?screen=conflicts`
   but no `?tab=screening` lands on whatever stage the monolith defaults to; `?screen=` is
   ignored (and is actively *deleted* by AppWorkspace when not on the screening stage,
   `AppWorkspace.jsx:36`). Always pair them.
3. **Unknown/invalid key → silent fallback to Overview** (`SiftProject.jsx:179`
   `tabSet.find(...) || tabSet[0]`). No 404. So a typo'd `screen=conflict` (singular) lands
   on Overview.
4. **Data Extraction is not a screening subpage.** `buildScreeningSteps` emits an
   `extraction` step (`screeningSteps.js:68`) but it has `screen:null` and is NOT in
   `EMBEDDED_TABS` — it lives outside the Screening stage. Do not add it to the contextual
   column.
5. **Project Control / Members.** design2.md's "Settings" = key `control` (label "Settings"
   embedded, "Project Control" standalone). The legacy `members` deep-link aliases to
   `control` (`TAB_ALIASES`, `SiftProject.jsx:43-48`).

---

## 9. Exact files / line anchors (for implementation without re-reading)

- Route table: `src/App.jsx:222-224`
- Standalone tab array `TABS`: `src/frontend/screening/pages/SiftProject.jsx:30-38`
- Embedded tab array `EMBEDDED_TABS` (canonical, matches design2.md): `SiftProject.jsx:57-66`
- Deep-link aliases `TAB_ALIASES`: `SiftProject.jsx:43-48`
- Param selection (`?tab=` vs `?screen=`) + read-back: `SiftProject.jsx:104-106`
- `setTab` (writes param, replace): `SiftProject.jsx:170`
- Active component select: `SiftProject.jsx:178-180`
- Embedded nav render + read-only stepper: `SiftProject.jsx:202-296`
- Standalone tab bar render: `SiftProject.jsx:338-358`
- Project-wide 503 disabled banner: `SiftProject.jsx:111,119,272-278`
- pid resolution (standalone vs embedded): `SiftProject.jsx:90-92`
- Embedded id resolution (linkedSiftId / getWorkspace): `overviewTabs.jsx:220-242`
- Mount of embedded SiftProject: `overviewTabs.jsx:242`
- Host URL ?tab=/?screen= sync: `AppWorkspace.jsx:24-39`; `Workspace.jsx:343-362`
- Count source endpoint: `screeningApi.getOverview` `screeningApi.js:104`; builder
  `screeningOverviewController.js:28-119`; pure step logic `screeningSteps.js:19-73`
- API client `getProject`/`getWorkspace`: `screeningApi.js:34,142`
- ConflictsTab (no nav gate; internal empty state + canResolve): `ConflictsTab.jsx:26,91`
