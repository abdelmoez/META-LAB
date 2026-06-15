# Screening — New UX Spec (prompt19)

[FROM: Frontend UX & Layout Engineer + Lead] [TO: Team] [TOPIC: The rebuilt Screening workspace]

## Principle
One Review Project. The main project nav stays clean; **Screening is one stage** that opens a dedicated, spacious workspace. The user never sees "META·SIFT" or "linked project".

## Layout
```
Review Project (monolith shell: fixed 256px sidebar + content)
└── click "Screening" (Screen-phase tab)
    → FULL-BLEED Screening workspace (escapes the 960px content clamp + project header)
       ├── Focus mode ON by default: sidebar slides away (translateX(-100%)),
       │   content marginLeft:0 → full viewport width. Toggle with ☰.
       ├── Screening top bar (always present — user is never trapped):
       │     [☰ focus toggle]  <ProjectName> ▸ Screening      [← Project overview] [Projects]
       │     (account / notifications / chat remain as global fixed overlays)
       └── Screening sub-navigation (the engine, full width + height):
             Overview · Import · Duplicates · Title & Abstract · Conflicts · Full Text · Settings · Export
```
- `ScreeningWorkspaceFrame` (monolith) renders the top bar + `EmbeddedScreening`, which resolves the internal screening module (auto-create/repair via `GET /api/screening/metalab/:id/workspace`) and renders `SiftProject embedded` at `height:100%`.
- Sub-tab state is local to the embedded `SiftProject` (`embTab`/`setTab`) — it never writes to the project URL.
- **Full Text** is the tab label (Task 1 preference); "Second Review" language may appear inside the page.
- Import is an inline sub-view (embedded `SiftImport`) — no separate page.

## What Screening shows vs. doesn't (Task 5)
- Screening shows ONLY screening-specific status (records, duplicates, members count, blind badge, and per-sub-tab progress). 
- General **project status** lives in Project Control + the Project Overview — NOT in the Screening workspace (the full-bleed frame omits the project header entirely).

## Project Overview (Task 8)
A **Screening Progress** card: Imported · Duplicates · Screened · Full text · Included + a "Next: <action>" line + "Continue/Start screening →" (in-app `setTab('screening')`). Member stats stay in their existing place (not moved here).

## Project Control / Settings (Task 6)
One place controls everything, including screening: status, name, blind mode, restrict chat, and **Required reviewers** (default 2, owner/leader editable, [2–10]). No separate "META·SIFT settings" app.

## Focus mode (Task 3)
- Default ON when entering Screening → maximum width.
- ☰ toggles the sidebar back (content shifts to `marginLeft:256`, still full-width, no 960 clamp) so the user can reach other stages without leaving Screening.
- Back to project overview / Back to projects are always in the Screening top bar.

## Naming (Task 4 + 7)
User-facing: Screening / Screening workspace / Screening settings / Screening records / Screening progress / Review Project. Removed: "META·SIFT", "Linked META·LAB Project", "Open/Create/link META·SIFT", linked/unlinked. The engine name "META·SIFT" survives only in code, comments, DB tables, services, and admin/debug.

## Deep links
`/app/project/:id?tab=screening` opens the Screening stage directly (AppWorkspace → `initialTab`). Old `/sift-beta` routes still resolve (admin/back-compat).

## Progressive disclosure + empty states (suggestions adopted)
Each sub-tab answers one question (Import → "get records in", Title & Abstract → "which advance?", Conflicts → "what needs resolution?", Full Text → "what's finally included?"). The screening sub-tabs already provide their own empty states; the Overview card surfaces the single next recommended action.
