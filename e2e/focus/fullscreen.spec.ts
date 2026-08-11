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
 *     the app — leaves BOTH halves consistent. "Consistent" is not "identical":
 *     114-r2 §2 separates them deliberately. Escape inside fullscreen cannot be
 *     intercepted — the browser exits whatever the page does with the event — so
 *     a researcher closing a modal or an autocomplete produces the same
 *     fullscreenchange as a deliberate exit. Collapsing the whole focus layout
 *     there ejected them from a mode they never asked to leave. So an external
 *     exit degrades to focused-but-windowed (the documented reload state) and
 *     the CONTROLS stop claiming a full screen; only a deliberate exit — the
 *     button, or a plain Escape our keydown handler sees — unwinds the layout.
 *     The "false full-screen state" the prompt forbids is a UI still claiming
 *     fullscreen, and that is what is asserted below;
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

    // 114.md §7 — "focus is not lost". The header toggle the user just pressed is
    // unmounted by the transition, which drops document.activeElement to <body>
    // and restarts a keyboard user's Tab order at the top of the document. The
    // control that replaces it takes the focus back.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null), { timeout: 5_000 })
      .toBe('focus-toggle');

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

    // A PLAIN Escape — nothing focused that wants it, nobody typing — is a
    // deliberate "get me out", and it stays a full exit in one press: the window
    // keydown handler sees it and unwinds the layout and fullscreen together.
    // (The keydown reaching the page and the browser's own fullscreen exit can
    // both fire from one physical press; the exit path is idempotent, so whichever
    // lands first the result below is the same.) This is the counterpart to the
    // external-exit test: there the layout must SURVIVE, because that Escape was
    // aimed at an overlay and never reached us.
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
    await expect(page.getByTestId('stitch-top-header')).toBeVisible();
  });

  test('fullscreen ending OUTSIDE the app degrades to windowed focus, it does not eject', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    const bar = page.getByTestId('focus-nav-bar');

    await page.getByTestId('focus-toggle').click();
    await expect(bar).toBeVisible();
    await expect.poll(() => rootIsFullscreen(page), { timeout: 10_000 }).toBe(true);
    // While we really are fullscreen, the exit control says so.
    await expect(page.getByTestId('focus-exit')).toHaveAttribute('aria-label', /leave full screen/);
    await expect(page.getByTestId('focus-fullscreen')).toHaveCount(0);

    // Stand in for every exit the app cannot intercept: F11, the window manager,
    // and — the one that matters — the Escape a researcher aimed at an overlay,
    // which the browser consumes to leave fullscreen no matter what the page does.
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);

    // 114-r2 §2: the LAYOUT stays. Being dropped back to full chrome mid-thought
    // because a modal was dismissed is the bug this test exists to prevent.
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('stitch-top-header')).toHaveCount(0);

    // …but nothing may keep CLAIMING a full screen that is gone: the exit copy
    // drops the promise, and the way back up appears.
    await expect(page.getByTestId('focus-exit')).toHaveAttribute('aria-label', 'Exit focus mode — restore navigation');
    await expect(page.getByTestId('focus-toggle')).toHaveAttribute('aria-label', 'Exit focus mode — restore navigation');
    await expect(page.getByTestId('focus-fullscreen')).toBeVisible();

    // The deliberate exit still works from here, and is still one press.
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('stitch-top-header')).toBeVisible();
  });

  test('the way back UP: windowed focus can re-enter real fullscreen with one gesture', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    await page.getByTestId('focus-toggle').click();
    await expect(page.getByTestId('focus-nav-bar')).toBeVisible();
    await expect.poll(() => rootIsFullscreen(page), { timeout: 10_000 }).toBe(true);

    await page.evaluate(() => document.exitFullscreen());
    await expect(page.getByTestId('focus-fullscreen')).toBeVisible();

    // A fresh user gesture is exactly what the browser was missing — which is why
    // this is a button and not something the app can do on its own after a reload.
    await page.getByTestId('focus-fullscreen').click();
    await expect.poll(() => rootIsFullscreen(page), { timeout: 10_000 }).toBe(true);
    await expect(page.getByTestId('focus-fullscreen')).toHaveCount(0);

    await page.getByTestId('focus-exit').click();
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
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
