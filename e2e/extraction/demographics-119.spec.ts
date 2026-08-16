/**
 * demographics-119.spec.ts — 119.md §6, scenarios 13 and 14.
 *
 *  13. "Creating a multi-arm demographics table and inserting it into the manuscript."
 *  14. "Editing an underlying demographics value from the manuscript with clear upstream
 *      impact."
 *
 * This file exists because §6's central promise is a CROSS-ENGINE one, and nothing in a
 * pure unit test can prove it: a value typed on an article's extraction form has to reach
 * the manuscript's study-characteristics table, and a value changed in the manuscript has
 * to land back on the SAME extraction row — through the real autosave, the real project
 * blob and the real reload. The two halves are asserted in both directions here.
 *
 * Ids are deterministic: the two preset arms map onto the repo's existing
 * intervention/control model, so their stable ids are `exp` and `ctrl` (demographics.js
 * DEFAULT_ARMS) and the field ids are the catalog ids (`age`).
 */
import { test, expect } from '../fixtures/stitch-test';

type Page = import('@playwright/test').Page;

const extractionUrl = (id: string) => `/app/project/${id}?tab=extraction`;
const manuscriptUrl = (id: string) => `/app/project/${id}?tab=manuscript`;

/** Add one blank study through the manual path (there is no fast API for project.studies). */
async function addStudy(page: Page, author: string, year: string) {
  await page.getByRole('button', { name: /add (first )?study/i }).first().click();
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('button', { name: /add blank study/i }).click();
  await expect(page.getByText('New Study')).toBeVisible();
  await page.getByText('New Study').click();                 // expand the card
  await page.getByPlaceholder('Smith J').first().fill(author);
  await page.getByPlaceholder('2024').first().fill(year);
}

/** Expand the first study card. Its "#1" index chip is the one label that is unique to
 *  the card header (the QC panel repeats the author, the table view repeats the year). */
async function openFirstCard(page: Page) {
  await page.getByText('#1', { exact: true }).first().click();
}

/** Wait for the debounced project autosave to settle. */
async function settle(page: Page) {
  await page.waitForTimeout(1200);
}

test.describe('Basic demographics & study characteristics (119.md §6)', () => {
  test.beforeEach(async ({ setFlags }) => {
    // The classic extraction tab is the surface with the manual "add study" path this
    // spec needs, so the engine flag is pinned OFF rather than inherited from whatever
    // the previous file left behind. (The demographics area is mounted on BOTH
    // surfaces — PecanExtractionEngine renders it above its article list.)
    await setFlags({ manuscriptEditor: true, extractionEngine: false });
  });

  test('§6 scenarios 13-14: a multi-arm table reaches the manuscript, and an edit there reaches extraction', async ({ page, tmpProject, setFlags }) => {
    /* ── 1. one study with two arms of demographics ─────────────────────────── */
    await page.goto(extractionUrl(tmpProject.id));
    await addStudy(page, 'Smith J', '2024');

    // Configure the demographics table: the Age statistic field + two arms.
    const demo = page.getByTestId('pex-demographics');
    await expect(demo).toBeVisible();
    await page.getByTestId('pex-demographics-toggle').click();
    await page.getByTestId('pex-demo-add-age').click();
    await page.getByTestId('pex-demo-tab-arms').click();
    await page.getByTestId('pex-demo-arm-preset-exp').click();
    await page.getByTestId('pex-demo-arm-preset-ctrl').click();
    await expect(page.getByTestId('pex-demo-arm-exp')).toBeVisible();
    await expect(page.getByTestId('pex-demo-arm-ctrl')).toBeVisible();
    await page.getByTestId('pex-demographics-toggle').click();     // Done

    // The article form now offers one age cell per arm, each with its own statistic.
    await expect(page.getByTestId('pex-xf-cell-age-overall')).toBeVisible();
    await page.getByTestId('pex-xf-slot-age-exp-mean').fill('45.2');
    await page.getByTestId('pex-xf-slot-age-exp-sd').fill('10.1');
    await page.getByTestId('pex-xf-stat-age-ctrl').selectOption('median_iqr');
    await page.getByTestId('pex-xf-slot-age-ctrl-median').fill('47');
    await page.getByTestId('pex-xf-slot-age-ctrl-q1').fill('39');
    await page.getByTestId('pex-xf-slot-age-ctrl-q3').fill('56');

    // §6 — "not reported" is a RECORDED fact, not an empty cell.
    await page.getByTestId('pex-xf-state-age-overall').selectOption('not-reported');
    await settle(page);

    // It survives a reload: this is real extraction data, not view state.
    // (Re-pinned first: feature flags are GLOBAL server state, so a spec running in
    // another worker/session can flip the extraction surface underneath a reload.)
    await setFlags({ extractionEngine: false });
    await page.reload();
    await openFirstCard(page);
    await expect(page.getByTestId('pex-xf-slot-age-exp-mean')).toHaveValue('45.2');
    await expect(page.getByTestId('pex-xf-state-age-overall')).toHaveValue('not-reported');

    /* ── 2. the same values, in the manuscript's table (scenario 13) ────────── */
    await page.goto(manuscriptUrl(tmpProject.id));
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-subtab-tables').click();
    const tables = page.getByTestId('stitch-manuscript-assets-tables');
    await expect(tables).toBeVisible();

    // One column per arm, each rendering the statistic the article actually reported.
    await expect(tables).toContainText('Age (years) — Intervention');
    await expect(tables).toContainText('Age (years) — Control');
    await expect(tables).toContainText('45.2 (10.1) years');
    await expect(tables).toContainText('47 (IQR 39–56) years');
    await expect(tables).toContainText('NR');              // the overall cell, recorded as not reported

    // …and the reviewer may CHOOSE to insert it, where it takes normal table numbering.
    await page.getByTestId('stitch-manuscript-asset-insert-table-study').click();
    await expect(tables).toContainText(/inserted|Table 1/i);

    /* ── 3. editing a value FROM the manuscript (scenario 14) ───────────────── */
    // The OVERALL column carries the recorded "not reported" state — opening it shows the
    // state, not a blank box, and its value inputs stay disabled until the state is cleared.
    await page.locator('[data-testid$="-demo-age"]').first().click();
    await expect(page.getByTestId('stitch-manuscript-demo-state')).toHaveValue('not-reported');

    // The Intervention arm's cell is the one holding a mean and an SD.
    const cell = page.locator('[data-testid$="-demo-age-exp"]').first();
    await expect(cell).toBeVisible();
    await cell.click();

    // The upstream impact is stated before anything is written.
    const notice = page.getByTestId('stitch-manuscript-demo-upstream');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('This changes the extracted project data');
    await expect(notice).toContainText('Smith J 2024');

    await page.getByTestId('stitch-manuscript-demo-input-mean').fill('46.8');
    await page.getByTestId('stitch-manuscript-demo-save').click();
    await expect(tables).toContainText('46.8 (10.1) years');
    await expect(tables).toContainText('Saved to Extraction');
    await settle(page);

    /* ── 4. it changed the EXTRACTION row, not a manuscript-side copy ───────── */
    await setFlags({ extractionEngine: false });
    await page.goto(extractionUrl(tmpProject.id));
    await openFirstCard(page);
    await expect(page.getByTestId('pex-xf-slot-age-exp-mean')).toHaveValue('46.8');
    await expect(page.getByTestId('pex-xf-slot-age-exp-sd')).toHaveValue('10.1');   // untouched
  });

  test('§6: a demographics field is archived, never silently deleted, once it holds data', async ({ page, tmpProject }) => {
    await page.goto(extractionUrl(tmpProject.id));
    await addStudy(page, 'Jones A', '2023');

    await page.getByTestId('pex-demographics-toggle').click();
    await page.getByTestId('pex-demo-add-age').click();
    await page.getByTestId('pex-demographics-toggle').click();
    await page.getByTestId('pex-xf-slot-age-overall-mean').fill('61');
    await settle(page);

    // The project-fields configuration screen refuses the hard delete and says why.
    page.once('dialog', (d) => d.dismiss());
    await page.getByTestId('pex-manage-field-toggle').click();
    await page.getByTestId('pex-xf-delete-age').click();
    await expect(page.getByTestId('pex-xf-archive-age')).toBeVisible();
    await page.getByTestId('pex-manage-field-toggle').click();
    await expect(page.getByTestId('pex-xf-slot-age-overall-mean')).toHaveValue('61');
  });
});
