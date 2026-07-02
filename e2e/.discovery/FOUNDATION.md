# PecanRev E2E — Foundation Contract (READ FIRST before authoring any spec)

This is the authoritative contract for the Playwright suite. Author specs ONLY against
what is documented here + the per-area selectors in `e2e/.discovery/maps.json`.

## Golden rules for authoring
1. **Do NOT edit application source in this pass.** Write ONLY new files under `e2e/`.
   Use the testids already added (below) + `getByRole`/`getByLabel`/`getByText` from your
   area map's `bestSelector`. If an element genuinely has NO stable selector and isn't
   covered by a testid, assert something adjacent that IS stable, or `test.skip(...)` with
   a clear `TODO:` reason. Never invent a testid that doesn't exist.
2. **Every test asserts real behavior.** No `expect(true).toBeTruthy()`. No screenshot-only
   "tests". If you can't meaningfully assert, `test.skip` with a reason.
3. **No fixed sleeps** (`waitForTimeout`) except as a last resort with a comment. Prefer
   web-first assertions (`await expect(locator).toBeVisible()`), `expect.poll`, and
   `waitForURL`. Do NOT wait for `networkidle` — the app holds a long-lived SSE connection.
4. **Determinism**: seed via the fixtures/helpers (fast API), not by driving the UI for setup.
   Use `tmpProject`/`screeningProject`/`projectWithMembers` so tests never touch shared seed
   data. Clean up is automatic in those fixtures.
5. Tag the fast, cross-browser sanity tests with `@smoke` in the title where apt.
6. Keep each `test()` focused and independently runnable. Group with `test.describe`.

## Design-mode facts (important)
- Two UIs share one app. Stitch is active when `html[data-ui-design="stitch"]`.
- The Ops `designSettings` default is `{ allowAllUsers: true, defaultMode: 'stitch' }`, so
  **every** user (even logged-out) renders Stitch by default. Admin-only Stitch is NOT the
  current default. To test "non-admin gets legacy", set `allowAllUsers:false` via the
  `setDesignSettings` helper within the spec's scope and restore it after.
- `?ui=legacy` query param forces legacy; `?ui=stitch` forces stitch.
- `/ops` is ALWAYS legacy (ForceLegacyDesign), even for an admin in Stitch.

## Importing the test object
```ts
import { test, expect, anonTest } from '<rel>/fixtures/stitch-test';
import { ShellNav } from '<rel>/page-objects/ShellNav';
import * as api from '<rel>/helpers/api';
```
- `test`  — page+request are the seeded ADMIN, already in Stitch. Use for authed specs.
- `anonTest` — logged-out (empty storageState). Use for landing/login/register/waitlist-public.
- NEVER call `test.use(...)`/`anonTest.use(...)` at the top level of a shared module — it
  leaks across test objects. In a SPEC file, `test.use({ viewport })` etc. is fine.

## Fixtures (from fixtures/stitch-test.ts)
- `page` / `request` — admin, Stitch-primed.
- `seed: SeedInfo` — `{ seedProjectId, longNameProjectId, extraProjectIds[], adminEmail,
   mod:{email,password}|null, normal:{email,password}|null, enabledFlags, baseURL, apiURL }`.
- `tmpProject: {id,name,linkedSiftId?}` — throwaway admin project, auto-deleted.
- `screeningProject: {project, siftId, recordCount}` — project + screening workspace + ~8 imported records.
- `projectWithMembers.create(roles: ('leader'|'reviewer'|'viewer')[])` →
   `{ project, siftId, members:[{email,preset,inviteToken,inviteLink}] }`. Auto-cleans.
- `setFlags(patch: Record<string,boolean>)` — set feature flags within a test; the prior
   snapshot is restored on teardown. (Engine flags are ALREADY on globally; use this only to
   turn something OFF to test gating, or to flip `betaWaitlist`.)
- `modContext` / `normalContext` — `{ page, request, context }` for the seeded mod / normal user.

## Helpers (from helpers/api.ts) — all paths relative, all work with the `request` fixture
- Auth: `login`, `register`, `me`, `logout`, `setDesignMode`.
- Projects: `createProject(request,name)`, `listProjects`, `deleteProject`.
- Public: `publicFlags(request)`, `publicSettings(request)`.
- Admin flags: `getFeatureFlags`, `setFeatureFlags(request,patch)`, `enableEngineFlags`, `ENGINE_FLAGS`.
- Design: `getDesignSettings(request) → {allowAllUsers,defaultMode}`, `setDesignSettings(request,patch)`.
- App settings: `getAppSettings`, `setAppSettings`. Roles: `updateUserRole(request,id,role)`.
- Onboarding: `setOnboardingEnabled(request,enabled)` (disabled globally; re-enabling needs
  the admin `request`). Onboarding is OFF during the run — do not assume the gate fires unless
  you turn it on in-scope.
- Screening: `ensureScreeningWorkspace(request,mainProjectId) → siftId`,
  `addProjectMember(request,siftId,{email,preset,modules})`,
  `importScreeningRecords(request,siftId,{format,content,filename,force})`, `makeRis(records)`,
  `aiScreeningEnabled(request,siftId)`.
- Invites: `getInvite(request,token)`, `acceptInvite(request,token)`.

## ShellNav page object (page-objects/ShellNav.ts) — shared chrome
`new ShellNav(page)` exposes: `appShell`, `mainContent`, `topHeader`, `primaryRail`,
`homeButton`, `contextRail`, `drawerToggle`, `globalNavItem('dashboard'|'activity'|'invitations'|'help')`,
`accountButton`, `accountMenu`, `accountMenuItem('profile'|'theme'|'ops-console'|'signout')`,
`openAccountMenu()`, `signOut()`, `projectRail`, `pinControl`, `backToProjects`,
`workflowStepper`, `projectCategory(id)`, `workflowStep(id)`, `stepperStep(key)`,
`modal`, `modalNamed(name)`, `modalTitle`, `modalClose`, `toast`, `toastWithTone(tone)`,
`goto(path)` (asserts Stitch), `expectStitch()`, `expectShell()`.

## Stable testids ALREADY in the app (use these; do not re-add)
### Shell / chrome (every authed Stitch page)
`stitch-app-shell`, `stitch-main-content`, `stitch-top-header`, `stitch-primary-rail`,
`stitch-home-button`, `stitch-global-nav-item-{dashboard|activity|invitations|help}`,
`stitch-profile-button`, `stitch-context-rail`, `stitch-context-rail-title`,
`stitch-drawer-toggle`, `stitch-account-button`, `stitch-account-menu`,
`stitch-account-menu-item-{profile|theme|ops-console|signout}`.
### Project workspace nav
`stitch-project-rail` (has `data-pinned`, `data-active-stage`), `stitch-pin-control`,
`stitch-back-to-projects`, `stitch-project-category-{id}`, `stitch-workflow-step-{id}`
(both have `data-status`), `stitch-workflow-stepper`, `stitch-stepper-step-{key}`
(has `data-status` + `data-disabled`).
### Overlays (primitives)
`stitch-modal` (has optional `data-modal="<name>"`), `stitch-modal-backdrop`,
`stitch-modal-title`, `stitch-modal-close`, `stitch-toast` (has `data-tone`).
### Ops console (AdminConsole, at /ops — legacy chrome, NOT Stitch)
Left nav: `nav-{overview|users|onboarding|projects|sift|rob|searchProviders|waitlist|content|settings|style|flags|messages|security|health|engineVersions}`.
Flags tab: `flag-toggle-{flagKey}`, `flags-save`. Messages: `messages-unread-badge`.
Appearance ('style') tab: `appearance-hex-input`, `appearance-save`, `design-allow-all-toggle`,
`design-default-mode` (select Legacy/Stitch), `design-settings-save`.
App settings tab: `settings-appname`, `settings-defaulttheme`, `settings-registration`, `settings-save`.
NOTE: the Toggle component renders a clickable `<div>` carrying the testid and has NO checked
attr — assert toggle state via a follow-up GET or a visual cue, not a DOM `checked`.

## Routes (from the router map — verify details in maps.json `router-shell`)
Public: `/` (landing; waitlist when betaWaitlist ON + unauth), `/beta-waitlist`, `/terms`,
`/privacy`→/terms#privacy, `/login`, `/register`, `/invite/:token`, `/reset`, `/verify-email`.
Authed: `/onboarding`, `/app` (dashboard; `?view=overview|mywork|activity|invitations|archived|resources`),
`/app/project/:id` (`?tab=overview|control|pico|prospero|search|screening|extraction|rob|analysis|forest|sensitivity|subgroup|nma|grade|manuscript|report|methods`,
`?screen=overview|import|duplicates|screening|conflicts|second-review|control|export`, `?ui=legacy|stitch`),
`/profile`, `/rob`, `/rob/:projectId`.
Admin (404-cloaked for non-staff): `/ops`, `/sift-beta`, `/sift-beta/projects/:pid`, `/sift-beta/projects/:pid/import`.

## Skip honestly
If a flag/seed/selector precondition isn't reliably available, write the test then
`test.skip(condition, 'TODO: <why>')` or `test.fixme`. A documented skip is acceptable; a
fake-passing test is not.
