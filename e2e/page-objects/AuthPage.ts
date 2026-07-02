/**
 * AuthPage.ts — page object for the public auth surfaces: landing, login, register,
 * and the Terms/Privacy page. Logged-out flows only; authenticated chrome lives in
 * ShellNav. Selectors are the stable element ids already in the app (Login.jsx /
 * Register.jsx use `#login-*` / `#reg-*`) plus role/text locators — no new testids
 * were added in this pass.
 *
 * NOTE: both the login and register <form>s are `noValidate`, so the browser never
 * shows native required-field bubbles. Login submits empty straight to the server
 * (which 400s); register runs its own client-side checks and shows an inline error
 * banner. The error banner has no testid — it renders the message as plain text, so
 * `expectError()` matches that text.
 */
import { Page, Locator, expect, Response } from '@playwright/test';

export class AuthPage {
  constructor(public readonly page: Page) {}

  // ── Navigation ───────────────────────────────────────────────────────────────
  /** Open the public landing page; returns the navigation Response for status checks. */
  gotoLanding(): Promise<Response | null> {
    return this.page.goto('/');
  }

  async gotoLogin(query = ''): Promise<void> {
    await this.page.goto(`/login${query}`);
    await expect(this.loginEmail).toBeVisible();
  }

  async gotoRegister(query = ''): Promise<void> {
    await this.page.goto(`/register${query}`);
    await expect(this.regEmail).toBeVisible();
  }

  // ── Login ────────────────────────────────────────────────────────────────────
  get loginEmail(): Locator { return this.page.locator('#login-email'); }
  get loginPassword(): Locator { return this.page.locator('#login-password'); }
  /** The form's submit button (children "Sign in"); not the "Register"/"Forgot" links. */
  get loginSubmit(): Locator { return this.page.getByRole('button', { name: /^sign in$/i }); }

  async login(email: string, password: string): Promise<void> {
    await this.loginEmail.fill(email);
    await this.loginPassword.fill(password);
    await this.loginSubmit.click();
  }

  // ── Register ─────────────────────────────────────────────────────────────────
  get regName(): Locator { return this.page.locator('#reg-name'); }
  get regEmail(): Locator { return this.page.locator('#reg-email'); }
  get regPassword(): Locator { return this.page.locator('#reg-password'); }
  get regConfirm(): Locator { return this.page.locator('#reg-confirm'); }
  /** The Terms & Privacy agreement checkbox (the only checkbox on the page). */
  get regTerms(): Locator { return this.page.getByRole('checkbox'); }
  get regSubmit(): Locator { return this.page.getByRole('button', { name: /create account/i }); }

  /** Fill any subset of the register fields; pass `terms:true` to tick the agreement. */
  async fillRegister(opts: {
    name?: string; email?: string; password?: string; confirm?: string; terms?: boolean;
  }): Promise<void> {
    if (opts.name !== undefined) await this.regName.fill(opts.name);
    if (opts.email !== undefined) await this.regEmail.fill(opts.email);
    if (opts.password !== undefined) await this.regPassword.fill(opts.password);
    if (opts.confirm !== undefined) await this.regConfirm.fill(opts.confirm);
    if (opts.terms) await this.regTerms.check();
  }

  async submitRegister(): Promise<void> { await this.regSubmit.click(); }

  // ── Shared error banner (login + register render the message as text) ─────────
  errorText(message: string | RegExp): Locator { return this.page.getByText(message); }

  async expectError(message: string | RegExp): Promise<void> {
    await expect(this.errorText(message).first()).toBeVisible();
  }
}
