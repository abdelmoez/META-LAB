/**
 * stitch-test.ts — the project's primary test object.
 *
 * Importing { test, expect } from here gives you a `page` that is ALREADY:
 *   - authenticated as the seeded admin (via the global storageState), and
 *   - primed to render the Stitch UI (localStorage `metalab_ui_design=stitch`).
 * The `request` fixture inherits the same admin session, so use it to seed state.
 *
 * Fixtures:
 *   - `seed`             : the whole .auth/seed.json (ids + mod/normal creds + flags).
 *   - `tmpProject`       : a throwaway admin project, deleted afterwards (create/edit/delete flows).
 *   - `screeningProject` : a throwaway project with a screening workspace + N imported records.
 *   - `projectWithMembers`: factory → seeds leader/reviewer/viewer collaborators (+ invite tokens).
 *   - `setFlags`         : set feature flags within a test; the original snapshot is restored on teardown.
 *   - `modContext` / `normalContext` : a { page, request } for the seeded mod / normal user.
 *
 * For anonymous pages (landing / login / register) import `anonTest` instead — it
 * clears the stored auth so the page loads logged-out.
 */
import { test as base, expect, Page, BrowserContext, APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import { AUTH_DIR, modStatePath, normalStatePath, BASE_URL } from '../helpers/env';
import { primeStitch, STITCH_STORAGE_KEY } from '../helpers/stitch';
import {
  createProject, deleteProject, ensureScreeningWorkspace, addProjectMember, importScreeningRecords,
  makeRis, getFeatureFlags, setFeatureFlags, Project, MemberPreset,
} from '../helpers/api';

export interface SeedInfo {
  seedProjectId: string;
  longNameProjectId: string;
  extraProjectIds: string[];
  adminEmail: string;
  mod: { email: string; password: string } | null;
  normal: { email: string; password: string } | null;
  enabledFlags: Record<string, boolean>;
  baseURL: string;
  apiURL: string;
}

function readSeed(): SeedInfo {
  try { return JSON.parse(fs.readFileSync(`${AUTH_DIR}/seed.json`, 'utf8')); }
  catch {
    return { seedProjectId: '', longNameProjectId: '', extraProjectIds: [], adminEmail: '', mod: null, normal: null, enabledFlags: {}, baseURL: BASE_URL, apiURL: '' };
  }
}

export interface MembersFixture {
  /** Create an admin-owned project, seed the given collaborator roles on it, and
   *  return its ids plus each member's pending invite token (for invite specs). */
  create(roles: MemberPreset[]): Promise<{
    project: Project;
    siftId: string;
    members: Array<{ email: string; preset: MemberPreset; inviteToken?: string; inviteLink?: string }>;
  }>;
}

interface RoleContext { page: Page; request: APIRequestContext; context: BrowserContext }

type Fixtures = {
  seed: SeedInfo;
  tmpProject: Project;
  screeningProject: { project: Project; siftId: string; recordCount: number };
  projectWithMembers: MembersFixture;
  setFlags: (patch: Record<string, boolean>) => Promise<void>;
  modContext: RoleContext;
  normalContext: RoleContext;
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

  screeningProject: async ({ request }, use) => {
    const p = await createProject(request, `E2E Screening ${Date.now()}-${Math.floor(Math.random() * 1e4)}`);
    const siftId = await ensureScreeningWorkspace(request, p.id);
    const records = Array.from({ length: 8 }, (_, i) => ({
      title: `E2E Study ${i + 1} on intervention efficacy and patient outcomes`,
      authors: [`Author${i + 1}, A`, 'Smith, B'],
      year: 2018 + (i % 6),
      abstract: `Background: randomized trial number ${i + 1}. Methods: cohort. Results: significant effect. Conclusion: promising for the systematic review.`,
      doi: `10.1000/e2e.${Date.now()}.${i + 1}`,
    }));
    const { imported } = await importScreeningRecords(request, siftId, { content: makeRis(records), filename: 'e2e-seed.ris', force: true });
    await use({ project: p, siftId, recordCount: imported });
    await deleteProject(request, p.id);
  },

  projectWithMembers: async ({ request }, use) => {
    const created: string[] = [];
    const factory: MembersFixture = {
      async create(roles) {
        const p = await createProject(request, `E2E Members ${Date.now()}-${Math.floor(Math.random() * 1e4)}`);
        created.push(p.id);
        const siftId = await ensureScreeningWorkspace(request, p.id);
        const members = [];
        for (const preset of roles) {
          const email = `e2e-${preset}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@pecanrev.test`;
          const { inviteToken, inviteLink } = await addProjectMember(request, siftId, { email, preset });
          members.push({ email, preset, inviteToken, inviteLink });
        }
        return { project: p, siftId, members };
      },
    };
    await use(factory);
    for (const id of created) await deleteProject(request, id);
  },

  setFlags: async ({ request }, use) => {
    let snapshot: Record<string, boolean> | null = null;
    const setter = async (patch: Record<string, boolean>) => {
      if (!snapshot) snapshot = await getFeatureFlags(request).catch(() => ({}));
      await setFeatureFlags(request, patch);
    };
    await use(setter);
    if (snapshot) { try { await setFeatureFlags(request, snapshot); } catch { /* best effort */ } }
  },

  modContext: async ({ browser }, use) => {
    const ctx = await roleContext(browser, modStatePath);
    await use(ctx);
    await ctx.context.close();
  },

  normalContext: async ({ browser }, use) => {
    const ctx = await roleContext(browser, normalStatePath);
    await use(ctx);
    await ctx.context.close();
  },
});

// `test` inherits the admin session from the config `use.storageState`
// (./e2e/.auth/admin.json) — no module-level `test.use()` here. Calling `.use()`
// in this SHARED helper module is unsupported by Playwright and silently leaks
// across sibling test objects (it nulled the admin session when `anonTest` set an
// empty storageState the same way). We override storageState via the FIXTURE form
// below instead, which is per-object and leak-free.

async function roleContext(browser: import('@playwright/test').Browser, statePath: string): Promise<RoleContext> {
  if (!fs.existsSync(statePath)) throw new Error(`[e2e] missing storageState ${statePath} — global-setup did not create this role.`);
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: statePath });
  await context.addInitScript((key) => { try { window.localStorage.setItem(key, 'stitch'); } catch { /* noop */ } }, STITCH_STORAGE_KEY);
  const page = await context.newPage();
  return { page, request: context.request, context };
}

/**
 * Anonymous (logged-out) test — for landing, login and register specs.
 * storageState is overridden via the FIXTURE form (not `.use()`), so it is scoped
 * to this object and does not leak into `test`'s admin session.
 */
export const anonTest = base.extend({
  storageState: async ({}, use) => { await use({ cookies: [], origins: [] }); },
});

export { expect };
