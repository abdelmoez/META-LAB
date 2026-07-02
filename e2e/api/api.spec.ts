/**
 * api.spec.ts — backend API surface, request-only (no browser page).
 *
 * Exercises the public + auth + admin HTTP contract directly through Playwright's
 * APIRequestContext, the way the SPA does. Two actors are used:
 *   - `request` (admin)        : the seeded admin session inherited from the fixture.
 *   - `anon`  (fresh context)  : a brand-new context with NO cookies → truly logged out.
 *   - a normal-user context    : built on demand from the seeded `normal.json` storageState,
 *                                guarded with test.skip when that role was not seeded.
 *
 * Every test asserts real behaviour (status codes, payload shape, round-trips) and
 * RESTORES any global setting it mutates (feature flags, design settings) so it never
 * leaves the shared server in a changed state for sibling specs.
 */
import { test, expect } from '../fixtures/stitch-test';
import { request as playwrightRequest, APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import * as api from '../helpers/api';
import { BASE_URL, normalStatePath } from '../helpers/env';

/** The admin-gated read endpoints we probe for role enforcement. */
const ADMIN_ENDPOINTS = [
  '/api/admin/feature-flags',
  '/api/admin/design-settings',
  '/api/admin/settings',
] as const;

// One fresh, cookie-less context shared across the file for the unauthenticated probes.
// NOTE: an explicit EMPTY storageState is required — a bare newContext({baseURL})
// inherits the config-level admin storageState and would come up authenticated.
let anon: APIRequestContext;
test.beforeAll(async () => { anon = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } }); });
test.afterAll(async () => { await anon?.dispose(); });

/* ─── Public settings ─────────────────────────────────────────────────────── */

test.describe('@smoke API · public settings', () => {
  test('GET /api/settings/public exposes featureFlags + appSettings + designSettings (no auth)', async () => {
    const res = await anon.get('/api/settings/public');
    expect(res.ok(), `public settings should be reachable unauthenticated (${res.status()})`).toBeTruthy();
    const body = await res.json();

    // Top-level blobs are all present and are objects.
    for (const key of ['featureFlags', 'appSettings', 'designSettings']) {
      expect(body, `missing "${key}" in public settings`).toHaveProperty(key);
      expect(typeof body[key], `"${key}" should be an object`).toBe('object');
    }

    // featureFlags: the engine flags the app reads are exposed as booleans.
    for (const flag of ['searchEngine', 'pecanSearch', 'aiScreening', 'rob_engine_v2']) {
      expect(typeof body.featureFlags[flag], `featureFlags.${flag} should be boolean`).toBe('boolean');
    }

    // designSettings: the Stitch rollout contract.
    expect(typeof body.designSettings.allowAllUsers).toBe('boolean');
    expect(['legacy', 'stitch']).toContain(body.designSettings.defaultMode);

    // appSettings: branded + has the registration switch.
    expect(typeof body.appSettings.appName).toBe('string');
    expect(body.appSettings.appName.length).toBeGreaterThan(0);
    expect(typeof body.appSettings.registrationOpen).toBe('boolean');
  });
});

/* ─── Authentication identity ─────────────────────────────────────────────── */

test.describe('@smoke API · auth identity', () => {
  test('GET /api/auth/me is 401 for an unauthenticated context', async () => {
    const res = await anon.get('/api/auth/me');
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/me returns the admin for the authed request', async ({ request, seed }) => {
    const user = await api.me(request);
    expect(user, 'admin /me should resolve a user').toBeTruthy();
    expect(user!.email && user!.email.length, 'admin should have an email').toBeTruthy();
    expect(String(user!.role)).toMatch(/admin/i);
    if (seed.adminEmail) {
      expect(user!.email.toLowerCase()).toBe(seed.adminEmail.toLowerCase());
    }
  });
});

/* ─── Admin-only endpoint role enforcement ────────────────────────────────── */

test.describe('API · admin endpoint gating', () => {
  test('admin-only endpoints reject an unauthenticated context (401/403)', async () => {
    for (const ep of ADMIN_ENDPOINTS) {
      const res = await anon.get(ep);
      expect(res.ok(), `${ep} must not be readable unauthenticated`).toBeFalsy();
      expect([401, 403], `${ep} unauth status`).toContain(res.status());
    }
  });

  test('admin-only endpoints reject a non-admin user (401/403)', async ({ seed }) => {
    test.skip(!seed.normal || !fs.existsSync(normalStatePath), 'TODO: no seeded normal (non-admin) user available');
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: normalStatePath });
    try {
      // Sanity: this context is authenticated as a NON-admin.
      const who = await ctx.get('/api/auth/me');
      expect(who.ok(), 'normal-user session should be valid').toBeTruthy();
      expect(String((await who.json()).role || (await who.json()).user?.role || '')).not.toMatch(/admin/i);

      for (const ep of ADMIN_ENDPOINTS) {
        const res = await ctx.get(ep);
        expect(res.ok(), `${ep} must be forbidden to a non-admin`).toBeFalsy();
        expect([401, 403], `${ep} non-admin status`).toContain(res.status());
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('admin-only endpoints return 200 for the admin', async ({ request }) => {
    for (const ep of ADMIN_ENDPOINTS) {
      const res = await request.get(ep);
      expect(res.ok(), `${ep} should be 200 for admin (got ${res.status()})`).toBeTruthy();
    }
  });
});

/* ─── Feature flags round-trip ────────────────────────────────────────────── */

test.describe('API · admin feature flags', () => {
  // projectDuplication is a benign display flag no other spec gates on — safe to flip.
  test('PUT /api/admin/feature-flags round-trips a flag (set → GET → restore)', async ({ request }) => {
    const FLAG = 'projectDuplication';
    const original = await api.getFeatureFlags(request);
    expect(typeof original[FLAG], `${FLAG} should be a known boolean flag`).toBe('boolean');
    const prev = !!original[FLAG];

    await api.setFeatureFlags(request, { [FLAG]: !prev });
    try {
      const after = await api.getFeatureFlags(request);
      expect(after[FLAG]).toBe(!prev); // the change is observable via GET
    } finally {
      await api.setFeatureFlags(request, { [FLAG]: prev }); // always restore
    }
    const restored = await api.getFeatureFlags(request);
    expect(restored[FLAG]).toBe(prev);
  });
});

/* ─── Design settings validation ──────────────────────────────────────────── */

test.describe('API · admin design settings', () => {
  test('PUT /api/admin/design-settings validates defaultMode (invalid → 400, valid → 200)', async ({ request }) => {
    const original = await api.getDesignSettings(request);

    // Invalid defaultMode is rejected with a 400 + a defaultMode-specific message.
    const bad = await request.put('/api/admin/design-settings', { data: { defaultMode: 'banana' } });
    expect(bad.status()).toBe(400);
    expect(String((await bad.json()).error || '')).toMatch(/defaultMode/i);

    try {
      // A valid (no-op) write returns 200 with the merged settings object.
      const good = await request.put('/api/admin/design-settings', { data: { defaultMode: original.defaultMode } });
      expect(good.ok(), `valid design-settings PUT should be 200 (got ${good.status()})`).toBeTruthy();
      const value = await good.json();
      expect(value.defaultMode).toBe(original.defaultMode);
      expect(typeof value.allowAllUsers).toBe('boolean');
    } finally {
      // Restore both fields to their captured originals (idempotent here, but explicit).
      await api.setDesignSettings(request, { defaultMode: original.defaultMode, allowAllUsers: original.allowAllUsers });
    }
    expect(await api.getDesignSettings(request)).toMatchObject({
      defaultMode: original.defaultMode,
      allowAllUsers: original.allowAllUsers,
    });
  });
});

/* ─── Projects CRUD ───────────────────────────────────────────────────────── */

test.describe('API · projects CRUD', () => {
  test('create → list contains it → delete → gone', async ({ request }) => {
    const name = `E2E API CRUD ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const created = await api.createProject(request, name);
    expect(created.id).toBeTruthy();

    try {
      // It appears in the caller's project list.
      const list = await api.listProjects(request);
      expect(list.some((p) => p.id === created.id), 'new project should appear in GET /api/projects').toBeTruthy();

      // Owner soft-delete via the REST DELETE.
      const del = await request.delete(`/api/projects/${encodeURIComponent(created.id)}`);
      expect(del.ok(), `DELETE should succeed (got ${del.status()})`).toBeTruthy();

      // It disappears from the list…
      await expect
        .poll(async () => (await api.listProjects(request)).some((p) => p.id === created.id), { timeout: 10_000 })
        .toBe(false);

      // …and a direct fetch is 404 (soft-deleted, hidden).
      const after = await request.get(`/api/projects/${encodeURIComponent(created.id)}`);
      expect(after.status()).toBe(404);
    } finally {
      await api.deleteProject(request, created.id); // best-effort safety net
    }
  });
});

/* ─── Screening workspace + member invite ─────────────────────────────────── */

test.describe('API · screening workspace & members', () => {
  test('ensureScreeningWorkspace + addProjectMember mints an invite token for an unregistered email', async ({ request, tmpProject }) => {
    const siftId = await api.ensureScreeningWorkspace(request, tmpProject.id);
    expect(siftId, 'screening workspace id').toBeTruthy();

    const email = `e2e-invite-${Date.now()}-${Math.floor(Math.random() * 1e4)}@pecanrev.test`;
    const { member, inviteToken, inviteLink } = await api.addProjectMember(request, siftId, { email, preset: 'reviewer' });
    expect(member, 'member row should be returned').toBeTruthy();
    expect(inviteToken, 'an unregistered email should yield a pending invite token').toBeTruthy();
    expect(inviteLink || '').toContain('/invite/');

    // The minted token resolves through the PUBLIC invite landing endpoint.
    const { ok, body } = await api.getInvite(request, inviteToken!);
    expect(ok, 'freshly-minted invite token should resolve via GET /api/invites/:token').toBeTruthy();
    expect(body, 'invite landing payload should be present').toBeTruthy();
  });
});

/* ─── Invites: bogus token ────────────────────────────────────────────────── */

test.describe('API · invites', () => {
  test('GET /api/invites/:token for a bogus token is not-ok (404/410)', async () => {
    const res = await anon.get(`/api/invites/${encodeURIComponent('bogus-' + Date.now())}`);
    expect(res.ok()).toBeFalsy();
    expect([404, 410]).toContain(res.status());
  });
});
