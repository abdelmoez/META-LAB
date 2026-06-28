/**
 * stitch-test.ts — the project's primary test object.
 *
 * Importing { test, expect } from here gives you a `page` that is ALREADY:
 *   - authenticated as the seeded admin (via the global storageState), and
 *   - primed to render the Stitch UI (localStorage `metalab_ui_design=stitch`).
 * The `request` fixture inherits the same admin session, so use it to seed state.
 *
 * Extra fixtures:
 *   - `seed`     : { seedProjectId, adminEmail, baseURL, apiURL } from global-setup.
 *   - `tmpProject`: a throwaway project created for the test and deleted afterwards
 *                   (use for create/edit/delete flows that should not touch the seed).
 *
 * For anonymous pages (landing / login / register) import `anonTest` instead — it
 * clears the stored auth so the page loads logged-out.
 */
import { test as base, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { AUTH_DIR } from '../helpers/env';
import { primeStitch } from '../helpers/stitch';
import { createProject, deleteProject } from '../helpers/api';

export interface SeedInfo { seedProjectId: string; adminEmail: string; baseURL: string; apiURL: string }

function readSeed(): SeedInfo {
  try { return JSON.parse(fs.readFileSync(`${AUTH_DIR}/seed.json`, 'utf8')); }
  catch { return { seedProjectId: '', adminEmail: '', baseURL: '', apiURL: '' }; }
}

type Fixtures = {
  seed: SeedInfo;
  tmpProject: { id: string; name: string };
};

export const test = base.extend<Fixtures>({
  // Re-prime Stitch on every context (belt-and-suspenders over the stored localStorage).
  page: async ({ page }: { page: Page }, use) => {
    await primeStitch(page);
    await use(page);
  },
  seed: async ({}, use) => { await use(readSeed()); },
  tmpProject: async ({ request }, use) => {
    const name = `E2E Tmp ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const p = await createProject(request, name);
    await use(p);
    await deleteProject(request, p.id);
  },
});

/** Anonymous (logged-out) test — for landing, login and register specs. */
export const anonTest = base.extend({});
anonTest.use({ storageState: { cookies: [], origins: [] } });

export { expect };
