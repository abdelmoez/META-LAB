# Final Review — Final Report (prompt21, v3.3.0)

[FROM: Lead Architect] [TO: Team + Stakeholder]
[TOPIC: Full-text stage renamed Final Review; two sub-tabs; revert; stepper; copy unification; v3.3.0]
[MESSAGE: Shipped. "Final Review" is now the unified user-facing label for the full-text stage. Safe revert with snapshot/restore is live. A six-step workflow stepper is mounted in the embedded workspace. All META·SIFT/Second Review/META·LAB user-facing copy swept. Build green, 671 unit / 2 new integration tests pass.]

---

1. **Rename locations.** `src/frontend/screening/pages/SiftProject.jsx`: `EMBEDDED_TABS` entry `'second-review'` label changed from `'Full Text'` to `'Final Review'`; `TABS` entry `'second-review'` label changed from `'Second Review'` to `'Final Review'`. `TAB_ALIASES` added: `'final-review'→'second-review'`, `'full-text'→'second-review'`, `'title-abstract'→'screening'`. `src/frontend/screening/tabs/SecondReviewTab.jsx`: all user-facing strings updated to "Final Review". Internal route key `second-review` and DB stage value `full_text` are unchanged.

2. **Two sub-tabs in Final Review.** "Not Sent to Data Extraction (N)" and "Sent to Data Extraction (N)", each with a live count. `isSent(r)` = `r.finalStatus === 'accepted' && (r.handoffStatus === 'sent' || r.handoffStatus === 'already_exists')`. Sent tab = isSent records; Not Sent tab = all others (pending, accepted-not-yet-sent, excluded). Counts recompute on every load and after every mutation.

3. **Counts staying fresh.** Final Review tab counts come from `listSecondReview` records (recomputed on load + after every mutation). The stepper refreshes via `SiftProject.refreshProject()` (reloads `getOverview`), triggered by accept / exclude / revert and the SSE `handoff.updated` poke. No polling; all updates are event-driven.

4. **Accept / send flow.** Unchanged from prompt19. Leader or canResolveConflicts accepts a record in the "Not Sent" tab → `handoffToMetaLab()` → study appended to `Project.data.studies[]` → `handoffStatus` set to `'sent'` → record moves to "Sent" tab → `RECORD_ACCEPTED` audit event → `handoff.updated` + `project.updated` SSE pokes refresh all live views.

5. **Revert.** New endpoint `POST /api/screening/projects/:pid/records/:rid/final-review/revert` (`revertFinalReview()`, `server/controllers/screeningReviewController.js`; route in `server/routes/screening.js`; client `screeningApi.revertFinalReview(pid,rid)`). Auth: leader or canResolveConflicts only (reviewer → 403, unauthenticated → 401, non-accepted record → 400). Flow: snapshot study JSON onto `ScreenRecord.revertedExtractionSnapshot` → splice study out of `project.studies` → reset `finalStatus/acceptedAt/handoffStatus/handoffStudyId/handoffAt` to empty/null → emit `handoff.updated` + `project.updated`. Record returns to "Not Sent" tab. Audit event: `RECORD_REVERTED` with `{ dataExtractionEntryDeactivated: true, snapshotKept: true }`.

6. **PRISMA update on revert.** `project.prisma` auto-fills from the screening summary; screening summary derives `included` from `ScreenRecord.finalStatus === 'accepted'`. Reverting (`finalStatus → ''`) decrements the PRISMA included count automatically. No separate PRISMA write required.

7. **Data Extraction update on revert.** Data Extraction reads `project.studies`. The reverted study is spliced out (step 2 of the revert flow), so it disappears immediately from the Data Extraction tab on the next `project.updated` refresh.

8. **Analysis update on revert.** Analysis reads `project.studies` for the study list. The removed study is gone from any meta-analysis until the record is re-sent. Users are warned in the revert confirm modal that any meta-analysis using the study may need re-running.

9. **Restore on re-accept.** `handoffToMetaLab()` checks `record.revertedExtractionSnapshot`; if present, it re-pushes the snapshot (preserving extracted data + original study id + provenance) instead of a fresh blank study. `finalizeRecord()` / `retryHandoff()` clear the snapshot once `handoff.handed` is confirmed.

10. **Copy removed / changed — SecondReviewTab.jsx.** "hand it off to META·LAB Data Extraction" → "send it to Data Extraction"; "Accept → META·LAB" → "Accept → Data Extraction"; toast "Sent to META·LAB Data Extraction." → "Sent to Data Extraction."; header "Second Review · Full-Text Stage" → "Final Review".

11. **Copy removed / changed — other tabs.** `ProjectControlTab.jsx:52` subtitle dropped "the META·LAB link". Labels-only sweep in `ScreeningTab.jsx`, `ConflictsTab.jsx`, `OverviewTab.jsx`, `MembersTab.jsx`: "META·SIFT" → "Screening"; "META·LAB" → "the project"/"Project"; "Second Review" → "Final Review". `<option value="...">` attributes (metasift/metalab/both/readonly_*) kept unchanged (API contract).

12. **Settings copy.** `ProjectControlTab.jsx:52`: subtitle now "Manage project status, blind mode, chat, members, and Screening settings — all in one place." (removed "the META·LAB link" phrase; the link UI is already `{!embedded}`-hidden in the unified flow).

13. **Stepper component.** `src/frontend/screening/ui/Stepper.jsx` — horizontal, scrollable, theme-aware (`C` tokens + `alpha()`), reuses in-house `<Icon>`. Steps: Import → Duplicates → Title & Abstract → Conflicts → Final Review → Data Extraction. Statuses: done / active / attention / pending. Clickable steps (Enter/Space, `role="button"`, `aria-current`) navigate via `setTab`. Data Extraction is non-clickable (`aria-disabled`). Colour convention mirrors existing `PROGRESS_BADGE`.

14. **Stepper placement.** Mounted in `SiftProject.jsx` (embedded mode), below the screening sub-nav and above the subpage content. `SiftProject` fetches `screeningApi.getOverview(pid).dataSummary` into `summary` state and passes it to `<Stepper>`. Refreshed alongside the project on every `refreshProject()` call.

15. **Stepper status logic.** Pure function `buildScreeningSteps(summary)` in `src/frontend/screening/ui/screeningSteps.js`. Import done if `totalArticles>0`; Duplicates attention if `unresolvedDuplicateGroups>0` else done; Title&Abstract done if `eligibleSecondReview>0 || decided>0` else active; Conflicts attention if `unresolvedConflicts>0` else done; Final Review active if `finalRemaining>0` else done; Data Extraction done if `acceptedToExtraction>0`. (`finalRemaining = eligibleSecondReview − (acceptedToExtraction + rejectedSecond)`.)

16. **Dependencies avoided.** No new npm packages added. Stepper uses JS + inline styles + theme tokens only — no TypeScript, no Tailwind, no shadcn, no lucide, no cva, no radix, no `cn`. Consistent with the existing screening UI design system.

17. **Backend changes.** New controller function `revertFinalReview()` in `server/controllers/screeningReviewController.js`. New route `POST .../records/:rid/final-review/revert` in `server/routes/screening.js`. `handoffToMetaLab()` updated to check and consume `revertedExtractionSnapshot` on re-accept. `screeningApi.revertFinalReview(pid, rid)` added to the API client.

18. **Frontend changes.** `SiftProject.jsx`: `TAB_ALIASES`, stepper mount, `summary` state + fetch. `SecondReviewTab.jsx`: two sub-tabs, revert button + confirm modal + toast, all copy updates. `ScreeningTab.jsx`, `ConflictsTab.jsx`, `OverviewTab.jsx`, `MembersTab.jsx`, `ProjectControlTab.jsx`: labels-only copy sweep.

19. **DB changes.** One new nullable column: `ScreenRecord.revertedExtractionSnapshot String?` (JSON-string snapshot; `server/prisma/schema.prisma`). Applied with `prisma db push` — additive, nullable, deploy-safe; no migration file; no existing rows affected.

20. **Tests added.** `tests/unit/screeningSteps.test.js` (6 tests — stepper status logic for all six steps across done/active/attention/pending transitions). `tests/integration/prompt21-final-review.test.js` (2 tests — full accept→revert→re-accept lifecycle on a linked project + 401 unauthenticated guard).

21. **Build / test results.** `vite build` green (pre-existing AnalysisTab esbuild `"}"` warning unchanged, exit 0). Unit: **671 passed / 6 pre-existing** serverStorage timing fails (untouched). Integration: prompt7 / prompt4 / prompt19 / prompt20 all pass; smoke-secondreview 9/9 pass. No new failures introduced.

22. **Version.** 3.2.0 → **3.3.0** (minor — workflow/UX change; additive, non-breaking; no API/route/data contract breakage; defaults preserve prior behaviour).

23. **Commit hash + push status.** (commit hash + push status filled in at ship time)

24. **Known limitations.** (a) No single project-wide "title/abstract fully screened" or "final-review complete" signal is available to non-leaders — stepper statuses for those steps are derived from `eligibleSecondReview` / `decided` counts; `projectProgress` is leader-only and is not used; no fake progress is shown. (b) The snapshot column retains the JSON until the study is re-sent or permanently excluded — it is not auto-purged. (c) Standalone `/sift-beta` shell and admin-only `LinkSection` / `LinkedMetaLabCard` retain some legacy copy (intentionally, admin/back-compat, not user-facing in the unified project flow). (d) Pre-existing serverStorage unit flakiness (6 fails) and AnalysisTab esbuild warning remain unaddressed.

25. **Recommended next steps.** (a) Surface the stepper in a collapsed/icon-only form on narrow laptop widths if the horizontal scroll proves awkward. (b) Add a `purgeRevertSnapshot` job or explicit delete on permanent exclusion to keep the DB lean on large projects. (c) Finish the labels sweep in the admin-only `MembersTab` / `SiftDashboard` paths that remain out of scope. (d) Consider exposing `finalRemaining` directly from the overview API rather than deriving it client-side, so the stepper logic can be simplified.
