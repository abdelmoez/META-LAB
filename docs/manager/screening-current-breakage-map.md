# Screening — Current Breakage Map (prompt19)

[FROM: Opus Lead Architect] [TO: Team] [TOPIC: Root-cause map before the rebuild]

Verified against the live code (not guessed). Companion to `screening-workflow-overhaul-plan.md`.

## 1. Screening sub-tabs felt broken / cramped
**Root cause (not a click handler bug):** the entire project body — including the `EmbeddedScreening` → `SiftProject embedded` workbench — rendered inside `meta-lab-3-patched.jsx` `<div className="tab-content" style={{maxWidth:960,margin:"0 auto"}}>` (was L8549), *under* the full project header. The embedded shell used `height:calc(100vh-168px)`. Net effect: the screening workbench was squeezed into a ≤960px column with little vertical room. The full-bleed **Title & Abstract** 3-column view (record list + abstract + decisions) is unusable at that width, and the other sub-tabs looked dead because switching them changed content inside a cramped, partly-clipped box. The sub-tab state machine itself (`embTab`/`setTab` in `SiftProject.jsx`) was correct.
**Fix:** full-bleed, full-height **Screening workspace** that escapes the 960 clamp and the project header, with a focus mode that slides the sidebar away. → `ScreeningWorkspaceFrame` in the monolith + `SiftProject` embedded shell now `height:100%`.

## 2. Forest plot — live display always dark + narrow + "overlap"
**Root cause:** `ForestPlot` (monolith L1260) is a SINGLE component used for both the live on-screen plot AND the "Dark (screen)" PNG export (serialized by `liveSvgToString("forestplot-svg")`). It hardcodes dark hex (`FC={txt:"#eaecf6"…}`, `<svg style background "#0e1420">`, `<rect fill "#0e1420">`) and a fixed pixel width (`W≈620`) inside `overflowX:auto`. So the live embed was always dark (even in day mode) and never used the available width; the "overlap" was the fixed-width plot crammed into a flex/scroll container. The white **publication** export is a separate builder and was always fine.
**Fix:** add a `live` + `theme` mode to `ForestPlot` (theme-aware palette + `width:100%`/viewBox + maxWidth). The live render is shown; a hidden dark `svg#forestplot-svg` stays in the DOM purely as the unchanged export source. Exports are untouched.

## 3. Reviewers — only a global quorum
**Root cause:** promotion to second review used `getEffectiveQuorum()` (a GLOBAL admin setting `minIncludeQuorum`/`requireTwoReviewers` in `server/screening/settings.js`). No per-project, owner-editable required-reviewer count.
**Fix:** `ScreenProject.requiredScreeningReviewers` (default 2) + `effectiveRequired = max(perProject, getEffectiveQuorum())` enforced in `screeningController.saveDecision`; settable in Project Settings (owner/leader).

## 4. Dashboard exposed "linking"
**Root cause:** `ProjectLanding.jsx` had `linked`/`notlinked` filters + a "Linked META·SIFT" KPI (from `projectLanding.helpers.js` `FILTERS`).
**Fix:** dropped those filters; added status filters (Active / Screening in progress / Completed / Owned / Shared / Recent / Archived) derived from real project fields.

## 5. User-facing "META·SIFT" / "Linked META·LAB Project"
**Root cause:** the product was renamed to Screening (prompt18) but copy across the monolith, screening UI, ProjectLanding, and ops wasn't fully swept.
**Fix:** swept user-facing strings → "Screening" (the engine name remains internal in code/comments/DB/services).

## 6. No ops user geography
**Root cause:** registration captured no country; no endpoint/map existed.
**Fix:** country-level capture at registration (proxy header → optional offline → Unknown), `GET /api/admin/users/countries`, AdminConsole Users-tab map + table.
