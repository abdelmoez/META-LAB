/**
 * auth.spec.ts — Authentication & onboarding.
 *
 * Covers the public auth surfaces (landing, login, register, terms/privacy) driven
 * through the real UI, plus the authenticated-session guards (PublicRoute redirect,
 * session persistence on reload, logout) and a guarded onboarding flow.
 *
 * Seeding rule (FOUNDATION §4): we never have the seeded admin's *password* in-test,
 * so login-form tests REGISTER a throwaway user via the fast API (`api.register` on a
 * fresh context) and then drive the login FORM with those credentials. Registering on
 * the standalone `request` fixture keeps the `page` logged out (separate context), so
 * the form genuinely authenticates from scratch.
 */
import { test, expect, anonTest } from '../fixtures/stitch-test';
import { request as plRequest, type APIRequestContext } from '@playwright/test';
import { AuthPage } from '../page-objects/AuthPage';
import { ShellNav } from '../page-objects/ShellNav';
import * as api from '../helpers/api';
import { adminStatePath, BASE_URL } from '../helpers/env';

const PW = 'E2e-Auth-Pw!2025';
const freshEmail = (tag: string) =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@pecanrev.test`;
const pathOf = (url: string) => new URL(url).pathname;

/* ───────────────────────── Public pages (logged out) ─────────────────────────── */
anonTest.describe('public auth pages', () => {
  anonTest('@smoke landing is reachable and shows PecanRev branding (not "Research OS")', async ({ page }) => {
    const authPage = new AuthPage(page);
    const resp = await authPage.gotoLanding();
    expect(resp?.status() ?? 200).toBeLessThan(400);
    await expect(page.locator('body')).toContainText(/PecanRev/i);
    expect((await page.content()).toLowerCase()).not.toContain('research os');
  });

  anonTest('the /terms page renders the Terms of Service and Privacy Policy', async ({ page }) => {
    const resp = await page.goto('/terms');
    expect(resp?.status() ?? 200).toBeLessThan(400);
    await expect(page.getByText('Terms & Privacy').first()).toBeVisible();
    await expect(page.getByText('1. Terms of Service').first()).toBeVisible();
    await expect(page.getByText('2. Privacy Policy').first()).toBeVisible();
  });

  anonTest('/privacy redirects to /terms#privacy', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForURL((u) => pathOf(u.toString()) === '/terms', { timeout: 15_000 });
    expect(page.url()).toContain('#privacy');
    await expect(page.locator('#privacy')).toBeVisible();
  });
});

/* ───────────────────────── Login form ─────────────────────────────────────────── */
anonTest.describe('login form', () => {
  anonTest('@smoke renders the email, password, and submit controls', async ({ page }) => {
    const authPage = new AuthPage(page);
    await authPage.gotoLogin();
    await expect(authPage.loginEmail).toBeVisible();
    await expect(authPage.loginPassword).toBeVisible();
    await expect(authPage.loginSubmit).toBeVisible();
  });

  anonTest('valid credentials authenticate and land the user on /app', async ({ page, request }) => {
    const email = freshEmail('login-ok');
    // Seed the account on a separate context; `page` stays logged out for the form flow.
    await api.register(request, { email, password: PW, name: 'Login OK', acceptedTerms: true });

    const authPage = new AuthPage(page);
    await authPage.gotoLogin();
    await authPage.login(email, PW);

    // A successful login redirects into the authenticated app. Onboarding is disabled
    // during the run, so this normally resolves to /app; we also accept /onboarding to
    // stay robust against the (parallel) onboarding block briefly re-enabling the gate.
    await page.waitForURL((u) => ['/app', '/onboarding'].includes(pathOf(u.toString())), { timeout: 20_000 });
    expect(pathOf(page.url())).not.toBe('/login');
    const meUser = await api.me(page.request);
    expect(meUser?.email?.toLowerCase()).toBe(email.toLowerCase()); // real session established
  });

  anonTest('invalid credentials show an error and keep the user on /login', async ({ page, request }) => {
    const email = freshEmail('login-bad');
    await api.register(request, { email, password: PW, name: 'Login Bad', acceptedTerms: true });

    const authPage = new AuthPage(page);
    await authPage.gotoLogin();
    await authPage.login(email, 'totally-wrong-password');

    await authPage.expectError(/invalid email or password/i);
    expect(pathOf(page.url())).toBe('/login');
    await expect(authPage.loginEmail).toHaveValue(email); // field values persist
    expect(await api.me(page.request)).toBeNull();         // not authenticated
  });

  anonTest('empty submit is blocked (required inputs, no navigation, stays unauthenticated)', async ({ page }) => {
    const authPage = new AuthPage(page);
    await authPage.gotoLogin();

    // The form is noValidate, but the inputs still carry the HTML5 required contract.
    await expect(authPage.loginEmail).toHaveAttribute('required', '');
    await expect(authPage.loginPassword).toHaveAttribute('required', '');

    await authPage.loginSubmit.click();
    // Empty creds reach the server (400) → an error banner appears, we never leave /login,
    // and no session is established.
    await authPage.expectError(/required|failed|invalid/i);
    expect(pathOf(page.url())).toBe('/login');
    await expect.poll(() => api.me(page.request).then((u) => u?.email ?? null)).toBeNull();
  });
});

/* ───────────────────────── Register form validation (UI-driven) ───────────────── */
anonTest.describe('register form validation', () => {
  anonTest('rejects an invalid email address', async ({ page }) => {
    const authPage = new AuthPage(page);
    await authPage.gotoRegister();
    await authPage.fillRegister({ name: 'Jane', email: 'not-an-email', password: 'ValidPass123', confirm: 'ValidPass123', terms: true });
    await authPage.submitRegister();
    await authPage.expectError('Enter a valid email address (e.g. you@institution.edu).');
    expect(pathOf(page.url())).toBe('/register');
  });

  anonTest('rejects a password shorter than 8 characters', async ({ page }) => {
    const authPage = new AuthPage(page);
    await authPage.gotoRegister();
    await authPage.fillRegister({ name: 'Jane', email: freshEmail('reg-short'), password: 'short', confirm: 'short', terms: true });
    await authPage.submitRegister();
    await authPage.expectError('Password must be at least 8 characters.');
    expect(pathOf(page.url())).toBe('/register');
  });

  anonTest('rejects mismatched password and confirmation', async ({ page }) => {
    const authPage = new AuthPage(page);
    await authPage.gotoRegister();
    await authPage.fillRegister({ name: 'Jane', email: freshEmail('reg-mismatch'), password: 'ValidPass123', confirm: 'DifferentPass123', terms: true });
    await authPage.submitRegister();
    await authPage.expectError('Passwords do not match.');
    expect(pathOf(page.url())).toBe('/register');
  });

  anonTest('requires agreeing to the Terms and Privacy Policy', async ({ page }) => {
    const authPage = new AuthPage(page);
    await authPage.gotoRegister();
    await authPage.fillRegister({ name: 'Jane', email: freshEmail('reg-terms'), password: 'ValidPass123', confirm: 'ValidPass123', terms: false });
    await authPage.submitRegister();
    await authPage.expectError('Please agree to the Terms and Privacy Policy to continue.');
    expect(pathOf(page.url())).toBe('/register');
  });
});

/* ───────────────────────── Authenticated session guards (admin) ───────────────── */
test.describe('authenticated session', () => {
  test('PublicRoute redirects an already-authenticated user from /login to /app', async ({ page }) => {
    const authPage = new AuthPage(page);
    await page.goto('/login');
    await page.waitForURL((u) => pathOf(u.toString()) === '/app', { timeout: 15_000 });
    await expect(authPage.loginEmail).toHaveCount(0); // the login form never renders
  });

  test('the session survives a full page reload', async ({ page }) => {
    const shell = new ShellNav(page);
    await shell.goto('/app'); // asserts Stitch rendered
    await shell.expectShell();
    await page.reload();
    await shell.expectShell();
    expect(pathOf(page.url())).toBe('/app'); // not bounced to /login
  });

  test('signing out via ShellNav returns to a logged-out state', async ({ page }) => {
    const shell = new ShellNav(page);
    const authPage = new AuthPage(page);
    await shell.goto('/app');
    await shell.expectShell();

    await shell.signOut();
    // The Stitch account-menu sign-out navigates to /login (shellParts.jsx).
    await page.waitForURL((u) => pathOf(u.toString()) === '/login', { timeout: 15_000 });
    await expect.poll(() => api.me(page.request).then((u) => u?.email ?? null)).toBeNull();

    // A protected route now bounces to /login (ProtectedRoute, unauthenticated).
    await page.goto('/app');
    await page.waitForURL((u) => pathOf(u.toString()) === '/login', { timeout: 15_000 });
    await expect(authPage.loginEmail).toBeVisible();
  });
});

/* ───────────────────────── Onboarding (gate re-enabled in-scope) ──────────────── */
// Onboarding is globally DISABLED during the run. We re-enable it ONLY for this
// serial block, register a fresh user, assert the onboarding screen, then disable it
// again. setOnboardingEnabled needs the admin API, and beforeAll/afterAll cannot use
// the test-scoped `request` fixture, so we build a short-lived admin context from the
// stored admin state.
anonTest.describe.configure({ mode: 'serial' });
anonTest.describe('onboarding', () => {
  let adminApi: APIRequestContext | null = null;

  anonTest.beforeAll(async () => {
    adminApi = await plRequest.newContext({ baseURL: BASE_URL, storageState: adminStatePath });
    await api.setOnboardingEnabled(adminApi, true);
  });

  anonTest.afterAll(async () => {
    if (adminApi) {
      try { await api.setOnboardingEnabled(adminApi, false); } catch { /* best effort restore */ }
      await adminApi.dispose();
    }
  });

  anonTest('a freshly registered user sees the intro, a question, and a proceed control', async ({ page }) => {
    const email = freshEmail('onboard');
    // Register through the PAGE's own context so the session cookie lands in the browser
    // context and subsequent navigations are authenticated as this fresh user.
    await api.register(page.request, { email, password: PW, name: 'Onboarding E2E', acceptedTerms: true });

    const res = await page.request.get('/api/onboarding/pending');
    const body = (await res.json().catch(() => ({}))) as { questions?: any[]; intro?: { title?: string } };
    const questions = Array.isArray(body?.questions) ? body.questions : [];
    anonTest.skip(questions.length === 0, 'TODO: no onboarding questions configured in this environment — nothing to assert.');

    await page.goto('/onboarding');

    // Intro header — the API-provided title, or the built-in fallback heading.
    const introTitle = body?.intro?.title;
    if (introTitle) {
      await expect(page.getByText(introTitle, { exact: false }).first()).toBeVisible();
    } else {
      await expect(page.getByText('A few quick questions')).toBeVisible();
    }

    // Progress indicator "1 / N".
    await expect(page.getByText(/\b1\s*\/\s*\d+/).first()).toBeVisible();

    // The first question's prompt renders.
    const firstPrompt = String(questions[0]?.prompt || '');
    if (firstPrompt) await expect(page.getByText(firstPrompt, { exact: false }).first()).toBeVisible();

    // A control to proceed: Skip (when the question is skippable) or the Save/Finish
    // submit button (always rendered).
    const first = questions[0] || {};
    const skippable = first.isRequired === false && first.allowSkip !== false;
    if (skippable) {
      await expect(page.getByRole('button', { name: /^skip$/i })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: /save & continue|finish/i })).toBeVisible();
    }
  });
});
