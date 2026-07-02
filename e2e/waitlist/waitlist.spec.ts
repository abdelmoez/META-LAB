/**
 * waitlist.spec.ts — the public Beta Waitlist (54.md / prompt48).
 *
 * Coverage:
 *   - The always-on `/beta-waitlist` PREVIEW renders the email-capture form + the
 *     questionnaire steps regardless of the `betaWaitlist` flag (OFF by default).
 *   - Client validation: empty + invalid email each surface the app's inline error
 *     and keep the visitor on Step 1.
 *   - Public submission API: a fresh email is accepted (201) and an immediate repeat
 *     is reported as a safe, non-leaking duplicate (200). DB-guarded.
 *   - Full UI flow: a valid unique email reaches the honest confirmation panel; a
 *     seeded duplicate shows the "already on the list" panel without leaking status.
 *   - The gate: with `betaWaitlist` flipped ON (serial scope, restored OFF in
 *     afterAll), an UNAUTH visit to `/` shows the waitlist, while an authed user
 *     bypasses it and gets the normal landing.
 *
 * Everything runs logged-out (`anonTest`) — the waitlist is a public page and its
 * endpoints need no session. The waitlist DB is isolated, so submissions in dev are
 * safe; every email is unique to avoid cross-run collisions. Tests that depend on a
 * real write skip honestly when the isolated waitlist DB is not configured.
 */
import { request as apiRequest, APIRequestContext } from '@playwright/test';
import { anonTest, expect } from '../fixtures/stitch-test';
import {
  WaitlistPage, submitWaitlistApplication, fetchWaitlistCount, waitlistDbAvailable, uniqueWaitlistEmail,
} from '../page-objects/WaitlistPage';
import { setFeatureFlags } from '../helpers/api';
import { BASE_URL, adminStatePath } from '../helpers/env';

const DB_SKIP = 'TODO: isolated waitlist DB (BETA_WAITLIST_DATABASE_URL) not configured in this env';

anonTest.describe('@smoke beta waitlist preview (/beta-waitlist) — renders regardless of flag', () => {
  anonTest('renders the email-capture form on the always-on preview route', async ({ page }) => {
    const wl = new WaitlistPage(page);
    await wl.gotoPreview();
    await expect(wl.emailInput).toBeVisible();
    await expect(wl.emailInput).toHaveAttribute('type', 'email');
    await expect(wl.joinBetaButton).toBeVisible();
    // The amber preview banner proves this is the noindex preview (renders flag-OFF too).
    await expect(wl.previewNote).toBeVisible();
    await expect(wl.heroHeading).toBeVisible();
  });

  anonTest('exposes the questionnaire fields (email → about you → your work)', async ({ page }) => {
    const wl = new WaitlistPage(page);
    await wl.gotoPreview();
    await wl.startWithEmail(uniqueWaitlistEmail('q')); // Step 1 → Step 2 (client-side only, no write)
    await expect(wl.aboutHeading).toBeVisible();
    await expect(wl.firstNameInput).toBeVisible();
    await expect(wl.lastNameInput).toBeVisible();
    await expect(wl.roleSelect).toBeVisible();
    await wl.continueButton.click();                   // Step 2 → Step 3
    await expect(wl.yourWorkHeading).toBeVisible();
    await expect(wl.countrySelect).toBeVisible();        // the one REQUIRED questionnaire field
  });

  anonTest('an empty email shows an inline validation error and stays on step 1', async ({ page }) => {
    const wl = new WaitlistPage(page);
    await wl.gotoPreview();
    await wl.joinBetaButton.click();                    // submit the pill with no email
    await expect(wl.emailError).toContainText('Email is required.');
    await expect(wl.aboutHeading).toHaveCount(0);        // did not advance off Step 1
  });

  anonTest('an invalid email shows an inline validation error and stays on step 1', async ({ page }) => {
    const wl = new WaitlistPage(page);
    await wl.gotoPreview();
    // `foo@bar` passes the browser's native type=email check (dot-less host is allowed)
    // but fails the app's stricter isValidEmail, so the app's own inline error fires.
    await wl.emailInput.fill('foo@bar');
    await wl.joinBetaButton.click();
    await expect(wl.emailError).toContainText('Enter a valid email address.');
    await expect(wl.aboutHeading).toHaveCount(0);
  });
});

anonTest.describe('beta waitlist submission (public API + UI)', () => {
  anonTest('@smoke the public count endpoint always responds 200 with a number or null', async ({ request }) => {
    const res = await request.get('/api/waitlist/count');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('count');
    expect(body.count === null || typeof body.count === 'number').toBeTruthy();
  });

  anonTest('a unique submission is accepted and an immediate repeat is a safe duplicate', async ({ request }) => {
    const email = uniqueWaitlistEmail('api');
    const first = await submitWaitlistApplication(request, { email });
    anonTest.skip(first.status === 503, DB_SKIP);

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ ok: true, duplicate: false });
    expect(String(first.body?.status)).toMatch(/WAITLISTED/i);

    const second = await submitWaitlistApplication(request, { email });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, duplicate: true });
    // Safe, non-leaking duplicate message.
    expect(String(second.body?.message)).toMatch(/already on the PecanRev beta waitlist/i);
  });

  anonTest('a valid unique email reaches the honest confirmation panel', async ({ page, request }) => {
    anonTest.skip(!(await waitlistDbAvailable(request)), DB_SKIP);
    const wl = new WaitlistPage(page);
    await wl.gotoPreview();
    await wl.completeApplication(uniqueWaitlistEmail('ui'), 'US');

    await expect(wl.confirmationHeading).toBeVisible();
    // The non-duplicate ("Thanks for joining") subtitle distinguishes a fresh signup.
    await expect(page.getByText('Thanks for joining the PecanRev beta waitlist')).toBeVisible();
    // Honest confirmation: no fabricated queue position / acceptance date.
    await expect(page.getByText(/queue position|you are number|guaranteed access/i)).toHaveCount(0);
  });

  anonTest('a duplicate email is detected in the UI without leaking status', async ({ page, request }) => {
    anonTest.skip(!(await waitlistDbAvailable(request)), DB_SKIP);
    const email = uniqueWaitlistEmail('dup');
    const seed = await submitWaitlistApplication(request, { email });
    expect(seed.status).toBe(201); // seeded as a fresh applicant first

    const wl = new WaitlistPage(page);
    await wl.gotoPreview();
    await wl.completeApplication(email, 'US');

    await expect(page.getByRole('heading', { name: /already on the list/i })).toBeVisible();
    await expect(page.getByText('No need to sign up again')).toBeVisible();
    // Anti-enumeration: the duplicate panel must not reveal the applicant's status.
    await expect(page.getByText(/status:\s*WAITLISTED|queue position/i)).toHaveCount(0);
  });
});

/**
 * Flipping `betaWaitlist` is GLOBAL server state, so this is kept strictly serial and
 * restored to OFF in afterAll. While it runs, `/` serves the waitlist to anon users.
 * The flag is toggled via a freshly-created admin request context (the admin
 * storageState written by global-setup) — anon `request` cannot mutate admin flags.
 */
anonTest.describe.serial('betaWaitlist flag ON gates "/"', () => {
  let adminCtx: APIRequestContext;

  anonTest.beforeAll(async () => {
    adminCtx = await apiRequest.newContext({ baseURL: BASE_URL, storageState: adminStatePath });
    await setFeatureFlags(adminCtx, { betaWaitlist: true });
  });

  anonTest.afterAll(async () => {
    try { await setFeatureFlags(adminCtx, { betaWaitlist: false }); }
    finally { await adminCtx?.dispose(); }
  });

  anonTest('an unauthenticated visit to "/" shows the waitlist instead of the landing', async ({ page }) => {
    const wl = new WaitlistPage(page);
    // The gate decides once per load from /api/settings/public; reload until the new
    // flag value has propagated (guards against any brief public-settings cache).
    await expect(async () => {
      await page.goto('/');
      await expect(wl.emailInput).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 25_000 });

    await expect(wl.joinBetaButton).toBeVisible();
    await expect(wl.heroHeading).toBeVisible();
    await expect(page).toHaveURL(/\/$/); // gate renders in place at "/", no redirect
  });

  anonTest('an authenticated user bypasses the gate and gets the landing at "/"', async ({ browser }) => {
    // A separate authed (admin) context — the gate gives signed-in users `children`.
    const ctx = await browser.newContext({ baseURL: BASE_URL, storageState: adminStatePath });
    try {
      const adminPage = await ctx.newPage();
      await adminPage.goto('/');
      await expect(adminPage.locator('body')).toContainText(/PecanRev/i); // app loaded
      // The waitlist-only CTA must be absent — proves the bypass branch (no waitlist).
      await expect(adminPage.getByRole('button', { name: 'Join the Beta' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
