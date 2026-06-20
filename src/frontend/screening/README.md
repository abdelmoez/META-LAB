# Screening — Frontend Screening Module

Systematic review title/abstract screening workspace, integrated into PecanRev.

## Routes

| Route | Component | Description |
|---|---|---|
| `/sift-beta` | `SiftDashboard` | Project list |
| `/sift-beta/projects/:pid` | `SiftProject` | Tabbed project shell (Overview · Screening · Second Review · Duplicates · Conflicts · Project Control · Export) |
| `/sift-beta/projects/:pid/import` | `SiftImport` | Import RIS/BibTeX/NBIB |

The per-feature views live in `tabs/` (`OverviewTab`, `ScreeningTab`,
`SecondReviewTab`, `DuplicatesTab`, `ConflictsTab`, `MembersTab`,
`ProjectControlTab`, `ExportTab`) and render inside the `SiftProject` shell.

> Removed 2026-06-11 (dead code from the pre-tabbed layout, never routed since):
> `pages/SiftWorkbench.jsx`, `pages/SiftDuplicates.jsx`, `pages/SiftConflicts.jsx`,
> `pages/SiftExport.jsx`.

## API

All calls use `/api/screening/...` via `src/frontend/screening/api-client/screeningApi.js`.
Session cookie is forwarded automatically (`credentials: 'include'`).

## Design

Follows the central theme tokens (`C` from `src/frontend/theme/tokens.js`,
re-exported through `ui/theme.js`) plus SIFT-specific decision colors.
IBM Plex Sans + IBM Plex Mono fonts. Inline styles only — no Tailwind.

## Keyboard shortcuts (Screening tab)

- `I` — Include record
- `E` — Exclude record
- `M` — Maybe
- `↑` / `↓` — Navigate records
