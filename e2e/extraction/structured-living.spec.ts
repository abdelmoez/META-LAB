/**
 * 66.md P5/P6 — structured extraction + living review flag-gated surfaces.
 *
 * Verifies the two new modules are (1) invisible while their flags are OFF
 * (no dead buttons, classic tab unchanged, living tab shows the disabled note)
 * and (2) reachable + rendering their setup states when the flags are ON.
 * Flags are patched via the snapshot-restoring setFlags fixture.
 */
import { test, expect } from '../fixtures/stitch-test';
import { gotoStitch } from '../helpers/stitch';

test.describe('structured extraction (flag extractionAssist)', () => {
  // e1.md retired the Classic/Structured mode toggle: the split-screen assisted workspace
  // IS the main extraction interface, and the 66.md structured dual-review workspace is
  // reachable behind a discreet, flag-gated "Dual-review workspace" button (its data +
  // reconciliation path preserved). These tests track that new surface.
  test('flag OFF → extraction tab only, no structured/dual-review affordance', async ({ page, tmpProject, setFlags }) => {
    await setFlags({ extractionAssist: false });
    await gotoStitch(page, `/app/project/${tmpProject.id}?tab=extraction`);
    await expect(page.getByText('Data Extraction').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Structured extraction/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Dual-review workspace/i })).toHaveCount(0);
  });

  test('flag ON → a "Dual-review workspace" button opens the structured workspace and back', async ({ page, tmpProject, setFlags }) => {
    await setFlags({ extractionAssist: true });
    await gotoStitch(page, `/app/project/${tmpProject.id}?tab=extraction`);
    // The retired Classic/Structured toggle must be gone.
    await expect(page.getByRole('button', { name: /Structured extraction \(beta\)/i })).toHaveCount(0);
    const open = page.getByRole('button', { name: /Dual-review workspace/i });
    await expect(open).toBeVisible();
    await open.click();
    // Empty project → the form-setup empty state (template picker) renders.
    await expect(page.getByText('No extraction form yet')).toBeVisible();
    // Return to the main extraction surface — nothing lost.
    await page.getByRole('button', { name: /Back to extraction/i }).click();
    await expect(page.getByText('Data Extraction').first()).toBeVisible();
  });
});

test.describe('living review (flag livingReview)', () => {
  test('flag OFF → ?tab=living shows the disabled note, never a broken page', async ({ page, tmpProject, setFlags }) => {
    await setFlags({ livingReview: false });
    await gotoStitch(page, `/app/project/${tmpProject.id}?tab=living`);
    await expect(page.getByText('Living Review').first()).toBeVisible();
    await expect(page.getByText(/Feature Flags/i)).toBeVisible(); // the enable-hint copy
  });

  test('flag ON → dashboard renders its sections and setup empty states', async ({ page, tmpProject, setFlags }) => {
    await setFlags({ livingReview: true });
    await gotoStitch(page, `/app/project/${tmpProject.id}?tab=living`);
    await expect(page.getByRole('heading', { name: 'Living Review' })).toBeVisible();
    // Empty project: saved-searches empty state + snapshots area render (no dead page).
    await expect(page.getByText(/saved search/i).first()).toBeVisible();
  });
});
