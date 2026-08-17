/**
 * manuscript-symbols-121.spec.ts — 121.md §1 "Comprehensive Symbols Menu".
 *
 * The catalogue's rules (what a safe entry is, how the five search forms work, how
 * recents and favourites are normalised and capped) are pure and pinned in
 * tests/unit/manuscript/symbols121.test.jsx. What only a browser can prove is the
 * sentence §1 calls most important:
 *
 *   "clicking the Symbols menu must not cause the editor to lose the intended
 *    insertion position. Save the active editor selection when the menu opens and
 *    insert the selected symbol at that exact I-beam cursor location. The insertion
 *    must participate normally in undo/redo and autosave."
 *
 * Every clause of that is an engine fact: the popover and its autofocused search field
 * take focus (WebKit drops the document selection the moment focus reaches a control),
 * the insertion goes through execCommand and must therefore join the NATIVE undo stack,
 * and the persisted markdown is what proves the character survived the model.
 *
 * UNDO NUANCE, decided once: the symbol is inserted with execCommand('insertText'),
 * which is the same call a typed character makes, so Blink MAY coalesce it with an
 * adjacent typed run into one undo step. That is not a defect — it is how typing
 * already behaves in this editor, and it satisfies "participates normally in
 * undo/redo". The assertion below is therefore that undo REMOVES the symbol and redo
 * brings it back, not that it is an isolated step.
 *
 * File name: deliberately NOT `manuscript-{table,figure}*`. playwright.config.ts's
 * `webkit-manuscript` testMatch names this file explicitly instead — caret preservation
 * across a focus-stealing popover is exactly where engines differ.
 *
 * WEBKIT ≠ SAFARI: green under `webkit-manuscript` is engine evidence, not a Safari
 * sign-off (see docs/testing/PLAYWRIGHT_COVERAGE_MATRIX.md › "Real-Safari manual QA").
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect } from '../fixtures/stitch-test';

type Page = import('@playwright/test').Page;
type APIRequestContext = import('@playwright/test').APIRequestContext;

const P = 'stitch-manuscript-symbols';
const editorOf = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor');

async function openEditorSection(page: Page, projectId: string, section: string) {
  await page.goto(`/app/project/${projectId}?tab=manuscript&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId(`stitch-manuscript-section-${section}`).click();
  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  return editor;
}

async function saved(page: Page) {
  await expect(page.getByTestId('stitch-manuscript-save-status').first())
    .toContainText(/Saved/i, { timeout: 25_000 });
}

async function sectionMd(request: APIRequestContext, projectId: string, section: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  const draft = (proj.manuscripts || [])[0] || {};
  return String((draft.sections || {})[section]?.content || '');
}

/** Walk the caret left N characters — the honest way to reach mid-sentence. */
async function caretLeft(page: Page, n: number) {
  for (let i = 0; i < n; i += 1) await page.keyboard.press('ArrowLeft');
}

/** Open the picker, search (the focus-stealing step), and click the first result. */
async function pickSymbol(page: Page, search: string) {
  await page.getByTestId(`${P}-open`).click();
  const pop = page.getByTestId(`${P}-popover`);
  await expect(pop).toBeVisible();
  await pop.getByTestId(`${P}-search`).fill(search);
  const cells = pop.getByTestId(`${P}-group-results`).locator('button[aria-label]');
  await expect(cells.first()).toBeVisible();
  const ch = await cells.first().textContent();
  await cells.first().click();
  await expect(pop).toHaveCount(0);       // v1 closes on insert — the bookmark is spent
  return String(ch || '');
}

test.describe('The Symbols menu inserts at the exact I-beam (121.md §1)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  test('§1: bookmark → search → insert MID-SENTENCE, with undo/redo and autosave', async ({ page, request, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    const sentence = 'Significance was set at p 0.05.';
    await page.keyboard.type(sentence);
    // …put the I-beam exactly between "p " and "0.05" — the position the popover,
    // its list and its autofocused search field all get a chance to destroy.
    await caretLeft(page, '0.05.'.length);

    const ch = await pickSymbol(page, '\\leq');
    expect(ch).toBe('≤');

    // EXACTLY at the caret: no space invented before it, nothing appended after it.
    await expect(editor).toContainText('p ≤0.05.', { timeout: 10_000 });
    const text = await editor.evaluate((el) => String(el.textContent || ''));
    expect(text).toBe('Significance was set at p ≤0.05.');
    // …and NOT at the start of the section, which is the failure mode §1 names.
    expect(text.startsWith('≤')).toBe(false);
    // no element wrapper was introduced around the character
    await expect(editor.locator('span').filter({ hasText: /^≤$/ })).toHaveCount(0);

    // §1 "participates normally in undo/redo" — see the header for the coalescing note.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).not.toContainText('≤', { timeout: 10_000 });
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(editor).toContainText('≤', { timeout: 10_000 });

    // §1 "and autosave" — the character reaches the persisted markdown verbatim.
    await saved(page);
    /* Polled, like every other persisted-markdown assertion in this suite
       (manuscript-citation-caret-120.spec.ts): the save-status chip still reads
       "Saved" from the PREVIOUS autosave while the one carrying this edit is in
       flight, so a single read races the debounce rather than testing anything. */
    await expect(async () => {
      expect(await sectionMd(request, tmpProject.id, 'methods')).toContain('p ≤0.05.');
    }).toPass({ timeout: 25_000 });

    // …and survives a reload as the same character in the same place.
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(editorOf(page)).toContainText('Significance was set at p ≤0.05.', { timeout: 15_000 });
  });

  test('§1: the five search forms all reach the same symbol', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    const before = await editor.evaluate((el) => String(el.textContent || ''));

    // by NAME, by ALIAS, by LATEX name, by CODE POINT, by the CHARACTER itself
    for (const [query, expected] of [
      ['alpha', 'α'],
      ['standard deviation', 'σ'],
      ['\\pm', '±'],
      ['U+00B0', '°'],
      ['∑', '∑'],
    ] as Array<[string, string]>) {
      await page.getByTestId(`${P}-open`).click();
      const pop = page.getByTestId(`${P}-popover`);
      await expect(pop).toBeVisible();
      await pop.getByTestId(`${P}-search`).fill(query);
      const cells = pop.getByTestId(`${P}-group-results`).locator('button[aria-label]');
      await expect(cells.first()).toBeVisible();
      await expect(cells.filter({ hasText: expected }).first()).toBeVisible();
      // close without inserting — the cancel path, which must change nothing
      await page.keyboard.press('Escape');
      await expect(pop).toHaveCount(0);
    }
    // …and five cancels wrote nothing: searching is not inserting.
    expect(await editor.evaluate((el) => String(el.textContent || ''))).toBe(before);
  });

  test('§1: complete keyboard navigation — arrows, Enter, Escape', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'discussion');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Mean difference ');

    await page.getByTestId(`${P}-open`).click();
    const pop = page.getByTestId(`${P}-popover`);
    await expect(pop).toBeVisible();
    await pop.getByTestId(`${P}-search`).fill('plus-minus');
    // ArrowDown leaves the search field for the first cell; the live region names it.
    await page.keyboard.press('ArrowDown');
    await expect(pop.getByTestId(`${P}-active`)).toContainText('±');
    await page.keyboard.press('Enter');
    await expect(pop).toHaveCount(0);
    await expect(editor).toContainText('Mean difference ±', { timeout: 10_000 });

    // Escape closes without inserting and returns focus to the trigger.
    await page.getByTestId(`${P}-open`).click();
    await expect(page.getByTestId(`${P}-popover`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(`${P}-popover`)).toHaveCount(0);
    await expect(page.getByTestId(`${P}-open`)).toBeFocused();
    await expect(editor).toContainText('Mean difference ±');
  });

  test('§1: Recently Used and Favorites persist across a reload', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Values ');
    await pickSymbol(page, 'infinity');
    await expect(editor).toContainText('∞', { timeout: 10_000 });

    // Star a symbol from its cell (the mouse affordance).
    await page.getByTestId(`${P}-open`).click();
    const pop = page.getByTestId(`${P}-popover`);
    await expect(pop).toBeVisible();
    await expect(pop.getByTestId(`${P}-group-recents`)).toBeVisible();
    await pop.getByTestId(`${P}-search`).fill('chi square');
    const chi = pop.getByTestId(`${P}-group-results`).locator('button[aria-label]').first();
    await expect(chi).toBeVisible();
    await pop.locator('button[aria-label^="Add "]').first().click();
    await pop.getByTestId(`${P}-search`).fill('');
    await expect(pop.getByTestId(`${P}-group-favorites`)).toBeVisible();
    await page.keyboard.press('Escape');

    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await page.getByTestId(`${P}-open`).click();
    const pop2 = page.getByTestId(`${P}-popover`);
    await expect(pop2).toBeVisible();
    // Both lists are pinned above the categories, and both survived the reload.
    await expect(pop2.getByTestId(`${P}-group-favorites`)).toBeVisible();
    await expect(pop2.getByTestId(`${P}-group-recents`)).toBeVisible();
    await expect(pop2.getByTestId(`${P}-group-recents`)).toContainText('∞');
  });

  test('§1: a symbol inserts inside a caption title and in a list item', async ({ page, request, tmpProject }) => {
    /* Two positions the plain-text insert has to be legal in: a caption TITLE is a
       nested editing island (contenteditable inside a contenteditable=false caption),
       and a list item is where Blink's insertHTML unwraps fragments — which is why a
       symbol must never be wrapped in an element. */
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.getByTestId('stitch-manuscript-tb-table').click();
    await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
    await page.getByTestId('stitch-manuscript-table-grid-2-2').click();
    // insertTable parks the caret in the new caption's TITLE region.
    await page.keyboard.type('Temperature in ');
    await pickSymbol(page, 'celsius');
    await expect(editor.locator('.ms-tblcap-t').first()).toContainText('Temperature in ℃', { timeout: 10_000 });

    // …and in a list item.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.getByTestId('stitch-manuscript-tb-ul').click();
    await page.keyboard.type('Change from baseline ');
    // "capital delta" rather than "delta": the catalogue is ordered, and lowercase δ is
    // the first match for the bare word — which is the correct answer to that query.
    const delta = await pickSymbol(page, 'capital delta');
    expect(delta).toBe('Δ');
    await expect(editor.locator('li').first()).toContainText('Change from baseline', { timeout: 10_000 });
    const liText = await editor.locator('li').first().evaluate((el) => String(el.textContent || ''));
    expect(liText).toContain('Δ');

    await saved(page);
    // Polled for the same reason as the mid-sentence journey above.
    await expect(async () => {
      const md = await sectionMd(request, tmpProject.id, 'results');
      expect(md).toContain('Temperature in ℃');
      expect(md).toContain('Δ');
      // no stray element markup reached the model
      expect(md).not.toContain('<span');
    }).toPass({ timeout: 25_000 });
  });

  /* ── 121.md r2 — the "In headings" row of the Testing Requirements matrix ─────── */

  test('r2 §1: at the end of a HEADING — the matrix row no insertion test covered', async ({ page, request, tmpProject }) => {
    /* Every automated insertion test operated on a `<p>`, an `<li>` or a caption
       title. An H2 is a different block for execCommand and for the end-of-block
       normalisations (LINE_BLOCK_TAGS lists the headings, and nothing exercised one),
       so a regression there — a symbol landing in the paragraph BELOW the heading, or
       the heading losing its level — would have shipped unseen. */
    const editor = await openEditorSection(page, tmpProject.id, 'discussion');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Change from baseline');
    await page.getByTestId('stitch-manuscript-tb-h2').click();
    await expect(editor.locator('h2')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await page.keyboard.type('The primary endpoint was met.');

    // Back to the TRUE end of the heading line, and insert there.
    await editor.locator('h2').click();
    await page.keyboard.press('End');
    const ch = await pickSymbol(page, 'capital delta');
    expect(ch).toBe('Δ');

    // In the heading, at its end — not in the paragraph below it.
    await expect(editor.locator('h2')).toContainText('Change from baselineΔ', { timeout: 10_000 });
    /* …and exactly once, in that block. (Which element Enter produces below a heading
       is Blink's business — a `<p>`, a `<div>`, another heading — so the honest check
       is that the character is in the heading and nowhere else.) */
    const all = await editor.evaluate((el) => String(el.textContent || ''));
    expect((all.match(/Δ/g) || []).length).toBe(1);
    await expect(editor).toContainText('The primary endpoint was met.');

    await saved(page);
    await expect(async () => {
      const md = await sectionMd(request, tmpProject.id, 'discussion');
      const line = md.split('\n').find((l) => l.includes('Change from baseline'));
      expect(line, `no heading line in:\n${md}`).toBeTruthy();
      /* still a HEADING (mdDom writes the editor's H2 with the section-relative level
         the assembler uses), and the character is the last thing on that line. */
      expect(line).toMatch(/^#+\s+Change from baselineΔ$/);
      // …and never a line of its own
      for (const l of md.split('\n')) expect(l.trim()).not.toBe('Δ');
    }).toPass({ timeout: 25_000 });
  });
});
