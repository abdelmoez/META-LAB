/**
 * global-setup.ts — runs once before the whole Playwright suite.
 *
 *  1. Refuses to run against a non-local target (safety).
 *  2. Waits for the app (client + API) to be reachable.
 *  3. Logs in the seeded admin, persists the admin's Stitch preference (65.md:
 *     Stitch is the default for everyone; only ADMINS may persist a personal
 *     mode, so this pins the admin explicitly), ENABLES the engine feature flags
 *     so gated areas (AI screening, RoB, NMA, search) are testable, and saves the
 *     admin browser storageState.
 *  4. Programmatically creates a MOD and a NORMAL user (per-run unique emails) and
 *     saves their storageStates, so permission/role specs need no manual seeding.
 *  5. Seeds a few projects (incl. a long-name one) so the dashboard is populated,
 *     and records every id/credential in `.auth/seed.json` for the fixtures.
 *
 * The admin credentials come from server/.env (ADMIN_EMAIL_1 + ADMIN_SEED_PASSWORD),
 * loaded by helpers/env.ts — the same dev seed the server uses. Never printed.
 */
import { chromium, request as playwrightRequest, FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertSafeTarget, BASE_URL, API_URL, ADMIN_EMAIL, ADMIN_PASSWORD, SEED_PASSWORD,
  AUTH_DIR, adminStatePath, modStatePath, normalStatePath,
} from './helpers/env';
import {
  login, setDesignMode, createProject, register, updateUserRole, enableEngineFlags, setOnboardingEnabled,
} from './helpers/api';
import { captureStorageState } from './helpers/sessions';

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

  // ── Admin API context (baseURL = API origin; cookie scoped to :3001) ──────────
  const adminApi = await playwrightRequest.newContext({ baseURL: API_URL });
  const admin = await login(adminApi, ADMIN_EMAIL, ADMIN_PASSWORD);
  if (admin.role !== 'admin') {
    throw new Error(`[e2e] ${ADMIN_EMAIL} is not an admin (role=${admin.role}). The suite needs admin APIs.`);
  }
  // Pin the admin's PERSONAL mode to Stitch (admin-only write — a 403 here would
  // mean the account is not really an admin). Normal-user fixtures need no design
  // priming: Stitch is the Ops-governed default for every non-admin.
  await setDesignMode(adminApi, 'stitch');

  // Turn ON the engine flags once for the whole run so gated specs can exercise
  // them (others skip with a clear reason). Best-effort: a flag failure must not
  // sink the whole suite.
  let enabledFlags: Record<string, boolean> = {};
  try { enabledFlags = await enableEngineFlags(adminApi); }
  catch (e: any) { console.warn('[e2e] could not enable engine flags:', e?.message || e); }

  // Disable the onboarding gate so seeded + mid-test users land on the app instead
  // of being trapped on /onboarding by required questions. globalTeardown restores it.
  try { await setOnboardingEnabled(adminApi, false); }
  catch (e: any) { console.warn('[e2e] could not disable onboarding gate:', e?.message || e); }

  // ── Seed projects (admin-owned) so the dashboard is never empty ───────────────
  const runTag = Date.now();
  let seedProjectId = '';
  let longNameProjectId = '';
  const extraProjectIds: string[] = [];
  try {
    seedProjectId = (await createProject(adminApi, `E2E Seed Project ${runTag}`)).id;
    longNameProjectId = (await createProject(
      adminApi,
      `E2E Very Long Project Name That Should Ellipsize Gracefully In Every Header And Card Without Breaking The Layout ${runTag}`,
    )).id;
    for (let i = 1; i <= 2; i++) extraProjectIds.push((await createProject(adminApi, `E2E Dashboard Project ${i} ${runTag}`)).id);
  } catch (e: any) {
    console.warn('[e2e] could not seed projects:', e?.message || e);
  }

  // ── Create a MOD and a NORMAL user, then promote the mod ──────────────────────
  const modEmail = `e2e-mod-${runTag}@pecanrev.test`;
  const normalEmail = `e2e-normal-${runTag}@pecanrev.test`;
  let modReady = false;
  let normalReady = false;
  try {
    const reg = await playwrightRequest.newContext({ baseURL: API_URL });
    const modUser = await register(reg, { email: modEmail, password: SEED_PASSWORD, name: 'E2E Mod' });
    await updateUserRole(adminApi, modUser.id, 'mod');
    modReady = true;
    await reg.dispose();

    const reg2 = await playwrightRequest.newContext({ baseURL: API_URL });
    await register(reg2, { email: normalEmail, password: SEED_PASSWORD, name: 'E2E Normal' });
    normalReady = true;
    await reg2.dispose();
  } catch (e: any) {
    console.warn('[e2e] could not create mod/normal users:', e?.message || e);
  }

  await adminApi.dispose();

  // ── Capture browser storageStates (cookie owned by the CLIENT origin) ─────────
  const browser = await chromium.launch();
  try {
    await captureStorageState(browser, { baseURL: BASE_URL, email: ADMIN_EMAIL, password: ADMIN_PASSWORD, statePath: adminStatePath });
    if (modReady) {
      try { await captureStorageState(browser, { baseURL: BASE_URL, email: modEmail, password: SEED_PASSWORD, statePath: modStatePath }); }
      catch (e: any) { console.warn('[e2e] mod storageState failed:', e?.message || e); modReady = false; }
    }
    if (normalReady) {
      try { await captureStorageState(browser, { baseURL: BASE_URL, email: normalEmail, password: SEED_PASSWORD, statePath: normalStatePath }); }
      catch (e: any) { console.warn('[e2e] normal storageState failed:', e?.message || e); normalReady = false; }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(
    path.join(AUTH_DIR, 'seed.json'),
    JSON.stringify({
      seedProjectId,
      longNameProjectId,
      extraProjectIds,
      adminEmail: ADMIN_EMAIL,
      mod: modReady ? { email: modEmail, password: SEED_PASSWORD } : null,
      normal: normalReady ? { email: normalEmail, password: SEED_PASSWORD } : null,
      enabledFlags,
      baseURL: BASE_URL,
      apiURL: API_URL,
    }, null, 2),
  );

  console.log(
    `[e2e] global-setup ok — admin=${ADMIN_EMAIL}, stitch persisted, ` +
    `flags=[${Object.keys(enabledFlags).filter((k) => enabledFlags[k]).join(',')}], ` +
    `seedProjectId=${seedProjectId || '(none)'}, mod=${modReady ? modEmail : 'none'}, normal=${normalReady ? normalEmail : 'none'}`,
  );
}
