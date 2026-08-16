/**
 * manuscript-templates-119.spec.ts — 119.md §7, and §10 high-priority scenario 15:
 * "Switching templates without losing unmapped content."
 *
 * What only a browser can prove here: that the whole round trip — open the switcher,
 * read a real diff of the CURRENT draft, apply, watch the document re-lay itself,
 * confirm the text that has no home in the new structure is still on the page AND
 * still in the persisted blob after a reload, then undo and get the original
 * structure back — actually holds against the live autosave, the live editor and the
 * live URL. The pure planner, the never-delete normalizer and the snapshot contract
 * are pinned in tests/unit/manuscript/templates119.test.js.
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect, Page } from '../fixtures/stitch-test';

const SENTINEL_RESULTS = 'RESULTS-SENTINEL pooled odds ratio 0.72 across three trials';
const SENTINEL_DISCUSSION = 'DISCUSSION-SENTINEL these findings extend the prior literature';

async function openManuscript(page: Page, projectId: string, params = '') {
  await page.goto(`/app/project/${projectId}?tab=manuscript&ms=editor${params}`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
}

/** A window wide enough that the toolbar keeps its Level-A controls inline (§41). */
async function desktop(page: Page) {
  await page.setViewportSize({ width: 1800, height: 950 });
}

/**
 * Seed real prose through the API. The scenario is about CONTENT survival, so the
 * text must exist before the switch and be identifiable after it — writing it in the
 * editor would test the editor, not the switch.
 */
async function seedSections(request: import('@playwright/test').APIRequestContext, projectId: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  const drafts = proj.manuscripts || [];
  const d = drafts[0] || { id: 'd1', sections: {} };
  d.title = 'A pooled analysis of three trials';
  d.sections = {
    ...(d.sections || {}),
    title: { content: 'A pooled analysis of three trials', userEdited: true },
    introduction: { content: 'INTRO-SENTINEL background paragraph.', userEdited: true },
    methods: { content: 'METHODS-SENTINEL we searched three databases.', userEdited: true },
    results: { content: SENTINEL_RESULTS, userEdited: true },
    discussion: { content: SENTINEL_DISCUSSION, userEdited: true },
    limitations: { content: 'LIMITATIONS-SENTINEL few trials, short follow-up.', userEdited: true },
    conclusion: { content: 'CONCLUSION-SENTINEL the intervention is probably beneficial.', userEdited: true },
  };
  proj.manuscripts = [d, ...drafts.slice(1)];
  expect((await request.put(`/api/projects/${projectId}/autosave`, { data: proj })).ok()).toBeTruthy();
}

/** The stored draft, straight from the API — the only honest persistence check. */
async function storedDraft(request: import('@playwright/test').APIRequestContext, projectId: string) {
  const p = await (await request.get(`/api/projects/${projectId}`)).json();
  return (p.manuscripts || [])[0] || {};
}

/**
 * Wait for the SERVER to hold the expected state.
 *
 * The save pill is set the moment the manuscript hands its list to the shell's
 * autosave (see the honesty note in useManuscript.js), and the blob PUT sits behind
 * that layer's own debounce — so "Saved" is not proof the row moved. Polling the API
 * is, and it is what every persistence claim in this file rests on.
 */
async function pollDraft(
  request: import('@playwright/test').APIRequestContext,
  projectId: string,
  read: (d: any) => unknown,
  expected: unknown,
) {
  await expect
    .poll(async () => read(await storedDraft(request, projectId)), { timeout: 25_000 })
    .toEqual(expected);
  return storedDraft(request, projectId);
}

async function openSwitcher(page: Page) {
  await page.getByTestId('stitch-manuscript-structure-select').click();
  await expect(page.getByTestId('stitch-manuscript-structure-dialog')).toBeVisible({ timeout: 10_000 });
}

test.describe('Manuscript reporting structures (119.md §7)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  /* ── §10 scenario 15 ──────────────────────────────────────────────────────── */

  test('§7 / §10-15: switching templates never loses unmapped content, and undo restores', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedSections(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);

    // The toolbar names the structure the draft is on — the implicit IMRAD default.
    const control = page.getByTestId('stitch-manuscript-structure-select');
    await expect(control).toContainText('Structure:');
    await expect(control).toContainText('Generic biomedical IMRAD');

    /* ── PREVIEW (§7 "Preview a template before applying it") ── */
    await openSwitcher(page);
    const dialog = page.getByTestId('stitch-manuscript-structure-dialog');
    await expect(dialog.getByTestId('stitch-manuscript-structure-current-imrad')).toBeVisible();

    // A protocol has no Results and no Discussion — the sharpest unmapped case.
    await dialog.getByTestId('stitch-manuscript-structure-option-prisma-p').click();

    // §7 "Record the guideline/version and the date on which the template was reviewed".
    const prov = dialog.getByTestId('stitch-manuscript-structure-provenance');
    await expect(prov).toContainText('PRISMA-P');
    await expect(prov).toContainText('2015');
    await expect(prov).toContainText(/Reviewed:\s*\d{4}-\d{2}-\d{2}/);

    // §7 "See what will be added, renamed, reordered, or hidden".
    await expect(dialog.getByTestId('stitch-manuscript-structure-summary')).toContainText('new section');
    await expect(dialog.getByTestId('stitch-manuscript-structure-row-administrative-information'))
      .toHaveAttribute('data-state', 'added');

    // §7 "Preserve unmapped content in a clearly labeled area" — named, sized, and
    // preserved BY DEFAULT (the select's initial value is "keep").
    const unmapped = dialog.getByTestId('stitch-manuscript-structure-unmapped');
    await expect(unmapped).toContainText('Nothing is deleted');
    for (const id of ['results', 'discussion', 'limitations', 'conclusion']) {
      await expect(dialog.getByTestId(`stitch-manuscript-structure-map-${id}`)).toHaveValue('');
      await expect(dialog.getByTestId(`stitch-manuscript-structure-preserved-${id}`)).toBeVisible();
    }

    /* ── §7 "Cancel safely" ── */
    await dialog.getByTestId('stitch-manuscript-structure-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(control).toContainText('Generic biomedical IMRAD');
    expect((await storedDraft(request, tmpProject.id)).structure).toBeUndefined();

    /* ── MAP one section, PRESERVE the rest, APPLY ── */
    await openSwitcher(page);
    await dialog.getByTestId('stitch-manuscript-structure-option-prisma-p').click();
    // §7 "Map existing sections to the new structure": Results → Methods.
    await dialog.getByTestId('stitch-manuscript-structure-map-results').selectOption('methods');
    await expect(dialog.getByTestId('stitch-manuscript-structure-summary'))
      .toContainText('1 merged into another section');
    await dialog.getByTestId('stitch-manuscript-structure-apply').click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });
    await expect(control).toContainText('Systematic review protocol (PRISMA-P)');

    /* ── the content survived, on screen ── */
    const doc = page.getByTestId('stitch-manuscript-continuous');
    await expect(doc).toBeVisible({ timeout: 15_000 });
    // The MAPPED text moved into Methods, under a heading that says where it came from.
    await expect(doc).toContainText(SENTINEL_RESULTS);
    // The PRESERVED ones are still their own sections, and say why they are there.
    await expect(doc).toContainText(SENTINEL_DISCUSSION);
    await expect(page.getByTestId('stitch-manuscript-retained-discussion')).toContainText('Not part of the current template');
    await expect(page.getByTestId('stitch-manuscript-retained-limitations')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-retained-conclusion')).toBeVisible();
    // …and the new structure's own section is there, empty and ready.
    await expect(page.getByTestId('stitch-manuscript-doc-administrative-information')).toBeVisible();

    /* ── it survived the AUTOSAVE, not just the render ── */
    const saved = await pollDraft(request, tmpProject.id, (d) => d.structure && d.structure.id, 'prisma-p');
    expect(saved.sections.discussion.content).toContain('DISCUSSION-SENTINEL');
    expect(saved.sections.limitations.content).toContain('LIMITATIONS-SENTINEL');
    expect(saved.sections.conclusion.content).toContain('CONCLUSION-SENTINEL');
    expect(saved.sections.methods.content).toContain('RESULTS-SENTINEL');
    // The journal profile and the citation style were NOT touched (§7's separation).
    expect(saved.templateId).toBe('generic');
    expect(saved.citationStyle).toBe('vancouver');

    /* ── and a RELOAD still shows it (persistence, not memory) ── */
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stitch-manuscript-structure-select')).toContainText('PRISMA-P');
    await expect(page.getByTestId('stitch-manuscript-continuous')).toContainText(SENTINEL_DISCUSSION);

    /* ── §7 "Undo a template change" ── */
    await openManuscript(page, tmpProject.id);
    await openSwitcher(page);
    await page.getByTestId('stitch-manuscript-structure-dialog')
      .getByTestId('stitch-manuscript-structure-option-care').click();
    await page.getByTestId('stitch-manuscript-structure-apply').click();
    await expect(page.getByTestId('stitch-manuscript-structure-select')).toContainText('Case report (CARE)');

    const undoBar = page.getByTestId('stitch-manuscript-structure-undo-bar');
    await expect(undoBar).toContainText('nothing was deleted');
    await undoBar.getByTestId('stitch-manuscript-structure-undo').click();

    await expect(page.getByTestId('stitch-manuscript-structure-select')).toContainText('PRISMA-P');
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });
    const undone = await pollDraft(request, tmpProject.id,
      (d) => (d.sections.discussion || {}).content && d.structure && d.structure.id, 'prisma-p');
    // Every sentence is still there after the switch AND the undo.
    expect(undone.sections.discussion.content).toContain('DISCUSSION-SENTINEL');
    expect(undone.sections.methods.content).toContain('RESULTS-SENTINEL');
    expect(undone.sections.introduction.content).toContain('INTRO-SENTINEL');
  });

  /* ── §7: the three dimensions really are separate ─────────────────────────── */

  test('§7: changing the citation style never rewrites the section structure', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedSections(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);

    await openSwitcher(page);
    await page.getByTestId('stitch-manuscript-structure-dialog')
      .getByTestId('stitch-manuscript-structure-option-consort').click();
    await page.getByTestId('stitch-manuscript-structure-apply').click();
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });

    const before = await pollDraft(request, tmpProject.id, (d) => d.structure && d.structure.id, 'consort');
    const sectionIds = before.structure.sections.map((s: { id: string }) => s.id);
    expect(sectionIds).toContain('open-science');
    expect(sectionIds).toContain('harms');

    /* Two changes on the OTHER two dimensions. Journal profile FIRST: choosing a
       profile adopts that journal's default reference style (the 118 behaviour), so
       picking the citation style afterwards is what "these are independent" means
       in practice — the researcher's explicit style choice is the one that stands. */
    const header = page.getByTestId('stitch-manuscript-header');
    await header.getByLabel('Template').selectOption('jama');
    await header.getByLabel('Citation style').selectOption('harvard');

    await expect.poll(async () => {
      const d = await storedDraft(request, tmpProject.id);
      return `${d.citationStyle}|${d.templateId}`;
    }, { timeout: 20_000 }).toBe('harvard|jama');

    const after = await storedDraft(request, tmpProject.id);
    expect(after.structure.id).toBe('consort');
    expect(after.structure.sections.map((s: { id: string }) => s.id)).toEqual(sectionIds);
    // …and the structure control still names the structure, not the journal.
    await expect(page.getByTestId('stitch-manuscript-structure-select')).toContainText('CONSORT');
  });

  /* ── §7: customize the resulting structure ────────────────────────────────── */

  test('§7: a section can be renamed and reordered, and the text never moves', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await seedSections(request, tmpProject.id);
    await page.goto(`/app/project/${tmpProject.id}?tab=manuscript&ms=export`);
    await expect(page.getByTestId('stitch-manuscript-structure-block')).toBeVisible({ timeout: 20_000 });

    // The three dimensions are three blocks on this destination.
    await expect(page.getByText('Reporting structure', { exact: true })).toBeVisible();
    await expect(page.getByText('Journal profile', { exact: true })).toBeVisible();

    // Rename Methods — the id (and therefore the text) must not move.
    await page.getByTestId('stitch-manuscript-structure-rename-methods').click();
    const input = page.getByTestId('stitch-manuscript-structure-rename-input-methods');
    await input.fill('Materials and methods');
    await input.press('Enter');
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 25_000 });

    let saved = await pollDraft(request, tmpProject.id,
      (d) => d.structure && d.structure.sections.find((s: { id: string }) => s.id === 'methods').label,
      'Materials and methods');
    expect(saved.sections.methods.content).toContain('METHODS-SENTINEL');

    // Reorder: Limitations moves above Discussion.
    await page.getByTestId('stitch-manuscript-structure-up-limitations').click();
    saved = await pollDraft(request, tmpProject.id, (d) => {
      const ids = ((d.structure || {}).sections || []).map((s: { id: string }) => s.id);
      return ids.indexOf('limitations') < ids.indexOf('discussion') && ids.indexOf('limitations') >= 0;
    }, true);
    const order = saved.structure.sections.map((s: { id: string }) => s.id);
    expect(order.indexOf('limitations')).toBeLessThan(order.indexOf('discussion'));
    expect(saved.sections.limitations.content).toContain('LIMITATIONS-SENTINEL');

    // …and the document reads in the new order.
    await page.goto(`/app/project/${tmpProject.id}?tab=manuscript&ms=editor`);
    const doc = page.getByTestId('stitch-manuscript-continuous');
    await expect(doc).toBeVisible({ timeout: 20_000 });
    const html = await doc.innerHTML();
    expect(html.indexOf('stitch-manuscript-doc-limitations'))
      .toBeLessThan(html.indexOf('stitch-manuscript-doc-discussion'));
  });
});
