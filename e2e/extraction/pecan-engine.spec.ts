/**
 * 76.md — Pecan Extraction Engine e2e. Enables the `extractionEngine` flag within scope
 * (restored on teardown by the setFlags fixture so the classic-surface specs are
 * unaffected), seeds one extraction study, and drives the article-list → workspace →
 * complete flow. Selectors use the engine's data-testids + accessible text.
 */
import { test, expect } from '../fixtures/stitch-test';
import { createProject, deleteProject } from '../helpers/api';

test.describe('Pecan Extraction Engine', () => {
  test('article list opens an article into the split workspace and completes it @smoke', async ({ page, request, setFlags }) => {
    await setFlags({ extractionEngine: true });

    const project = await createProject(request, `E2E Pecan Engine ${Date.now()}`);
    try {
      // Seed one extraction study directly into the blob (owner-scoped studies API).
      const res = await request.post(`/api/projects/${project.id}/studies`, {
        data: { author: 'Khoury', year: '2021', outcome: 'All-cause mortality', esType: 'OR', a: '12', b: '88', c: '20', d: '80' },
      });
      expect(res.ok(), `seed study failed: ${res.status()}`).toBeTruthy();

      await page.goto(`/app/project/${project.id}?tab=extraction`);

      // The engine article list (not the classic tab) is mounted.
      const list = page.getByTestId('pex-article-list');
      await expect(list).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('Articles for extraction')).toBeVisible();
      await expect(page.getByText('Khoury')).toBeVisible();

      // Open the article → the full-screen split workspace appears.
      await page.getByText('Khoury').first().click();
      const ws = page.getByTestId('pex-workspace');
      await expect(ws).toBeVisible({ timeout: 15000 });

      // The toolbar exposes the Complete action; completing returns to a "complete" state.
      const complete = page.getByRole('button', { name: /Complete/i }).first();
      await expect(complete).toBeVisible();
      await complete.click();
      // After completion the toolbar offers Reopen (audited state change round-tripped through the API).
      await expect(page.getByRole('button', { name: /Reopen/i })).toBeVisible({ timeout: 15000 });
    } finally {
      await deleteProject(request, project.id);
    }
  });

  test('workspace shows only Pick-from-PDF + Manual Entry, the Converter, and a measure-driven active field @smoke', async ({ page, request, setFlags }) => {
    await setFlags({ extractionEngine: true });
    const project = await createProject(request, `E2E Pecan UX ${Date.now()}`);
    try {
      // 77.md §7 — a Risk Ratio study; picking must be able to fill the 2×2 boxes.
      const res = await request.post(`/api/projects/${project.id}/studies`, {
        data: { author: 'Rivera', year: '2022', outcome: 'Mortality', esType: 'RR' },
      });
      expect(res.ok(), `seed study failed: ${res.status()}`).toBeTruthy();

      await page.goto(`/app/project/${project.id}?tab=extraction`);
      await page.getByText('Rivera').first().click();
      const ws = page.getByTestId('pex-workspace');
      await expect(ws).toBeVisible({ timeout: 15000 });

      // §3 — exactly two input modes, no table/figure recognition.
      await expect(page.getByRole('tab', { name: /Pick from PDF/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Manual Entry/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Table|Figure/i })).toHaveCount(0);

      // §4 — the Converter is present; the parked "Also reported" slot is gone.
      await expect(page.getByTestId('pex-converter')).toBeVisible();
      await expect(page.getByText('Also reported (not in this review)')).toHaveCount(0);

      // §7/§8 — a discoverable, measure-driven active pick target (RR → the 2×2 cells).
      const target = page.getByLabel('Next click fills →');
      await expect(target).toBeVisible();
      await expect(target.locator('option', { hasText: '2×2 a' })).toHaveCount(1);

      // §7 — changing the effect measure re-drives the pick targets (RR 2×2 → MD continuous),
      // proving the field mapping (not a stale 'smart') across browsers.
      await page.getByTestId('pex-esType').selectOption('MD');
      await expect(target.locator('option', { hasText: 'Mean (Exp)' })).toHaveCount(1);
      await expect(target.locator('option', { hasText: '2×2 a' })).toHaveCount(0);

      // Manual Entry hides the pick guidance; the form stays editable.
      await page.getByRole('tab', { name: /Manual Entry/i }).click();
      await expect(page.getByLabel('Next click fills →')).toHaveCount(0);
    } finally {
      await deleteProject(request, project.id);
    }
  });

  test('flag OFF keeps the classic extraction surface', async ({ page, request, setFlags }) => {
    await setFlags({ extractionEngine: false });
    const project = await createProject(request, `E2E Classic Extraction ${Date.now()}`);
    try {
      await page.goto(`/app/project/${project.id}?tab=extraction`);
      // The engine surface must NOT mount; the classic "Data Extraction" section header does.
      await expect(page.getByTestId('pex-article-list')).toHaveCount(0);
      await expect(page.getByText('Data Extraction').first()).toBeVisible({ timeout: 15000 });
    } finally {
      await deleteProject(request, project.id);
    }
  });
});
