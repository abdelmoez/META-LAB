/**
 * 108.md §5 / §7 / §8 / §13 — extraction Undo/Redo end-to-end.
 *
 * The unit suite (tests/unit/interaction/extractionHistory.test.js) proves the entry
 * builders, the coalescing rule and the provenance-preserving inverses on real
 * `studies[]` fixtures. What only a browser can prove is the rest of §8: that Ctrl+Z
 * is a REAL state mutation which survives a reload ("the project must remain correct
 * after refreshing immediately after an Undo"), and that native text-editing undo is
 * still the behaviour inside a focused field (§7).
 *
 * FOCUS MATTERS. `isEditableTarget` (research-engine/interaction/editableTarget.js)
 * makes the global Ctrl+Z a no-op while an INPUT / TEXTAREA / SELECT has focus — that
 * is 108.md §7, not an oversight — so every application-undo step below deliberately
 * moves focus off the field first (a click on the workspace chrome). One test asserts
 * the opposite case directly.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { createProject, deleteProject } from '../helpers/api';

/** Move focus off the form so the GLOBAL Ctrl+Z owns the keystroke (108.md §7/§24). */
async function blurToChrome(page: Page) {
  await page.getByTestId('pex-workspace').getByText('DATA CHECKS').first().click();
  await expect.poll(async () => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? el.tagName : 'NONE';
  })).not.toMatch(/^(INPUT|TEXTAREA|SELECT)$/);
}

const undo = async (page: Page) => { await blurToChrome(page); await page.keyboard.press('ControlOrMeta+z'); };
const redo = async (page: Page) => { await blurToChrome(page); await page.keyboard.press('ControlOrMeta+Shift+z'); };

/** Open the seeded article in the Pecan engine's split workspace. */
async function openArticle(page: Page, projectId: string, author: string) {
  await page.goto(`/app/project/${projectId}?tab=extraction`);
  await page.getByText(author).first().click();
  await expect(page.getByTestId('pex-workspace')).toBeVisible({ timeout: 15000 });
}

test.describe('Extraction Undo / Redo', () => {
  test('@smoke editing Events then Ctrl+Z restores the value AND the persisted state', async ({ page, request, setFlags }) => {
    await setFlags({ extractionEngine: true });
    const project = await createProject(request, `E2E Extraction Undo ${Date.now()}`);
    try {
      const res = await request.post(`/api/projects/${project.id}/studies`, {
        data: { author: 'Undone', year: '2024', outcome: 'Diagnostic yield', esType: 'PROP', events: '23', total: '59' },
      });
      expect(res.ok(), `seed study failed: ${res.status()}`).toBeTruthy();

      await openArticle(page, project.id, 'Undone');
      const events = page.getByTestId('pex-field-events');
      await expect(events).toHaveValue('23');

      // One logical edit — 108.md §13: the keystrokes coalesce into ONE history entry.
      await events.fill('');
      await events.type('41');
      await expect(events).toHaveValue('41');

      await undo(page);
      await expect(events).toHaveValue('23');
      // §17 — subtle confirmation, not a dialog.
      await expect(page.getByText('Extraction change undone')).toBeVisible({ timeout: 5000 });

      // §8 — a real mutation: the reverted value survives a reload of the project.
      await page.reload();
      await page.getByText('Undone').first().click();
      await expect(page.getByTestId('pex-workspace')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('pex-field-events')).toHaveValue('23');
    } finally {
      await deleteProject(request, project.id);
    }
  });

  test('Denominator Population undo/redo — 108.md §5\'s worked example', async ({ page, request, setFlags }) => {
    await setFlags({ extractionEngine: true });
    const project = await createProject(request, `E2E Denominator Undo ${Date.now()}`);
    try {
      const res = await request.post(`/api/projects/${project.id}/studies`, {
        data: {
          author: 'Denom', year: '2024', outcome: 'Diagnostic yield', esType: 'PROP',
          events: '23', total: '59', denominatorPopulation: 'all_patients_tested',
        },
      });
      expect(res.ok(), `seed study failed: ${res.status()}`).toBeTruthy();

      await openArticle(page, project.id, 'Denom');
      const denom = page.getByTestId('pex-field-denominatorPopulation');
      await expect(denom).toHaveValue('all_patients_tested');

      // "All patients tested" → "P/LP molecular diagnoses"
      await denom.selectOption('plp_molecular_diagnoses');
      await expect(denom).toHaveValue('plp_molecular_diagnoses');

      await undo(page);
      await expect(denom).toHaveValue('all_patients_tested');

      await redo(page);
      await expect(denom).toHaveValue('plp_molecular_diagnoses');

      // …and the redone value is what the server holds.
      await page.reload();
      await page.getByText('Denom').first().click();
      await expect(page.getByTestId('pex-field-denominatorPopulation')).toHaveValue('plp_molecular_diagnoses', { timeout: 15000 });
    } finally {
      await deleteProject(request, project.id);
    }
  });

  test('a whole typed phrase is ONE undo, and a select before it is a separate one (§13)', async ({ page, request, setFlags }) => {
    await setFlags({ extractionEngine: true });
    const project = await createProject(request, `E2E Undo Coalesce ${Date.now()}`);
    try {
      const res = await request.post(`/api/projects/${project.id}/studies`, {
        data: { author: 'Coalesce', year: '2024', outcome: 'Diagnostic yield', esType: 'PROP', events: '23', total: '59' },
      });
      expect(res.ok(), `seed study failed: ${res.status()}`).toBeTruthy();

      await openArticle(page, project.id, 'Coalesce');

      // Discrete action #1: choose Other/custom (which reveals the description input).
      const denom = page.getByTestId('pex-field-denominatorPopulation');
      await denom.selectOption('other');
      const custom = page.getByTestId('pex-field-denominatorCustom');
      await expect(custom).toBeVisible();

      // 108.md §13's example: 42 keystrokes must not cost 42 Ctrl+Z presses.
      const PHRASE = 'Patients with confirmed molecular diagnosis';
      await custom.type(PHRASE, { delay: 15 });
      await expect(custom).toHaveValue(PHRASE);

      // ONE undo clears the whole phrase…
      await undo(page);
      await expect(page.getByTestId('pex-field-denominatorCustom')).toHaveValue('');
      // …and the NEXT undo reverses the select, not another character.
      await undo(page);
      await expect(denom).toHaveValue('');
      await expect(page.getByTestId('pex-field-denominatorCustom')).toHaveCount(0);
    } finally {
      await deleteProject(request, project.id);
    }
  });

  test('Ctrl+Z INSIDE a focused field stays native text undo (108.md §7)', async ({ page, request, setFlags }) => {
    await setFlags({ extractionEngine: true });
    const project = await createProject(request, `E2E Undo Native ${Date.now()}`);
    try {
      const res = await request.post(`/api/projects/${project.id}/studies`, {
        data: { author: 'Native', year: '2024', outcome: 'Diagnostic yield', esType: 'PROP', events: '23', total: '59' },
      });
      expect(res.ok(), `seed study failed: ${res.status()}`).toBeTruthy();

      await openArticle(page, project.id, 'Native');
      const total = page.getByTestId('pex-field-total');
      await total.click();
      await total.type('7');                       // "59" → "597", caret still in the field
      await expect(total).toHaveValue('597');

      // The application undo must NOT fire here: the field keeps focus and the value
      // is whatever the browser's own text history decides — never the pre-edit row
      // value written back through the blob.
      await page.keyboard.press('ControlOrMeta+z');
      await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'pex-field-total');
      await expect(page.getByText('Extraction change undone')).toHaveCount(0);
    } finally {
      await deleteProject(request, project.id);
    }
  });
});
