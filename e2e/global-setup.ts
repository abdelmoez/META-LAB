/**
 * global-setup.ts — runs once before the whole Playwright suite.
 *
 *  1. Refuses to run against a non-local target (safety).
 *  2. Waits for the app (client + API) to be reachable.
 *  3. Logs in the seeded admin via the API, persists Stitch as their UI design mode,
 *     and saves a browser storageState (cookie + localStorage `metalab_ui_design`)
 *     so every test starts authenticated as an admin in Stitch with no per-test login.
 *  4. Seeds one shared read-only project and records its id for tests that need an
 *     existing project without creating their own.
 *
 * The admin credentials come from server/.env (ADMIN_EMAIL_1 + ADMIN_SEED_PASSWORD),
 * loaded by helpers/env.ts — the same dev seed the server uses. Never printed.
 */
import { chromium, request as playwrightRequest, FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertSafeTarget, BASE_URL, API_URL, ADMIN_EMAIL, ADMIN_PASSWORD, AUTH_DIR, adminStatePath,
} from './helpers/env';
import { login, setDesignMode, createProject } from './helpers/api';
import { STITCH_STORAGE_KEY } from './helpers/stitch';

async function waitForUp(url: string, label: string, timeoutMs = 60000): Promise<void> {
  const ctx = await playwrightRequest.newContext();
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await ctx.get(url, { timeout: 5000 });
      if (res.ok() || res.status() < 500) { await ctx.dispose(); return; }
      lastErr = `status ${res.status()}`;
    } catch (e: any) { lastErr = e?.message || String(e); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await ctx.dispose();
  throw new Error(`[e2e] ${label} not reachable at ${url} within ${timeoutMs}ms (${lastErr}). Start it with: npm run dev`);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  assertSafeTarget();

  if (!ADMIN_PASSWORD) {
    throw new Error(
      '[e2e] No admin password available. Set ADMIN_SEED_PASSWORD in server/.env ' +
      '(the dev seed) or E2E_ADMIN_PASSWORD in .env.test so the suite can authenticate.',
    );
  }

  await waitForUp(`${API_URL}/api/health`, 'API server (:3001)');
  await waitForUp(`${BASE_URL}/`, 'client (:3000)');

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // Authenticate the admin and persist Stitch as their design mode (server-side).
  const apiCtx = await playwrightRequest.newContext({ baseURL: API_URL });
  const admin = await login(apiCtx, ADMIN_EMAIL, ADMIN_PASSWORD);
  if (admin.role !== 'admin') {
    throw new Error(`[e2e] ${ADMIN_EMAIL} is not an admin (role=${admin.role}). Stitch mode requires an admin.`);
  }
  const persisted = await setDesignMode(apiCtx, 'stitch');
  if (!persisted) console.warn('[e2e] PUT /api/profile {uiDesignMode:stitch} did not persist (continuing — localStorage will still force Stitch).');

  // Seed a shared project for read-only tests.
  let seedProjectId = '';
  try {
    const p = await createProject(apiCtx, `E2E Seed Project ${Date.now()}`);
    seedProjectId = p.id;
  } catch (e: any) {
    console.warn('[e2e] could not seed a shared project:', e?.message || e);
  }
  await apiCtx.dispose();

  // Capture a real browser storageState. We log in via the PAGE's own fetch so Chromium
  // sets + owns the session cookie (an injected sameSite=Strict cookie is not reliably
  // sent on the SPA's getMe). localStorage forces Stitch on first paint.
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.addInitScript((key) => { try { window.localStorage.setItem(key, 'stitch'); } catch { /* noop */ } }, STITCH_STORAGE_KEY);
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('domcontentloaded');
  const loginStatus = await page.evaluate(async ({ api, email, password }) => {
    const r = await fetch(`${api}/api/auth/login`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    return r.status;
  }, { api: API_URL, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginStatus >= 400) throw new Error(`[e2e] in-page admin login failed (status ${loginStatus}).`);
  await page.goto(`${BASE_URL}/app`);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((key) => { try { window.localStorage.setItem(key, 'stitch'); } catch { /* noop */ } }, STITCH_STORAGE_KEY);
  await context.storageState({ path: adminStatePath });
  await browser.close();

  fs.writeFileSync(
    path.join(AUTH_DIR, 'seed.json'),
    JSON.stringify({ seedProjectId, adminEmail: ADMIN_EMAIL, baseURL: BASE_URL, apiURL: API_URL }, null, 2),
  );

  console.log(`[e2e] global-setup ok — admin=${ADMIN_EMAIL}, stitch persisted, seedProjectId=${seedProjectId || '(none)'}`);
}
