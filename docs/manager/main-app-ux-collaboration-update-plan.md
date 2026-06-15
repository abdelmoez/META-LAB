# Main-App UX & Collaboration Update (prompt23)

Status: **DONE** — v3.5.0. A workflow/UX/collaboration pass that makes the app
simpler, cleaner, and safe for multiple people to work in at once.

Target workflow the UI now reinforces:
**Project Landing → Open Review Project → Protocol/PICO → Screening → Data
Extraction → Analysis → PRISMA/Export.**

## What changed (by area)

| # | Task | Summary |
|---|------|---------|
| 1 | Sidebar declutter | Removed the redundant **Projects** switcher from the in-project sidebar. "Back to Projects" remains the single, clean way back to the dashboard (`/app`). |
| 2 | Sort persistence | The dashboard **sort / filter / view / show-archived** choice is remembered **per user** (validated localStorage), surviving refresh, browser restart, and logout/login. See defaults fallback below. |
| 3 | Stepper | Restored the **connecting line** between steps and a **real task-count line** under each step (e.g. "124 records", "3 unresolved", "45 remaining"). Still a read-only guide — not clickable. |
| 4 | Conflict → T&A sync | Resolving a conflict now updates the Title & Abstract list, stepper counts, and overview **without a refresh** (realtime `decision.saved` + resolver `refreshProject`). |
| 5 | Field locking | Real-time collaborative field locks — see [project-presence-and-field-locking.md](project-presence-and-field-locking.md). |
| 6 | Day theme | Day/light is the product default for new/logged-out users; saved preferences are preserved. |
| 7 | Create-project copy | Removed the "Screening is built in … Nothing to link." block. |
| 8 | PICO | Time Frame dropdown + custom range, mandatory Comparator, structured criteria — see [pico-protocol-improvements.md](pico-protocol-improvements.md). |
| 9 | Import → Duplicates | After import we detect duplicates then land on Step 2 with a "Preparing duplicate review…" state — no race/empty error. See [screening-import-duplicates-fix.md](screening-import-duplicates-fix.md). |
| 10 | Duplicates | "Not duplicates — keep all" resolution + Show-more abstract. |
| 11 | Reviewer quorum | All quorum labels follow `requiredScreeningReviewers` — see [reviewer-quorum-settings.md](reviewer-quorum-settings.md). |
| 12 | Submenu declutter | Removed "records · members" from the Screening submenu; replaced by the presence indicator. |
| 13/14/15 | Presence | Active-users indicator + Members-tab presence, integrated with field locks. |

## Why "Projects" was removed from the left panel
The project dashboard at `/app` already owns the full project list, creation,
import, and deletion. Duplicating a project switcher inside the workspace sidebar
added clutter and a second, weaker navigation surface. The monolith is not
router-aware; it navigates via the `onBackToProjects` prop (→ `/app`), which is
untouched, so routing and deep-links (`/app/project/:id?tab=…`) are unaffected.

## Theme default
`index.html` already sets `data-theme="day"` pre-paint for users with no saved
preference; `ThemeContext` now also falls back to `'day'` (was `'night'`), so the
intent is unambiguous. Saved preferences (localStorage `metalab_theme` and the
server `User.themePreference`) still win.

## Dashboard preference storage decision
We chose **per-user localStorage** (`metalab.dashboardPrefs.<userId>`) over a new
backend column to avoid an unverifiable schema migration in this cycle. It meets
the requirement (refresh / restart / logout-login on the same browser; distinct
per user; safe fallback on invalid data). Cross-device sync via a
`User.dashboardPreferences` column is a clean future enhancement that mirrors the
existing `themePreference` pattern.

## Known limitations
- Presence/locking is scoped to the **screening workspace** (the collaborative
  core). Locking monolith stages (PICO/Data Extraction) reuses the same infra and
  is the documented next step.
- Single-process SSE bus (no Redis) — presence is per-instance, same caveat as the
  existing realtime system; polling fallback covers correctness.
