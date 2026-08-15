/**
 * finalReviewUndo.spec.ts — 117.md §52-§56. Undo/redo for FINAL REVIEW decisions.
 *
 * §52's worked example is "the user excludes an article, then presses Ctrl+Z". Before
 * 117 there was no inverse for that anywhere in the system: the revert endpoint took
 * accepted records only, so an exclusion was permanent unless a leader re-decided it
 * by hand. These tests drive that scenario end to end and re-read the SERVER after
 * every step, so none of them can pass on a UI-only illusion (108.md §8).
 *
 * WHAT EACH ASSERTION IS FOR
 *   · §52/§53 — Exclude → Ctrl+Z must clear BOTH `finalStatus` AND `rejectedReason`.
 *     Restoring only the status leaves an exclusion reason on a record that is no
 *     longer excluded, which the PRISMA exclusion breakdown and the export both read.
 *   · §54 — Ctrl+Shift+Z re-applies the exclusion WITH its original reason.
 *   · §55 — the visible affordance: a snackbar naming the article-level outcome, whose
 *     Undo button runs the SAME history entry Ctrl+Z would.
 *   · §56 — the audit trail shows both the decision AND the undo. The undo appends
 *     FINAL_REVIEW_UNDO; the original RECORD_REJECTED row is still there.
 *   · §53 (PRISMA) — the flow is DERIVED at read, so the same undo moves the record
 *     back out of "excluded at full text" without anything storing a second copy.
 *
 * SEEDING. Final Review only lists records that reached inclusion quorum, which needs
 * two DISTINCT reviewers to include a record at title/abstract (the server enforces
 * it — a forged body cannot bypass it). The seeded `normal` user is added to the
 * workspace as a reviewer and casts the second include through the API.
 */
import { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { ScreeningPage } from '../page-objects/ScreeningPage';
import { addProjectMember } from '../helpers/api';

interface FinalRecord {
  id: string;
  finalStatus?: string;
  rejectedReason?: string;
  currentStage?: string;
}

/** The Final Review list, straight from the API. */
async function secondReview(request: APIRequestContext, siftId: string): Promise<FinalRecord[]> {
  const res = await request.get(`/api/screening/projects/${siftId}/second-review`);
  expect(res.ok(), 'the final-review list must be readable').toBeTruthy();
  return ((await res.json())?.records || []) as FinalRecord[];
}

async function finalRecord(request: APIRequestContext, siftId: string, rid: string): Promise<FinalRecord> {
  const rows = await secondReview(request, siftId);
  return rows.find((r) => r.id === rid) || ({ id: rid } as FinalRecord);
}

/** The project audit ledger (leader-only). */
async function auditActions(request: APIRequestContext, siftId: string): Promise<string[]> {
  const res = await request.get(`/api/screening/projects/${siftId}/audit`);
  if (!res.ok()) return [];
  return (((await res.json())?.entries || []) as Array<{ action: string }>).map((e) => e.action);
}

/**
 * Promote ONE record to Final Review by having two distinct reviewers include it.
 * Returns the promoted record id.
 */
async function promoteOne(
  ownerRequest: APIRequestContext,
  reviewerRequest: APIRequestContext,
  siftId: string,
): Promise<string> {
  const list = await ownerRequest.get(`/api/screening/projects/${siftId}/records?page=1&limit=5`);
  expect(list.ok()).toBeTruthy();
  const rid = ((await list.json())?.records || [])[0]?.id as string;
  expect(rid, 'the seeded project must have records').toBeTruthy();

  for (const req of [ownerRequest, reviewerRequest]) {
    const res = await req.post(`/api/screening/projects/${siftId}/records/${rid}/decision`, {
      // THE STAGE TRAP (108.md §4) — never let the server default the stage.
      data: { decision: 'include', stage: 'title_abstract' },
    });
    expect(res.ok(), `include failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  }

  await expect
    .poll(async () => (await secondReview(ownerRequest, siftId)).some((r) => r.id === rid))
    .toBeTruthy();
  return rid;
}

/** Open Final Review and wait until the list has painted. */
async function openFinalReview(page: Page, projectId: string): Promise<ScreeningPage> {
  const sift = new ScreeningPage(page);
  await sift.goto(projectId, 'second-review');
  await expect(sift.finalReviewHeading).toBeVisible();
  return sift;
}

/* The Modal renders inline but carries role="dialog", so every confirmation locator
   is scoped to it — the card button and the modal button share their wording. */
const dialog = (sift: ScreeningPage) => sift.page.getByRole('dialog');
const excludeButton = (sift: ScreeningPage) => sift.main.getByRole('button', { name: /^Exclude$/ });
const confirmExclude = (sift: ScreeningPage) => dialog(sift).getByRole('button', { name: /Exclude record/ });
const reasonBox = (sift: ScreeningPage) => dialog(sift).getByPlaceholder(/Wrong population/);
const acceptButton = (sift: ScreeningPage) => sift.main.getByRole('button', { name: /Accept → Data Extraction/ });
const reopenButton = (sift: ScreeningPage) => sift.main.getByRole('button', { name: /Reopen for Final Review/ });
const confirmReopen = (sift: ScreeningPage) => dialog(sift).getByRole('button', { name: /Reopen for Final Review/ });

test.describe('Final Review — exclude undo/redo (117.md §52-§56)', () => {
  test('@smoke Exclude → Ctrl+Z clears the status AND the reason → Ctrl+Shift+Z restores both', async ({
    page, request, seed, normalContext, screeningProject,
  }) => {
    test.skip(!seed.normal, 'needs the seeded `normal` user as a second reviewer');
    await addProjectMember(request, screeningProject.siftId, { email: seed.normal!.email, preset: 'reviewer' });
    const rid = await promoteOne(request, normalContext.request, screeningProject.siftId);

    const sift = await openFinalReview(page, screeningProject.project.id);
    await excludeButton(sift).click();
    await reasonBox(sift).fill('Wrong population');
    await confirmExclude(sift).click();

    // §8 — a real mutation, reconciled with the server.
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('rejected');
    expect((await finalRecord(request, screeningProject.siftId, rid)).rejectedReason).toBe('Wrong population');

    // §55 — the visible affordance names the article-level outcome.
    await expect(sift.snackbar).toContainText('Article excluded');
    await expect(sift.snackbarUndo).toBeVisible();

    await sift.undo();
    // §17 — the provider's own confirmation names the entry that was reversed.
    await expect(sift.snackbar).toContainText('Final decision undone');
    // §52/§53 — BOTH columns come back. A status-only inverse would leave "Wrong
    // population" attached to a record that is no longer excluded.
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('');
    expect((await finalRecord(request, screeningProject.siftId, rid)).rejectedReason).toBe('');

    await sift.redo();
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('rejected');
    // §54 — the redo replays the ORIGINAL reason, not a blank one.
    expect((await finalRecord(request, screeningProject.siftId, rid)).rejectedReason).toBe('Wrong population');
  });

  test('§55 — the snackbar Undo button runs the same entry Ctrl+Z would', async ({
    page, request, seed, normalContext, screeningProject,
  }) => {
    test.skip(!seed.normal, 'needs the seeded `normal` user as a second reviewer');
    await addProjectMember(request, screeningProject.siftId, { email: seed.normal!.email, preset: 'reviewer' });
    const rid = await promoteOne(request, normalContext.request, screeningProject.siftId);

    const sift = await openFinalReview(page, screeningProject.project.id);
    await excludeButton(sift).click();
    await reasonBox(sift).fill('No full text');
    await confirmExclude(sift).click();
    await expect(sift.snackbar).toContainText('Article excluded');

    await sift.snackbarUndo.click();
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('');
  });

  test('§56 — the audit shows the exclusion AND the undo, not a rewritten row', async ({
    page, request, seed, normalContext, screeningProject,
  }) => {
    test.skip(!seed.normal, 'needs the seeded `normal` user as a second reviewer');
    await addProjectMember(request, screeningProject.siftId, { email: seed.normal!.email, preset: 'reviewer' });
    const rid = await promoteOne(request, normalContext.request, screeningProject.siftId);

    const sift = await openFinalReview(page, screeningProject.project.id);
    await excludeButton(sift).click();
    await reasonBox(sift).fill('Retracted');
    await confirmExclude(sift).click();
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('rejected');
    await expect.poll(() => auditActions(request, screeningProject.siftId)).toContain('RECORD_REJECTED');

    await sift.undo();
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('');

    const actions = await auditActions(request, screeningProject.siftId);
    // The undo APPENDED its own row…
    expect(actions).toContain('FINAL_REVIEW_UNDO');
    // …and the original decision is still on the record. "Pretending the original
    // action never occurred" is the exact failure §56 forbids.
    expect(actions).toContain('RECORD_REJECTED');
  });

  test('§52 — an excluded record can also be reopened from the card, long after the fact', async ({
    page, request, seed, normalContext, screeningProject,
  }) => {
    test.skip(!seed.normal, 'needs the seeded `normal` user as a second reviewer');
    await addProjectMember(request, screeningProject.siftId, { email: seed.normal!.email, preset: 'reviewer' });
    const rid = await promoteOne(request, normalContext.request, screeningProject.siftId);

    // Exclude through the API, then load the page fresh — there is no history entry
    // for this decision in this browser session, so the card affordance is the only
    // way back. That is the case Ctrl+Z cannot cover.
    const res = await request.post(`/api/screening/projects/${screeningProject.siftId}/records/${rid}/finalize`, {
      data: { decision: 'reject', reason: 'Wrong comparator' },
    });
    expect(res.ok()).toBeTruthy();

    const sift = await openFinalReview(page, screeningProject.project.id);
    await expect(reopenButton(sift)).toBeVisible();
    await reopenButton(sift).click();
    await confirmReopen(sift).click();

    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('');
    expect((await finalRecord(request, screeningProject.siftId, rid)).rejectedReason).toBe('');
  });
});

test.describe('Final Review — accept undo (117.md §52/§53)', () => {
  test('Accept → Ctrl+Z returns the record to pending and withdraws the study', async ({
    page, request, seed, normalContext, screeningProject,
  }) => {
    test.skip(!seed.normal, 'needs the seeded `normal` user as a second reviewer');
    await addProjectMember(request, screeningProject.siftId, { email: seed.normal!.email, preset: 'reviewer' });
    const rid = await promoteOne(request, normalContext.request, screeningProject.siftId);

    const sift = await openFinalReview(page, screeningProject.project.id);
    await acceptButton(sift).click();
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('accepted');
    await expect(sift.snackbar).toContainText('Article included');

    await sift.undo();
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('');

    // §53 — the study left active Data Extraction with the record. The extracted data
    // is NOT destroyed (the server snapshots it), which is why a redo can restore it.
    const proj = await request.get(`/api/projects/${screeningProject.project.id}`);
    if (proj.ok()) {
      const body = await proj.json();
      let studies = body?.studies ?? body?.data?.studies;
      if (typeof studies === 'string') { try { studies = JSON.parse(studies).studies; } catch { studies = null; } }
      if (Array.isArray(studies)) {
        expect(studies.filter((s: any) => s?.screeningRecordId === rid)).toHaveLength(0);
      }
    }

    await sift.redo();
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('accepted');
  });
});
