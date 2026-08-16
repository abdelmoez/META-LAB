/**
 * manuscript-citation-caret-120.spec.ts — 120.md §5 "Exact-Caret Citation and
 * Cross-Reference Insertion".
 *
 * §5 exists because citations landed at the START of the section instead of at the
 * researcher's I-beam. Every part of that defect is an engine fact and none of it
 * is provable in Node:
 *
 *   · the clobber itself — the root's `onFocus` fires SYNCHRONOUSLY inside the
 *     `el.focus()` that was restoring the caret, after the browser has installed
 *     its own position-0 caret for a newly focused contentEditable;
 *   · the focus theft — a popover, its list and its autoFocus'd search input all
 *     take focus before anything has bookmarked where the caret was;
 *   · the routing — in Continuous View ten editors are mounted at once and the
 *     "active" one is written by an IntersectionObserver as the reader scrolls;
 *   · the history — one insertion must be ONE native undo step, and a cancelled
 *     picker must leave the stack untouched.
 *
 * The pure resolution rule ("is this still the same place in the text?") is pinned
 * in tests/unit/manuscript/caretInsert120.test.jsx; this file is the journey.
 *
 * File name deliberately does NOT match the `webkit-manuscript` project pattern
 * (`manuscript-{table,figure}*`): this is a chromium journey. The WebKit-specific
 * half of §5 — selection lost when focus reaches a control — is covered by the
 * paste spec's engine matrix and by the 119.md table specs that already run there.
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect } from '../fixtures/stitch-test';

type Page = import('@playwright/test').Page;
type APIRequestContext = import('@playwright/test').APIRequestContext;

/** Three included studies, so the citation picker has something to search. */
async function seedStudies(request: APIRequestContext, projectId: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  proj.prisma = { dbs: '900', reg: '20', other: '0', dedupe: '120', excTA: '600', excFull: '150', reasons: [], included: '', quant: '' };
  proj.studies = [
    { id: 's1', title: 'Alpha trial of the intervention', authors: 'Alpha A', year: '2019', journal: 'Lancet', doi: '10.1000/alpha' },
    { id: 's2', title: 'Beta trial of the intervention', authors: 'Beta B', year: '2021', journal: 'NEJM', doi: '10.1000/beta' },
    { id: 's3', title: 'Gamma cohort of the intervention', authors: 'Gamma G', year: '2020', journal: 'JAMA', doi: '10.1000/gamma' },
  ];
  expect((await request.put(`/api/projects/${projectId}/autosave`, { data: proj })).ok()).toBeTruthy();
}

const editorOf = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor');
const citeChips = (page: Page) => editorOf(page).locator('span.ms-cite[data-cite]');
const assetChips = (page: Page) => editorOf(page).locator('span.ms-asset[data-asset]');
const titlesOf = (page: Page) => editorOf(page).locator('.ms-tblcap-t');

async function openEditorSection(page: Page, projectId: string, section: string) {
  await page.goto(`/app/project/${projectId}?tab=manuscript&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId(`stitch-manuscript-section-${section}`).click();
  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  return editor;
}

/** Everything the section says, with the chip's own `&nbsp;` normalised away, so an
    assertion can name the EXACT position a chip landed in. */
function normText(loc: ReturnType<typeof editorOf>) {
  return loc.evaluate((el) => String(el.textContent || '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

/** Walk the caret left N characters — the honest way to reach mid-sentence. */
async function caretLeft(page: Page, n: number) {
  for (let i = 0; i < n; i += 1) await page.keyboard.press('ArrowLeft');
}

/** Open the citation picker, SEARCH in it (the focus-stealing step §5 names), pick. */
async function citeVia(page: Page, testIdPrefix: string, search: string) {
  await page.getByTestId(testIdPrefix).click();
  const popover = page.getByTestId(`${testIdPrefix}-popover`);
  await expect(popover).toBeVisible();
  await popover.getByTestId(`${testIdPrefix}-search`).fill(search);
  await expect(popover.getByRole('option')).toHaveCount(1);
  await popover.getByRole('option').first().click();
  await expect(popover).toHaveCount(0);
}
const cite = (page: Page, search: string) => citeVia(page, 'stitch-manuscript-insert-citation', search);

async function saved(page: Page) {
  await expect(page.getByTestId('stitch-manuscript-save-status').first())
    .toContainText(/Saved/i, { timeout: 25_000 });
}

/** Insert an r×c table at the caret through the toolbar grid picker. */
async function insertTable(page: Page, r = 2, c = 2) {
  await page.getByTestId('stitch-manuscript-tb-table').click();
  await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
  await page.getByTestId(`stitch-manuscript-table-grid-${r}-${c}`).click();
}

test.describe('Exact-caret citation and cross-reference insertion (120.md §5)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  /* ── Journey D: the citation goes where the I-beam is ───────────────────────── */

  test('§5: mid-sentence, at the end of a paragraph, and inside a list item', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');

    /* MID-SENTENCE — THE DEFECT. Before 120.md §5 this chip landed at character 0
       of the section, because restoring focus to the editor overwrote the very
       caret the restore was about to read. */
    const sentence = 'Pooled estimates favoured the intervention.';
    await page.keyboard.type(sentence);
    await caretLeft(page, sentence.length - 'Pooled estimates'.length);
    await cite(page, 'Alpha');
    await expect(citeChips(page)).toHaveCount(1);
    await expect(citeChips(page).first()).toHaveText('[1]', { timeout: 10_000 });
    /* Exactly AT the caret: no space is invented before the chip, and the `&nbsp;`
       the inserter leaves behind is the one after it. */
    expect(await normText(editor)).toBe('Pooled estimates[1] favoured the intervention.');

    /* END OF A PARAGRAPH — a new paragraph, so the two cannot be confused. */
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Heterogeneity was low.');
    await cite(page, 'Beta');
    await expect(citeChips(page)).toHaveCount(2);
    expect(await normText(editor)).toContain('Heterogeneity was low.[2]');
    // …and the FIRST chip did not move, and nothing landed at the start.
    expect(await normText(editor)).toMatch(/^Pooled estimates\[1\] favoured/);

    /* INSIDE A LIST ITEM — §5's "Supported locations" list names it. */
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.getByTestId('stitch-manuscript-tb-ul').click();
    await page.keyboard.type('Sensitivity analysis excluded open-label trials');
    await cite(page, 'Gamma');
    await expect(citeChips(page)).toHaveCount(3);
    const inList = editor.locator('li span.ms-cite[data-cite]');
    await expect(inList).toHaveCount(1);
    await expect(inList.first()).toHaveText('[3]', { timeout: 10_000 });

    // It all persists, and survives a reload in the same three places.
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(citeChips(page)).toHaveCount(3, { timeout: 15_000 });
    expect(await normText(editorOf(page))).toMatch(/^Pooled estimates\[1\] favoured the intervention\./);
    await expect(editorOf(page).locator('li span.ms-cite')).toHaveCount(1);
  });

  /**
   * §5 "Concurrent changes and stale selections". The picker is open; the document
   * changes underneath it. Two outcomes are allowed and NOTHING else: the position
   * is mapped through the change, or the researcher is told. A silent insertion at
   * the start of the section is the one thing that must never happen again.
   *
   * The change is forced through the DOM rather than typed, for two reasons: the
   * picker's backdrop covers the page (any click closes it, which is the CANCEL
   * path, tested separately), and replacing the editor's children is exactly what a
   * remount does — it detaches the saved Range, so the LOGICAL re-resolution is the
   * thing actually under test rather than the live-range shortcut.
   */
  test('§5: a document change while the picker is open is mapped through — never guessed', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    const sentence = 'Pooled estimates favoured the intervention.';
    await page.keyboard.type(sentence);
    await caretLeft(page, sentence.length - 'Pooled estimates'.length);

    // Open the picker (the caret is bookmarked here) …
    await page.getByTestId('stitch-manuscript-insert-citation').click();
    const popover = page.getByTestId('stitch-manuscript-insert-citation-popover');
    await expect(popover).toBeVisible();

    // … then rebuild the whole section under it. Every node the saved Range pointed
    // at is now detached, which is what a regenerate or a snapshot restore does.
    await editor.evaluate((el) => {
      const html = el.innerHTML;
      el.innerHTML = `<p>An earlier paragraph appeared while the picker was open.</p>${html}`;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });

    await popover.getByTestId('stitch-manuscript-insert-citation-search').fill('Alpha');
    await popover.getByRole('option').first().click();

    // The position was re-found by its surrounding TEXT: the chip is still exactly
    // after "estimates", in a paragraph that is no longer the first one.
    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
    const text = await normText(editorOf(page));
    expect(text).toContain('An earlier paragraph appeared while the picker was open.');
    expect(text).toContain('Pooled estimates[1] favoured the intervention.');
    // …and NOT at the beginning of the section.
    expect(text).not.toMatch(/^\s*\[1\]/);
    expect(text).not.toMatch(/^An earlier paragraph appeared while the picker was open\.\s*\[1\]/);
    await expect(page.getByTestId('stitch-manuscript-insert-notice')).toHaveCount(0);
  });

  test('§5: when the place is genuinely gone, nothing is inserted and the notice says so', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Pooled estimates favoured the intervention.');
    await caretLeft(page, 26);

    await page.getByTestId('stitch-manuscript-insert-citation').click();
    const popover = page.getByTestId('stitch-manuscript-insert-citation-popover');
    await expect(popover).toBeVisible();

    // The section is REPLACED — the sentence the caret was in no longer exists.
    await editor.evaluate((el) => {
      el.innerHTML = '<p>An entirely different paragraph about screening.</p>';
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });

    await popover.getByTestId('stitch-manuscript-insert-citation-search').fill('Alpha');
    await popover.getByRole('option').first().click();

    // THE HONEST REFUSAL: a message, and no citation anywhere in the manuscript.
    const notice = page.getByTestId('stitch-manuscript-insert-notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText(/could not be found/i);
    await expect(citeChips(page)).toHaveCount(0);
    expect(await normText(editorOf(page))).toBe('An entirely different paragraph about screening.');

    // It is dismissible, and it clears itself the next time a picker opens.
    await page.getByTestId('stitch-manuscript-insert-notice-ok').click();
    await expect(notice).toHaveCount(0);

    // …and the researcher can do exactly what it asked: put the caret back and retry.
    await editorOf(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await cite(page, 'Alpha');
    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
    expect(await normText(editorOf(page))).toBe('An entirely different paragraph about screening.[1]');
  });

  /**
   * §5 "Do not default to … the most recently focused editor from another section".
   * Continuous View mounts one editor per section and the "active" one is written
   * by scrolling, so this is the case where a wrong-editor insert is invisible until
   * a researcher finds a citation in a paragraph they never wrote.
   */
  test('§5: the insert follows the CARET, not whatever is scrolled into view', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/app/project/${tmpProject.id}?tab=manuscript&ms=editor`);
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-view-continuous').click();
    await expect(page.getByTestId('stitch-manuscript-continuous')).toBeVisible({ timeout: 15_000 });

    const methods = page.getByTestId('stitch-manuscript-rich-editor-methods');
    const discussion = page.getByTestId('stitch-manuscript-rich-editor-discussion');
    await methods.click();
    await page.keyboard.press('ControlOrMeta+End');
    const sentence = 'Eligibility was assessed in duplicate.';
    await page.keyboard.type(sentence);
    await caretLeft(page, sentence.length - 'Eligibility was assessed'.length);

    // Open the picker with the caret in METHODS …
    await page.getByTestId('stitch-manuscript-insert-citation').click();
    const popover = page.getByTestId('stitch-manuscript-insert-citation-popover');
    await expect(popover).toBeVisible();

    // … then edit ANOTHER section and scroll it into the reading band, both of which
    // move the workspace's idea of the "active" section under the picker's feet.
    await discussion.evaluate((el) => {
      el.insertBefore(
        Object.assign(document.createElement('p'), { textContent: 'A paragraph typed elsewhere.' }),
        el.firstChild,
      );
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await page.getByTestId('stitch-manuscript-doc-discussion')
      .evaluate((el) => el.scrollIntoView({ block: 'start' }));

    await popover.getByTestId('stitch-manuscript-insert-citation-search').fill('Beta');
    await popover.getByRole('option').first().click();

    // The chip is in METHODS, at the caret — and Discussion has none.
    await expect(methods.locator('span.ms-cite')).toHaveCount(1, { timeout: 10_000 });
    await expect(discussion.locator('span.ms-cite')).toHaveCount(0);
    const mText = await normText(methods);
    expect(mText).toContain('Eligibility was assessed[1] in duplicate.');
    expect(mText).not.toMatch(/^\s*\[1\]/);
    await expect(page.getByTestId('stitch-manuscript-insert-notice')).toHaveCount(0);

    await saved(page);
    await expect(async () => {
      const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const draft = (proj.manuscripts || [])[0] || {};
      expect(String(draft.sections?.methods?.content || '')).toContain('[[cite:');
      expect(String(draft.sections?.discussion?.content || '')).not.toContain('[[cite:');
    }).toPass({ timeout: 25_000 });
  });

  /* ── §5 "Citation-specific behavior": grouping ──────────────────────────────── */

  test('§5: a second citation beside an existing one becomes ONE grouped chip', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Two trials reported the outcome ');
    await cite(page, 'Alpha');
    await expect(citeChips(page)).toHaveCount(1);
    await expect(citeChips(page).first()).toHaveText('[1]', { timeout: 10_000 });

    // Cite again with the caret still right beside the chip: ONE chip, not "[1] [2]".
    await cite(page, 'Beta');
    await expect(citeChips(page)).toHaveCount(1);
    await expect(citeChips(page).first()).toHaveText('[1,2]', { timeout: 10_000 });
    await expect(citeChips(page).first()).toHaveAttribute('data-cite', /s1.*s2|s2.*s1/);

    /* …and grouping stops at punctuation: a citation after a full stop is its own
       chip, because merging across it would change what the sentence says. */
    await editorOf(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('and a cohort agreed.');
    await cite(page, 'Gamma');
    await expect(citeChips(page)).toHaveCount(2, { timeout: 10_000 });
    expect(await normText(editorOf(page))).toMatch(/agreed\.\s*\[3\]/);

    await saved(page);
    await expect(async () => {
      const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const draft = (proj.manuscripts || [])[0] || {};
      // ONE token carrying two ids — the serialization contract for a grouped chip.
      expect(String(draft.sections?.results?.content || '')).toMatch(/\[\[cite:s1,s2\]\]|\[\[cite:s2,s1\]\]/);
    }).toPass({ timeout: 25_000 });

    /* Last, because the menu's backdrop covers the page: the grouped chip is ONE
       object that still knows both references (§5 "Preserve … citation-group
       behavior, reference IDs, deduplication"). */
    await citeChips(page).first().click();
    const menu = page.getByTestId('stitch-manuscript-cite-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Alpha, 2019');
    await expect(menu).toContainText('Beta, 2021');
    await expect(menu.getByTestId('stitch-manuscript-cite-remove-s1')).toBeVisible();
    await expect(menu.getByTestId('stitch-manuscript-cite-remove-s2')).toBeVisible();
  });

  /* ── §5 "History behavior": cancel changes nothing ──────────────────────────── */

  test('§5: canceling the picker clears the bookmark and modifies nothing', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('A sentence that must survive the picker.');
    await saved(page);
    const before = await normText(editor);

    // Open it, search in it, then close WITHOUT inserting — the cancel path.
    await page.getByTestId('stitch-manuscript-insert-citation').click();
    const popover = page.getByTestId('stitch-manuscript-insert-citation-popover');
    await expect(popover).toBeVisible();
    await popover.getByTestId('stitch-manuscript-insert-citation-search').fill('Alpha');
    /* The picker's own backdrop covers the whole viewport (that is how it captures
       "click away"), so it is the only reachable dismiss target while it is open —
       including over the toggle button itself. Dispatching its mousedown is the
       app's real cancel path, and it is deterministic at any window size. */
    await page.evaluate(() => {
      const pop = document.querySelector('[data-testid="stitch-manuscript-insert-citation-popover"]');
      const backdrop = pop && pop.previousElementSibling;
      if (!backdrop) throw new Error('the picker has no backdrop');
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await expect(popover).toHaveCount(0);

    // Nothing was written, nothing was deleted, and no notice was raised.
    expect(await normText(editorOf(page))).toBe(before);
    await expect(citeChips(page)).toHaveCount(0);
    await expect(page.getByTestId('stitch-manuscript-insert-notice')).toHaveCount(0);

    /* The undo stack is CLEAN: one Ctrl+Z undoes the researcher's typing, not a
       phantom step the cancelled picker left behind. */
    await editorOf(page).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => normText(editorOf(page)), { timeout: 10_000 })
      .not.toBe(before);
  });

  /* ── Journey E: a cross-reference is bound to an ID, not to a label ─────────── */

  test('§5: a cross-reference inserted mid-sentence renumbers when its target moves', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');

    // Two manual tables, so the reference below is genuinely to "Table 2".
    await insertTable(page);
    await page.keyboard.type('Baseline characteristics');
    await editorOf(page).click({ position: { x: 24, y: 8 } });
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page);
    await page.keyboard.type('Adverse events');
    await expect(editorOf(page).locator('.ms-tblcap')).toHaveCount(2);

    // A sentence that references Table 2, with the reference MID-SENTENCE.
    await editorOf(page).click({ position: { x: 24, y: 8 } });
    await page.keyboard.press('ControlOrMeta+End');
    const sentence = 'Adverse events are reported in full below.';
    await page.keyboard.type(sentence);
    await caretLeft(page, 'below.'.length);
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    const xref = page.getByTestId('stitch-manuscript-crossref-popover');
    await expect(xref).toBeVisible();
    await xref.getByTestId('stitch-manuscript-crossref-search').fill('Adverse events');
    await xref.getByRole('option').first().click();

    await expect(assetChips(page)).toHaveCount(1, { timeout: 10_000 });
    const chip = assetChips(page).first();
    await expect(chip).toHaveText('Table 2', { timeout: 10_000 });
    const boundId = await chip.getAttribute('data-asset');
    expect(boundId).toMatch(/^table:/);
    // …and it landed mid-sentence, not at the start of the section.
    expect(await normText(editorOf(page))).toContain('reported in full Table 2 below.');

    /* REORDER: a new table inserted ABOVE both pushes the referenced one down. The
       chip must show the NEW number while staying bound to the SAME id — §5's "Do
       not bind only to the visible label text". */
    /* The caret goes to the very START of the section through the Range API: a
       click up there lands inside the first caption ISLAND, which 120.md §4
       deliberately redirects into the title, and ControlOrMeta+Home from inside a
       table cell is engine-dependent. This is a caret placement, not a mutation. */
    await editorOf(page).evaluate((el) => {
      (el as HTMLElement).focus();
      const r = document.createRange();
      r.setStart(el, 0);
      r.collapse(true);
      const sel = window.getSelection();
      if (!sel) throw new Error('no selection');
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await insertTable(page);
    await page.keyboard.type('Search strategy');
    await expect(editorOf(page).locator('.ms-tblcap')).toHaveCount(3);
    // …and the new table really is FIRST, so the referenced one moved to third.
    await expect(titlesOf(page).first()).toHaveText('Search strategy');

    await expect(assetChips(page).first()).toHaveText('Table 3', { timeout: 15_000 });
    await expect(assetChips(page).first()).toHaveAttribute('data-asset', boundId as string);
    await expect(assetChips(page).first()).not.toHaveAttribute('data-asset-broken', 'true');

    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-results').click();
    await expect(assetChips(page).first()).toHaveText('Table 3', { timeout: 15_000 });
    await expect(assetChips(page).first()).toHaveAttribute('data-asset', boundId as string);
  });
});
