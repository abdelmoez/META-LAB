# Ops Console — Risk of Bias engine controls (prompt32 Task 12)

## Current state (before)
RoB had a single control: the `rob_engine_v2` feature flag (Ops › Feature Flags) which 404s the `/api/rob` endpoints and hides the workspace when off. No dedicated Ops section, no policy settings, no engine metrics.

## Decision
Keep `rob_engine_v2` as the master kill-switch. Add an admin-only **Risk of Bias** Ops section backed by a new `robSettings` SiteSetting (additive JSON, no migration) plus read-only engine metrics. Defaults are permissive so existing projects are never broken by a missing row.

## Backend (`server/controllers/robAdminController.js`, `routes/admin.js`, `settingsController.js`)
Admin endpoints (`requireAdmin`):
- `GET /api/admin/rob/settings` → `{ settings, engineEnabled }` (engineEnabled mirrors the flag).
- `PUT /api/admin/rob/settings` → coerced + persisted via `coerceRobSettings` (clamps `defaultRequiredReviewers` to 1–5, validates `defaultLeftTab` ∈ pdf|article, merges `tools{}`, accepts only real booleans), `logAdminAction` on write.
- `GET /api/admin/rob/metrics` → `{ projectsUsingRoB, totalAssessments, completedAssessments, pendingAssessments, overall:{low,some,high}, reviewerConflicts }`, tolerant of an empty/absent RoB dataset (returns zeros, never 500s).
- `getConsole` admin sections now include `'rob'`.
- `robSettings` (and `onboardingSettings`) are exposed via `GET /api/settings/public` (with `ROB_DEFAULTS` merged) so the RoB UI can read non-sensitive layout defaults without a second authed call. The server kill-switch is independent of this payload.

### robSettings fields
Panels/UI: `showPdfPanel`, `showArticleInfoTab`, `defaultLeftTab`, `compactAssessmentCards`. Tools: `tools{rob2,robinsI,quadas2,nos,custom}`, `defaultTool`. Workflow: `defaultRequiredReviewers`, `allowLeaderChangeReviewers`, `requireConsensusBeforeComplete`, `allowConflictResolutionByLeader`, `allowOwnerOverride`, `requireNotesForHighOrUnclear`, `requireDomainJustifications`, `requireFinalJudgment`. Export: `includeInReport`, `includeSummaryFigure`, `includeDomainTable`, `includeReviewerNotes`, `allowCsvXlsxPdfExport`. Audit/safety: `logChanges`, `requireReasonWhenChangingCompleted`, `lockCompletedAssessments`, `allowReopenCompleted`.

## Frontend (FE agent — AdminConsole.jsx `RobAdminSection`, adminApiClient.js `rob.*`)
Engine-status banner (links to Feature Flags), a metrics card (zeros-safe), and grouped settings cards (Panels/UI, Tools, Workflow, Export, Audit/Safety) with toggles + selects + a 1–5 reviewer number input. The RoB study workspace consumes `showPdfPanel` / `showArticleInfoTab` / `defaultLeftTab` from public settings (Task 2/4 UI).

## Permissions
Admin-only (server `getConsole` + `requireAdmin` routes). Mods/normal users have no access.

## Test results
- `tests/unit/robSettings.test.js` — coercion/clamping (6 tests).
- Live smoke: `GET /api/settings/public` returns `robSettings` (23 keys, `defaultLeftTab:"pdf"`).

## Risks / limitations
- Wired-to-behaviour today: the UI panel/tab/default-tab flags (Task 2/4). The remaining workflow/export/audit toggles are persisted and surfaced in Ops but not all are enforced engine-side yet (documented as a follow-up); defaults are safe/permissive so nothing regresses.
- Keep `rob_engine_v2` as the single master flag — `robController.robEnabled()` and `robApi.robFlagEnabled()` hard-read that exact path; do not move it into `robSettings`.
