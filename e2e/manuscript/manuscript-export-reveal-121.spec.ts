/**
 * manuscript-export-reveal-121.spec.ts — 121.md §3.
 *
 * "An export error or warning may appear near the top of the page while the user
 * remains lower on the page and does not understand why the export failed."
 *
 * The unit suite (tests/unit/manuscript/exportReveal121.test.jsx) pins the roles, the
 * reveal state machine, the navigability rule and the identity threading. What only a
 * real browser can prove is the thing §3 is actually about: that after pressing an
 * export button from the BOTTOM of a long page, the message is on screen and the
 * keyboard is in it — in every scroll-container configuration the prompt lists.
 *
 * So the journey is PARAMETERIZED over the two editing views (§3: "Continuous
 * manuscript view" / "Section/tabbed view") crossed with the two workspace shapes
 * (normal, and the PDF split — a genuinely different scroller: in the split the
 * editor half owns its own scrolling and the shell's does not scroll at all). The
 * narrow stacked split and real fullscreen get their own tests, the latter Chromium
 * only for the reason e2e/focus/fullscreen.spec.ts documents.
 *
 * WHY errors are seeded through the API: the defect is about the REVEAL, not about
 * how a broken reference gets into a draft. `[[table:nope]]` typed in the editor
 * would open the cross-reference picker; written into the blob it is exactly the
 * unresolved token validateExport blocks on.
 */
import { test, expect, Page } from '../fixtures/stitch-test';
import {
  SPLIT, desktop, openManuscript, openSplit, isFullscreen,
} from '../helpers/manuscript';

const REGION = 'stitch-manuscript-export-feedback';
const REVIEW = 'stitch-manuscript-export-validation';

/* A draft long enough that the Export destination's own button is well below the
   fold, which is the situation §3 describes. */
const LONG = (tag: string) => `${tag} `.repeat(160).trim();

/** Seed a draft whose export BLOCKS: a cross-reference to a table that is not there. */
async function seedBlockingDraft(
  request: import('@playwright/test').APIRequestContext, projectId: string,
) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  const drafts = proj.manuscripts || [];
  const d = drafts[0] || { id: 'd1', sections: {} };
  d.title = 'A pooled analysis of three trials';
  d.sections = {
    ...(d.sections || {}),
    title: { content: 'A pooled analysis of three trials', userEdited: true },
    introduction: { content: LONG('INTRO'), userEdited: true },
    methods: { content: LONG('METHODS'), userEdited: true },
    // The blocking finding, anchored in a REAL section — which is what gives the
    // "Go to it" control somewhere to go (§3's last bullet).
    results: { content: `${LONG('RESULTS')}\n\nAs shown in [[table:absent-table]], the effect held.`, userEdited: true },
    discussion: { content: LONG('DISCUSSION'), userEdited: true },
    limitations: { content: LONG('LIMITATIONS'), userEdited: true },
    conclusion: { content: LONG('CONCLUSION'), userEdited: true },
  };
  proj.manuscripts = [d, ...drafts.slice(1)];
  proj.studies = [
    { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', journal: 'Lancet', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', nExp: '500', nCtrl: '500' },
    { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', journal: 'NEJM', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06', nExp: '300', nCtrl: '300' },
    { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', journal: 'JAMA', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05', nExp: '400', nCtrl: '400' },
  ];
  expect((await request.put(`/api/projects/${projectId}/autosave`, { data: proj })).ok()).toBeTruthy();
}

/** Is the element inside the visible part of the window, below the sticky ribbon? */
async function isRevealed(page: Page, testId: string): Promise<boolean> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) return false;
  const h = await page.evaluate(() => window.innerHeight);
  const bar = await page.getByTestId('stitch-manuscript-header').boundingBox();
  const floor = bar ? bar.y + bar.height : 0;
  // Fully on screen, and NOT hiding under the sticky purple toolbar (118.md §17 —
  // the exact bug a naive scrollIntoView({block:'start'}) would reintroduce).
  return box.y >= floor - 2 && box.y + Math.min(box.height, 120) <= h + 2;
}

/**
 * Drive the export from the EXPORT destination's own button, which sits below a page
 * of checklist content — i.e. from exactly where §3 says the researcher is when the
 * message appears "near the top of the page". (Only the Overview copy of the button
 * group carries the canonical test id; this one is addressed by its accessible name.)
 */
async function exportFromExportPanel(page: Page) {
  await page.getByTestId('stitch-manuscript-subtab-export').click();
  const btn = page.getByRole('button', { name: /^Export Word$/ }).first();
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
}

test.describe('121.md §3 — export errors and warnings reveal themselves', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  for (const view of ['continuous', 'sections'] as const) {
    for (const shape of ['normal', 'split'] as const) {
      test(`blocked export in ${view} view, ${shape} workspace: the message is scrolled to, focused and announced`, async ({ page, request, tmpProject }) => {
        await desktop(page);
        await seedBlockingDraft(request, tmpProject.id);
        await openManuscript(page, tmpProject.id, `&msv=${view}`);
        if (shape === 'split') {
          await openSplit(page);
          await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-layout', 'split');
        }

        // Nothing is announced before an export is attempted.
        await expect(page.getByTestId(REGION)).toHaveCount(0);

        await exportFromExportPanel(page);

        const region = page.getByTestId(REGION);
        await expect(region).toBeVisible({ timeout: 25_000 });

        /* §3 — "Errors should use an assertive alert behavior." ONE region, one role,
           whatever the view or the workspace shape. */
        await expect(region).toHaveAttribute('role', 'alert');
        await expect(region).toHaveAttribute('aria-live', 'assertive');
        await expect(region).toHaveAttribute('data-tone', 'blocking');
        await expect(page.getByTestId(REVIEW)).toContainText('Export blocked');
        await expect(page.getByTestId(REVIEW)).toContainText(/does not match any table or figure/i);

        // §3 — "Automatically move the correct Manuscript Editor scroll container to
        // the validation message. Bring the complete error/warning summary into view."
        await expect.poll(() => isRevealed(page, REGION), { timeout: 10_000 }).toBe(true);

        // §3 — "Move keyboard focus to the message or its heading."
        await expect(page.getByTestId('stitch-manuscript-export-validation-heading')).toBeFocused();

        // …and nothing was downloaded, which is what "blocking" means.
        await expect(page.getByTestId('stitch-manuscript-export-anyway')).toHaveCount(0);

        /* §3 — "provide a control that navigates directly to it". The finding names
           the Results section, so this jumps into the editor at Results. */
        const goto = page.locator('[data-testid^="stitch-manuscript-export-goto-"]').first();
        await expect(goto).toBeVisible();
        await goto.click();
        await expect(page.getByTestId('stitch-manuscript-editor')).toBeVisible();
        if (view === 'sections') {
          // Section View OPENS the section (one editor is mounted at a time, so the
          // proof is the outline's own current item plus the prose on the page).
          await expect(page.getByTestId('stitch-manuscript-section-results'))
            .toHaveAttribute('aria-current', 'true', { timeout: 10_000 });
          await expect(page.getByTestId('stitch-manuscript-rich-editor')).toContainText('RESULTS');
        } else {
          // Continuous View never switches away from the document: it scrolls.
          await expect.poll(async () => {
            const box = await page.getByTestId('stitch-manuscript-doc-results').boundingBox();
            const h = await page.evaluate(() => window.innerHeight);
            return !!box && box.y < h && box.y + box.height > 0;
          }, { timeout: 10_000 }).toBe(true);
        }

        /* §3 — "Keep the message visible until the user dismisses it, resolves it, or
           starts another relevant export attempt." Navigating away from the Export
           destination did not take it with them. */
        await expect(page.getByTestId(REGION)).toBeVisible();

        // …and it IS dismissible, by the control that already existed.
        await page.getByTestId('stitch-manuscript-export-fix-first').click();
        await expect(page.getByTestId(REGION)).toHaveCount(0);
      });
    }
  }

  test('a warnings-only review is a polite STATUS, is revealed, and a re-check re-reveals', async ({ page, request, tmpProject }) => {
    await desktop(page);
    // A clean-ish draft plus an explicitly included figure nobody references — the
    // 85.md B2 warning path, which must NOT be announced as assertively as a block.
    const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
    proj.prisma = { dbs: '1200', reg: '50', other: '0', dedupe: '250', excTA: '800', excFull: '180', reasons: [], included: '', quant: '' };
    proj.studies = [
      { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', journal: 'Lancet', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', nExp: '500', nCtrl: '500' },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', journal: 'NEJM', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06', nExp: '300', nCtrl: '300' },
      { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', journal: 'JAMA', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05', nExp: '400', nCtrl: '400' },
    ];
    expect((await request.put(`/api/projects/${tmpProject.id}/autosave`, { data: proj })).ok()).toBeTruthy();

    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-generate').click();
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 20_000 });

    await page.getByTestId('stitch-manuscript-subtab-figures').click();
    const include = page.locator('[data-testid^="stitch-manuscript-asset-include-figure-funnel"]');
    await expect(include).toBeEnabled({ timeout: 20_000 });
    await include.check();
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 20_000 });

    await exportFromExportPanel(page);

    const region = page.getByTestId(REGION);
    await expect(region).toBeVisible({ timeout: 25_000 });
    // §3 — "Warnings should use an appropriate status or alert behavior depending on
    // whether they block export." Nothing is blocked here, so: status/polite.
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveAttribute('data-tone', 'advisory');
    await expect(page.getByTestId(REVIEW)).toContainText('Check before you export');
    await expect.poll(() => isRevealed(page, REGION), { timeout: 10_000 }).toBe(true);
    await expect(page.getByTestId('stitch-manuscript-export-validation-heading')).toBeFocused();

    /* THE RE-CHECK PATH. "Export anyway" re-runs prepareExport against the CURRENT
       draft; here it is still only warnings, so it exports. The reveal contract for
       the recheck is keyed on the fresh fetchedAt, so a second review would announce
       itself again — which is what this proves does not require a page reload. */
    const downloadP = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('stitch-manuscript-export-anyway').click();
    const download = await downloadP;
    expect(download.suggestedFilename()).toMatch(/\.docx$/);
    // Exporting cleared the review: §3's "starts another relevant export attempt".
    await expect(page.getByTestId(REGION)).toHaveCount(0);

    // Ask again → a NEW review with a new fetchedAt → revealed and focused again.
    await exportFromExportPanel(page);
    await expect(page.getByTestId(REGION)).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => isRevealed(page, REGION), { timeout: 10_000 }).toBe(true);
    await expect(page.getByTestId('stitch-manuscript-export-validation-heading')).toBeFocused();
  });

  test('reduced motion: the reveal still lands, without a smooth flight', async ({ page, request, tmpProject }) => {
    // §3 — "Respect the user's reduced-motion setting when scrolling." The utility
    // this reveal goes through switches to behavior:'auto' under the OS setting, so
    // the only observable difference is that it arrives immediately.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await desktop(page);
    await seedBlockingDraft(request, tmpProject.id);
    await openManuscript(page, tmpProject.id, '&msv=continuous');
    await exportFromExportPanel(page);
    await expect(page.getByTestId(REGION)).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => isRevealed(page, REGION), { timeout: 5_000 }).toBe(true);
    await expect(page.getByTestId('stitch-manuscript-export-validation-heading')).toBeFocused();
  });

  test('the NARROW stacked split: a per-item jump shows the editor pane first', async ({ page, request, tmpProject }) => {
    /* The stacked layout shows ONE pane and hides the other with display:none, so a
       jump into the editor while the PDF pane is showing would scroll a box with no
       layout at all. The reveal region itself sits above the row and is visible in
       both. */
    await desktop(page);
    await seedBlockingDraft(request, tmpProject.id);
    await openManuscript(page, tmpProject.id, '&msv=sections');
    await page.setViewportSize({ width: 760, height: 900 });
    await openSplit(page);
    await expect(page.getByTestId(SPLIT)).toHaveAttribute('data-layout', 'stacked');

    /* The stacked layout shows the PDF on open, and the panel host lives inside the
       hidden editor pane — so the export is started from the manuscript side, exactly
       as a researcher would have to. */
    await page.getByTestId('stitch-manuscript-split-pane-editor').click();
    await exportFromExportPanel(page);
    const region = page.getByTestId(REGION);
    await expect(region).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => isRevealed(page, REGION), { timeout: 10_000 }).toBe(true);

    // …now go back to the PDF. The feedback region lives ABOVE the split row, so it
    // is still on screen — but the editor it points into is display:none.
    await page.getByTestId('stitch-manuscript-split-pane-pdf').click();
    await expect(page.getByTestId('stitch-manuscript-split-pdf')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-split-editor')).toBeHidden();
    await expect(region).toBeVisible();

    await page.locator('[data-testid^="stitch-manuscript-export-goto-"]').first().click();
    // The editor pane is now the shown one, and the section really is on screen.
    await expect(page.getByTestId('stitch-manuscript-split-editor')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-split-pane-editor')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('stitch-manuscript-section-results'))
      .toHaveAttribute('aria-current', 'true', { timeout: 10_000 });
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toContainText('RESULTS');
  });

  test('real fullscreen: the reveal works in the focused, chrome-less layout too', async ({ page, request, tmpProject, browserName }) => {
    test.skip(browserName !== 'chromium',
      'Fullscreen grants are unreliable outside the Chromium harness (see e2e/focus/fullscreen.spec.ts).');
    await desktop(page);
    await seedBlockingDraft(request, tmpProject.id);
    await openManuscript(page, tmpProject.id, '&msv=continuous');
    await openSplit(page);
    await page.getByTestId('focus-fullscreen').click();
    await expect.poll(() => isFullscreen(page), { timeout: 10_000 }).toBe(true);

    await exportFromExportPanel(page);
    await expect(page.getByTestId(REGION)).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => isRevealed(page, REGION), { timeout: 10_000 }).toBe(true);
    await expect(page.getByTestId('stitch-manuscript-export-validation-heading')).toBeFocused();

    await page.evaluate(() => document.exitFullscreen && document.exitFullscreen());
    await expect.poll(() => isFullscreen(page), { timeout: 10_000 }).toBe(false);
    // The message survives the layout change — §3's "keep the message visible".
    await expect(page.getByTestId(REGION)).toBeVisible();
  });

  test('§3 — exactly ONE announced surface, and nothing about it reaches the blob', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedBlockingDraft(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await exportFromExportPanel(page);
    await expect(page.getByTestId(REGION)).toBeVisible({ timeout: 25_000 });

    // One live region in the whole document: the per-panel copies are unannounced
    // echoes, so a screen reader reads the failure once, not two-to-four times.
    expect(await page.locator('[role="alert"], [role="status"]')
      .filter({ has: page.getByTestId(REVIEW) }).count()).toBe(1);
    await expect(page.getByTestId(REGION)).toHaveCount(1);
    // The retired role is really gone — this was never a modal.
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    // Validation state is derived at export time and is pure UI: the project blob
    // must not have learned anything about it (the byte-stability convention).
    const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
    const blob = JSON.stringify(proj);
    expect(blob).not.toContain('exportReview');
    expect(blob).not.toContain('absent-table" does not match');
  });
});
