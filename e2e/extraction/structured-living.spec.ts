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
  test('flag OFF → classic extraction tab only, no structured toggle', async ({ page, tmpProject, setFlags }) => {
    await setFlags({ extractionAssist: false });
    await gotoStitch(page, `/app/project/${tmpProject.id}?tab=extraction`);
    await expect(page.getByText('Data Extraction').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Structured extraction/i })).toHaveCount(0);
  });

  test('flag ON → toggle appears and opens the structured workspace setup state', async ({ page, tmpProject, setFlags }) => {
    await setFlags({ extractionAssist: true });
    await gotoStitch(page, `/app/project/${tmpProject.id}?tab=extraction`);
    const toggle = page.getByRole('button', { name: /Structured extraction \(beta\)/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    // Empty project → the form-setup empty state (template picker) renders.
    await expect(page.getByText('No extraction form yet')).toBeVisible();
    // Switch back to the classic table — nothing lost.
    await page.getByRole('button', { name: /Classic table/i }).click();
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
