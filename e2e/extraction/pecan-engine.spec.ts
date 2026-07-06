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
