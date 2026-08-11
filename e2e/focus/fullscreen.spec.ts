/**
 * fullscreen.spec.ts — 114.md §1: Focus Mode is TRUE browser fullscreen now.
 *
 * The layout half of Focus Mode (which chrome is hidden, what the workspace
 * becomes) is covered by tests/unit/focus/focusMode.test.jsx and is deliberately
 * unchanged. What can only be proven in a real browser is the half 114.md adds:
 *
 *   - our control actually puts the DOCUMENT ELEMENT into the Fullscreen API, so
 *     the browser's tabs/address bar go too (a CSS-only "big page" would leave
 *     document.fullscreenElement null — that is the whole point of asserting it);
 *   - every exit path — our button, Escape, and a fullscreen that ends OUTSIDE
 *     the app — leaves BOTH halves consistent. A page that stays in the focus
 *     layout after the browser dropped fullscreen is the "false full-screen
 *     state" the prompt names explicitly;
 *   - the Previous/Next bar keeps working while fullscreen.
 *
 * Chromium only: fullscreen grants depend on the window manager, and the WebKit /
 * Firefox harnesses refuse or hang on requestFullscreen headlessly. The API
 * wiring itself (including the webkit-prefixed dialect and the denial fallback)
 * is unit-tested against a hand-rolled document instead.
 */
import { test, expect } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';

test.describe('114.md §1 — Focus Mode enters true browser fullscreen', () => {
  test.skip(({ browserName }) => browserName !== 'chromium',
    'Fullscreen grants are unreliable outside the Chromium harness; the API contract is unit-tested.');

  /** Is the PAGE ITSELF fullscreen (not merely a wide viewport)? */
  const rootIsFullscreen = (page: import('@playwright/test').Page) =>
    page.evaluate(() => document.fullscreenElement === document.documentElement);
  const anyFullscreen = (page: import('@playwright/test').Page) =>
    page.evaluate(() => !!document.fullscreenElement);

  /**
   * The PICO stage of the project workspace — a real workspace surface, so the
   * focus bar is StitchProjectWorkspace's own FocusNavBar (Previous/Next/exit)
   * rather than the shell's minimal fallback bar.
   */
  async function openWorkspace(page: import('@playwright/test').Page, projectId: string) {
    const shell = new ShellNav(page);
    await shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=pico`);
    await shell.expectShell();
    return shell;
  }

  test('the toggle enters fullscreen with the focus bar, and toggling again clears both', async ({ page, tmpProject }) => {
    const shell = await openWorkspace(page, tmpProject.id);
    const toggle = page.getByTestId('focus-toggle');
    const bar = page.getByTestId('focus-nav-bar');

    await expect(bar).toHaveCount(0);
    expect(await anyFullscreen(page)).toBe(false);

    // ENTER — the layout mode AND the browser's own chrome.
    await toggle.click();
    await expect(bar).toBeVisible();
    await expect(shell.topHeader).toHaveCount(0);
    await expect.poll(() => rootIsFullscreen(page), {
      timeout: 10_000,
      message: 'the control never requested real fullscreen on documentElement',
    }).toBe(true);
    // 114.md §1 — the workspace really fills the display, not just the viewport.
    const covered = await page.evaluate(() => window.innerHeight >= window.screen.height * 0.9);
    expect(covered).toBe(true);

    // The one control Focus Mode keeps is the one that gets back out.
    await toggle.click();
    await expect(bar).toHaveCount(0);
    await expect(shell.topHeader).toBeVisible();
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
  });

  test('Escape leaves fullscreen AND the focus layout together (no false full-screen state)', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    const toggle = page.getByTestId('focus-toggle');
    const bar = page.getByTestId('focus-nav-bar');

    await toggle.click();
    await expect(bar).toBeVisible();
    await expect.poll(() => rootIsFullscreen(page), { timeout: 10_000 }).toBe(true);

    // Escape is the browser's own way out of fullscreen; the app state must follow
    // it whichever half moves first (our keydown handler, or fullscreenchange).
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
    await expect(page.getByTestId('stitch-top-header')).toBeVisible();
  });

  test('fullscreen ending OUTSIDE the app drops Focus Mode with it', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    const bar = page.getByTestId('focus-nav-bar');

    await page.getByTestId('focus-toggle').click();
    await expect(bar).toBeVisible();
    await expect.poll(() => rootIsFullscreen(page), { timeout: 10_000 }).toBe(true);

    // Stand in for the browser/OS exit (F11, the window manager, the Esc overlay):
    // fullscreen ends without any app control being touched.
    await page.evaluate(() => document.exitFullscreen());
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('stitch-top-header')).toBeVisible();
    expect(await anyFullscreen(page)).toBe(false);
  });

  test('Previous/Next still navigates while the page is fullscreen', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    await page.getByTestId('focus-toggle').click();
    await expect(page.getByTestId('focus-nav-bar')).toBeVisible();
    await expect.poll(() => rootIsFullscreen(page), { timeout: 10_000 }).toBe(true);

    const before = page.url();
    await page.getByTestId('focus-nav-next').click();
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toBe(before);

    // The route change must NOT eject fullscreen — that is why documentElement is
    // the fullscreen element rather than a shell div that remounts.
    await expect(page.getByTestId('focus-nav-bar')).toBeVisible();
    expect(await rootIsFullscreen(page)).toBe(true);

    // Leave the tab in a clean state for the next spec sharing the browser.
    await page.getByTestId('focus-exit').click();
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
  });
});
