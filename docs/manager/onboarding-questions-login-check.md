# Onboarding questions — per-login enforcement (prompt32 Task 6)

## Current state (before)
Onboarding was a single global flag: `User.onboardingCompletedAt` + 5 fixed profile columns. The 3 select questions were hard-coded in `Onboarding.jsx`/`editableUserFields.js`. Routing to `/onboarding` happened only at the login/register handlers (once per account), so a returning cookie session bypassed it and a newly-added question could never re-prompt an existing user.

## Issue
New onboarding questions added later would never reach already-registered users; there was no per-question answered/skipped state and no per-login gate.

## Decision
Add a generic, ops-managed, per-question layer with per-user state, computed as "active questions minus the ones this user already answered or skipped", and a real post-login gate that fires on every authenticated session bootstrap. Keep the legacy `onboardingCompletedAt` + 5 columns for analytics/back-compat (seeded canonical answers mirror onto them).

## Data model (additive — two new tables, `prisma db push`-safe)
- `OnboardingQuestion { id, key @unique, prompt, description?, type, options?(JSON), isActive, isRequired, allowSkip, displayOrder, audience?, createdAt, updatedAt }`. Types: `text | single_select | multi_select | boolean | number | date`.
- `UserOnboardingResponse { id, userId→User(Cascade), questionId→OnboardingQuestion(Cascade), answer?(JSON), status("answered"|"skipped"), answeredAt?, skippedAt?, createdAt, updatedAt, @@unique([userId, questionId]) }`.
- `User.onboardingResponses` back-relation.

## Backend (`server/controllers/onboardingController.js`, `routes/onboarding.js`)
- `GET /api/onboarding/pending` → `{ questions:[…], intro:{title,body} }`. **Pending = active questions with no response row for this user** (answered OR skipped both remove a question). Honours the `onboardingSettings.enabled` master switch. Never throws (degrades to empty so app entry is never blocked).
- `POST /api/onboarding/responses` `{ responses:[{questionId, answer}] }` — validates each answer against its type/options, upserts `status:"answered"`, mirrors canonical keys (`primary_role`→`primaryRole`, etc.) onto the legacy User columns for analytics, then marks `onboardingCompletedAt` when nothing remains.
- `POST /api/onboarding/skip` `{ questionIds? }` (omit ⇒ all pending skippable) — refuses to skip `isRequired`/`allowSkip:false` questions.
- `seedOnboardingQuestions()` upserts the 3 canonical select questions at startup (idempotent; never clobbers admin edits).

## Frontend (FE agent — App.jsx / AuthContext / Onboarding.jsx / authClient.js)
- `authClient` gains `getPendingOnboarding` / `submitOnboardingResponses` / `skipOnboarding` (never fatally throw).
- `AuthContext` fetches pending after login/`getMe`, exposes `pendingOnboarding` + `refreshPendingOnboarding`.
- A post-login gate redirects to `/onboarding` when there are pending questions and the path isn't `/onboarding`, `/invite`, `/verify-email`, `/terms`, `/reset` (invite precedence preserved). `Onboarding.jsx` renders the server-driven questions dynamically (one input per type), shows progress, hides Skip on required questions, re-fetches after each action, and continues to `/app` when pending is empty.

## Test results
- Unit: `tests/unit/onboarding.test.js` (pending computation incl. new-question-reappears, per-type `validateAnswer`, `coerceQuestionInput`) — 11 tests.
- **Live smoke (verified):** new user → 3 pending; answer one → 2; skip rest → 0; inserting a new active question made it pending again for the already-completed user; a required (`allowSkip:false`) question survived skip-all.

## Risks / limitations
- Legacy `onboardingCompletedAt` + 5 columns are preserved; canonical answers mirror onto them so Ops Users analytics keep working. Non-canonical (admin-authored) questions are stored only in `UserOnboardingResponse`.
- The gate degrades open on any network error (onboarding never blocks app access by design).
