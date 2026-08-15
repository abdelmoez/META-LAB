/**
 * manuscript-continuous.spec.ts — 118.md §10-§19, §45, §64-§65, §66 ("Continuous
 * View" list).
 *
 * The Continuous Document View is the one part of this redesign that a unit test
 * genuinely cannot prove: it exists to be SCROLLED. What this file pins is exactly
 * that — that the whole manuscript really is one editable document, that switching
 * views never loses a keystroke that is still inside the two autosave debounces,
 * that clicking a section scrolls it to a place the sticky toolbar does not hide,
 * that the active-section indicator follows the reader without flip-flopping, and
 * that citations / cross-references still work with the caret ten sections down.
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect, Page } from '../fixtures/stitch-test';

const HEADER = 'stitch-manuscript-header';
const SCROLLER = 'stitch-main-content';

async function openManuscript(page: Page, projectId: string, params = '') {
  await page.goto(`/app/project/${projectId}?tab=manuscript&ms=editor${params}`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stitch-manuscript-editor')).toBeVisible({ timeout: 20_000 });
}

/** A window wide enough that the toolbar is not condensing while we read it. */
async function desktop(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 });
}

/** Fill the manuscript so there is a real document to scroll through. */
async function generateAll(page: Page) {
  await page.getByTestId('stitch-manuscript-generate').click();
  await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });
}

/**
 * Studies + PRISMA counts, so the reference library is non-empty and the generated
 * tables/figures are AVAILABLE — §18 asks for citations and cross-references to work
 * inside the continuous document, and neither exists without data.
 */
async function seedData(request: import('@playwright/test').APIRequestContext, projectId: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  proj.prisma = { dbs: '1200', reg: '50', other: '0', dedupe: '250', excTA: '800', excFull: '180', reasons: [], included: '', quant: '' };
  proj.studies = [
    { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', journal: 'Lancet', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', nExp: '500', nCtrl: '500' },
    { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', journal: 'NEJM', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06', nExp: '300', nCtrl: '300' },
    { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', journal: 'JAMA', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05', nExp: '400', nCtrl: '400' },
  ];
  expect((await request.put(`/api/projects/${projectId}/autosave`, { data: proj })).ok()).toBeTruthy();
}

const toContinuous = async (page: Page) => {
  await page.getByTestId('stitch-manuscript-view-continuous').click();
  await expect(page.getByTestId('stitch-manuscript-continuous')).toBeVisible({ timeout: 15_000 });
};
const toSections = async (page: Page) => {
  await page.getByTestId('stitch-manuscript-view-sections').click();
  await expect(page.getByTestId('stitch-manuscript-continuous')).toHaveCount(0);
};

/** The active outline row (118.md §16 — the indicator the reader watches). */
const activeSection = async (page: Page) => page
  .locator('[data-testid^="stitch-manuscript-section-"][data-active="true"]')
  .first()
  .getAttribute('data-testid');

test.describe('Manuscript continuous document view (118.md §10-§19)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  /* ── §12: the switcher, its URL and its memory ─────────────────────────────── */

  test('§12/§47: the view switcher lives on the Editor tab, deep-links, and is remembered', async ({ page, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);

    // One control, two exclusive states — and Section View is the default (§12).
    const switcher = page.getByTestId('stitch-manuscript-view-switcher');
    await expect(switcher).toHaveAttribute('role', 'radiogroup');
    await expect(page.getByTestId('stitch-manuscript-view-sections')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('stitch-manuscript-continuous')).toHaveCount(0);

    // It means nothing on the other destinations, so it is not there.
    await page.getByTestId('stitch-manuscript-subtab-tables').click();
    await expect(switcher).toHaveCount(0);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await expect(switcher).toBeVisible();

    // Switching is real URL state (§47) …
    await toContinuous(page);
    await expect(page).toHaveURL(/msv=continuous/);
    await expect(page.getByTestId('stitch-manuscript-view-continuous')).toHaveAttribute('aria-checked', 'true');

    // … it survives a destination change, and comes back with it (§46/§48).
    await page.getByTestId('stitch-manuscript-subtab-references').click();
    await expect(page).toHaveURL(/msv=continuous/);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await expect(page.getByTestId('stitch-manuscript-continuous')).toBeVisible();

    // …a reload keeps it (the URL carries it) …
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-continuous')).toBeVisible({ timeout: 20_000 });

    // …and so does a fresh visit with NO view in the URL: the preference was stored
    // per user, which is the whole of "refreshing does not reset their workflow".
    await page.goto(`/app/project/${tmpProject.id}?tab=manuscript&ms=editor`);
    await expect(page.getByTestId('stitch-manuscript-continuous')).toBeVisible({ timeout: 20_000 });

    // Back to Section View — one section at a time, exactly as before.
    await toSections(page);
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toHaveCount(0); // title section is an input
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toBeVisible();
  });

  /* ── §45: switching views must never lose work ─────────────────────────────── */

  test('§45: type in Section View → switch → the edit is there → keep editing → switch back → refresh', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);

    // 1-2. Type, then switch IMMEDIATELY — both debounces (600 ms field patch →
    // 800 ms blob autosave) are still armed. The toggle must flush them.
    await page.getByTestId('stitch-manuscript-section-introduction').click();
    const sectionEditor = page.getByTestId('stitch-manuscript-rich-editor');
    await sectionEditor.click();
    const first = `Section-view marker ${Date.now()}`;
    await page.keyboard.type(first);
    await toContinuous(page);

    // 3. The edit exists in the continuous document.
    const introDoc = page.getByTestId('stitch-manuscript-rich-editor-introduction');
    await expect(introDoc).toContainText(first, { timeout: 15_000 });

    // 4. Continue editing — in the document, without leaving it.
    await introDoc.click();
    await page.keyboard.press('ControlOrMeta+End');
    const second = ` and continuous-view marker ${Date.now()}`;
    await page.keyboard.type(second);

    // 5. Switch back: both edits are in the section editor.
    await toSections(page);
    await page.getByTestId('stitch-manuscript-section-introduction').click();
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toContainText(first, { timeout: 15_000 });
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toContainText(second.trim());

    // 6-7. …and they really landed on the server, so a refresh shows them.
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });
    await expect(async () => {
      const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const blob = JSON.stringify(proj.manuscripts || []);
      expect(blob).toContain(first);
      expect(blob).toContain(second.trim());
    }).toPass({ timeout: 25_000 });

    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-introduction').click();
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toContainText(first, { timeout: 15_000 });
  });

  /* ── §11/§60: it is ONE document ───────────────────────────────────────────── */

  test('§11/§60: the whole manuscript is one scrollable document — title to references', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedData(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await generateAll(page);
    await toContinuous(page);

    // ONE page, not a stack of cards.
    await expect(page.getByTestId('stitch-manuscript-page')).toHaveCount(1);
    await expect(page.getByTestId('stitch-manuscript-title-input')).toBeVisible();

    // Every section, in reading order, each with its own editable body.
    const order = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion'];
    let previousTop = -Infinity;
    for (const id of order) {
      const block = page.getByTestId(`stitch-manuscript-doc-${id}`);
      await expect(block).toHaveCount(1);
      const box = await block.boundingBox();
      expect(box!.y, `${id} is out of document order`).toBeGreaterThan(previousTop);
      previousTop = box!.y;
    }
    for (const id of order.slice(1)) {
      await expect(page.getByTestId(`stitch-manuscript-rich-editor-${id}`)).toHaveAttribute('contenteditable', 'true');
    }

    // The declarations and the rendered bibliography close the document (§11/§21).
    await expect(page.getByTestId('stitch-manuscript-continuous-statements')).toHaveCount(1);
    const refs = page.getByTestId('stitch-manuscript-continuous-references');
    await expect(refs).toHaveCount(1);
    await expect(refs.locator('li').first()).toContainText(/Smith|Lee|Brown/);
    // …read-only: the library itself stays in the References destination (§21).
    await expect(refs.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
    await refs.getByTestId('stitch-manuscript-continuous-references-open').click();
    await expect(page.getByTestId('stitch-manuscript-subtab-references')).toHaveAttribute('aria-selected', 'true');
  });

  /* ── §15-§17: navigation inside the document ───────────────────────────────── */

  test('§15-§17: clicking a section scrolls to it, below the sticky toolbar, and updates the active item', async ({ page, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    await generateAll(page);
    await toContinuous(page);

    const scroller = page.getByTestId(SCROLLER);
    const before = await scroller.evaluate((el) => el.scrollTop);

    // Click Methods in the outline: the view does NOT change (§15) — it scrolls.
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(page.getByTestId('stitch-manuscript-continuous')).toBeVisible();
    await expect.poll(async () => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(before + 40);

    // §17 — the heading lands BELOW the sticky toolbar, never behind it.
    const heading = page.getByTestId('stitch-manuscript-doc-methods').locator('h2').first();
    await expect.poll(async () => {
      const h = await heading.boundingBox();
      const bar = await page.getByTestId(HEADER).boundingBox();
      return h && bar ? Math.round(h.y - (bar.y + bar.height)) : -999;
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(0);

    // …the navigation says where we are …
    await expect.poll(() => activeSection(page), { timeout: 10_000 })
      .toBe('stitch-manuscript-section-methods');

    // …and it is STILL ON SCREEN after the scroll (§15): an outline that scrolled
    // away with the prose would be usable exactly once.
    await expect(page.getByTestId('stitch-manuscript-section-conclusion')).toBeInViewport();

    // §16 — scrolling (not clicking) into Discussion activates Discussion.
    await page.getByTestId('stitch-manuscript-doc-discussion')
      .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await expect.poll(() => activeSection(page), { timeout: 10_000 })
      .toBe('stitch-manuscript-section-discussion');

    // …and it does not flip back and forth once it has settled (no jitter).
    const settled = await activeSection(page);
    await page.waitForTimeout(700);
    expect(await activeSection(page)).toBe(settled);
  });

  /* ── §18: full editing parity ──────────────────────────────────────────────── */

  test('§18: citations and cross-references can be inserted INSIDE the continuous document', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedData(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await generateAll(page);
    await toContinuous(page);

    // Put the caret in Discussion — ten sections into a document that never
    // remounts. The shared toolbar must act on THAT editor.
    const discussion = page.getByTestId('stitch-manuscript-rich-editor-discussion');
    await discussion.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Earlier work agrees ');

    const citesBefore = await discussion.locator('.ms-cite').count();
    await page.getByTestId('stitch-manuscript-insert-citation').click();
    const citePicker = page.getByTestId('stitch-manuscript-insert-citation-popover');
    await expect(citePicker).toBeVisible();
    await citePicker.getByTestId('stitch-manuscript-insert-citation-search').fill('Smith');
    await citePicker.getByRole('option').first().click();
    await expect(discussion.locator('.ms-cite')).toHaveCount(citesBefore + 1, { timeout: 10_000 });

    // A cross-reference, in the same sentence, in the same section.
    await page.keyboard.type('and the pooled result is shown in ');
    const chipsBefore = await discussion.locator('.ms-asset').count();
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    const xrefPicker = page.getByTestId('stitch-manuscript-crossref-popover');
    await expect(xrefPicker).toBeVisible();
    await xrefPicker.getByRole('option').first().click();
    await expect(discussion.locator('.ms-asset')).toHaveCount(chipsBefore + 1, { timeout: 10_000 });

    // Both landed in DISCUSSION — not in whichever section happened to be first.
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });
    await expect(async () => {
      const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const draft = (proj.manuscripts || [])[0] || {};
      expect(String(draft.sections?.discussion?.content || '')).toContain('[[cite:');
      expect(String(draft.sections?.discussion?.content || '')).toContain('Earlier work agrees');
    }).toPass({ timeout: 25_000 });

    // …and the edit is visible in Section View too — one manuscript, two views (§13).
    await toSections(page);
    await page.getByTestId('stitch-manuscript-section-discussion').click();
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toContainText('Earlier work agrees', { timeout: 15_000 });
  });

  /* ── §43/§66: the editor's own keyboard still owns the document ────────────── */

  test('§43/§66: undo and redo work inside the continuous document', async ({ page, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    await toContinuous(page);

    const methods = page.getByTestId('stitch-manuscript-rich-editor-methods');
    await methods.click();
    await page.keyboard.type('Eligibility was assessed in duplicate.');
    await expect(methods).toContainText('assessed in duplicate');

    // The toolbar must not intercept the platform chords (§43) — this is the
    // browser's native undo stack, which is why the editor never binds them.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(methods).not.toContainText('assessed in duplicate', { timeout: 10_000 });
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(methods).toContainText('assessed in duplicate', { timeout: 10_000 });

    // …and the restored text is autosaved like any other edit.
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });
  });

  /* ── §64: View in manuscript, from Updates ─────────────────────────────────── */

  test('§64: an update card opens the section it is about, without leaving the document', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    await toContinuous(page);

    // Warm the sync plan, then generate: a section can only go OUT of date once it
    // has recorded what it was generated from.
    await page.getByTestId('stitch-manuscript-subtab-updates').click();
    await expect(page.getByTestId('stitch-manuscript-freshness').first())
      .not.toContainText(/unknown/i, { timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await generateAll(page);

    let proj: any = null;
    await expect(async () => {
      proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      expect(proj?.manuscripts?.[0]?.sections?.methods?.inputsHash).toBeTruthy();
    }).toPass({ timeout: 20_000 });

    // Change a dependency server-side so real sections go out of date.
    proj.analysisSettings = { ...(proj.analysisSettings || {}), tau2Method: 'REML' };
    expect((await request.put(`/api/projects/${tmpProject.id}/autosave`, { data: proj })).ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('stitch-manuscript-subtab-updates').click();
    const action = page.locator('[data-testid^="stitch-manuscript-update-view-"]').first();
    await expect(action).toBeVisible({ timeout: 20_000 });
    const sectionId = (await action.getAttribute('data-testid'))!.replace('stitch-manuscript-update-view-', '');
    await action.click();

    // §64 — "If Continuous View is active, scroll there": the view is preserved and
    // the document lands on the section the update is about.
    await expect(page.getByTestId('stitch-manuscript-continuous')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => activeSection(page), { timeout: 10_000 })
      .toBe(`stitch-manuscript-section-${sectionId}`);
  });

  /* ── §65: View in manuscript ────────────────────────────────────────────────── */

  test('§65: "View in manuscript" on a table jumps to the sentence that references it', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedData(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await generateAll(page);
    await toContinuous(page);

    // Put a cross-reference in Results OURSELVES, so the precondition of this test
    // is stated rather than inherited from whatever the generator happened to write:
    // §65 is about the manager and the prose pointing at ONE entity.
    const results = page.getByTestId('stitch-manuscript-rich-editor-results');
    await results.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Study characteristics are summarised in ');
    const chipsBefore = await results.locator('.ms-asset').count();
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    const picker = page.getByTestId('stitch-manuscript-crossref-popover');
    await expect(picker).toBeVisible();
    await picker.getByRole('option').first().click();
    await expect(results.locator('.ms-asset')).toHaveCount(chipsBefore + 1, { timeout: 10_000 });
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });

    // The Tables manager can now offer to show that table where it appears.
    await page.getByTestId('stitch-manuscript-subtab-tables').click();
    const view = page.locator('[data-testid^="stitch-manuscript-asset-view-"]').first();
    await expect(view).toBeVisible({ timeout: 20_000 });
    await view.click();

    // Back in the Editor, in the continuous document, on the referencing section.
    await expect(page.getByTestId('stitch-manuscript-continuous')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => activeSection(page), { timeout: 10_000 })
      .toBe('stitch-manuscript-section-results');
    // …and the chip it pointed at is the one the browser focused (no copy was made).
    await expect(page.locator('.ms-asset:focus')).toHaveCount(1);
  });
});
