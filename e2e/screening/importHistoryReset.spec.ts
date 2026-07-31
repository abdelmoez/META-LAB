/**
 * importHistoryReset.spec.ts — the Screening "Search Import History" timeline +
 * the guarded "Delete All Imported Search Records" reset (96.md Phases 5B/6,
 * plan D11/D12 — QA finding M25).
 *
 * Journey (real UI over real API seeding, per the screening.spec.ts pattern):
 *   1. Seed a throwaway project + a synchronous RIS file import.
 *   2. Open the Screening overview → the Search Import History section lists the
 *      file import with its stats; axe-scan the section.
 *   3. Open the reset modal: the server-computed preview renders exact numbers,
 *      and the danger button stays DISABLED until the exact confirmation token
 *      (the project name) is typed; axe-scan the open dialog.
 *   4. Complete a scope='search' reset → file-imported (manual-scope) records
 *      survive, the history keeps the batch entry (acceptance 23).
 *   5. Complete a scope='all' reset → every record is deleted, the history
 *      empties, and RE-IMPORTING THE SAME FILE succeeds (acceptance 25 — the
 *      reset clears the fileHash idempotency fence, plan D11).
 *
 * Deliberate scope notes:
 *   - Search-RUN entries (the expandable per-database Details breakdown and the
 *     rolled-back badge) need a live multi-provider Pecan run, which E2E cannot
 *     execute deterministically; that rendering seam is pinned by the SSR unit
 *     suite (tests/unit/importHistory.test.jsx) against the server contract.
 *     A file BATCH entry's expandable surface is its issues list, which only
 *     renders when rows were rejected — also unit-covered.
 */
import { test, expect } from '../fixtures/stitch-test';
import { ScreeningPage } from '../page-objects/ScreeningPage';
import * as api from '../helpers/api';
import { expectNoSeriousA11y } from '../helpers/axe';
import type { APIRequestContext } from '@playwright/test';

/**
 * Seed a project + screening workspace + one synchronous RIS import, KEEPING the
 * exact file content so the re-import-after-reset step can send the identical
 * fileHash (the fixture's own seeding always forces past the duplicate guard,
 * which would mask the idempotency behaviour under test).
 */
async function seedImportedProject(request: APIRequestContext, tag: string) {
  const project = await api.createProject(request, `E2E Reset ${tag} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`);
  const siftId = await api.ensureScreeningWorkspace(request, project.id);
  const records = Array.from({ length: 6 }, (_, i) => ({
    title: `E2E Reset Study ${i + 1} on ${tag} intervention outcomes`,
    authors: [`Author${i + 1}, A`, 'Smith, B'],
    year: 2019 + (i % 5),
    abstract: `Background: trial ${i + 1} for the ${tag} reset journey. Results: significant.`,
    doi: `10.1000/e2e-reset.${tag}.${i + 1}`,
  }));
  const content = api.makeRis(records);
  const filename = `e2e-${tag}.ris`;
  const { imported } = await api.importScreeningRecords(request, siftId, { content, filename, force: true });
  return { project, siftId, content, filename, imported };
}

/** Count the workspace's screening records straight from the API (relative path — see helpers/api.ts). */
async function recordCount(request: APIRequestContext, siftId: string): Promise<number> {
  const res = await request.get(`/api/screening/projects/${encodeURIComponent(siftId)}/records?limit=1`);
  expect(res.ok(), `listRecords failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return body.total ?? body.totalCount ?? (Array.isArray(body.records) ? body.records.length : 0);
}

test.describe('Screening — Search Import History + typed-confirm reset', () => {
  test('history section renders, the reset is typed-confirm gated, and scope=search keeps file-imported records', async ({ page, request }, testInfo) => {
    const seed = await seedImportedProject(request, 'search');
    try {
      const sift = new ScreeningPage(page);
      await sift.goto(seed.project.id); // bare ?tab=screening → screen=overview

      // ── The Search Import History section lists the file import ────────────
      const history = sift.main.getByTestId('screening-import-history');
      await expect(history).toBeVisible();
      await expect(history.getByText('Search Import History')).toBeVisible();
      await expect(history.getByText(seed.filename)).toBeVisible();
      await expect(history.getByText('Identified')).toBeVisible();

      // Accessibility: the history section itself carries no serious violations.
      await expectNoSeriousA11y(page, {
        include: '[data-testid="screening-import-history"]',
        label: 'screening-import-history',
        testInfo,
      });

      // ── Open the reset modal (owner → the action is enabled) ───────────────
      const resetOpen = history.getByRole('button', { name: 'Delete All Imported Search Records' });
      await expect(resetOpen).toBeEnabled();
      await resetOpen.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // The server-computed preview renders exact numbers before any typing.
      await expect(dialog.getByText('This will permanently remove')).toBeVisible();
      await expect(dialog.getByText('This cannot be undone.')).toBeVisible();

      // ── Typed-confirm gate: disabled until the EXACT token is typed ────────
      const danger = dialog.getByRole('button', { name: 'Delete imported search records' });
      await expect(danger).toBeDisabled();

      const confirmInput = dialog.getByLabel('Type the exact confirmation text to confirm deletion');
      await confirmInput.fill('definitely not the project name');
      await expect(danger).toBeDisabled();
      await confirmInput.fill(seed.project.name.slice(0, -1)); // one char short
      await expect(danger).toBeDisabled();
      await confirmInput.fill(seed.project.name);
      await expect(danger).toBeEnabled();

      // Accessibility: the open modal (focus-trapped dialog) scans clean.
      await expectNoSeriousA11y(page, { include: '[role="dialog"]', label: 'reset-modal', testInfo });

      // ── Complete the scope='search' reset ──────────────────────────────────
      await danger.click();
      await expect(dialog.getByText('Imported records deleted')).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toHaveCount(0);

      // File-imported records are OUT of scope 'search': the batch entry is
      // still in the refreshed history and every record survived (acceptance 23).
      await expect(history.getByText(seed.filename)).toBeVisible();
      expect(await recordCount(request, seed.siftId)).toBe(seed.imported);

      // The workbench still lists the seeded records.
      await sift.openWorkbench(seed.project.id);
      await expect(sift.recordCounter).toContainText(`${seed.imported} / ${seed.imported} RECORD`);
    } finally {
      await api.deleteProject(request, seed.project.id);
    }
  });

  test('scope=all deletes everything and the SAME file re-imports successfully afterwards', async ({ page, request }) => {
    const seed = await seedImportedProject(request, 'all');
    try {
      const sift = new ScreeningPage(page);
      await sift.goto(seed.project.id);

      const history = sift.main.getByTestId('screening-import-history');
      await expect(history.getByText(seed.filename)).toBeVisible();
      await history.getByRole('button', { name: 'Delete All Imported Search Records' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Switch to the full-restart scope: the harder copy + extra warning render
      // and the danger button label changes.
      await dialog.locator('input[type="radio"][value="all"]').check();
      await expect(dialog.getByText(/restart\s+Screening from zero/)).toBeVisible();
      const danger = dialog.getByRole('button', { name: 'Delete ALL screening records' });
      await expect(danger).toBeDisabled();

      const confirmInput = dialog.getByLabel('Type the exact confirmation text to confirm deletion');
      await confirmInput.fill(seed.project.name);
      await expect(danger).toBeEnabled();
      await danger.click();
      await expect(dialog.getByText('Imported records deleted')).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).click();

      // Every record is gone; the (now empty) history section unmounts entirely
      // (the section is hidden only when it has no data — 96.md 6E).
      expect(await recordCount(request, seed.siftId)).toBe(0);
      await expect(sift.main.getByTestId('screening-import-history')).toHaveCount(0);

      // Acceptance 25 / plan D11: the SAME file (identical content → identical
      // fileHash) imports again WITHOUT force — the reset cleared the
      // duplicate-import fence along with the batches.
      const again = await api.importScreeningRecords(request, seed.siftId, {
        content: seed.content, filename: seed.filename, force: false,
      });
      expect(again.imported).toBe(seed.imported);

      // The refreshed overview shows the new batch entry.
      await sift.goto(seed.project.id);
      await expect(sift.main.getByTestId('screening-import-history').getByText(seed.filename)).toBeVisible();
    } finally {
      await api.deleteProject(request, seed.project.id);
    }
  });
});
