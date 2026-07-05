/**
 * WaitlistPage.ts — page object for the public Beta Waitlist surface
 * (src/frontend/pages/waitlist/*). It owns BOTH:
 *   - the UI driver (locators + the multi-step Email → About you → Your work →
 *     Review & confirm flow rendered by WaitlistFlow.jsx), and
 *   - thin request helpers for the PUBLIC waitlist API (POST /api/waitlist,
 *     GET /api/waitlist/count) so a spec can seed a duplicate / probe whether the
 *     isolated waitlist DB is configured without driving the slow UI.
 *
 * Selectors are the stable element ids already in the app — the WaitlistFlow form
 * fields render real `<input id=…>` / native `<select id=…>` controls (#email,
 * #firstName, #role, #countryCode, #consent) plus role/text locators. No new
 * data-testids were added in this pass.
 *
 * Native-validation note: the Step 1 email pill is `type="email"` but NOT `required`.
 * An empty value is therefore native-valid (the form submits → the app's own
 * "Email is required." inline error fires). A value like `foo@bar` is also
 * native-valid (Chromium accepts a dot-less host) yet fails the app's stricter
 * `isValidEmail` (`…@…\..…`), so it exercises the app's "Enter a valid email
 * address." inline error rather than a native browser bubble.
 */
import { Page, Locator, APIRequestContext, expect } from '@playwright/test';

export interface WaitlistApplication {
  email: string;
  countryCode?: string;
  consent?: boolean;
  [key: string]: unknown;
}

export class WaitlistPage {
  constructor(public readonly page: Page) {}

  // ── Navigation ───────────────────────────────────────────────────────────────
  /** Open the always-on preview route (renders regardless of the betaWaitlist flag). */
  async gotoPreview(): Promise<void> {
    await this.page.goto('/beta-waitlist');
    await expect(this.emailInput).toBeVisible();
  }

  // ── Step 1: the email-capture pill ───────────────────────────────────────────
  /** The Step 1 email pill input (raw `<input id="email" type="email">`). */
  get emailInput(): Locator { return this.page.locator('#email'); }
  /** The Step 1 submit button — advances to the questionnaire. */
  get joinBetaButton(): Locator { return this.page.getByRole('button', { name: 'Join the Beta' }); }
  /** The Step 1 inline email error (role="alert" with id="email-error"). */
  get emailError(): Locator { return this.page.locator('#email-error'); }
  /** The amber preview banner shown only on the /beta-waitlist preview route. */
  get previewNote(): Locator { return this.page.getByText('this is how the Beta Waitlist page looks', { exact: false }); }
  /** The waitlist hero headline (present on the public gate + preview, Step 1 only). */
  get heroHeading(): Locator { return this.page.getByRole('heading', { name: /Join us in cultivating the future/i }); }

  // ── Step 2: About you ────────────────────────────────────────────────────────
  get aboutHeading(): Locator { return this.page.getByRole('heading', { name: 'About you' }); }
  get firstNameInput(): Locator { return this.page.locator('#firstName'); }
  get lastNameInput(): Locator { return this.page.locator('#lastName'); }
  get roleSelect(): Locator { return this.page.locator('#role'); }
  get continueButton(): Locator { return this.page.getByRole('button', { name: 'Continue' }); }

  // ── Step 3: Your work ────────────────────────────────────────────────────────
  get yourWorkHeading(): Locator { return this.page.getByRole('heading', { name: 'Your work' }); }
  /** The required Country select (native `<select id="countryCode">`). */
  get countrySelect(): Locator { return this.page.locator('#countryCode'); }
  get reviewButton(): Locator { return this.page.getByRole('button', { name: 'Review' }); }

  // ── Step 4: Review & confirm ─────────────────────────────────────────────────
  get reviewHeading(): Locator { return this.page.getByRole('heading', { name: 'Review & confirm' }); }
  /** The required operational-consent checkbox. */
  get consentCheckbox(): Locator { return this.page.locator('#consent'); }
  get submitButton(): Locator { return this.page.getByRole('button', { name: 'Join the waitlist' }); }

  // ── Confirmation ─────────────────────────────────────────────────────────────
  /** The success/duplicate heading on the confirmation panel. */
  get confirmationHeading(): Locator { return this.page.getByRole('heading', { name: /on the waitlist|already on the list/i }); }

  // ── Flows ────────────────────────────────────────────────────────────────────
  /** Step 1 → Step 2: enter an email and submit the pill. */
  async startWithEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.joinBetaButton.click();
    await expect(this.aboutHeading).toBeVisible();
  }

  /**
   * Drive the whole questionnaire to submission. Only email + country + consent are
   * required, so every other (optional) field is left blank. Stops once the submit
   * button is clicked; the caller asserts the resulting confirmation state.
   */
  async completeApplication(email: string, countryCode = 'US'): Promise<void> {
    await this.startWithEmail(email);                 // Step 1 → Step 2
    await this.continueButton.click();                // Step 2 → Step 3 (all optional)
    await expect(this.yourWorkHeading).toBeVisible();
    await this.countrySelect.selectOption(countryCode);
    await this.reviewButton.click();                  // Step 3 → Step 4
    await expect(this.reviewHeading).toBeVisible();
    await this.consentCheckbox.check();
    await this.submitButton.click();
  }
}

/* ── Public waitlist API helpers (used for seeding / availability probes) ───────── */

export interface WaitlistSubmitResult { status: number; body: any }

/**
 * POST /api/waitlist — submit a completed application via the public API. Defaults a
 * valid country + operational consent so a bare `{ email }` is accepted. Returns the
 * raw status + parsed body (does NOT assert ok, so callers can inspect 201/200/422/503).
 */
export async function submitWaitlistApplication(
  request: APIRequestContext,
  payload: WaitlistApplication,
): Promise<WaitlistSubmitResult> {
  const res = await request.post('/api/waitlist', { data: { countryCode: 'US', consent: true, ...payload } });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/**
 * GET /api/waitlist/count — public total signups. Returns an integer, or `null` when
 * the count is unavailable (the isolated waitlist DB is not configured / errored).
 * Always HTTP 200 by contract, so a null here is the "DB not configured" signal.
 */
export async function fetchWaitlistCount(request: APIRequestContext): Promise<number | null> {
  const res = await request.get('/api/waitlist/count');
  if (!res.ok()) return null;
  const body = await res.json().catch(() => null);
  return body && typeof body.count === 'number' ? body.count : null;
}

/** True when the isolated waitlist DB is configured (count endpoint returns a number). */
export async function waitlistDbAvailable(request: APIRequestContext): Promise<boolean> {
  return (await fetchWaitlistCount(request)) !== null;
}

/** A unique, non-colliding test email for waitlist submissions (isolated DB → safe). */
export function uniqueWaitlistEmail(tag = 'wl'): string {
  return `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@pecanrev.test`;
}
