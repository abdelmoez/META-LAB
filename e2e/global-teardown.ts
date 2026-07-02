/**
 * global-teardown.ts — runs once after the whole suite. Best-effort restore of the
 * dev environment so a developer using the app after a test run isn't left with the
 * onboarding gate disabled. Never throws (teardown failures must not fail the run).
 */
import { request as playwrightRequest } from '@playwright/test';
import { API_URL, ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/env';
import { login, setOnboardingEnabled } from './helpers/api';

export default async function globalTeardown(): Promise<void> {
  if (!ADMIN_PASSWORD) return;
  try {
    const api = await playwrightRequest.newContext({ baseURL: API_URL });
    await login(api, ADMIN_EMAIL, ADMIN_PASSWORD);
    await setOnboardingEnabled(api, true);
    await api.dispose();
    console.log('[e2e] global-teardown: onboarding gate re-enabled.');
  } catch (e: any) {
    console.warn('[e2e] global-teardown skipped:', e?.message || e);
  }
}
