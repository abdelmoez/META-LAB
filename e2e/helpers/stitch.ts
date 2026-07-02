/**
 * stitch.ts — guarantees the app renders in the STITCH UI design mode and lets a
 * test assert it.
 *
 * 65.md: Stitch IS the product UI — the default for EVERY user (designSettings
 * defaultMode:'stitch'), with legacy reachable only when Ops enables
 * `allowLegacyFallback` or for an admin's personal ?ui=/saved preference. The
 * priming below is therefore first-paint determinism, not access:
 *   1. localStorage `metalab_ui_design = stitch` — read pre-React by the
 *      index.html bootstrap so Stitch paints on the very first frame (no flash,
 *      no dependence on the cached designSettings). Only meaningful for the
 *      ADMIN fixture (non-admins ignore saved modes while fallback is off); it
 *      is harmless for normal-user fixtures since it matches the default.
 *      NEVER prime `legacy` for a normal-user fixture — the provider would
 *      ignore it and the pre-paint frame would flash.
 *   2. server persistence (`PUT /api/profile`) done in global-setup — ADMIN-ONLY
 *      (the server 403s the write for anyone else).
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
  // designSettings load (Stitch is the product default for all users). We do NOT wait
  // for networkidle: the app holds a long-lived SSE (presence) connection open.
  await expect
    .poll(async () => page.locator('html').getAttribute('data-ui-design'), { timeout: 20000 })
    .toBe('stitch');
}

/** Assert legacy mode (the /ops console + the admin ?ui=legacy override case). */
export async function expectLegacy(page: Page): Promise<void> {
  // Legacy sets data-ui-design to "legacy" (or leaves it absent on the very first paint).
  await expect
    .poll(async () => (await page.locator('html').getAttribute('data-ui-design')) || 'legacy', { timeout: 15000 })
    .not.toBe('stitch');
}
