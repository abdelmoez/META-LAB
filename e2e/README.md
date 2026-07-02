# PecanRev — Playwright E2E Suite

A professional, full-coverage end-to-end suite that exercises PecanRev from A→Z in the
**Stitch** UI as a seeded admin: every major page, role, permission boundary, engine,
import/export flow, navigation path, empty/error/success state, responsive breakpoint, and
accessibility baseline.

It runs against a **local dev instance only** (client `:3000`, API `:3001`) and refuses to
run against a non-local target (see `helpers/env.ts › assertSafeTarget`).

---

## 1. Prerequisites

```bash
npm install                  # project deps (includes @playwright/test + @axe-core/playwright)
npm run test:e2e:install     # one-time: download the Playwright browsers
```

You need the dev server's admin seed credentials. They are read automatically from
`server/.env` (`ADMIN_EMAIL_1` + `ADMIN_SEED_PASSWORD`). CI can override with
`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` (or put them in `.env.test`).

## 2. Run the app

The suite reuses already-running dev servers when present, and starts them otherwise
(`webServer` in `playwright.config.ts`, `reuseExistingServer: !CI`).

```bash
npm run dev    # concurrently starts the API (:3001) and the Vite client (:3000)
```

## 3. Run the tests

```bash
npm run test:e2e            # full suite (chromium full coverage; firefox/webkit run @smoke)
npm run test:e2e:smoke      # the fast @smoke subset only
npm run test:e2e:ui         # Playwright UI mode (watch + time-travel)
npm run test:e2e:headed     # headed browser
npm run test:e2e:debug      # Playwright inspector
npm run test:e2e:report     # open the last HTML report
npm run test:e2e:ci         # html + list reporters (CI)
```

Run one area / one test:

```bash
npx playwright test e2e/screening                       # one area
npx playwright test e2e/auth/auth.spec.ts -g "logout"   # one test by title
npx playwright test --project=chromium                  # one browser
```

> **Determinism note.** A handful of specs mutate **global** server state (the Stitch
> rollout `designSettings`, the `betaWaitlist` flag, the onboarding gate) and restore it
> afterward. Under heavy `fullyParallel` these can briefly race. The **canonical,
> deterministic run is serial** (`--workers=1`), which is what CI uses
> (`workers: isCI ? 1 : undefined`). Locally, `npm run test:e2e` is parallel and fast; if
> you see a transient global-state flake, re-run with `--workers=1`.

## 4. Seed / reset strategy

There is **no manual setup**. `global-setup.ts` runs once and:

1. Asserts the target is local (safety) and waits for both servers.
2. Logs in the seeded **admin**, persists Stitch, and **enables the engine feature flags**
   (`aiScreening`, `rob_engine_v2`, `networkMetaAnalysis`, `searchEngine`, `pecanSearch`,
   `serverBackedWorkflowState`) so gated areas are testable.
3. **Disables the onboarding gate** so seeded + mid-test users reach the app (restored by
   `global-teardown.ts`).
4. Programmatically creates a **mod** and a **normal** user (per-run unique emails) and saves
   their browser sessions.
5. Seeds a few projects (incl. a long-name one) and writes everything to `.auth/seed.json`.

Browser sessions are saved under `e2e/.auth/` (git-ignored). Per-test data is created and
**torn down by fixtures** (`tmpProject`, `screeningProject`, `projectWithMembers`), so tests
never mutate shared seed data. `global-teardown.ts` re-enables onboarding.

Everything is created via the **real API** (fast + deterministic), never by driving the UI
for setup.

## 5. Architecture

```
e2e/
  fixtures/stitch-test.ts     # `test` (admin+Stitch), `anonTest`, + all fixtures
  helpers/
    env.ts                    # env resolution + local-only safety guard + state paths
    api.ts                    # typed API wrappers (relative paths → correct cookie origin)
    stitch.ts                 # Stitch design-mode activation + assertions
    sessions.ts               # capture authenticated browser storageStates
    axe.ts                    # @axe-core/playwright wrapper (serious/critical gate)
  page-objects/
    ShellNav.ts               # SHARED chrome/nav (rail, account menu, stepper, modals…)
    AuthPage / DashboardPage / ProjectOverviewPage / OpsPage / ScreeningPage /
    RobPage / SearchPage / WaitlistPage
  global-setup.ts / global-teardown.ts
  <area>/<area>.spec.ts       # auth, dashboard, projects, ops, permissions, branding,
                              # api, responsive, a11y, screening, rob, extraction,
                              # meta-analysis, search, waitlist, invites, files, visual
  smoke/smoke.spec.ts         # cross-browser sanity (@smoke)
```

### Fixtures (import from `fixtures/stitch-test`)
- `test` — `page`/`request` are the seeded **admin**, already in Stitch.
- `anonTest` — logged-out (empty storageState) for landing/login/register/waitlist-public.
- `seed` — the whole `.auth/seed.json`.
- `tmpProject`, `screeningProject` (project + workspace + ~8 records),
  `projectWithMembers.create([roles])` (collaborators + invite tokens) — all auto-cleaned.
- `setFlags(patch)` — set feature flags in-test; the snapshot is restored on teardown.
- `modContext`, `normalContext` — `{ page, request, context }` for the seeded mod / normal user.

### Stable selectors
Prefer, in order: `getByRole`/`getByLabel` → the **data-testid**s added to the Stitch shell,
rail, stepper, overlay primitives, and the Ops console (see `e2e/.discovery/FOUNDATION.md` for
the full list) → scoped text. Stitch components are inline-styled with no stable class names,
so testids are mandatory for chrome. **Do not** rely on generated styles or volatile text.

## 6. Conventions
- One `data-testid` per stable interactive element; kebab-case, semantic, never style-coupled.
- Web-first assertions (`await expect(locator).toBeVisible()`), `expect.poll`, `waitForURL`.
  **No fixed `waitForTimeout`** (no `networkidle` — the app holds a long-lived SSE).
- Every test asserts real behavior. A precondition that isn't reachable (a flag-gated engine
  that needs heavy seeding, a role whose UI session isn't available) is a **documented
  `test.skip(condition, 'TODO: …')`**, never a fake pass. The current skips are listed in
  `docs/testing/PLAYWRIGHT_COVERAGE_MATRIX.md`.
- `@smoke` tags the fast, cross-browser sanity tests.

## 7. Debugging
- `npm run test:e2e:ui` — best first stop (watch + DOM/network time-travel).
- Failures auto-capture **trace + screenshot + video** (config `retain-on-failure`).
  Open a trace: `npx playwright show-trace test-results/<…>/trace.zip`.
- `npm run test:e2e:debug` opens the inspector; add `await page.pause()` to step.

## 8. VS Code Playwright extension
Install **Playwright Test for VSCode** (`ms-playwright.playwright`). It auto-detects
`playwright.config.ts`; tests appear in the Test Explorer with run/debug gutter icons and
"Pick locator" / "Record at cursor" tools. The extension runs the same config, so the admin
session + seeding apply automatically.

## 9. Visual tests
`visual.spec.ts` snapshots a small set of stable surfaces (landing, app rail, dashboard,
project rail, Ops sidebar) with dynamic content **masked**. Baselines live in
`e2e/visual/visual.spec.ts-snapshots/` (committed, `*-chromium-win32.png`). Regenerate after an
intentional UI change:

```bash
npx playwright test e2e/visual --update-snapshots
```

Review the regenerated PNGs in the diff before committing.

## 10. Adding tests
1. Put the spec under `e2e/<area>/<area>.spec.ts`; reuse `ShellNav` + your area's page object.
2. Add a stable `data-testid` to the source element if (and only if) no role/label selector is
   stable — keep it semantic and don't change the UI.
3. Seed via fixtures/`helpers/api.ts`, not the UI. Tear down what you create.
4. Update `docs/testing/PLAYWRIGHT_COVERAGE_MATRIX.md`.
