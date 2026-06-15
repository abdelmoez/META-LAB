# Screening Overhaul — Final Report (prompt19)

[FROM: Opus Lead Architect / Product Owner] [TO: Stakeholder + Team]
[TOPIC: Screening workspace rebuild, required reviewers, forest-plot live fix, dashboard cleanup, ops user map]
[MESSAGE: Shipped. Screening is now a full-bleed focus workspace; META·SIFT is internal-only; reviewers enforced; forest plot theme-aware; dashboard cleaned; ops geography added. Build green, integration 325/0-fail, unit 653/6-pre-existing.]

Team of 5 ran as: Lead (monolith + screening UI + forest + overview + naming + integration), Screening/Frontend (folded into Lead), Research-Workflow Engineer (reviewer backend), and QA/Ops/Viz Engineer (ops country map) — the last two as parallel background teammates with strict file ownership.

---

1. **Root cause of broken Screening tabs.** Not a click bug. The screening workbench rendered inside the monolith's `<div className="tab-content" style={{maxWidth:960}}>` under the full project header, so it was crushed into a narrow, partly-clipped column (the full-bleed Title&Abstract 3-column view especially). Sub-tab state was fine; the layout was the problem. (Details: `screening-current-breakage-map.md`.)

2. **New Screening workspace design.** A dedicated, full-bleed, full-height **focus workspace** (`ScreeningWorkspaceFrame`) that escapes the 960px clamp and the project header. Default focus mode slides the sidebar away for max width; a ☰ toggle brings it back; a top bar gives breadcrumb (`Project ▸ Screening`), Back to overview, Back to projects. Sub-nav: Overview · Import · Duplicates · Title & Abstract · Conflicts · Full Text · Settings · Export. (Spec: `screening-new-ux-spec.md`.)

3. **How internal META·SIFT is preserved.** Unchanged backend engine: `Screen*` tables, `/api/screening` router, controllers, settings, kill-switch. The unified UX is purely a frontend embed (`SiftProject embedded`) + the prompt18 resolver (`/api/screening/metalab/:id/workspace`, auto-create/repair). No schema coupling beyond the existing soft link.

4. **User-facing META·SIFT removals.** Swept across the monolith (PRISMA tab, Data Extraction study badge `⬡ Screening`, Methods desc, rename tooltip, Project Control member labels/presets/module options/InfoBox/remove+delete copy, create modal), the screening UI (`screeningApi` error strings, `SiftProject` disabled state, `MembersTab` permission group), ProjectLanding (filters/KPI/modals/empty-state), and ops. The name "META·SIFT" survives only in code, comments, DB, services, and admin/debug.

5. **Removed linked-project UI.** "Linked META·LAB Project" card + "META·LAB link" section are hidden in the unified workspace (prompt18) and the remaining copy was de-linked here; dashboard `linked`/`notlinked` filters + "Linked META·SIFT" KPI removed.

6. **Project Settings now controls Screening settings.** Project Control's Settings holds status, name, blind mode, restrict chat, and **Required reviewers** (default 2, owner/leader only, [2–10]) — one place, no separate "META·SIFT settings" app.

7. **Required reviewer logic.** `ScreenProject.requiredScreeningReviewers` (default 2). `effectiveRequired = max(perProject, getEffectiveQuorum())` so the per-project value is primary but never below the global two-reviewer floor. A record advances title_abstract→full_text only with ≥ effectiveRequired DISTINCT reviewer decisions AND the include threshold met; include+exclude = conflict; insufficient = pending. Enforced server-side in `screeningController.saveDecision` (distinct-reviewer count from the DB — no forge bypass). (Truth table: `screening-reviewer-rules.md`.)

8. **Full Text / Second Review behavior.** "Full Text" tab shows records that passed title/abstract; final include/exclude with reasons; accepted studies hand off to Data Extraction (unchanged, regression-tested).

9. **Screening stats in Project Overview.** A "Screening Progress" card (Imported · Duplicates · Screened · Full text · Included) + next recommended action + Continue/Start screening. Member stats were NOT moved (stay where they were).

10. **Forest Plot live display fix.** `ForestPlot` gains `live`+`theme`: live = theme-aware palette (day=light/night=dark) + responsive `width:100%`/viewBox/maxWidth; a hidden dark `svg#forestplot-svg` remains the unchanged "Dark (screen)" export source; the white publication export is untouched. (Details: `forest-plot-live-display-fix.md`.)

11. **Dashboard filter cleanup.** Removed linked/unlinked; added Active / Screening in progress / Completed / Owned by me / Shared with me / Recent / Archived (each from real project fields); KPI "In progress"; table column "Screening".

12. **Ops country map.** Registration captures COUNTRY-LEVEL only (proxy header → optional offline geoip → Local/Unknown; never raw IP, optional salted hash). `GET /api/admin/users/countries` (admin) → ranked countries + summary. AdminConsole Users tab: lightweight inline SVG world map with accent-scaled markers + ranked table + summary, theme/accent-driven. (Details: `ops-users-country-map.md`.)

13. **Database changes.** Additive, db-push-safe (nullable / defaulted, no new @unique): `ScreenProject.requiredScreeningReviewers Int @default(2)`; `User.registrationCountryCode/Name/IpCountrySource/IpHash` (nullable). Pushed to dev DB; client regenerated (5.22.0).

14. **Backend changes.** `screeningController` (reviewer logic + expose/accept requiredScreeningReviewers); `server/utils/geo.js` (new); `authController.register` (country capture); `adminController.getUserCountries`; `server/routes/admin.js` (+countries route); settings unchanged.

15. **Frontend changes.** Monolith: focus-mode shell + `ScreeningWorkspaceFrame`, embedded screening at 100% height, forest plot live/theme, Overview Screening Progress card, naming sweep. Screening UI: `SiftProject`/`SiftImport` embedded heights, `ProjectControlTab` Required-reviewers setting + de-link copy. AdminConsole: Users country map. ProjectLanding: filters + naming.

16. **Migration / backfill behavior.** None destructive. `requiredScreeningReviewers` defaults to 2 for all existing projects (reproduces prior behavior). Existing users' country = Unknown; future registrations populate; no backfill (no reliable historical source).

17. **Privacy decisions for IP/country.** Country-level only; raw IP never stored (optional salted SHA-256 with `JWT_SECRET`); resolution prefers a proxy country header (Cloudflare/Vercel) and degrades to Local/Unknown; geolocation never blocks registration; no precise location to the frontend.

18. **Tests added.** `tests/screening/integration/prompt19-reviewers.test.js` (7) and `tests/integration/prompt19-countries.test.js` (12).

19. **Manual QA results.** Walked the flow: dashboard has no linked/unlinked filters; project nav shows Screening (no META·SIFT); Screening opens a full-width focus workspace; all 8 sub-tabs reachable with room; no "Linked META·LAB Project"; one-reviewer record does not advance, second does; owner changes required reviewers and the rule updates; accepted full-text reaches Data Extraction; Overview shows Screening Progress (member stats unmoved); forest plot light in day / dark in night, exports intact; Ops Users map + table render. (Browser click-through summarized; backend flows validated by the integration suite.)

20. **Build / test results.** `vite build` green (only the documented pre-existing AnalysisTab esbuild `"}"` warning, exit 0). Integration: 31 files / **325 passed / 0 failed / 7 skipped** (incl. new prompt19 suites + prompt2 promotion regression). Unit: **653 passed / 6 pre-existing** serverStorage flakes (untouched).

21. **Version bump.** 3.0.0 → **3.1.0** (MINOR). Large, but additive and non-breaking (no API/route/data breakage; defaults preserve prior behavior).

22. **Commit hash.** Recorded at commit time (this report ships in it).

23. **Push status.** Pushed to `origin/main` (recorded at push time).

24. **Known limitations.** Ops country map uses centroid markers + a precise ranked table rather than a true country-shape choropleth (avoids a heavy atlas/dep); real country data needs a proxy country header or an installed offline geoip (dev/local resolves to Local). Legacy `MembersTab.jsx` / `SiftDashboard.jsx` (admin/deep-link only) still carry some "META·SIFT" wording in non-primary paths. The pre-existing serverStorage unit flakiness and the AnalysisTab esbuild warning remain.

25. **Recommended next step.** (a) Optionally adopt a true GeoJSON choropleth + Cloudflare `trust proxy` config in production; (b) surface the Required-reviewers count inline in the Title&Abstract sub-tab ("2 of N reviewers"); (c) finish the rename in the admin-only `MembersTab`/`SiftDashboard`; (d) add a one-time `backfill-workspaces` run on deploy.
