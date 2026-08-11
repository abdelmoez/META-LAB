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
    // 115.md — the tool card no longer claims that RoB 2 is the only instrument
    // available; it states how many the registry actually carries.
    await expect(rob.toolAvailabilityNote).toBeVisible();
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

/* ══════════════════════════════════════════════════════════════════════════════
 * 115.md §34 — the PER-TOOL assessment loop.
 *
 * "Do not consider this complete after the dropdown shows 15 names." Each test
 * below drives one instrument through the real workflow: pick it in the redesigned
 * Assess selector (recommended path AND search path), answer every item, record the
 * judgements the instrument actually defines, prove the 450 ms autosave persisted by
 * reloading, finalise, check the judgements are the ones the tool's own rules
 * produce, then edit an answer and watch the derived result change.
 *
 * Three instruments are covered here because they exercise the three structures the
 * definition-driven renderer added: QUADAS-2 (dual axis + no overall), a JBI
 * checklist (flat items + a reviewer appraisal decision, no score) and AMSTAR 2
 * (critical domains + a computed confidence rating). RoB 2 / ROBINS-I / NOS keep
 * their existing coverage above and in the integration suite.
 * ══════════════════════════════════════════════════════════════════════════════ */

/** The answerable item ids of each instrument, in the order the form prints them. */
const QUADAS2_ITEMS: Record<string, string[]> = {
  D1: ['1.1', '1.2', '1.3'],
  D2: ['2.1', '2.2'],
  D3: ['3.1', '3.2'],
  D4: ['4.1', '4.2', '4.3', '4.4'],
};
const JBI_CASE_SERIES_ITEMS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const AMSTAR2_ITEMS = Array.from({ length: 16 }, (_, i) => String(i + 1));

/** The single assessment the project owns (these tests create exactly one). */
async function onlyAssessment(request: any, projectId: string): Promise<any> {
  const list = await RobPage.getAssessments(request, projectId);
  expect(list.status).toBe(200);
  expect(list.body.assessments.length).toBe(1);
  return list.body.assessments[0];
}

test.describe('RoB — §34 per-tool assessment loop (115.md)', () => {
  test('@smoke the instrument catalogue is registry-driven and carries every implemented tool', async ({ request }) => {
    const { status, body } = await RobPage.getInstruments(request);
    expect(status).toBe(200);
    const ids = (body.instruments || []).map((i: any) => i.id);
    // The exact regression 115.md exists to fix: Assess used to offer two tools.
    expect(ids).toEqual(expect.arrayContaining([
      'RoB2', 'ROBINS-I', 'NOS', 'NOS-CC', 'QUADAS-2', 'AMSTAR-2',
      'JBI-CaseSeries', 'JBI-CaseReport', 'JBI-Prevalence', 'JBI-CrossSectional', 'JBI-Qualitative',
      'QUIPS', 'PROBAST',
    ]));
    for (const inst of body.instruments) {
      // §32 — every tool states which edition it is and which designs it covers.
      expect(inst.instrumentVersion, `${inst.id} has no version`).toBeTruthy();
      expect(inst.designs.length, `${inst.id} declares no study design`).toBeGreaterThan(0);
    }
    // ALL THIRTEEN carry their provenance ON THE DEFINITION, so the server's
    // catalogue rows arrive complete and the client merges nothing back in — the
    // §32 About panel reads one source of truth (the four pre-115 definitions used
    // to need a client-side merge from the tools catalogue; they no longer do).
    for (const inst of body.instruments) {
      expect(inst.organization, `${inst.id} has no organisation`).toBeTruthy();
      expect(inst.citation, `${inst.id} has no citation`).toBeTruthy();
      expect(inst.guidanceUrl, `${inst.id} has no guidance URL`).toBeTruthy();
      expect(inst.license, `${inst.id} has no licence note`).toBeTruthy();
    }
    // 115.md decision 5 — only the Newcastle–Ottawa forms may present a score.
    const scoring = body.instruments.filter((i: any) => i.scoringAllowed).map((i: any) => i.id);
    expect(scoring.sort()).toEqual(['NOS', 'NOS-CC']);
  });

  test('QUADAS-2 — recommended path, dual axis, autosave, finalise, edit', async ({ page, request, tmpProject }) => {
    await RobPage.setProjectDesign(request, tmpProject.id, 'diagnostic test accuracy study');
    const seeded = await RobPage.createManualStudy(request, tmpProject.id, {
      title: 'E2E diagnostic accuracy study', authors: 'Whiting et al.', year: '2022',
    });
    expect(seeded.status).toBe(201);

    const rob = new RobPage(page);
    await rob.gotoTab(tmpProject.id);
    await rob.openAssessSelector();

    // §6/§37 — the RECOMMENDED path: the study's recorded design surfaces QUADAS-2.
    await expect(rob.recommendedTools).toBeVisible();
    await expect(rob.toolCard('QUADAS-2')).toBeVisible();
    await rob.toolCard('QUADAS-2').click();
    await expect(rob.mismatchWarning).toHaveCount(0); // the right tool → no caution
    await rob.startAssessment.click();

    // The definition-driven pane opened on QUADAS-2, and says out loud that the
    // instrument prescribes NO overall judgement (§10 — never invent one).
    await expect(rob.instrumentPanel).toHaveAttribute('data-instrument', 'QUADAS-2');
    await expect(rob.noOverallNotice).toBeVisible();

    // Answer every signalling question, domain by domain (§34 steps 4-5).
    for (const [domainId, items] of Object.entries(QUADAS2_ITEMS)) {
      await rob.domainNav(domainId).click();
      await rob.answerAll(items, 'Y');
    }
    await expect(rob.panelProgress).toHaveText('11/11 answered');

    // §14 — the applicability axis is a SEPARATE judgement on the first three
    // domains, recorded by the reviewer. D4 (Flow and Timing) has none.
    for (const domainId of ['D1', 'D2', 'D3']) {
      await rob.domainNav(domainId).click();
      await expect(rob.applicabilityAxis(domainId)).toBeVisible();
      await rob.recordJudgment(`rob-axis-applicability-${domainId}`, 'low', 'Matches the review question');
    }
    await rob.domainNav('D4').click();
    await expect(rob.applicabilityAxis('D4')).toHaveCount(0);

    // §34 steps 6-8 — the 450 ms autosave persisted; a reload finds the same state.
    const created = await onlyAssessment(request, tmpProject.id);
    expect(created.instrumentId).toBe('QUADAS-2');
    await expect.poll(async () => {
      const { body } = await RobPage.getAssessment(request, created.id);
      const answered = Object.values(body.assessment.answersByDomain as Record<string, any>)
        .reduce((n: number, d: any) => n + Object.keys(d).length, 0);
      return answered;
    }, { timeout: 15_000 }).toBe(11);

    await page.reload();
    await rob.page.getByRole('button', { name: /^open$/i }).first().click();
    await expect(rob.instrumentPanel).toBeVisible();
    await expect(rob.panelProgress).toHaveText('11/11 answered');
    await expect(rob.applicabilityAxis('D1')).toContainText('Low concern');

    // §34 steps 9-11 — finalise, then check the judgements are QUADAS-2's own:
    // all-Yes signalling questions → LOW risk of bias, per domain, and no overall.
    await rob.finaliseButton.click();
    await expect(rob.reopenButton).toBeVisible();
    const done = await RobPage.getAssessment(request, created.id);
    expect(done.body.assessment.status).toBe('complete');
    for (const d of done.body.assessment.domains) expect(d.resolvedJudgment).toBe('low');
    expect(done.body.assessment.applicability.map((a: any) => a.judgment)).toEqual(['low', 'low', 'low']);
    expect(done.body.assessment.overallLevels).toBeNull(); // QUADAS-2 has no overall

    // §34 steps 12-13 — edit an answer and watch the derived result change. A "No"
    // flags the potential for bias and QUADAS-2 refuses to propose a judgement.
    await rob.reopenButton.click();
    await rob.domainNav('D1').click();
    await rob.response('1.1', 'N').click();
    await expect(rob.robAxis('D1')).toContainText('proposes no judgement here');
    await expect.poll(async () => {
      const { body } = await RobPage.getAssessment(request, created.id);
      return body.assessment.domains.find((d: any) => d.domainId === 'D1').proposedJudgment;
    }, { timeout: 15_000 }).toBe('');
  });

  test('JBI Case Series — checklist responses + a reviewer appraisal decision, no score', async ({ page, request, tmpProject }) => {
    await RobPage.setProjectDesign(request, tmpProject.id, 'case series');
    await RobPage.createManualStudy(request, tmpProject.id, { title: 'E2E case series', authors: 'Munn et al.', year: '2021' });

    const rob = new RobPage(page);
    await rob.gotoTab(tmpProject.id);
    await rob.openAssessSelector();
    await expect(rob.recommendedTools).toBeVisible();
    await rob.toolCard('JBI-CaseSeries').click();
    await rob.startAssessment.click();
    await expect(rob.instrumentPanel).toHaveAttribute('data-instrument', 'JBI-CaseSeries');

    // Yes / No / Unclear / Not applicable — the checklist's own vocabulary.
    await expect(rob.response('1', 'NA')).toBeVisible();
    await rob.answerAll(JBI_CASE_SERIES_ITEMS, 'Y');
    await rob.response('4', 'NA').click(); // "Not applicable" is a real JBI answer
    await expect(rob.panelProgress).toHaveText('10/10 answered');

    // §21 — every item answered is NOT complete: the appraisal decision is the
    // instrument's own conclusion and no algorithm produces it.
    await expect(rob.finaliseButton).toBeDisabled();
    await expect(rob.overallAxis).toContainText('proposes no judgement here');
    await rob.recordJudgment('rob-axis-overall', 'include', 'Meets the review protocol');
    await expect(rob.overallAxis).toContainText('Include');
    await expect(rob.finaliseButton).toBeEnabled();

    const created = await onlyAssessment(request, tmpProject.id);
    await page.reload();
    await rob.page.getByRole('button', { name: /^open$/i }).first().click();
    await expect(rob.panelProgress).toHaveText('10/10 answered');

    await rob.finaliseButton.click();
    await expect(rob.reopenButton).toBeVisible();
    const done = await RobPage.getAssessment(request, created.id);
    expect(done.body.assessment.status).toBe('complete');
    expect(done.body.assessment.overall.resolvedOverall).toBe('include');
    // 115.md decision 5 — a JBI checklist defines no score, and the API says so.
    expect(done.body.assessment.scoringAllowed).toBe(false);
    expect(done.body.assessment.score).toBeNull();
    expect(done.body.assessment.overallLevels).toEqual(['include', 'exclude', 'seek-further-info']);
  });

  test('AMSTAR 2 — search path + mismatch continue, critical domains, confidence rating', async ({ page, request, tmpProject }) => {
    // Deliberately the WRONG recorded design for AMSTAR 2, so the §38 caution fires
    // and the reviewer has to continue explicitly.
    await RobPage.setProjectDesign(request, tmpProject.id, 'case series');
    await RobPage.createManualStudy(request, tmpProject.id, { title: 'E2E umbrella review', authors: 'Shea et al.', year: '2019' });

    const rob = new RobPage(page);
    await rob.gotoTab(tmpProject.id);
    await rob.openAssessSelector();

    // §8 — the SEARCH path: open the full list, search, pick.
    await rob.showAllTools.click();
    await rob.toolSearch.fill('AMSTAR');
    await expect(rob.toolCard('AMSTAR-2')).toBeVisible();
    await expect(rob.toolCard('QUADAS-2')).toHaveCount(0); // the filter really filters
    await rob.toolCard('AMSTAR-2').click();

    // §38 — warn, never block; continue is explicit.
    await expect(rob.mismatchWarning).toBeVisible();
    await expect(rob.mismatchWarning).toContainText('case series');
    await expect(rob.startAssessment).toBeDisabled();
    await rob.mismatchContinue.click();
    await expect(rob.startAssessment).toBeEnabled();
    await rob.startAssessment.click();

    await expect(rob.instrumentPanel).toHaveAttribute('data-instrument', 'AMSTAR-2');
    // §15 — the seven critical domains are marked, and Partial Yes exists only
    // where the instrument defines it.
    await expect(page.getByText('Critical domain', { exact: true })).toHaveCount(7);
    await expect(rob.response('2', 'PARTIAL_YES')).toBeVisible();
    await expect(rob.response('1', 'PARTIAL_YES')).toHaveCount(0);

    await rob.answerAll(AMSTAR2_ITEMS, 'Y');
    await expect(rob.panelProgress).toHaveText('16/16 answered');
    // No critical flaws, no non-critical weaknesses → HIGH confidence. Note the
    // polarity: on AMSTAR 2 "High" is the BEST result, not the worst.
    await expect(rob.overallAxis).toContainText('High confidence');

    const created = await onlyAssessment(request, tmpProject.id);
    await expect.poll(async () => {
      const { body } = await RobPage.getAssessment(request, created.id);
      return Object.keys(body.assessment.answersByDomain.items || {}).length;
    }, { timeout: 15_000 }).toBe(16);

    await page.reload();
    await rob.page.getByRole('button', { name: /^open$/i }).first().click();
    await expect(rob.panelProgress).toHaveText('16/16 answered');
    await expect(rob.overallAxis).toContainText('High confidence');

    // Edit a CRITICAL item → exactly one critical flaw → Low confidence (Shea 2017).
    await rob.response('2', 'N').click();
    await expect(rob.overallAxis).toContainText('Low confidence');
    await expect(rob.overallAxis).toContainText('Exactly one critical flaw');
    // The weakness counts are shown as counts of flaws — explicitly not a score.
    await expect(page.getByText(/counts of weaknesses, not a score/)).toBeVisible();

    await rob.finaliseButton.click();
    await expect(rob.reopenButton).toBeVisible();
    const done = await RobPage.getAssessment(request, created.id);
    expect(done.body.assessment.status).toBe('complete');
    expect(done.body.assessment.scoringAllowed).toBe(false);
    expect(done.body.assessment.overallLevels).toEqual(['high', 'moderate', 'low', 'critically-low']);
  });
});

test.describe('RoB — deep assessment flows (documented gaps)', () => {
  test('domain-judgment override + finalise/reopen persistence', async () => {
    test.skip(
      true,
      'TODO: needs the multi-step keyboard-first RobWorkspace (open an assessment → answer ' +
      'all domain questions → override a proposed judgment → finalise → reopen → assert ' +
      'persisted answers/overrides). The RoB 2 / ROBINS-I domain walk still exposes no stable ' +
      'testids, so a reliable selector path is unavailable there. The equivalent loop IS now ' +
      'covered end-to-end for the definition-driven instruments (QUADAS-2, JBI, AMSTAR 2) above, ' +
      'whose renderer carries testids. Author once the domain walk has them too.',
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
