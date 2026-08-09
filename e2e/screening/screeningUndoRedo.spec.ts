/**
 * screeningUndoRedo.spec.ts — 108.md §4 (screening decisions + keyword actions in the
 * project-wide history) and the §26 async/persistence case
 * "Mutation → Undo before first save returns".
 *
 * WHAT EACH ASSERTION IS FOR
 *   · §4's worked example — Include → Ctrl+Z → Ctrl+Shift+Z — end to end, with the
 *     SERVER re-read each time so this can never pass on a UI-only illusion (§8).
 *   · §4 "change Include → Exclude": the undo must restore the PREVIOUS decision, not
 *     clear it — the distinction the 107 DecisionBar "↩ Undo" could not make.
 *   · §26's race: the first decision POST is delayed through `page.route`, Ctrl+Z is
 *     pressed while it is still in flight, and the final persisted value must be the
 *     UNDONE one. Without the per-record serialized chain the two POSTs reach the
 *     server in either order and the older intent can win.
 *
 * The decision writes are all at the title/abstract stage, which is what this workbench
 * is; the payload always carries `stage` explicitly (the promotion "stage trap").
 */
import { Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { ScreeningPage } from '../page-objects/ScreeningPage';

const RECORD = /E2E Study 1 on intervention efficacy/;
const PHRASE = 'significant effect';

/** My persisted title/abstract decision for a record, read straight from the API. */
async function readDecision(page: Page, siftId: string, index = 0): Promise<string> {
  const res = await page.request.get(`/api/screening/projects/${siftId}/records?page=1&limit=50`);
  expect(res.ok(), 'the record list must be readable').toBeTruthy();
  const body = await res.json();
  const rec = (body?.records || [])[index];
  const d = rec?.myDecision;
  if (!d || (d.stage && d.stage !== 'title_abstract')) return 'undecided';
  return d.decision || 'undecided';
}

/** The persisted inclusion keywords. */
async function readInclude(page: Page, siftId: string): Promise<string[]> {
  const res = await page.request.get(`/api/screening/projects/${siftId}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const v = (body?.project ?? body)?.inclusionKeywords;
  if (Array.isArray(v)) return v as string[];
  try { return JSON.parse(String(v || '[]')); } catch { return []; }
}

/** Open the workbench on the first record and wait until its abstract is rendered. */
async function openFirstRecord(page: Page, projectId: string): Promise<ScreeningPage> {
  const sift = new ScreeningPage(page);
  await sift.openWorkbench(projectId);
  await sift.recordRow(RECORD).click();
  await expect(sift.main.getByTestId('screening-abstract')).toBeVisible();
  return sift;
}

/** Select a phrase inside the rendered abstract (deterministic across engines). */
async function selectInAbstract(page: Page, needle: string): Promise<void> {
  const selected = await page.evaluate((text: string) => {
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === 'function') active.blur();
    const host = document.querySelector('[data-testid="screening-abstract"]');
    if (!host) return '<no abstract>';
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = node.textContent || '';
      const at = value.indexOf(text);
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const sel = window.getSelection();
        if (!sel) return '<no selection api>';
        sel.removeAllRanges();
        sel.addRange(range);
        return String(sel);
      }
      node = walker.nextNode();
    }
    return '<not found>';
  }, needle);
  expect(selected, `"${needle}" must be selectable inside the abstract`).toBe(needle);
}

test.describe('Screening — decision undo/redo (108.md §4)', () => {
  test('@smoke Include → Ctrl+Z restores the previous decision → Ctrl+Shift+Z restores Include', async ({ page, screeningProject }) => {
    const sift = await openFirstRecord(page, screeningProject.project.id);
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'undecided');

    await sift.includeButton.click();
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'include');
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('include');

    await sift.undo();
    // §17 — the subtle confirmation names the action that was reversed.
    await expect(sift.snackbar).toContainText('Screening decision undone');
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'undecided');
    // §8 — a real state mutation, reconciled with the server.
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('undecided');

    await sift.redo();
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'include');
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('include');
  });

  test('changing Include → Exclude and undoing restores INCLUDE, not "undecided"', async ({ page, screeningProject }) => {
    const sift = await openFirstRecord(page, screeningProject.project.id);

    await sift.includeButton.click();
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('include');
    await sift.excludeButton.click();
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('exclude');

    await sift.undo();
    // The whole point of capturing the COMPLETE prior decision rather than clearing.
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'include');
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('include');
  });

  test('the DecisionBar ↩ Undo (clear) is itself a recordable action', async ({ page, screeningProject }) => {
    const sift = await openFirstRecord(page, screeningProject.project.id);

    await sift.includeButton.click();
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('include');

    // The 107 "↩ Undo" is a forward mutation (clear the decision), not a history undo.
    await sift.undoButton.click();
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('undecided');

    // …so Ctrl+Z now reverses THAT clear.
    await sift.undo();
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'include');
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('include');
  });

  test('the undone decision survives an immediate reload (§8)', async ({ page, screeningProject }) => {
    const sift = await openFirstRecord(page, screeningProject.project.id);

    await sift.includeButton.click();
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('include');
    await sift.undo();
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'undecided');

    await page.reload();
    await sift.recordRow(RECORD).click();
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'undecided');
  });

  test('with nothing to undo, Ctrl+Z is a silent no-op (§26)', async ({ page, screeningProject }) => {
    const sift = await openFirstRecord(page, screeningProject.project.id);

    await sift.undo();
    // No history → no toast, no decision written, nothing broken.
    await expect(sift.feedback).toHaveCount(0);
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'undecided');
    expect(await readDecision(page, screeningProject.siftId)).toBe('undecided');
  });
});

test.describe('Screening — keyword undo/redo (108.md §4)', () => {
  test('@smoke Ctrl+I adds a keyword and Ctrl+Z takes it back off the server', async ({ page, screeningProject }) => {
    const sift = await openFirstRecord(page, screeningProject.project.id);
    await selectInAbstract(page, PHRASE);
    await page.keyboard.press('ControlOrMeta+i');

    await expect(sift.snackbar).toContainText('Added');
    await expect.poll(() => readInclude(page, screeningProject.siftId)).toContain(PHRASE);

    await sift.undo();
    await expect(sift.snackbar).toContainText('Keyword addition undone');
    await expect.poll(() => readInclude(page, screeningProject.siftId)).not.toContain(PHRASE);

    await sift.redo();
    await expect.poll(() => readInclude(page, screeningProject.siftId)).toContain(PHRASE);
  });
});

/* ── §26 "Mutation → Undo before first save returns" ──────────────────────────── */

test.describe('Screening — async race (108.md §14/§26)', () => {
  test('an older decision response cannot overwrite a newer Undo', async ({ page, screeningProject }) => {
    const sift = await openFirstRecord(page, screeningProject.project.id);

    // Delay ONLY the first decision POST. Everything after it runs at full speed, so
    // the undo is genuinely issued while the include is still unresolved.
    let delayed = 0;
    await page.route('**/api/screening/projects/*/records/*/decision', async (route) => {
      if (delayed === 0) {
        delayed = 1;
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      await route.continue();
    });

    await sift.includeButton.click();
    // The optimistic patch has NOT landed yet — the POST is still parked in the route
    // handler — so this Ctrl+Z is the §26 scenario exactly.
    await sift.undo();

    // The newest user intent must win, on the client…
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'undecided');
    // …and on the server, after BOTH requests have settled.
    await expect.poll(() => readDecision(page, screeningProject.siftId), { timeout: 15000 })
      .toBe('undecided');
    // Give the (already-resolved) first response every chance to land late and lose.
    await expect.poll(() => readDecision(page, screeningProject.siftId)).toBe('undecided');
    await expect(sift.decisionBar).toHaveAttribute('data-decision', 'undecided');

    await page.unroute('**/api/screening/projects/*/records/*/decision');
  });
});
