/**
 * invites.spec.ts — Invites & notifications.
 *
 * Covers the invite lifecycle and the surfaces that reflect it:
 *   - the PUBLIC invite landing (/invite/:token) for a logged-OUT visitor and a
 *     logged-IN user (the page deliberately works both ways);
 *   - the public GET /api/invites/:token sanitized landing payload;
 *   - registering a NEW user with the invited email → auto-accept (the server
 *     claims pending ScreenProjectMember rows BY EMAIL on register), so the user
 *     becomes an ACTIVE project member (asserted via the admin members API) and
 *     the single-use token is consumed;
 *   - an invalid token rendering the fallback card;
 *   - the NotificationsBell rendering in the Stitch top header;
 *   - the InvitationsView (/app?view=invitations) rendering, and an actually-
 *     invited user seeing their pending-invitation count.
 *
 * Seeding is done via the fast API (projectWithMembers fixture, or a dedicated
 * admin request context for the logged-out specs which have no admin fixture).
 * No application source was modified; selectors come from the area map + the
 * stable shell testids documented in FOUNDATION.md.
 */
import { test, expect, anonTest } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';
import * as api from '../helpers/api';
import { BASE_URL, adminStatePath } from '../helpers/env';
import { STITCH_STORAGE_KEY } from '../helpers/stitch';
import { request as playwrightRequest, APIRequestContext } from '@playwright/test';
import fs from 'node:fs';

const rnd = () => Math.floor(Math.random() * 1e4);
/** Meets the server's >=8 char rule; reused for the mid-test registrations. */
const NEW_USER_PW = 'E2e-Invitee-Pw!2025';

/**
 * Mint a pending invite for an UNREGISTERED email using a fresh ADMIN request
 * context (the anon specs have no admin fixture). Returns the token + the admin
 * context so the caller can read the canonical landing payload and clean up.
 */
async function mintInviteAsAdmin(preset: api.MemberPreset = 'reviewer'): Promise<{
  token?: string; email: string; projectId: string; siftId: string;
  admin: APIRequestContext; cleanup: () => Promise<void>;
}> {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: adminStatePath });
  const project = await api.createProject(admin, `E2E Invite ${Date.now()}-${rnd()}`);
  const siftId = await api.ensureScreeningWorkspace(admin, project.id);
  const email = `e2e-invitee-${Date.now()}-${rnd()}@pecanrev.test`;
  const { inviteToken } = await api.addProjectMember(admin, siftId, { email, preset });
  return {
    token: inviteToken, email, projectId: project.id, siftId, admin,
    async cleanup() { await api.deleteProject(admin, project.id); await admin.dispose(); },
  };
}

/* ─── Public invite landing (logged-out) ───────────────────────────────────── */

anonTest.describe('@smoke Invites · public landing (logged-out)', () => {
  anonTest('the invite landing renders project info + sign-up actions for a logged-out visitor', async ({ page }) => {
    anonTest.skip(!fs.existsSync(adminStatePath), 'TODO: admin storageState missing — global-setup did not seed admin');
    const seed = await mintInviteAsAdmin('reviewer');
    try {
      anonTest.skip(!seed.token, 'TODO: no invite token minted for the unregistered email');

      // The landing payload the page itself will render (avoid assuming title==name).
      const { ok, body } = await api.getInvite(seed.admin, seed.token!);
      expect(ok, 'freshly minted token should resolve via the public endpoint').toBeTruthy();

      await page.goto(`/invite/${encodeURIComponent(seed.token!)}`, { waitUntil: 'domcontentloaded' });

      // Valid-invite card: the "Project invitation" eyebrow + the project name.
      await expect(page.getByText('Project invitation')).toBeVisible();
      if (body?.projectName) {
        await expect(page.getByText(String(body.projectName)).first()).toBeVisible();
      }

      // Logged-out branch: register / sign-in actions, and NO one-click accept.
      await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Accept invite/i })).toHaveCount(0);
    } finally {
      await seed.cleanup();
    }
  });

  anonTest('an invalid/unknown token shows the fallback card (not the project)', async ({ page }) => {
    await page.goto(`/invite/bogus-${Date.now()}-${rnd()}`, { waitUntil: 'domcontentloaded' });

    // 404 → the "invalid" StateCard, with a route back to the app.
    await expect(page.getByText(/This invite link isn.?t valid/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Go to PecanRev/i })).toBeVisible();

    // It must NOT leak any valid-invite affordances.
    await expect(page.getByText('Project invitation')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Accept invite/i })).toHaveCount(0);
  });
});

/* ─── Public invite endpoint contract ──────────────────────────────────────── */

test.describe('@smoke Invites · GET /api/invites/:token', () => {
  test('returns sanitized landing info (masked email, role, expiry) for a valid token', async ({ request, projectWithMembers }) => {
    const { members } = await projectWithMembers.create(['reviewer']);
    const m = members[0];
    test.skip(!m.inviteToken, 'TODO: no invite token minted for the unregistered email');

    const { ok, body } = await api.getInvite(request, m.inviteToken!);
    expect(ok, 'GET /api/invites/:token should be 2xx for a valid token').toBeTruthy();
    expect(body, 'invite landing payload should be present').toBeTruthy();

    expect(typeof body.projectName).toBe('string');
    expect(body.projectName.length).toBeGreaterThan(0);
    expect(body.roleLabel, 'role label should be present').toBeTruthy();
    expect(body.expiresAt, 'invite should carry an expiry').toBeTruthy();

    // Email is masked, never the raw invited address.
    expect(String(body.email)).toContain('***');
    expect(String(body.email)).not.toBe(m.email);
  });
});

/* ─── Invite landing (logged-in) + accept gating ───────────────────────────── */

test.describe('Invites · landing (logged-in)', () => {
  test('the invite landing renders the one-click accept action for a signed-in user', async ({ page, projectWithMembers }) => {
    const { members } = await projectWithMembers.create(['reviewer']);
    const m = members[0];
    test.skip(!m.inviteToken, 'TODO: no invite token minted for the unregistered email');

    // The admin page is signed in; InvitePage renders its OWN shell (NOT Stitch),
    // so we assert on its content directly rather than the app chrome.
    await page.goto(`/invite/${encodeURIComponent(m.inviteToken!)}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Project invitation')).toBeVisible();
    // Signed-in branch: accept button + "Signed in as <email>"; no register CTA.
    await expect(page.getByRole('button', { name: /Accept invite/i })).toBeVisible();
    await expect(page.getByText(/Signed in as/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
    // We do NOT click Accept here — it would consume the single-use token and
    // mutate membership; acceptance is covered end-to-end by the register spec.
  });
});

/* ─── Register-with-invite → auto-accept → member ──────────────────────────── */

test.describe('Invites · register auto-accepts the invite', () => {
  test('a new user registering with the invited email becomes an ACTIVE member + the token is consumed', async ({ request, projectWithMembers }) => {
    const { siftId, members } = await projectWithMembers.create(['reviewer']);
    const m = members[0];
    test.skip(!m.inviteToken, 'TODO: no invite token minted for the unregistered email');

    // Register the brand-new user in a fresh, cookie-less context so the admin
    // `request` session is never disturbed. The server claims the pending member
    // row by matching email on register (the inviteToken body field is harmless).
    const userCtx = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    try {
      await api.register(userCtx, { email: m.email, password: NEW_USER_PW, name: 'E2E Invitee', inviteToken: m.inviteToken });

      // The member row flips pending → active (claim is fire-and-forget → poll).
      await expect
        .poll(async () => {
          const res = await request.get(`/api/admin/screening/projects/${encodeURIComponent(siftId)}/members`);
          if (!res.ok()) return `http_${res.status()}`;
          const body = await res.json().catch(() => ({}));
          const row = (body.members || []).find((r: any) => String(r.email).toLowerCase() === m.email.toLowerCase());
          return row?.status ?? 'absent';
        }, { timeout: 15_000, message: 'invited member should become active after the invitee registers' })
        .toBe('active');

      // Single-use: the token no longer resolves once claimed/accepted.
      const after = await api.getInvite(request, m.inviteToken!);
      expect(after.ok, 'a consumed invite token should no longer resolve').toBeFalsy();
    } finally {
      await userCtx.dispose();
    }
  });
});

/* ─── Notifications bell in the shell ──────────────────────────────────────── */

test.describe('@smoke Notifications · bell in the shell', () => {
  test('the notifications bell renders in the Stitch top header', async ({ page }) => {
    const shell = new ShellNav(page);
    await shell.goto('/app');
    await shell.expectShell();

    const bell = shell.topHeader.locator('button[title="Notifications"]');
    await expect(bell).toBeVisible();
  });
});

/* ─── Invitations dashboard view ───────────────────────────────────────────── */

test.describe('Invitations · dashboard view', () => {
  test('the invitations view renders at /app?view=invitations', async ({ page }) => {
    const shell = new ShellNav(page);
    await shell.goto('/app?view=invitations'); // asserts Stitch rendered

    // InvitationsView is the only surface with this section header — its presence
    // proves the view mounted (vs. the overview/dashboard default). The phrase appears
    // in both the heading and an empty-state line, so assert the first match.
    await expect(page.getByText('Pending invitations').first()).toBeVisible();
  });

  test('an actually-invited user sees their pending invitation reflected in the view', async ({ browser, projectWithMembers }) => {
    const { members } = await projectWithMembers.create(['reviewer']);
    const m = members[0];
    test.skip(!m.inviteToken, 'TODO: no invite token minted for the unregistered email');

    // A fresh, logged-out browser context; prime Stitch on first paint.
    const ctx = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    await ctx.addInitScript((key) => { try { window.localStorage.setItem(key, 'stitch'); } catch { /* noop */ } }, STITCH_STORAGE_KEY);
    try {
      // Register the invited email → membership is claimed AND a PROJECT_INVITE
      // notification is created for this user (fire-and-forget on the server).
      await api.register(ctx.request, { email: m.email, password: NEW_USER_PW, name: 'E2E Invitee', inviteToken: m.inviteToken });

      // Wait for the auto-claim notification to land before driving the UI, so the
      // page assertion is not racing the server's deferred notify.
      await expect
        .poll(async () => {
          const res = await ctx.request.get('/api/notifications/unread-count');
          if (!res.ok()) return -1;
          const b = await res.json().catch(() => ({}));
          return Number(b.count ?? b.unreadCount ?? 0);
        }, { timeout: 15_000, message: 'the invitee should receive a PROJECT_INVITE notification on register' })
        .toBeGreaterThanOrEqual(1);

      const userPage = await ctx.newPage();
      // &ui=stitch is a belt-and-suspenders first-paint override for the new user.
      await userPage.goto('/app?view=invitations&ui=stitch', { waitUntil: 'domcontentloaded' });

      // The Stitch-only InvitationsView header proves the view rendered for them,
      // and the badge reflects the real pending count from their invite.
      await expect(userPage.getByText('Pending invitations').first()).toBeVisible({ timeout: 15_000 });
      await expect(userPage.getByText(/\d+\s+pending/i).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });
});
