# Ops Console — onboarding question controls (prompt32 Task 7)

## Current state (before)
No Ops surface managed onboarding; questions were hard-coded in shared frontend modules with no admin toggle.

## Decision
Add an admin-only **Onboarding** section to the Ops Console backed by the new `OnboardingQuestion` table plus an `onboardingSettings` SiteSetting (master enable + intro copy). Follow the existing Ops conventions exactly (nav section registered in both `getConsole` and `NAV_SECTIONS`; `requireAdmin` routes; `logAdminAction` on every write).

## Backend (`server/controllers/onboardingController.js`, `routes/admin.js`)
Admin endpoints (all `requireAdmin`):
- `GET /api/admin/onboarding-settings` / `PUT` — `{ enabled, introTitle, introBody }`.
- `GET /api/admin/onboarding-questions` → `{ questions:[{…, isActive, counts:{answered,skipped,pending}, createdAt, updatedAt}], totalUsers }`.
- `POST /api/admin/onboarding-questions` (create) — slugifies/uniquifies `key`, validates type/options via `coerceQuestionInput`.
- `PATCH /api/admin/onboarding-questions/:id` (edit / activate-deactivate / required / allowSkip / reorder fields).
- `POST /api/admin/onboarding-questions/reorder` `{ order:[id…] }`.
- `POST /api/admin/onboarding-questions/:id/reset` `{ userId? }` (omit ⇒ all users) — deletes responses so the question reappears.
- `DELETE /api/admin/onboarding-questions/:id` (cascades responses).
- `getConsole` admin sections now include `'onboarding'`.

## Frontend (FE agent — AdminConsole.jsx `OnboardingSection`, adminApiClient.js `onboarding.*`)
A "Behaviour" card (enabled + intro copy), a question manager (list with answered/skipped/pending counts; create with a type select + options editor; inline edit; activate/deactivate; required/allowSkip toggles; reorder; reset; delete; preview), modelled on the existing `SiftSettings`/`FlagsSection` primitives.

## Permissions
Admin-only (server `getConsole` returns the section only for admins; routes are `requireAdmin`). Mods/normal users have no access.

## Test results
- Pure coercion/validation covered by `tests/unit/onboarding.test.js`.
- Live smoke verified the question lifecycle end-to-end (create via DB → appears for users; required not skippable; reset).

## Risks / limitations
- `initDefaultSettings`/seed never overwrites existing rows; `onboardingSettings` defaults are merged on read.
- Counts: `pending = totalUsers − (answered + skipped)` for active questions (an approximation that treats every user as an audience member; audience targeting is reserved via the nullable `audience` column).
