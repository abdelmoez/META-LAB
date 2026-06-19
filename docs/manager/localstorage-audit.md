# localStorage Audit (prompt38, Phase 9)

**Headline:** an exhaustive sweep of `src/**` + the monolith found **no canonical
workflow data in localStorage**. Every key is a UI preference, a theme cache, or a
derived list. Canonical workflow state already lives server-side (the `Project.data`
blob; see `current-monolith-and-state-map.md`). This is good news — the
localStorage risk the prompt anticipated is largely **already absent**; the real
work is moving the *server blob* to per-module state.

| Key | File(s) | Purpose | Shape | Classification | Action |
|---|---|---|---|---|---|
| `metalab.navCollapsed` | monolith ~L7983 | left workflow menu collapsed | `"0"`/`"1"` | UI-preference | keep local |
| `ml_banner_dismissed` | `Landing.jsx` | landing banner dismissed | `"1"` | UI-preference | keep local |
| `metalab.dashboardPrefs.<userId>` | `projectLanding.helpers.js` | dashboard sort/filter/view | JSON | UI-pref (server-mirrored via `User.dashboardPreferences`) | keep local cache |
| `metalab.recentProjects(.<userId>)` | `ProjectLanding.jsx` | recently-opened ids | id[] | derived | keep local (or derive server-side later) |
| `metalab.rob.splitRatio` | `rob/RobWorkspace.jsx` | RoB PDF/assessment split | float | UI-preference | keep local |
| `metalab.pdfToolsHidden` | `screening/components/PdfViewer.jsx` | PDF toolbar collapsed | `"0"`/`"1"` | UI-preference | keep local |
| `metalab.screeningShortcuts.<userId>` | `screening/tabs/ScreeningTab.jsx` | keyboard shortcuts | JSON | UI-pref (server-mirrored via `User.screeningShortcuts`) | keep local cache |
| `metalab.screeningUI.<userId>` | `screening/tabs/ScreeningTab.jsx` | L/R panel collapse | JSON | UI-preference | keep local |
| `metalab_brand` | `theme/ThemeContext.jsx` | brand-theme cache (anti-flash) | JSON | theme-cache (server = `SiteSetting:themeSettings`) | keep cache |
| `metalab_theme` | `theme/tokens.js` | day/night choice | `"day"`/`"night"` | theme-cache (server = `User.themePreference`) | keep cache |

## Conclusions
- **Can remain local:** all of the above (UI prefs, theme caches, derived recents).
- **Must move to server:** *none in localStorage* — but the **`Project.data` blob's
  per-module slices** (protocol, search, extraction, analysis, GRADE, PRISMA,
  report) must move to per-module server state. That is the actual migration; this
  audit redirects the effort there.
- **No `migration-flag` keys exist yet.** When per-module migration runs, it writes
  the legacy data into the server module state (not a localStorage flag) and uses
  the module `revision` (0 = not yet migrated) as the migration marker — see
  `localstorage-to-server-migration-plan.md`.

## Observability follow-up (Phase 11)
A dev-only `console.warn` when the legacy whole-project autosave persists a slice
that a migrated module now owns would surface accidental double-writes. Deferred to
a later wave (the Protocol mirror is intentional dual-write during transition).
