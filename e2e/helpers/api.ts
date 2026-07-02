/**
 * api.ts — thin, typed wrappers over the PecanRev backend, built on Playwright's
 * APIRequestContext so the same helpers work in global-setup and inside tests.
 *
 * IMPORTANT — every path here is RELATIVE (`/api/...`), never the absolute API
 * origin. That is deliberate and load-bearing:
 *   - Inside a test, the `request` fixture inherits `use.baseURL` = the CLIENT
 *     origin (:3000) and the admin session cookie, which the browser scoped to
 *     :3000. A relative call therefore goes :3000 → Vite proxy → :3001 carrying
 *     that cookie. An ABSOLUTE :3001 call would NOT send the :3000-scoped cookie
 *     and would 401.
 *   - In global-setup the dedicated apiCtx is created with baseURL = the API
 *     origin (:3001) and its own login, so the same relative call hits :3001
 *     directly with the :3001 cookie.
 * One convention, both contexts. (See e2e/README.md › "Cross-origin cookies".)
 *
 * These exist so tests can SEED state fast and deterministically via the real API
 * (create a project, enable an engine flag, invite a member, import records)
 * instead of driving the slow UI for setup. UI flows are still exercised directly
 * in the feature specs.
 */
import { APIRequestContext, expect } from '@playwright/test';

export interface AuthUser { id: string; email: string; name?: string; role: string; uiDesignMode?: string }

/* ─── Auth ─────────────────────────────────────────────────────────────────── */

/** POST /api/auth/login — on success the session cookie is stored on `request`. */
export async function login(request: APIRequestContext, email: string, password: string): Promise<AuthUser> {
  const res = await request.post('/api/auth/login', { data: { email, password } });
  expect(res.ok(), `login(${email}) failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  return body.user || body;
}

/** POST /api/auth/register — returns the created user (and logs them in on `request`). */
export async function register(
  request: APIRequestContext,
  data: { email: string; password: string; name?: string; country?: string; acceptedTerms?: boolean; inviteToken?: string },
): Promise<AuthUser> {
  const res = await request.post('/api/auth/register', { data: { acceptedTerms: true, ...data } });
  expect(res.ok(), `register(${data.email}) failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  return body.user || body;
}

/** GET /api/auth/me — the current session's user, or null when unauthenticated. */
export async function me(request: APIRequestContext): Promise<AuthUser | null> {
  const res = await request.get('/api/auth/me');
  if (!res.ok()) return null;
  const body = await res.json();
  return body.user || body;
}

export async function logout(request: APIRequestContext): Promise<void> {
  await request.post('/api/auth/logout', { data: {} });
}

/** PUT /api/profile — persist a PERSONAL UI design mode. 65.md: ADMIN-ONLY for
 *  BOTH values — any non-admin attempt (stitch OR legacy) is a 403
 *  (UI_DESIGN_ADMIN_ONLY); non-admins always render the Ops-governed default.
 *  Returns res.ok(), so callers can assert the 403 by expecting `false`. */
export async function setDesignMode(request: APIRequestContext, mode: 'stitch' | 'legacy'): Promise<boolean> {
  const res = await request.put('/api/profile', { data: { uiDesignMode: mode } });
  return res.ok();
}

/* ─── Projects ─────────────────────────────────────────────────────────────── */

export interface Project { id: string; name: string; linkedSiftId?: string }

/** POST /api/projects — create a project (with its linked screening workspace). */
export async function createProject(request: APIRequestContext, name: string, extra: Record<string, unknown> = {}): Promise<Project> {
  const res = await request.post('/api/projects', { data: { name, ...extra } });
  expect(res.ok(), `createProject failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  const project = body.project || body;
  return { id: project.id, name: project.name, linkedSiftId: project.linkedSiftId || project.linkedScreenProjectId };
}

export async function listProjects(request: APIRequestContext): Promise<Project[]> {
  const res = await request.get('/api/projects');
  if (!res.ok()) return [];
  const body = await res.json();
  const arr = Array.isArray(body) ? body : (body.projects || []);
  return arr.map((p: any) => ({ id: p.id, name: p.name }));
}

/** Best-effort delete (owner delete endpoint), used for cleanup. Never throws. */
export async function deleteProject(request: APIRequestContext, id: string): Promise<void> {
  try { await request.post(`/api/projects/${encodeURIComponent(id)}/delete`, { data: { confirm: true } }); } catch { /* ignore */ }
}

/* ─── Public settings / feature flags ──────────────────────────────────────── */

/** GET /api/settings/public — the merged public feature flags (no auth). */
export async function publicFlags(request: APIRequestContext): Promise<Record<string, boolean>> {
  const res = await request.get('/api/settings/public');
  if (!res.ok()) return {};
  const body = await res.json();
  return (body && body.featureFlags) || {};
}

/** GET /api/settings/public — full public settings blob (flags + appSettings + designSettings…). */
export async function publicSettings(request: APIRequestContext): Promise<Record<string, any>> {
  const res = await request.get('/api/settings/public');
  if (!res.ok()) return {};
  return res.json();
}

/* ─── Admin: feature flags ─────────────────────────────────────────────────── */

/** GET /api/admin/feature-flags (admin). Returns the full merged flag object. */
export async function getFeatureFlags(request: APIRequestContext): Promise<Record<string, boolean>> {
  const res = await request.get('/api/admin/feature-flags');
  if (!res.ok()) throw new Error(`getFeatureFlags failed: ${res.status()}`);
  const body = await res.json();
  return body.featureFlags || body.flags || body;
}

/**
 * PUT /api/admin/feature-flags (admin) — the server MERGES the body over current,
 * but we read+merge client-side too so a partial patch can never drop a flag.
 * Returns the resulting flag object.
 */
export async function setFeatureFlags(request: APIRequestContext, patch: Record<string, boolean>): Promise<Record<string, boolean>> {
  const current = await getFeatureFlags(request).catch(() => ({}));
  const merged = { ...current, ...patch };
  const res = await request.put('/api/admin/feature-flags', { data: merged });
  expect(res.ok(), `setFeatureFlags failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  return body.featureFlags || body.flags || merged;
}

/** The engine flags the E2E suite turns ON so gated areas are testable. */
export const ENGINE_FLAGS: Record<string, boolean> = {
  searchEngine: true, // dependency of pecanSearch — set first (merge sets both at once)
  pecanSearch: true,
  aiScreening: true,
  rob_engine_v2: true,
  networkMetaAnalysis: true,
  serverBackedWorkflowState: true,
  // betaWaitlist stays OFF by default so `/` keeps the normal landing for most
  // specs; the waitlist spec flips it within its own scope.
};

export async function enableEngineFlags(request: APIRequestContext): Promise<Record<string, boolean>> {
  return setFeatureFlags(request, ENGINE_FLAGS);
}

/* ─── Admin: design (Ops-governed UI) settings ─────────────────────────────── */

// 65.md — `defaultMode` is the interface every non-admin renders;
// `allowLegacyFallback` re-enables ?ui=legacy links + saved prefs for non-admins
// (emergency escape, default false); `allowAllUsers` is storage back-compat only
// and no longer gates rendering.
export interface DesignSettings { allowAllUsers: boolean; defaultMode: 'legacy' | 'stitch'; allowLegacyFallback: boolean }

export async function getDesignSettings(request: APIRequestContext): Promise<DesignSettings> {
  const res = await request.get('/api/admin/design-settings');
  expect(res.ok(), `getDesignSettings failed: ${res.status()}`).toBeTruthy();
  return res.json();
}

export async function setDesignSettings(request: APIRequestContext, patch: Partial<DesignSettings>): Promise<DesignSettings> {
  const res = await request.put('/api/admin/design-settings', { data: patch });
  expect(res.ok(), `setDesignSettings failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  return res.json();
}

/* ─── Admin: app settings + roles ──────────────────────────────────────────── */

export async function getAppSettings(request: APIRequestContext): Promise<Record<string, any>> {
  const res = await request.get('/api/admin/settings');
  if (!res.ok()) throw new Error(`getAppSettings failed: ${res.status()}`);
  const body = await res.json();
  return body.appSettings || body.settings || body;
}

/** PUT /api/admin/settings — merges a partial appSettings patch over current. */
export async function setAppSettings(request: APIRequestContext, patch: Record<string, any>): Promise<Record<string, any>> {
  const current = await getAppSettings(request).catch(() => ({}));
  const merged = { ...current, ...patch };
  const res = await request.put('/api/admin/settings', { data: merged });
  expect(res.ok(), `setAppSettings failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  return body.appSettings || merged;
}

/** PATCH /api/admin/users/:id/role (admin only). */
export async function updateUserRole(request: APIRequestContext, userId: string, role: 'admin' | 'mod' | 'user'): Promise<boolean> {
  const res = await request.patch(`/api/admin/users/${encodeURIComponent(userId)}/role`, { data: { role } });
  return res.ok();
}

/**
 * Enable/disable the dynamic onboarding gate (admin). The suite disables it so
 * seeded + mid-test users (invited registrants included) reach the app instead of
 * being trapped on /onboarding by required questions. globalTeardown restores it.
 * Returns the previous `enabled` value so the caller can restore it.
 */
export async function setOnboardingEnabled(request: APIRequestContext, enabled: boolean): Promise<boolean | undefined> {
  let prev: boolean | undefined;
  let current: Record<string, any> = {};
  try {
    const res = await request.get('/api/admin/onboarding-settings');
    if (res.ok()) { const b = await res.json(); current = b.onboardingSettings || b.settings || b || {}; prev = current.enabled; }
  } catch { /* default below */ }
  await request.put('/api/admin/onboarding-settings', { data: { ...current, enabled } });
  return prev;
}

/* ─── Screening: workspace + members + records (project collaboration) ──────── */

/**
 * GET /api/screening/metalab/:mlpid/workspace — resolve (and, for the owner,
 * silently create) the screening project linked to a main project. Returns the
 * SCREEN project id, which the members/records/import endpoints below key on.
 */
export async function ensureScreeningWorkspace(request: APIRequestContext, mainProjectId: string): Promise<string> {
  const res = await request.get(`/api/screening/metalab/${encodeURIComponent(mainProjectId)}/workspace`);
  expect(res.ok(), `ensureScreeningWorkspace(${mainProjectId}) failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  const sift = body.project || body.workspace || body;
  const id = sift?.id || body.screenProjectId || body.projectId || body.siftProjectId;
  expect(id, `ensureScreeningWorkspace: could not find a screen project id in ${JSON.stringify(body).slice(0, 200)}`).toBeTruthy();
  return id;
}

export type MemberPreset = 'leader' | 'reviewer' | 'viewer';

/**
 * POST /api/screening/projects/:siftPid/members — add a collaborator by email.
 * `siftPid` is the SCREEN project id (from ensureScreeningWorkspace), NOT the main
 * project id. Returns the created member plus the plaintext invite link/token when
 * the email is not yet a registered user (used by the invite-acceptance specs).
 */
export async function addProjectMember(
  request: APIRequestContext,
  siftPid: string,
  opts: { email: string; preset?: MemberPreset; modules?: 'metalab' | 'metasift' | 'both' },
): Promise<{ member: any; inviteToken?: string; inviteLink?: string }> {
  const res = await request.post(`/api/screening/projects/${encodeURIComponent(siftPid)}/members`, {
    data: { email: opts.email, preset: opts.preset || 'reviewer', ...(opts.modules ? { modules: opts.modules } : {}) },
  });
  expect(res.ok(), `addProjectMember(${opts.email}) failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  const link: string | undefined = body.invite?.link || body.link;
  const token = link ? (link.split('/invite/')[1] || '').split(/[?#]/)[0] || undefined : (body.invite?.token || undefined);
  return { member: body.member || body, inviteToken: token, inviteLink: link };
}

/** Build a minimal RIS document from simple records — enough for the importer. */
export function makeRis(records: Array<{ title: string; authors?: string[]; year?: number; abstract?: string; doi?: string }>): string {
  return records.map((r) => {
    const lines = ['TY  - JOUR'];
    (r.authors || ['Doe, J']).forEach((a) => lines.push(`AU  - ${a}`));
    lines.push(`TI  - ${r.title}`);
    if (r.year) lines.push(`PY  - ${r.year}`);
    if (r.abstract) lines.push(`AB  - ${r.abstract}`);
    if (r.doi) lines.push(`DO  - ${r.doi}`);
    lines.push('ER  - ');
    return lines.join('\n');
  }).join('\n');
}

/**
 * POST /api/screening/projects/:siftPid/import — synchronous import (small files).
 * Pass already-formatted `content` (e.g. from makeRis). `force:true` bypasses the
 * duplicate-file (409) guard so repeated seeding never wedges.
 */
export async function importScreeningRecords(
  request: APIRequestContext,
  siftPid: string,
  opts: { format?: string; content: string; filename?: string; force?: boolean },
): Promise<{ imported: number; raw: any }> {
  const res = await request.post(`/api/screening/projects/${encodeURIComponent(siftPid)}/import`, {
    data: { format: opts.format || 'ris', content: opts.content, filename: opts.filename || 'e2e-seed.ris', force: opts.force ?? true },
  });
  expect(res.ok(), `importScreeningRecords failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  return { imported: body.imported ?? body.recordCount ?? 0, raw: body };
}

/** GET /api/screening/projects/:siftPid/ai/status — 404 when aiScreening is OFF. */
export async function aiScreeningEnabled(request: APIRequestContext, siftPid: string): Promise<boolean> {
  const res = await request.get(`/api/screening/projects/${encodeURIComponent(siftPid)}/ai/status`);
  return res.status() !== 404;
}

/* ─── Invites ──────────────────────────────────────────────────────────────── */

export async function getInvite(request: APIRequestContext, token: string): Promise<{ ok: boolean; body: any }> {
  const res = await request.get(`/api/invites/${encodeURIComponent(token)}`);
  return { ok: res.ok(), body: await res.json().catch(() => null) };
}

export async function acceptInvite(request: APIRequestContext, token: string): Promise<boolean> {
  const res = await request.post(`/api/invites/${encodeURIComponent(token)}/accept`, { data: {} });
  return res.ok();
}
