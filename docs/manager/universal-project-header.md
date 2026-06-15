# Universal Project Header (prompt24 Tasks 4/7)

[FROM: Lead] [TO: Team] [TOPIC: ProjectHeaderBar — unified top bar on every project page, v3.6.0]

## Problem

Before this change the project title lived inside the scrollable `.tab-content`
area. Only the Screening stage had a real persistent top bar (the bespoke
`ScreeningWorkspaceFrame` header). On all other stages, the title scrolled away,
the fixed utility cluster (chat launcher, notifications bell, account menu,
presence chip) floated at the top-right with a hardcoded pixel offset, and at
narrower viewports the `@media (max-width:1480px)` hack reserved right-side
padding on `.tab-content` to stop content from sliding under the cluster.

This left no single place to put presence, breadcrumbs, or the ☰ sidebar toggle
— each new feature that needed a top bar had to add its own fixed overlay.

## Solution — `ProjectHeaderBar`

A new `ProjectHeaderBar` component rendered on **every project page**:
Overview, PICO, Protocol, Search, Screening, PRISMA, Extraction, RoB, Analysis,
Forest plot, GRADE, Checklist, Manuscript, Methods, and Project Control.

### Structure

```
[ ☰  Project title  ▸  Current section ]   [ Project overview | Projects ]   [ Presence | Chat | Bell | Account ]
 ← left region (min-width:0, truncates) →   ← middle nav (collapses <900px) →   ← right cluster (flex-shrink:0) →
```

- **Left:** ☰ menu toggle + project title (truncating with ellipsis,
  `min-width:0`) + `▸ Current section` breadcrumb.
- **Middle:** "Project overview" link + "Projects" (Back to Projects) nav.
  Labels collapse to icons under 900px via the `.uh-navlabel` responsive class.
- **Right (utility cluster):** `[PresenceIndicator][MetaLabChatLauncher]
  [NotificationsBell][UserMenu]` — all rendered inline, not floating.

### Layout restructure (`meta-lab-3-patched.jsx`)

The main content area is now a flex column:

```
ProjectHeaderBar   (flex-shrink:0  — never scrolls away)
─────────────────────────────────────────────────────────
Scrolling body     (flex:1; min-height:0  — owns overflow)
```

This eliminates the scroll-away title, the fixed-cluster z-fighting, and the
`padding-right` reservation hack.

### Anti-overlap (Task 4)

Long project titles truncate via `min-width:0` + `text-overflow:ellipsis` on
the title span; the right utility cluster is `flex-shrink:0` so it never
compresses. Dropdowns (notifications, account, presence popover) are
`position:absolute` or portaled, so they are never trapped by the header's own
overflow boundary.

## What was removed / consolidated

| Removed | Replaced by |
|---------|-------------|
| `AppWorkspace.jsx` fixed `NotificationsBell` + `UserMenu` | Inline in `ProjectHeaderBar` right cluster |
| Monolith fixed chat launcher | Inline in `ProjectHeaderBar` right cluster |
| Monolith floating fixed presence chip | `PresenceIndicator` in `ProjectHeaderBar` right cluster |
| `ScreeningWorkspaceFrame` bespoke header bar | `ProjectHeaderBar` (universal); `ScreeningWorkspaceFrame` now only provides the embedded engine height fill |
| `@media (max-width:1480px){.tab-content{padding-right:118px}}` | Deleted (no longer needed) |

The welcome screen (no project open → header not shown) keeps a small top-right
bell + account cluster for unauthenticated/lobby states.

## Sidebar toggle

☰ toggles the sidebar on every tab via a new `navCollapsed` boolean state. The
Screening stage keeps its bespoke full-bleed focus behaviour (sidebar fully
hides in focus mode, ☰ restores it) — the toggle is compatible with both modes.

## File reference

| File | Change |
|------|--------|
| `meta-lab-3-patched.jsx` | New `ProjectHeaderBar` component; flex-column layout; `navCollapsed` state; removed fixed cluster; removed Screening-tab fixed overlap hack |
| `AppWorkspace.jsx` | Removed fixed `NotificationsBell` + `UserMenu` (now in header) |
| `src/frontend/screening/pages/SiftProject.jsx` | `ScreeningWorkspaceFrame` stripped to height-fill only |

## Known limitations

- `navCollapsed` state is per-session (not persisted to localStorage or
  `dashboardPreferences`).
- The sidebar is a desktop-first, fixed-256px layout; true phone widths remain
  out of scope.
- Middle nav collapses to icon-only at 900px but no full mobile hamburger menu
  is provided.

## QA results

- Unit suite: **719 passed / 6 pre-existing failures**.
- `vite build` green; the pre-existing AnalysisTab esbuild JSX warning at
  ~L4328 is unchanged and build still exits 0.
- Header structure and anti-overlap verified by code review. The flex
  `min-width:0` + `flex-shrink:0` pattern matches the approach confirmed
  working in the SiftProject top bar since v3.1.0.
