/**
 * robReviewers.spec.ts — the dual-reviewer / consensus workflow and the
 * project-wide RoB export (115.md decision 10 + §27; dossier §6, §9).
 *
 * Two layers:
 *
 *  1. THE WORKFLOW ITSELF, driven through the real /api/rob service with TWO
 *     genuinely different logged-in users (the admin owner + the seeded `normal`
 *     user, added to the project's linked review workspace as a leader so they
 *     hold the RoB grant). This is the part that proves the science: two people
 *     assess the same study independently, their disagreement is detectable, and
 *     reconciling them ADDS a third record rather than overwriting either one.
 *     The second-user pattern is the one screening.spec.ts uses (`normalContext`
 *     + `addProjectMember`).
 *
 *  2. THE UI, which needs ReviewerComparisonPanel / RobSummaryOutputs /
 *     RobExportButton to be MOUNTED into ProjectRobPanel first (the mount points
 *     are specified in scratchpad/115-w2b-mountspec.md; W2-A owns that file and
 *     is rewriting it concurrently). Those specs are written out in full and
 *     marked `test.skip` with the exact unskip condition — a fixed TODO, not a
 *     guess at selectors that do not exist yet.
 */
import { test, expect } from '../fixtures/stitch-test';
import type { APIRequestContext } from '@playwright/test';
import { RobPage } from '../page-objects/RobPage';
import * as api from '../helpers/api';

/* ── helpers ─────────────────────────────────────────────────────────────────── */

/** Every RoB 2 signalling-question id, from the live instrument definition. */
async function rob2QuestionIds(request: APIRequestContext): Promise<string[]> {
  const { body } = await RobPage.getInstrument(request);
  const instrument = body?.instrument || body;
  return (instrument.domains as Array<{ questions: Array<{ id: string }> }>)
    .flatMap(d => d.questions.map(q => q.id));
}

/** Create → answer every question → finalise, as one reviewer. Returns the row id. */
async function assessAsReviewer(
  request: APIRequestContext,
  { projectId, studyId, questionIds, dissentOn, dissentResponse = 'N' }:
  { projectId: string; studyId: string; questionIds: string[]; dissentOn?: string; dissentResponse?: string },
): Promise<string> {
  const created = await request.post('/api/rob/assessments', {
    data: { projectId, studyId, instrumentId: 'RoB2', resultLabel: 'Primary outcome' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).assessment.id as string;

  const answers = questionIds.map(qid => ({
    questionId: qid,
    response: qid === dissentOn ? dissentResponse : 'Y',
  }));
  const saved = await request.put(`/api/rob/assessments/${id}/answers`, { data: { answers } });
  expect(saved.status(), await saved.text()).toBe(200);

  const done = await request.post(`/api/rob/assessments/${id}/finalise`);
  expect(done.status(), await done.text()).toBe(200);
  return id;
}

/** Add the seeded `normal` user to the project's linked workspace with RoB rights. */
async function addSecondReviewer(adminRequest: APIRequestContext, secondRequest: APIRequestContext, projectId: string) {
  const who = await api.me(secondRequest);
  expect(who?.email, 'the seeded normal user must be resolvable').toBeTruthy();
  const siftId = await api.ensureScreeningWorkspace(adminRequest, projectId);
  // 'leader' carries full META·LAB + RoB access (server/screening/metalabAccess.js:
  // owner/leader are `full`), which is what an independent second assessor needs.
  await api.addProjectMember(adminRequest, siftId, { email: who!.email, preset: 'leader' });
  return who!;
}

/* ── 1. the workflow (runs today, no UI needed) ──────────────────────────────── */

test.describe('RoB — two independent reviewers, conflict, consensus', () => {
  test('a consensus record reconciles both reviewers and overwrites neither', async ({ request, tmpProject, normalContext }) => {
    const projectId = tmpProject.id;
    const second = await addSecondReviewer(request, normalContext.request, projectId);

    const seeded = await RobPage.createManualStudy(request, projectId, {
      title: 'E2E dual-reviewer study on intervention efficacy',
      authors: 'Reviewer Test, A',
      year: '2022',
    });
    expect(seeded.status).toBe(201);
    const studyId = seeded.body.study.id as string;

    const questionIds = await rob2QuestionIds(request);
    expect(questionIds.length).toBeGreaterThan(10);
    const dissentOn = questionIds.find(q => q.startsWith('2.')) || questionIds[1];

    // Reviewer A (owner) and reviewer B (the added leader) assess independently.
    const idA = await assessAsReviewer(request, { projectId, studyId, questionIds });
    const idB = await assessAsReviewer(normalContext.request, {
      projectId, studyId, questionIds, dissentOn, dissentResponse: 'N',
    });
    expect(idB).not.toBe(idA);

    // Both rows exist side by side; neither is a consensus row yet.
    const listed = await RobPage.getAssessments(request, projectId);
    const forStudy = (listed.body.assessments as Array<any>).filter(a => a.studyId === studyId);
    expect(forStudy).toHaveLength(2);
    expect(forStudy.every(a => a.status === 'complete')).toBe(true);
    expect(new Set(forStudy.map(a => a.reviewerId)).size).toBe(2);

    // The comparison surfaces the item they answered differently.
    const cmp = await request.get(
      `/api/rob/projects/${projectId}/studies/${studyId}/reviewers?instrumentId=RoB2`,
    );
    expect(cmp.status()).toBe(200);
    const comparison = await cmp.json();
    expect(comparison.reviewers).toHaveLength(2);
    expect(comparison.consensus).toBeNull();
    const conflict = (comparison.disagreements as Array<any>).find(d => d.questionId === dissentOn);
    expect(conflict, `expected a recorded disagreement on ${dissentOn}`).toBeTruthy();
    expect(Object.values(conflict.values).sort()).toEqual(['N', 'Y']);
    expect(comparison.agreement.comparedQuestions).toBeGreaterThan(0);
    expect(comparison.agreement.disagreedQuestions).toBe(comparison.disagreements.length);

    // Snapshot both originals BEFORE reconciling. (`GET /assessments/:id` wraps the
    // view as `{ assessment, instrument }` — unwrap it, or every field below reads
    // `undefined` and the comparison passes vacuously.)
    const viewOf = async (ctx: APIRequestContext, id: string) => {
      const res = await ctx.get(`/api/rob/assessments/${id}`);
      expect(res.status()).toBe(200);
      const { assessment } = await res.json();
      expect(assessment?.answersByDomain, 'the view must carry its answers').toBeTruthy();
      return assessment;
    };
    const beforeA = await viewOf(request, idA);
    const beforeB = await viewOf(normalContext.request, idB);
    expect(Object.keys(beforeA.answersByDomain).length).toBeGreaterThan(0);

    // Consensus: a THIRD row, seeded from reviewer A.
    const madeRes = await request.post(
      `/api/rob/projects/${projectId}/studies/${studyId}/consensus`,
      { data: { instrumentId: 'RoB2', seedFromAssessmentId: idA } },
    );
    expect(madeRes.status(), await madeRes.text()).toBe(201);
    const made = await madeRes.json();
    expect(made.assessment.status).toBe('consensus');
    expect(made.assessment.id).not.toBe(idA);
    expect(made.assessment.id).not.toBe(idB);
    expect(made.seededFrom.assessmentId).toBe(idA);
    expect(made.seededFrom.answerCount).toBe(questionIds.length);

    // NEITHER original changed — same status, same answers, same overall.
    const afterA = await viewOf(request, idA);
    const afterB = await viewOf(normalContext.request, idB);
    expect(afterA.status).toBe(beforeA.status);
    expect(afterB.status).toBe(beforeB.status);
    expect(afterA.answersByDomain).toEqual(beforeA.answersByDomain);
    expect(afterB.answersByDomain).toEqual(beforeB.answersByDomain);
    expect(afterA.overall.resolvedOverall).toBe(beforeA.overall.resolvedOverall);
    expect(afterB.overall.resolvedOverall).toBe(beforeB.overall.resolvedOverall);
    // The seeded copy is an independent row, not a pointer at A.
    expect(afterA.id).not.toBe(made.assessment.id);

    // The comparison now reports the consensus alongside the two originals.
    const cmp2 = await (await request.get(
      `/api/rob/projects/${projectId}/studies/${studyId}/reviewers?instrumentId=RoB2`,
    )).json();
    expect(cmp2.reviewers).toHaveLength(2);
    expect(cmp2.consensus?.assessmentId).toBe(made.assessment.id);

    // A second consensus is refused — the record can only be reconciled once.
    const again = await request.post(
      `/api/rob/projects/${projectId}/studies/${studyId}/consensus`,
      { data: { instrumentId: 'RoB2' } },
    );
    expect(again.status()).toBe(409);

    // Sanity: the second reviewer really was a different user.
    expect(second.email).not.toBe((await api.me(request))?.email);
  });

  test('consensus is refused when only one reviewer has assessed the study', async ({ request, tmpProject }) => {
    const projectId = tmpProject.id;
    const seeded = await RobPage.createManualStudy(request, projectId, {
      title: 'E2E single-reviewer study', authors: 'Solo, S', year: '2021',
    });
    const studyId = seeded.body.study.id as string;
    const questionIds = await rob2QuestionIds(request);
    await assessAsReviewer(request, { projectId, studyId, questionIds });

    const res = await request.post(
      `/api/rob/projects/${projectId}/studies/${studyId}/consensus`,
      { data: { instrumentId: 'RoB2' } },
    );
    // A "consensus" with nothing to reconcile would be a fabricated claim.
    expect(res.status()).toBe(409);
    expect((await res.json()).reviewerCount).toBe(1);
  });
});

/* ── 2. the project-wide export ──────────────────────────────────────────────── */

test.describe('RoB — project-wide export', () => {
  test('the export returns one CSV, sectioned by tool, covering every row', async ({ request, tmpProject, normalContext }) => {
    const projectId = tmpProject.id;
    await addSecondReviewer(request, normalContext.request, projectId);
    const seeded = await RobPage.createManualStudy(request, projectId, {
      title: 'E2E export study on intervention efficacy', authors: 'Export, E', year: '2020',
    });
    const studyId = seeded.body.study.id as string;
    const questionIds = await rob2QuestionIds(request);
    const idA = await assessAsReviewer(request, { projectId, studyId, questionIds });
    await assessAsReviewer(normalContext.request, { projectId, studyId, questionIds, dissentOn: questionIds[0], dissentResponse: 'N' });
    await request.post(`/api/rob/projects/${projectId}/studies/${studyId}/consensus`, {
      data: { instrumentId: 'RoB2', seedFromAssessmentId: idA },
    });

    const res = await request.get(`/api/rob/projects/${projectId}/assessments/export?format=csv`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();

    // The client turns exactly this into a download (RobExportButton).
    expect(body.format).toBe('csv');
    expect(body.mime).toBe('text/csv');
    expect(body.filename).toContain(projectId);
    expect(typeof body.content).toBe('string');
    expect(body.content.length).toBeGreaterThan(0);

    // One SECTION per tool, and every row of this project is in it.
    expect(body.summary).toEqual([{ instrumentId: 'RoB2', instrumentLabel: 'RoB 2', count: 3 }]);
    expect(body.content).toContain('RoB 2');
    expect(body.content).toContain('consensus');
    expect(body.content.split('\n').length).toBeGreaterThan(3);
  });

  test('an unsupported export format is refused before anything is charged', async ({ request, tmpProject }) => {
    const res = await request.get(`/api/rob/projects/${tmpProject.id}/assessments/export?format=pdf`);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('csv');
  });
});

/* ── 3. the UI (unskip after mounting — see 115-w2b-mountspec.md) ────────────── */

const MOUNT_TODO =
  'TODO(115 W2-B): unskip once ProjectRobPanel mounts ReviewerComparisonPanel at the '
  + '"reviewer comparison" seam (inside ArticleCard, under the per-study assessment list) and '
  + 'RobSummaryOutputs + RobExportButton at the "summary outputs" seam (the project-level area '
  + 'that currently renders the single RobTrafficLight card). Exact imports/JSX are in '
  + 'scratchpad/115-w2b-mountspec.md. Until then the components are covered by '
  + 'tests/unit/robReviewerComparison.test.jsx + tests/unit/robSummaryOutputs.test.jsx.';

test.describe('RoB — dual-reviewer + outputs UI', () => {
  test('the comparison stays hidden until both reviewers finish, then shows the conflict', async ({ request, tmpProject, normalContext, page }) => {
    const projectId = tmpProject.id;
    await addSecondReviewer(request, normalContext.request, projectId);
    const seeded = await RobPage.createManualStudy(request, projectId, {
      title: 'E2E UI dual-reviewer study', authors: 'Blind, B', year: '2022',
    });
    const studyId = seeded.body.study.id as string;
    const questionIds = await rob2QuestionIds(request);

    // Reviewer A finishes; reviewer B starts but does NOT finish.
    await assessAsReviewer(request, { projectId, studyId, questionIds });
    const createdB = await normalContext.request.post('/api/rob/assessments', {
      data: { projectId, studyId, instrumentId: 'RoB2', resultLabel: 'Primary outcome' },
    });
    const idB = (await createdB.json()).assessment.id as string;
    await normalContext.request.put(`/api/rob/assessments/${idB}/answers`, {
      data: { answers: [{ questionId: questionIds[0], response: 'N' }] },
    });

    const rob = new RobPage(page);
    await rob.gotoTab(projectId);
    await expect(page.getByText(/Comparison hidden/i)).toBeVisible();
    await expect(page.getByText(/1 of 2 finished/i)).toBeVisible();
    await expect(page.getByText(/conflict/i)).toHaveCount(0);

    // B finishes → the comparison unlocks and names the conflict.
    await normalContext.request.put(`/api/rob/assessments/${idB}/answers`, {
      data: { answers: questionIds.map(q => ({ questionId: q, response: q === questionIds[0] ? 'N' : 'Y' })) },
    });
    await normalContext.request.post(`/api/rob/assessments/${idB}/finalise`);
    await page.reload();
    await expect(page.getByText(/Comparison hidden/i)).toHaveCount(0);
    await expect(page.getByText(/difference/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /create consensus record/i })).toBeVisible();
  });

  test('creating consensus from the panel keeps both originals on screen', async ({ request, tmpProject, normalContext, page }) => {
    const projectId = tmpProject.id;
    await addSecondReviewer(request, normalContext.request, projectId);
    const seeded = await RobPage.createManualStudy(request, projectId, {
      title: 'E2E UI consensus study', authors: 'Agree, A', year: '2022',
    });
    const studyId = seeded.body.study.id as string;
    const questionIds = await rob2QuestionIds(request);
    await assessAsReviewer(request, { projectId, studyId, questionIds });
    await assessAsReviewer(normalContext.request, { projectId, studyId, questionIds, dissentOn: questionIds[0], dissentResponse: 'N' });

    const rob = new RobPage(page);
    await rob.gotoTab(projectId);
    await page.getByRole('button', { name: /create consensus record/i }).click();
    // The badge correctly appears in BOTH surfaces (article list + summary
    // outputs) — scope to the article list to keep the locator strict.
    await expect(page.getByLabel('Articles for risk-of-bias assessment').getByText('CONSENSUS', { exact: true })).toBeVisible();
    await expect(page.getByText(/Both reviewer assessments above are unchanged/i)).toBeVisible();
    // Three rows for the study: two originals + the reconciliation.
    const after = await RobPage.getAssessments(request, projectId);
    expect((after.body.assessments as Array<any>).filter(a => a.studyId === studyId)).toHaveLength(3);
  });

  test('the summary outputs render per tool and the export button downloads the CSV', async ({ request, tmpProject, page }) => {
    const projectId = tmpProject.id;
    const seeded = await RobPage.createManualStudy(request, projectId, {
      title: 'E2E summary study', authors: 'Summary, S', year: '2019',
    });
    const studyId = seeded.body.study.id as string;
    const questionIds = await rob2QuestionIds(request);
    await assessAsReviewer(request, { projectId, studyId, questionIds });

    const rob = new RobPage(page);
    await rob.gotoTab(projectId);
    await expect(page.getByText(/Summary outputs/i)).toBeVisible();
    await expect(page.getByText(/RoB 2/).first()).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /export all assessments/i }).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain('rob-assessments');
  });
});
