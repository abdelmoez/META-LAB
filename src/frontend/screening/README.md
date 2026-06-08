# META·SIFT Beta — Frontend Screening Module

Systematic review title/abstract screening workspace, integrated into META·LAB.

## Routes

| Route | Component | Description |
|---|---|---|
| `/sift-beta` | `SiftDashboard` | Project list |
| `/sift-beta/projects/:pid` | `SiftWorkbench` | Screening workbench |
| `/sift-beta/projects/:pid/import` | `SiftImport` | Import RIS/BibTeX/NBIB |
| `/sift-beta/projects/:pid/duplicates` | `SiftDuplicates` | Duplicate detection & resolution |
| `/sift-beta/projects/:pid/conflicts` | `SiftConflicts` | Inter-reviewer conflict resolution |
| `/sift-beta/projects/:pid/export` | `SiftExport` | Export screened data |

## API

All calls use `/api/screening/...` via `src/frontend/screening/api-client/screeningApi.js`.
Session cookie is forwarded automatically (`credentials: 'include'`).

## Design

Follows the main META·LAB palette (`C` tokens) plus SIFT-specific decision colors.
IBM Plex Sans + IBM Plex Mono fonts. Inline styles only — no Tailwind.

## Keyboard shortcuts (Workbench)

- `I` — Include record
- `E` — Exclude record
- `M` — Maybe
- `↑` / `↓` — Navigate records
