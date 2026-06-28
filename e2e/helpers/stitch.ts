/**
 * stitch.ts — guarantees the app renders in the STITCH UI design mode and lets a
 * test assert it.
 *
 * Stitch is admin-only: non-admins are always forced to legacy and the server
 * refuses to persist `stitch` for them (src/frontend/design/designMode.js,
 * server/controllers/profileController.js). So the Stitch suite always runs as an
 * admin. Activation is layered for robustness:
 *   1. localStorage `metalab_ui_design = stitch` — applied pre-React by the
 *      index.html bootstrap, so Stitch paints on the very first frame (no flash).
 *      The admin storageState (global-setup) already carries this; `primeStitch`
 *      re-applies it for fresh/cleared contexts.
 *   2. the `?ui=stitch` escape param — a belt-and-suspenders first-paint override.
 *   3. server persistence (`PUT /api/profile`) done in global-setup.
 * Stitch is confirmed via `html[data-ui-design="stitch"]` (set on document root).
 */
import { Page, expect } from '@playwright/test';

export const STITCH_STORAGE_KEY = 'metalab_ui_design';

/** Ensure every page in this context boots Stitch on first paint. Call once per context. */
export async function primeStitch(page: Page): Promise<void> {
  await page.context().addInitScript((key) => {
    try { window.localStorage.setItem(key, 'stitch'); } catch { /* storage unavailable */ }
  }, STITCH_STORAGE_KEY);
}

/** Navigate to a path, let the SPA settle (auth/getMe), and assert Stitch is active.
 *  The stored admin session + localStorage `metalab_ui_design=stitch` make the admin
 *  resolve to Stitch; we just have to wait past the brief pre-auth legacy paint. */
export async function gotoStitch(page: Page, path = '/app'): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expectStitch(page);
}

/** Assert the Stitch design mode is the one actually rendered (after auth settles). */
export async function expectStitch(page: Page): Promise<void> {
  // Poll the root attribute — DesignModeContext resolves to Stitch once the public
  // designSettings load (Stitch is the rollout default for all users). We do NOT wait
  // for networkidle: the app holds a long-lived SSE (presence) connection open.
  await expect
    .poll(async () => page.locator('html').getAttribute('data-ui-design'), { timeout: 20000 })
    .toBe('stitch');
}

/** Assert legacy mode (used for the /ops console + the non-admin forced-legacy case). */
export async function expectLegacy(page: Page): Promise<void> {
  // Legacy sets data-ui-design to "legacy" (or leaves it absent on the very first paint).
  await expect
    .poll(async () => (await page.locator('html').getAttribute('data-ui-design')) || 'legacy', { timeout: 15000 })
    .not.toBe('stitch');
}
