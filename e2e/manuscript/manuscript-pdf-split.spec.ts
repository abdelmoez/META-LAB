/**
 * manuscript-pdf-split.spec.ts — 119.md §4, §10 scenarios 9-11.
 *
 * The split workspace is the one part of §4 a unit test cannot prove: it exists to be
 * OPENED, DRAGGED and TYPED IN. What this file pins is exactly that —
 *   9.  enabling PDF view really gives a 50/50 split (measured, not asserted from a
 *       style string) with an accessible separator and the rails out of the way;
 *   10. a keyboard resize + choosing another included article survive a REFRESH;
 *   11. writing in the manuscript while the PDF is open loses nothing — including the
 *       structural guarantee behind that: opening/closing the pane does not remount
 *       the editor (proved with a DOM probe React would destroy on a remount).
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect, Page } from '../fixtures/stitch-test';
import { attachPdfToFirstRecord, FIXTURE_HEADING } from '../helpers/pdf';

const SPLIT = 'stitch-manuscript-split';

async function openManuscript(page: Page, projectId: string, params = '') {
  await page.goto(`/app/project/${projectId}?tab=manuscript&ms=editor${params}`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stitch-manuscript-editor')).toBeVisible({ timeout: 20_000 });
}

const desktop = (page: Page) => page.setViewportSize({ width: 1600, height: 900 });

/** Included studies, so the selector has real articles to offer. */
async function seedStudies(request: import('@playwright/test').APIRequestContext, projectId: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  proj.studies = [
    { id: 's1', title: 'Trial A statins after infarction', authors: 'Smith J', year: '2020', journal: 'Lancet', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', nExp: '500', nCtrl: '500' },
    { id: 's2', title: 'Trial B aspirin in prevention', authors: 'Lee K', year: '2021', journal: 'NEJM', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06', nExp: '300', nCtrl: '300' },
    { id: 's3', title: 'Trial C anticoagulation', authors: 'Brown T', year: '2019', journal: 'JAMA', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05', nExp: '400', nCtrl: '400' },
  ];
  expect((await request.put(`/api/projects/${projectId}/autosave`, { data: proj })).ok()).toBeTruthy();
}

const openSplit = async (page: Page) => {
  await page.getByTestId('stitch-manuscript-split-toggle').click();
  await expect(page.getByTestId('stitch-manuscript-split-pdf')).toBeVisible({ timeout: 15_000 });
};

const ratio = async (page: Page) => Number(await page.getByTestId(SPLIT).getAttribute('data-ratio'));

test.describe('Manuscript Editor + PDF split workspace (119.md §4)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  /* ── §10 scenario 9 ─────────────────────────────────────────────────────────── */

  test('scenario 9: enabling PDF view gives a 50/50 split, an accessible separator and the maximised layout', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedStudies(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);

    // The toggle is one control with two states, and the pane starts closed.
    const toggle = page.getByTestId('stitch-manuscript-split-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-split', 'off');
    await expect(page.getByTestId('stitch-manuscript-split-pdf')).toHaveCount(0);

    await openSplit(page);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-split', 'on');
    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-layout', 'split');
    expect(await ratio(page)).toBe(50);

    // …and it is REALLY 50/50 on screen, not just in a data attribute.
    const editorBox = await page.getByTestId('stitch-manuscript-split-editor').boundingBox();
    const pdfBox = await page.getByTestId('stitch-manuscript-split-pdf').boundingBox();
    expect(editorBox).toBeTruthy();
    expect(pdfBox).toBeTruthy();
    expect(Math.abs((editorBox!.width) - (pdfBox!.width))).toBeLessThan(40);

    // §4 — "Support keyboard resizing and an accessible separator".
    const divider = page.getByTestId('stitch-manuscript-split-divider');
    await expect(divider).toHaveAttribute('role', 'separator');
    await expect(divider).toHaveAttribute('aria-orientation', 'vertical');
    await expect(divider).toHaveAttribute('aria-valuenow', '50');

    // §4 — "Hide the normal left and right menus/panels": the shell's own Focus Mode,
    // which UNMOUNTS the rails and leaves the slim focus bar.
    await expect(page.getByTestId('stitch-app-shell')).toHaveAttribute('data-focused', 'true');
    await expect(page.getByTestId('focus-nav-bar')).toBeVisible();

    // The workspace toolbar §4 asks for: exit · article identity · width presets.
    await expect(page.getByTestId('stitch-manuscript-split-exit')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-split-article')).toBeVisible();
    for (const p of ['even', 'editor', 'pdf']) {
      await expect(page.getByTestId(`stitch-manuscript-split-preset-${p}`)).toBeVisible();
    }
    await expect(page.getByTestId('stitch-manuscript-split-preset-even')).toHaveAttribute('aria-pressed', 'true');

    // Exiting restores the ordinary workspace (and the rails with it).
    await page.getByTestId('stitch-manuscript-split-exit').click();
    await expect(page.getByTestId('stitch-manuscript-split-pdf')).toHaveCount(0);
    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-split', 'off');
    await expect(page.getByTestId('stitch-app-shell')).not.toHaveAttribute('data-focused', 'true');
  });

  /* ── §10 scenario 10 ────────────────────────────────────────────────────────── */

  test('scenario 10: resize, choose another included article, refresh — both are preserved', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedStudies(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await openSplit(page);

    // Keyboard resize: three nudges of 2 points away from 50/50.
    const divider = page.getByTestId('stitch-manuscript-split-divider');
    await divider.focus();
    await divider.press('ArrowRight');
    await divider.press('ArrowRight');
    await divider.press('ArrowRight');
    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-ratio', '56');
    await expect(divider).toHaveAttribute('aria-valuenow', '56');
    // A free ratio is on no preset — the quick actions do not pretend otherwise.
    await expect(page.getByTestId('stitch-manuscript-split-preset-even')).toHaveAttribute('aria-pressed', 'false');

    // Choose another included article, by SEARCH (§4: title/author/year/DOI/PMID/label).
    await page.getByTestId('stitch-manuscript-split-article').click();
    await page.getByTestId('stitch-manuscript-split-article-search').fill('Lee');
    const options = page.locator('[data-testid^="stitch-manuscript-split-article-option-"]');
    await expect(options).toHaveCount(1);
    await options.first().click();
    await expect(page.getByTestId('stitch-manuscript-split-identity')).toContainText('Trial B');

    // §4 — honest empty state: these studies carry no attached PDF.
    await expect(page.getByTestId('stitch-manuscript-split-empty')).toContainText(/No PDF attached/i);

    // REFRESH — the pane, the ratio and the article all come back.
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stitch-manuscript-split-pdf')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-ratio', '56');
    await expect(page.getByTestId('stitch-manuscript-split-identity')).toContainText('Trial B');

    // Layout is a PREFERENCE, not project data: nothing about it reached the blob.
    const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
    expect(JSON.stringify(proj)).not.toContain('manuscriptSplit');
  });

  /* ── §10 scenario 11 ────────────────────────────────────────────────────────── */

  test('scenario 11: writing in the manuscript with the PDF open loses nothing, and the pane never remounts the editor', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedStudies(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);

    const intro = page.getByTestId('stitch-manuscript-rich-editor-introduction');
    await expect(intro).toBeVisible({ timeout: 20_000 });

    /* A probe React destroys on a remount: the element is created by React, so an
       attribute set from OUTSIDE React survives exactly as long as the DOM node does.
       This is the mechanical form of §4's "opening, closing, or resizing the PDF must
       not reload the manuscript / reset the cursor / discard unsaved changes". */
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="stitch-manuscript-rich-editor-introduction"]');
      if (el) el.setAttribute('data-remount-probe', 'alive');
    });

    // Type BEFORE opening the pane — both autosave debounces are still armed.
    await intro.click();
    const before = `Written before the PDF opened ${Date.now()}`;
    await page.keyboard.type(before);

    await openSplit(page);
    await expect(intro).toHaveAttribute('data-remount-probe', 'alive');   // same DOM node
    await expect(intro).toContainText(before);

    // …keep writing WITH the PDF open.
    await intro.click();
    await page.keyboard.press('ControlOrMeta+End');
    const during = ` and written beside the PDF ${Date.now()}`;
    await page.keyboard.type(during);

    // Resizing is not a remount either.
    await page.getByTestId('stitch-manuscript-split-preset-editor').click();
    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-ratio', '70');
    await expect(intro).toHaveAttribute('data-remount-probe', 'alive');
    await expect(intro).toContainText(before);
    await expect(intro).toContainText(during.trim());

    // Closing it is not a remount either — and autosave carried everything.
    await page.getByTestId('stitch-manuscript-split-exit').click();
    await expect(intro).toHaveAttribute('data-remount-probe', 'alive');
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });
    await expect(async () => {
      const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const blob = JSON.stringify(proj.manuscripts || []);
      expect(blob).toContain(before);
      expect(blob).toContain(during.trim());
    }).toPass({ timeout: 25_000 });

    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-rich-editor-introduction'))
      .toContainText(before, { timeout: 20_000 });
  });

  /* ── §4: the real thing — an included study whose full text is attached ─────── */

  /**
   * The other three scenarios drive the LAYOUT; this one drives the DOCUMENT. It seeds
   * a real PDF on a real screening record through the real upload route, links an
   * included study to that record, and asserts the split opens THAT file through the
   * shared screening viewer — the §4 rule that a PDF opened in the manuscript is the
   * same identity Screening and Extraction already hold, never a second copy.
   */
  test('§4: an included study with an attached full text opens it in the shared viewer', async ({ page, request, screeningProject }) => {
    await desktop(page);
    const attached = await attachPdfToFirstRecord(request, screeningProject.siftId);
    const proj = await (await request.get(`/api/projects/${screeningProject.project.id}`)).json();
    proj.studies = [{
      id: 'p1', title: 'Screened trial with a full text', authors: 'Lee K', year: '2020',
      journal: 'Lancet', doi: '10.1000/withpdf',
      screeningRecordId: attached.recordId, screeningProjectId: screeningProject.siftId,
    }];
    expect((await request.put(`/api/projects/${screeningProject.project.id}/autosave`, { data: proj })).ok()).toBeTruthy();

    await openManuscript(page, screeningProject.project.id);
    await openSplit(page);

    await expect(page.getByTestId('stitch-manuscript-split-identity')).toContainText('Screened trial');
    // The bytes really render — through the same viewer the screening surface uses.
    const viewer = page.getByTestId('stitch-manuscript-split-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });
    await expect(viewer).toContainText(FIXTURE_HEADING, { timeout: 25_000 });
    await expect(page.getByTestId('stitch-manuscript-split-empty')).toHaveCount(0);

    // §4 "PDF availability status" — the selector says so, honestly.
    await page.getByTestId('stitch-manuscript-split-article').click();
    await expect(page.getByTestId('stitch-manuscript-split-article-option-p1')).toContainText('PDF');
    await page.getByTestId('stitch-manuscript-split-article-catcher').click();

    // Opening it here uploaded nothing: the record still has exactly one attachment.
    const list = await (await request.get(
      `/api/screening/projects/${screeningProject.siftId}/records/${attached.recordId}/pdf`,
    )).json();
    expect((list.attachments || []).length).toBe(1);
    expect(list.attachments[0].id).toBe(attached.attachmentId);
  });

  /* ── §4 responsive floor ────────────────────────────────────────────────────── */

  /* The viewport is set BEFORE the pane opens on purpose: opening it enters the
     shell's Focus Mode, whose fullscreen bridge maximises the browser window, and a
     maximised window cannot be resized by the driver. That is the shell's documented
     behaviour (114.md), not something this workspace re-implements. */
  test('§4: a narrow window shows one pane at a time instead of two unusable columns', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedStudies(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await page.setViewportSize({ width: 760, height: 900 });
    await openSplit(page);

    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-layout', 'stacked');
    await expect(page.getByTestId('stitch-manuscript-split-divider')).toHaveCount(0);

    // Asking for PDF view shows the PDF — and both panes stay REACHABLE, which is the
    // whole point of stacking rather than squeezing.
    const switcher = page.getByTestId('stitch-manuscript-split-panes');
    await expect(switcher).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-split-pdf')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-split-editor')).toBeHidden();
    await page.getByTestId('stitch-manuscript-split-pane-editor').click();
    await expect(page.getByTestId('stitch-manuscript-split-editor')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-split-pdf')).toBeHidden();
    await page.getByTestId('stitch-manuscript-split-pane-pdf').click();
    await expect(page.getByTestId('stitch-manuscript-split-pdf')).toBeVisible();

    // Back to a wide window: two panes and the separator return. (Closing the pane
    // first releases Focus Mode, so the window is resizable again.)
    await page.getByTestId('stitch-manuscript-split-toggle').click();
    await expect(page.getByTestId('stitch-manuscript-split-pdf')).toHaveCount(0);
    await expect(page.getByTestId('stitch-app-shell')).not.toHaveAttribute('data-focused', 'true');
    await desktop(page);
    await openSplit(page);
    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-layout', 'split');
    await expect(page.getByTestId('stitch-manuscript-split-divider')).toBeVisible();
  });
});
