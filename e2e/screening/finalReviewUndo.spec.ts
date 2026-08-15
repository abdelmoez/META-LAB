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

/* LOCATORS — 117.md §79 (r2 fix). These were written by ACCESSIBLE NAME, and on this
   page that is ambiguous by construction: the project owner is both a reviewer and the
   leader, so a pending card renders a reviewer VOTE button reading "Exclude" AND a
   leader VERDICT button reading "Exclude". `getByRole('button', {name: /^Exclude$/})`
   therefore resolved to two elements and every click on it was a Playwright
   strict-mode violation — the exclude tests below could not run at all for an owner.
   The card button and the modal confirmation shared their wording too ("Reopen for
   Final Review"), which the `dialog` scoping papered over but did not remove.

   Every control now has an explicit testid naming its ROLE, not its label, so the
   ambiguity cannot come back with a copy change. `acceptButton` was audited for the
   same defect: the reviewer's vote reads "Include" and the leader's reads
   "Accept → Data Extraction", so it was never ambiguous — it moves to a testid anyway
   so both halves of one decision are located the same way. */
const dialog = (sift: ScreeningPage) => sift.page.getByRole('dialog');
const excludeButton = (sift: ScreeningPage) => sift.main.getByTestId('final-review-exclude');
const confirmExclude = (sift: ScreeningPage) => dialog(sift).getByTestId('final-review-exclude-confirm');
const reasonBox = (sift: ScreeningPage) => dialog(sift).getByPlaceholder(/Wrong population/);
const acceptButton = (sift: ScreeningPage) => sift.main.getByTestId('final-review-accept');
const reopenButton = (sift: ScreeningPage) => sift.main.getByTestId('final-review-reopen');
const confirmReopen = (sift: ScreeningPage) => dialog(sift).getByTestId('final-review-reopen-confirm');
/** The REVIEWER's own full-text vote — the other half of the ambiguity above. */
const voteButton = (sift: ScreeningPage, v: 'include' | 'exclude' | 'maybe') =>
  sift.main.getByTestId(`final-review-vote-${v}`);

/**
 * Exclude the open record and WAIT FOR THE CLIENT TO SETTLE — 117.md §55, 108.md §7/§24.
 *
 * THE RACE THIS EXISTS TO CLOSE. The exclude dialog does not close when the POST
 * returns: `submitReject` → `runFinalize` awaits the write, THEN the silent list
 * reload, THEN `refreshProject()`, and only then clears `rejectFor`. For those
 * ~200-400 ms the dialog is still on screen with focus in its reason textarea. A
 * Ctrl+Z issued in that window is REFUSED BY DESIGN and not by accident:
 * `historyShortcutAllowed` (undoChords.js) declines on an editable target (§7 —
 * native text undo wins while the user is typing) AND on an open modal (§24 tier 1
 * — a dialog owns the keyboard), so the chord falls through with no preventDefault,
 * no note and no request. Verified against the live app: at keypress time the DOM
 * still carried `[data-screening-modal]` and `document.activeElement` was the
 * dialog's TEXTAREA, and the identical Ctrl+Z pressed after the dialog closed drove
 * a real POST /final-review/revert and returned the record to pending.
 *
 * A test that synchronises only on the SERVER (`expect.poll` over the API, which
 * sees `finalStatus:'rejected'` the moment the POST commits — i.e. BEFORE the
 * client is finished) therefore types the chord into a textarea and reads a
 * correct no-op as a broken undo. A human never hits this: the exclusion is not
 * announced to them until the dialog closes and the §55 snackbar appears, which is
 * exactly the state this helper waits for.
 */
async function excludeRecord(sift: ScreeningPage, reason: string): Promise<void> {
  await excludeButton(sift).click();
  await reasonBox(sift).fill(reason);
  await confirmExclude(sift).click();
  // The dialog is gone → no modal owns the keyboard and focus has left the textarea.
  await expect(dialog(sift)).toHaveCount(0);
  // §55 — and the visible affordance the decision promises is on screen.
  await expect(sift.snackbar).toContainText('Article excluded');
  await expect(sift.snackbarUndo).toBeVisible();
}

test.describe('Final Review — exclude undo/redo (117.md §52-§56)', () => {
  test('@smoke Exclude → Ctrl+Z clears the status AND the reason → Ctrl+Shift+Z restores both', async ({
    page, request, seed, normalContext, screeningProject,
  }) => {
    test.skip(!seed.normal, 'needs the seeded `normal` user as a second reviewer');
    await addProjectMember(request, screeningProject.siftId, { email: seed.normal!.email, preset: 'reviewer' });
    const rid = await promoteOne(request, normalContext.request, screeningProject.siftId);

    const sift = await openFinalReview(page, screeningProject.project.id);
    // 117.md §79 (r2 fix) — the two "Exclude" controls really are both on screen for an
    // owner. Asserting it here is what keeps the locators above honest: if the leader
    // verdict ever loses its testid, this fails loudly rather than clicking the vote.
    await expect(voteButton(sift, 'exclude')).toBeVisible();
    await expect(excludeButton(sift)).toBeVisible();
    await expect(sift.main.getByRole('button', { name: /^Exclude$/ })).toHaveCount(2);

    // §55 — the visible affordance names the article-level outcome (asserted inside
    // the helper, which is also what makes the Ctrl+Z below land on a settled page).
    await excludeRecord(sift, 'Wrong population');

    // §8 — a real mutation, reconciled with the server.
    await expect.poll(async () => (await finalRecord(request, screeningProject.siftId, rid)).finalStatus)
      .toBe('rejected');
    expect((await finalRecord(request, screeningProject.siftId, rid)).rejectedReason).toBe('Wrong population');

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
    await excludeRecord(sift, 'No full text');

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
    await excludeRecord(sift, 'Retracted');
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
    // The accept half of the §79 (r2) audit: the leader verdict and the reviewer's
    // "Include" vote are DIFFERENT names, so this one was never ambiguous — pinned so
    // a future copy change ("Include → Data Extraction") cannot make it so silently.
    await expect(acceptButton(sift)).toBeVisible();
    await expect(voteButton(sift, 'include')).toBeVisible();
    await expect(sift.main.getByRole('button', { name: /^Include$/ })).toHaveCount(1);

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
