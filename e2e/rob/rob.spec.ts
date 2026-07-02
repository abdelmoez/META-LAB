/**
 * rob.spec.ts — Risk of Bias (RoB 2) engine, with `rob_engine_v2` ON globally
 * (enabled once in global-setup). Covers what is robustly assertable today:
 *   · the flag is exposed ON, and the owner-scoped /api/rob/* service is live with
 *     the real RoB 2 domain model (the data behind the domain navigation);
 *   · opening `?tab=rob` renders the RoB engine surface inside the unified Stitch
 *     workspace (tool selector + RoB 2), and the empty/setup state when there are no
 *     studies (a fresh project has none — assessment requires a study);
 *   · RoB is a sub-step of the Extract category: the rail marks Extract active and the
 *     white submenu exposes `stitch-stepper-step-rob` (there is NO workflow-step-rob);
 *   · seeding a manual study via the engine API surfaces a study + "Assess a result";
 *   · permission gating — an authenticated NON-owner is 404'd (existence hidden);
 *   · the standalone `/rob/:projectId` route renders the same panel.
 *
 * Deep RobWorkspace flows (per-question answers → recomputed domain judgments →
 * override → finalise/reopen persistence) need a multi-step keyboard form with no
 * stable testids yet — documented test.skip below rather than a fragile guess.
 */
import { test, expect } from '../fixtures/stitch-test';
import { request as apiRequest } from '@playwright/test';
import { RobPage } from '../page-objects/RobPage';
import { publicFlags, register } from '../helpers/api';
import { API_URL, SEED_PASSWORD } from '../helpers/env';

test.describe('RoB — feature flag + engine API (rob_engine_v2 ON)', () => {
  test('@smoke public flags expose rob_engine_v2 = true', async ({ request }) => {
    const flags = await publicFlags(request);
    expect(flags).toHaveProperty('rob_engine_v2');
    expect(flags.rob_engine_v2).toBe(true);
  });

  test('the RoB 2 instrument endpoint returns the 5-domain model', async ({ request }) => {
    const { status, body } = await RobPage.getInstrument(request);
    expect(status).toBe(200);
    const instrument = body?.instrument || body;
    expect(instrument).toBeTruthy();
    expect(instrument.id).toBeTruthy();
    // RoB 2 has five bias domains, each with its own question set — this is the
    // model that drives the domain navigation + the per-domain judgment proposals.
    expect(Array.isArray(instrument.domains)).toBe(true);
    expect(instrument.domains.length).toBe(5);
    for (const d of instrument.domains) {
      expect(d.id).toBeTruthy();
      expect(Array.isArray(d.questions)).toBe(true);
      expect(d.questions.length).toBeGreaterThan(0);
    }
  });

  test('owner assessments + studies endpoints return their shapes for a fresh project', async ({ request, tmpProject }) => {
    const asmt = await RobPage.getAssessments(request, tmpProject.id);
    expect(asmt.status).toBe(200);
    expect(Array.isArray(asmt.body.assessments)).toBe(true);
    expect(asmt.body.assessments).toHaveLength(0); // brand-new project → none yet
    expect(asmt.body).toHaveProperty('matrix'); // robvis summary matrix is always present

    const studies = await RobPage.getStudies(request, tmpProject.id);
    expect(studies.status).toBe(200);
    expect(Array.isArray(studies.body.studies)).toBe(true);
    expect(studies.body.studies).toHaveLength(0);
  });

  test('an authenticated non-owner is 404’d on the owner-scoped RoB endpoint (existence hidden)', async ({ seed }) => {
    test.skip(!seed.seedProjectId, 'no admin-owned seed project to probe non-owner access against');
    // A fresh, isolated user that is NOT a member of the admin's project. The RoB
    // service hides existence (404) from anyone without owner / canAssessRiskOfBias —
    // the API-level proof of the permission gate (no UI seeding of read-only members
    // is available via the current fixtures).
    const ctx = await apiRequest.newContext({ baseURL: API_URL, storageState: { cookies: [], origins: [] } });
    try {
      await register(ctx, {
        email: `e2e-rob-nonowner-${Date.now()}-${Math.floor(Math.random() * 1e4)}@pecanrev.test`,
        password: SEED_PASSWORD,
        name: 'E2E RoB NonOwner',
      });
      // Sanity: the new user IS authenticated — the global instrument is visible to them.
      const instrument = await ctx.get('/api/rob/instruments/rob2');
      expect(instrument.status()).toBe(200);
      // …but the owner-scoped project endpoint is cloaked as 404.
      const res = await ctx.get(`/api/rob/projects/${encodeURIComponent(seed.seedProjectId)}/assessments`);
      expect(res.status()).toBe(404);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe('RoB — workspace tab (?tab=rob) in the Stitch shell', () => {
  test('@smoke opening ?tab=rob renders the RoB engine surface', async ({ page, tmpProject }) => {
    const rob = new RobPage(page);
    await rob.gotoTab(tmpProject.id); // asserts Stitch
    await rob.nav.expectShell();
    await rob.expectEngineSurface();
    await expect(rob.onlyRob2Note).toBeVisible();
    await expect(rob.sectionHeaderDesc).toBeVisible();
  });

  test('a project with no studies shows the empty/setup state', async ({ page, tmpProject }) => {
    const rob = new RobPage(page);
    await rob.gotoTab(tmpProject.id);
    await expect(rob.emptyStudiesNotice).toBeVisible();
    // The owner can add a study directly here (assessment requires a study/outcome).
    await expect(rob.addManualStudyButton).toBeVisible();
  });

  test('RoB is the Extract category’s sub-step (rail step Extract active; submenu step rob present)', async ({ page, tmpProject }) => {
    const rob = new RobPage(page);
    await rob.gotoTab(tmpProject.id);

    // The project rail tracks the active stage on its root.
    await expect(rob.nav.projectRail).toHaveAttribute('data-active-stage', 'rob');

    // RoB rolls up into the Extract workflow category — that rail step is the active one.
    await expect(rob.extractCategoryStep).toBeVisible();
    await expect(rob.extractCategoryStep).toHaveAttribute('aria-current', 'step');

    // There is NO top-level workflow step for RoB itself (it is a sub-step).
    await expect(page.getByTestId('stitch-workflow-step-rob')).toHaveCount(0);

    // The white submenu (Extract category) exposes the RoB step + its Extraction sibling.
    await expect(rob.contextRailTitle).toContainText('Extract');
    await expect(rob.robSubStep).toBeVisible();
    await expect(rob.robSubStep).toHaveAttribute('aria-current', 'step'); // route-derived active step
    await expect(rob.extractionSubStep).toBeVisible();
  });

  test('seeding a manual study via the engine API surfaces a study + "Assess a result"', async ({ page, request, tmpProject }) => {
    const author = `E2E RoB Author ${Date.now()}`;
    const seeded = await RobPage.createManualStudy(request, tmpProject.id, {
      title: 'E2E manual study on intervention efficacy',
      authors: author,
      year: '2021',
    });
    expect(seeded.status).toBe(201);
    expect(seeded.body.study?.source).toBe('manual');

    const rob = new RobPage(page);
    await rob.gotoTab(tmpProject.id);

    // The merged study universe now lists the manual study — empty state is gone.
    await expect(page.getByText(author)).toBeVisible();
    await expect(rob.assessResultButton).toBeVisible();
    await expect(rob.emptyStudiesNotice).toHaveCount(0);
  });
});

test.describe('RoB — standalone /rob/:projectId route', () => {
  test('the standalone RoB page renders the assessment panel', async ({ page, tmpProject }) => {
    const rob = new RobPage(page);
    await rob.gotoStandalone(tmpProject.id); // legacy Frame — not the Stitch shell
    // Its own header badge + the shared ProjectRobPanel tool selector confirm it mounted.
    await expect(rob.standaloneBetaBadge).toBeVisible();
    await rob.expectEngineSurface();
  });
});

test.describe('RoB — deep assessment flows (documented gaps)', () => {
  test('domain-judgment override + finalise/reopen persistence', async () => {
    test.skip(
      true,
      'TODO: needs the multi-step keyboard-first RobWorkspace (open an assessment → answer ' +
      'all domain questions → override a proposed judgment → finalise → reopen → assert ' +
      'persisted answers/overrides). The form exposes no stable testids this pass, so a ' +
      'reliable selector path is unavailable. Author once RobWorkspace has testids.',
    );
  });

  test('read-only member (canAssessRiskOfBias without canEdit) sees "View only" UI', async () => {
    test.skip(
      true,
      'TODO: requires a REGISTERED, logged-in project member granted RoB read-only access. ' +
      'Current fixtures invite members by email (unregistered, no password) and the seeded ' +
      'mod/normal users are not members of a test project, so there is no reliable way to ' +
      'drive the member session. The API-level gate is already covered by the non-owner 404 test.',
    );
  });
});
