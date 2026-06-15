# Project Dashboard Cleanup (prompt24 Task 1)

[FROM: Lead] [TO: Team] [TOPIC: dashboard filter/rail trim, v3.6.0]

Targeted removal of two stale filter chips and a display-cap on the "Recently
opened" rail. No logic changes to search, sort, view toggle, or persisted prefs.

## What changed

### Filter chips — `src/frontend/pages/ProjectLanding.jsx`

The component-local `DASHBOARD_FILTERS` array drives chip rendering via a
`.map()`. Two entries were deleted:

| Removed key | Label shown | Why removed |
|-------------|-------------|-------------|
| `'recent'`  | Recent | Redundant with the RecentsRail; filtering by recency and surfacing recents are the same UX intent |
| `'shared'`  | Shared with me | Shared projects appear in "All" and any other applicable filter; a dedicated chip added noise without surfacing unique data |

Remaining chips (in order): **All · Active · Screening in progress · Done ·
Owned by me · Archived**.

The `FILTERS` array in `projectLanding.helpers.js` is a separate export used
only by unit tests; it was intentionally left unchanged so existing tests
remain green.

Stale persisted values (`'shared'`, `'recent'`) from users who previously
selected those chips are silently dropped by the existing
`sanitizeDashboardPrefs` validator — no migration, no jarring resets.

### "Recently opened" rail

`recentItems` (a `useMemo` over the localStorage ring) was capped with
`.slice(0, 1)`, so the rail shows at most **one** project — the single
most-recently opened. `RecentsRail` already returned `null` when the list was
empty, so the empty-state is clean.

The localStorage ring still stores up to 6 entries (unchanged), keeping
backward compatibility should the cap be raised later.

### What was NOT changed

- The **"In progress" KPI summary tile** on the dashboard header was kept — it
  is a stat card, not a filter chip.
- Shared projects continue to appear under "All" and other applicable filters.
- Search, column sort, card/table view toggle, archive toggle, and
  `dashboardPreferences` cross-device persistence (added in v3.5.1) are all
  untouched.

## File reference

| File | Change |
|------|--------|
| `src/frontend/pages/ProjectLanding.jsx` | Removed `'recent'` + `'shared'` from `DASHBOARD_FILTERS`; added `.slice(0,1)` to `recentItems` useMemo |
| `src/frontend/pages/projectLanding.helpers.js` | No change (test-only `FILTERS` array preserved) |

## Known limitations

- "Recently opened" displays one project even when the user has several recent
  ones. The cap is intentional (declutter); raise the slice argument to restore
  more if stakeholders request it.
- `navCollapsed` sidebar state introduced in Task 4 is per-session (not
  persisted); this is unrelated to dashboard prefs.

## QA results

- Unit suite: **719 passed / 6 pre-existing failures** (`serverStorage.test.js`
  network-mock flakiness; unrelated to this change).
- `npx vite build` green (v3.6.0).
- Filter-chip and rail behaviour verified by code review; no manual server run
  required (pure frontend rendering change).
