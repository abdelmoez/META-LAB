/**
 * sessions.ts — capture authenticated browser storageStates for global-setup.
 *
 * Why a real browser (not just an APIRequestContext)? The SPA reads its session
 * from a cookie the BROWSER owns on the CLIENT origin (:3000). We log in via the
 * PAGE's own fetch to a RELATIVE /api/auth/login so Chromium sets + owns that
 * cookie on :3000 — the exact origin the SPA's getMe() uses. Then we persist the
 * storageState (cookie + the `metalab_ui_design=stitch` localStorage flag) so
 * every spec starts already authenticated, with no per-test login.
 */
import { Browser } from '@playwright/test';
import { STITCH_STORAGE_KEY } from './stitch';

export interface CaptureOpts {
  baseURL: string;
  email: string;
  password: string;
  statePath: string;
  /** Force Stitch on first paint via localStorage (default true). */
  stitch?: boolean;
}

/**
 * Log `email` in inside a fresh browser context and persist its storageState.
 * Asserts the session is real (getMe returns the same email) so a broken login
 * fails LOUDLY here instead of silently producing an unauthenticated state that
 * bounces every spec to /login. Returns the email on success.
 */
export async function captureStorageState(browser: Browser, opts: CaptureOpts): Promise<string> {
  const { baseURL, email, password, statePath, stitch = true } = opts;
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  if (stitch) {
    await page.addInitScript((key) => { try { window.localStorage.setItem(key, 'stitch'); } catch { /* noop */ } }, STITCH_STORAGE_KEY);
  }
  try {
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    const status = await page.evaluate(async ({ e, p }) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: p }),
      });
      return r.status;
    }, { e: email, p: password });
    if (status >= 400) throw new Error(`in-page login failed for ${email} (status ${status})`);

    const meEmail = await page.evaluate(async () => {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      if (!r.ok) return null;
      const b = await r.json().catch(() => null);
      return (b && (b.user?.email || b.email)) || null;
    });
    if (!meEmail || meEmail.toLowerCase() !== email.toLowerCase()) {
      throw new Error(`session not established for ${email} (getMe=${meEmail || 'null'})`);
    }

    if (stitch) {
      await page.goto(`${baseURL}/app`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((key) => { try { window.localStorage.setItem(key, 'stitch'); } catch { /* noop */ } }, STITCH_STORAGE_KEY);
    }
    await context.storageState({ path: statePath });
    return email;
  } finally {
    await context.close();
  }
}
