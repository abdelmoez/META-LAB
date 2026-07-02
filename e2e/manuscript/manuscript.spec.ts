/**
 * manuscript.spec.ts — the WYSIWYG manuscript editor (65.md Major Upgrade 2).
 *
 * The `manuscriptEditor` flag is OFF by default; every test here flips it ON via
 * the setFlags fixture (auto-restored on teardown) and drives the Stitch
 * workspace at `/app/project/:id?tab=manuscript`.
 *
 * Core contract under test: the editor is Word-like — the user NEVER sees raw
 * markdown tokens (#, **, [[cite:), formatting is real DOM (strong/headings),
 * sections auto-generate without leaking tokens, autosave reports honestly, and
 * the one-click Word export actually produces a .docx download.
 */
import { test, expect } from '../fixtures/stitch-test';

async function openManuscript(page: import('@playwright/test').Page, projectId: string) {
  await page.goto(`/app/project/${projectId}?tab=manuscript`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
}

test.describe('Manuscript editor (flag ON)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  test('editor is WYSIWYG: paper page + toolbar, and NO raw-markdown textarea', async ({ page, tmpProject }) => {
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();

    const editorPanel = page.getByTestId('stitch-manuscript-editor');
    await expect(editorPanel).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-page')).toBeVisible();
    // The title section is a plain input by design — the formatting toolbar
    // appears for the rich-text sections.
    await page.getByTestId('stitch-manuscript-section-introduction').click();
    await expect(page.getByTestId('stitch-manuscript-toolbar')).toBeVisible();

    // The old markdown surface is gone: no textarea anywhere in the editor panel,
    // and no help copy advertising markdown syntax.
    await expect(editorPanel.locator('textarea')).toHaveCount(0);
    await expect(editorPanel.getByText('Markdown supported')).toHaveCount(0);
  });

  test('typing + bold produce real formatting; no raw tokens ever visible', async ({ page, tmpProject }) => {
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();

    // Introduction is a plain rich-text section (title is an input; abstract is structured).
    await page.getByTestId('stitch-manuscript-section-introduction').click();
    const editor = page.getByTestId('stitch-manuscript-rich-editor');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.type('Systematic reviews synthesise the best available evidence.');
    // Select-all inside the contentEditable, then toolbar Bold (mousedown is
    // preventDefault-ed in the toolbar so the selection survives the click).
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByTestId('stitch-manuscript-tb-bold').click();

    await expect(editor.locator('strong, b')).toHaveCount(1);
    const visible = (await editor.innerText()).trim();
    expect(visible).toContain('Systematic reviews');
    expect(visible).not.toContain('**');
    expect(visible).not.toContain('[[cite:');

    // Autosave reports honestly — the pill lands on Saved (never a silent limbo).
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 15_000 });
  });

  test('Generate all drafts sections as formatted content — headings render as headings, not # tokens', async ({ page, tmpProject }) => {
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-generate').click();

    // Results always generates '##' sub-headings (Study selection / characteristics
    // / Risk of bias …) — they must render as real heading elements with zero
    // leaked markdown metacharacters.
    await page.getByTestId('stitch-manuscript-section-results').click();
    const editor = page.getByTestId('stitch-manuscript-rich-editor');
    await expect(editor.locator('h2, h3, h4').first()).toBeVisible({ timeout: 10_000 });
    const visible = await editor.innerText();
    expect(visible).not.toMatch(/(^|\n)#{1,3}\s/);
    expect(visible).not.toContain('**');
    expect(visible).not.toContain('[[cite:');

    // The generated abstract opens in the STRUCTURED abstract editor (labelled
    // subsections + live word count), not a raw text blob.
    await page.getByTestId('stitch-manuscript-section-abstract').click();
    await expect(page.getByTestId('stitch-manuscript-abstract-editor')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-abstract-words')).toBeVisible();
  });

  test('one-click Word export downloads a .docx', async ({ page, tmpProject }) => {
    await openManuscript(page, tmpProject.id);
    // Give the export something non-trivial to render.
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-generate').click();
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 15_000 });

    // The canonical export button lives on the Overview panel.
    await page.getByTestId('stitch-manuscript-subtab-overview').click();
    const downloadP = page.waitForEvent('download', { timeout: 45_000 });
    await page.getByTestId('stitch-manuscript-export-word').click();
    const download = await downloadP;
    expect(download.suggestedFilename()).toMatch(/\.docx$/);
  });

  test('flag OFF keeps the legacy drafter (rollout gate intact)', async ({ page, tmpProject, setFlags }) => {
    await setFlags({ manuscriptEditor: false });
    await page.goto(`/app/project/${tmpProject.id}?tab=manuscript`);
    // The structured workspace must NOT mount; the legacy drafter renders instead.
    await expect(page.getByTestId('stitch-manuscript-workspace')).toHaveCount(0);
  });
});
