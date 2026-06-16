# prompt24 — Final Report (v3.6.0)

UX polish and structural cleanup across six areas. All changes are
frontend-only or minor frontend+hook changes; no database schema changes, no
new backend routes, no migration required.

Build green. Unit suite green (719 pass / 6 pre-existing `serverStorage` timing
failures; unrelated baseline).

---

## Summary of changes

### 1. Dashboard cleanup (`ProjectLanding.jsx`)

Two filter chips removed from `DASHBOARD_FILTERS`: **Recent** (key `'recent'`)
and **Shared with me** (key `'shared'`). Remaining chips: All · Active ·
Screening in progress · Done · Owned by me · Archived.

The "Recently opened" rail now displays at most **one** project (`.slice(0,1)`
on `recentItems`). The localStorage ring still stores up to 6 (backward
compatible). Stale persisted filter values are dropped silently by the existing
`sanitizeDashboardPrefs` validator — no migration. The "In progress" KPI stat
tile was kept.

Full detail: `docs/manager/project-dashboard-cleanup.md`

### 2/3/8/9. Presence globalization, portal popover & deduplication

`PresenceIndicator` was rewritten as the **one shared presence chip** used by
both the META·LAB universal header and the standalone META·SIFT shell. Key
improvements:

- **Portal popover** via `createPortal(document.body)` at z-index 10000 —
  never clipped by `overflow:hidden` ancestors or CSS transforms. Positioned
  with `getBoundingClientRect` + viewport collision clamping; hover-bridge-safe
  (160 ms close delay); closes on outside-click and Escape.
- **Deduplication** — the old floating fixed chip in the monolith AND the
  SiftProject chip on the Screening tab were two indicators for the same data.
  Now exactly one indicator exists, in the universal project header.
- **Globalization** — the chip shows live presence on every project tab. On
  non-Screening tabs the header owns the heartbeat; on the Screening tab the
  header listens only (`heartbeat:false`) while SiftProject owns the
  fine-grained location. Previously the monolith set `enabled:false` on the
  Screening tab, leaving the chip stale.
- `usePresence.js` gained a `heartbeat` option (listen-only mode).
- Backend unchanged.
- 5 new unit tests in `tests/unit/presenceIndicator.test.js` (all pass).

Full detail: `docs/manager/project-presence-globalization.md`

### 4/7. Universal project header (`ProjectHeaderBar`)

New `ProjectHeaderBar` component rendered on **every** project page. Structure:
left = ☰ + title (truncating) + breadcrumb; middle = Project overview / Back to
Projects (collapses to icons < 900px); right = inline utility cluster
[Presence | Chat | Bell | Account].

Main content area restructured into a flex column: `ProjectHeaderBar`
(`flex-shrink:0`) + scrolling body (`flex:1; min-height:0`). The project title
no longer scrolls away. The fixed cluster overlays were removed. The obsolete
`@media (max-width:1480px)` padding-right hack was deleted.

☰ toggles sidebar via new `navCollapsed` state. The bespoke
`ScreeningWorkspaceFrame` header bar was removed (the universal header replaces
it); `ScreeningWorkspaceFrame` now only provides the embedded-engine height
fill.

Full detail: `docs/manager/universal-project-header.md`

### 5. Screening layout overflow (`ScreeningTab.jsx`)

Root container height changed from `calc(100vh - 56px)` to `100%` (fills the
already-bounded flex parent). `LeftColumn` and its studies list gained
`min-height:0`. The "Load more (N)" button is now `position:sticky; bottom:0`
so it is always reachable. The middle-column abstract content scrolls in an
inner `overflow:auto` region; the `← Previous / X of N / Next →` pagination
bar is a sticky bottom bar. `RightColumn` got `min-height:0`. Layout-only —
all handlers, labels, and counts unchanged.

Full detail: `docs/manager/screening-layout-overflow-fix.md`

### 6. Members & Permissions UI unification

The polished `MembersTab` (grouped by role, permission presets, live presence,
add-member modal, invite link) is now the **shared** component for both
Screening Settings and the monolith Project Control.

~200 lines of bespoke flat-list code in `ControlTab` were deleted
(`CtrlMemberRow`, `CtrlAddMember`, `CtrlPermDot`, four constants, mutation
state, remove-confirm modal). `MembersTab` gained one new prop:
`leaveRedirect` (default `'/sift-beta'`; Project Control passes `'/app'`).
Both hosts call the same `screeningApi` — no data-source divergence. Project
Control members now show live presence indicators.

Full detail: `docs/manager/members-permissions-ui-unification.md`

---

## File change index

| File | Tasks |
|------|-------|
| `src/frontend/pages/ProjectLanding.jsx` | 1 |
| `src/frontend/screening/components/PresenceIndicator.jsx` | 2/3/8/9 |
| `src/frontend/screening/hooks/usePresence.js` | 2/9 |
| `meta-lab-3-patched.jsx` | 2/3/4/6/7/8/9 |
| `src/frontend/screening/pages/SiftProject.jsx` | 8 |
| `AppWorkspace.jsx` | 4/7 |
| `src/frontend/screening/tabs/ScreeningTab.jsx` | 5 |
| `src/frontend/screening/tabs/MembersTab.jsx` | 6 |
| `tests/unit/presenceIndicator.test.js` | 2/3 (new) |
| `server/package.json` + `server/version.json` | version bump |

No database schema changes. No new backend routes. No new npm dependencies.

---

## DB / migration

None. Presence and locks are in-memory (`server/realtime/presence.js`).
Dashboard prefs are localStorage + `User.dashboardPreferences` (added in
v3.5.1). All layout and component changes are frontend-only.

---

## Tests

| Suite | Result |
|-------|--------|
| `tests/unit/presenceIndicator.test.js` (new, 5 tests) | 5/5 pass |
| Full unit suite | 719 pass / 6 pre-existing failures (`serverStorage.test.js` network-mock flakiness) |
| `npx vite build` | Green; pre-existing AnalysisTab esbuild JSX warning at ~L4328 unchanged, build exits 0 |

---

## Version

**3.6.0** (minor; universal header, presence globalization + portal, dashboard
cleanup, screening layout, members unification).

---

## Known limitations

1. **Presence requires a linked workspace.** A META·LAB project with no linked
   screening workspace (`spId null`) shows no presence indicator (self-hides
   gracefully). Opening the Screening stage once auto-creates the workspace and
   enables presence everywhere. Optionally, a presence-only workspace could be
   lazily provisioned so brand-new projects show presence immediately.

2. **Presence is in-memory + single-process.** No Redis pub/sub broker. This is
   a pre-existing architectural caveat shared by all realtime features (chat,
   pokes). The SSE + TTL-polling fallback preserves correctness. Multi-instance
   deployment would require a pub/sub layer (out of scope for this release).

3. **Popover position is not ResizeObserver-tracked.** Position is computed on
   open and updated on `scroll`/`resize`, but not via a `ResizeObserver` on the
   popover element itself. Extreme rapid layout thrash could momentarily
   misplace the popover; it re-opens correctly.

4. **`navCollapsed` is per-session.** The ☰ sidebar-collapse state is not
   persisted to localStorage or `dashboardPreferences`. It resets on page load.

5. **"Recently opened" shows one project.** The localStorage ring still stores
   up to 6; the display cap is intentional but easy to raise.

---

## Recommended next steps

1. **Lazy presence workspace provisioning** — optionally auto-create a
   presence-only `ScreenProject` stub for brand-new unlinked projects so the
   indicator is live from first open, before Screening is explicitly launched.

2. **Persist `navCollapsed`** — store the sidebar-collapse preference in
   localStorage (alongside `dashboardPrefs`). Consider adding a keyboard
   shortcut (e.g. `⌘/Ctrl + B`) to match common editor conventions.

3. **Presence popover accessibility** — add a focus-trap and full ARIA menu
   semantics (`role="dialog"` or `role="tooltip"`) to the popover for keyboard
   users; the current implementation is mouse/hover-only.

4. **Rename `MembersTab` → `ProjectMembersPanel`** — the component is already
   the de-facto shared project members UI. Moving it out of
   `src/frontend/screening/tabs/` into a shared components directory would make
   the dependency direction explicit and prevent future confusion about which
   "side" owns it.

---

## Follow-up update — limitations resolved (v3.6.1)

Shipped as a separate patch immediately after v3.6.0; addresses four of the
limitations / recommended next steps above.

| # | Limitation | Resolution |
|---|------------|------------|
| 1 | Presence needed a linked workspace (none on brand-new projects) | The monolith now **lazily resolves/creates the screening workspace for the project owner** when none is linked (the same owner-only `screeningApi.getWorkspace()` path Screening already uses), via a best-effort effect keyed on `project.id`. Presence is now live project-wide from first open for owners. Members are unaffected (membership already implies a workspace); any error simply leaves presence off. |
| 4 | `navCollapsed` was per-session | The ☰ sidebar-collapse state now **persists to `localStorage` (`metalab.navCollapsed`)** and is restored on load. |
| 3 (a11y) | Popover was mouse/hover-only | The presence popover is now **keyboard-accessible**: the chip opens on `Enter`/`Space`/`ArrowDown`, focus moves into the popover (`role="dialog"`, `aria-label`, `tabIndex=-1`), `Escape` closes **and returns focus to the chip**, and `aria-haspopup="dialog"` is set. Hover-bridge behaviour is unchanged. |
| Naming | `MembersTab` lacked the suggested shared name | Added **`src/frontend/screening/tabs/ProjectMembersPanel.jsx`** (re-export of `MembersTab`) as the canonical shared-component name; Project Control now imports `ProjectMembersPanel`. |

**Still open (intentionally deferred):** in-memory/single-process presence (needs
a pub/sub broker for multi-instance — architectural, out of scope); popover
`ResizeObserver` tracking (low value — `scroll`/`resize` reposition already
covers real usage); the "Recently opened" 1-item display cap (intentional UX).

**Verification:** `npx vite build` green; unit suite 719 pass / 6 pre-existing
`serverStorage` fails (unchanged baseline); `presenceIndicator.test.js` green.
Version `3.6.0` → `3.6.1`.

---

## Follow-up patch — reported issues (v3.6.2)

1. **Screening showed "no online".** On the Screening tab the universal-header
   presence runs *listen-only* (the embedded engine owns the heartbeat so the
   fine-grained "Screening · …" location is preserved). The server only pokes
   *other* members on a heartbeat, so the header never refetched to include
   **itself** → the chip read empty even though the user was present. Fix: in
   `usePresence.js`, listen-only mode now refetches immediately, again at ~1.2 s
   (to catch its own heartbeat landing post-mount), then polls every 15 s on top
   of the realtime pokes — so the count converges to the true room, including self.
2. **Custom "?" tooltips were clipped** (notably beside *Measure* / *Convert data*
   in Data Extraction). The shared `HelpTip` bubble rendered as
   `position:absolute; z-index:300` inside the content, so overflow-hidden
   tables/cards and the transformed `.tab-content` ancestor trapped it. Fix:
   `HelpTip` now **portals its bubble to `<body>`** at z-10000 with
   `getBoundingClientRect` positioning, an above/below flip, and viewport
   clamping — identical to the presence popover. This fixes **every** `HelpTip`
   across the app (PICO, Search, Extraction, etc.); all other tooltips were
   already native `title=` (never clipped).

`npx vite build` green; suite 719 pass / 6 pre-existing fails. Version
`3.6.1` → `3.6.2`.
