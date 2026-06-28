/**
 * api.ts — thin, typed wrappers over the PecanRev backend, built on Playwright's
 * APIRequestContext so the same helpers work in global-setup and inside tests
 * (cookies are stored on the context automatically after login).
 *
 * These exist so tests can SEED state fast and deterministically via the real API
 * (create a project, become an admin in Stitch, invite a member) instead of driving
 * the slow UI for setup. UI flows are still exercised directly in the feature specs.
 */
import { APIRequestContext, expect } from '@playwright/test';
import { API_URL } from './env';

export interface AuthUser { id: string; email: string; name?: string; role: string; uiDesignMode?: string }

/** POST /api/auth/login — on success the session cookie is stored on `request`. */
export async function login(request: APIRequestContext, email: string, password: string): Promise<AuthUser> {
  const res = await request.post(`${API_URL}/api/auth/login`, { data: { email, password } });
  expect(res.ok(), `login(${email}) failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  return body.user || body;
}

/** POST /api/auth/register — returns the created user (and logs them in on `request`). */
export async function register(request: APIRequestContext, data: { email: string; password: string; name?: string; country?: string }): Promise<AuthUser> {
  const res = await request.post(`${API_URL}/api/auth/register`, { data });
  expect(res.ok(), `register(${data.email}) failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  return body.user || body;
}

/** GET /api/auth/me — the current session's user, or null when unauthenticated. */
export async function me(request: APIRequestContext): Promise<AuthUser | null> {
  const res = await request.get(`${API_URL}/api/auth/me`);
  if (!res.ok()) return null;
  const body = await res.json();
  return body.user || body;
}

export async function logout(request: APIRequestContext): Promise<void> {
  await request.post(`${API_URL}/api/auth/logout`, { data: {} });
}

/** PUT /api/profile — persist the UI design mode (admin-only; 403 for non-admins). */
export async function setDesignMode(request: APIRequestContext, mode: 'stitch' | 'legacy'): Promise<boolean> {
  const res = await request.put(`${API_URL}/api/profile`, { data: { uiDesignMode: mode } });
  return res.ok();
}

/** POST /api/projects — create a project; returns its id. */
export async function createProject(request: APIRequestContext, name: string): Promise<{ id: string; name: string }> {
  const res = await request.post(`${API_URL}/api/projects`, { data: { name } });
  expect(res.ok(), `createProject failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  const body = await res.json();
  const project = body.project || body;
  return { id: project.id, name: project.name };
}

export async function listProjects(request: APIRequestContext): Promise<Array<{ id: string; name: string }>> {
  const res = await request.get(`${API_URL}/api/projects`);
  if (!res.ok()) return [];
  const body = await res.json();
  const arr = Array.isArray(body) ? body : (body.projects || []);
  return arr.map((p: any) => ({ id: p.id, name: p.name }));
}

/** Best-effort delete (owner delete endpoint), used for cleanup. Never throws. */
export async function deleteProject(request: APIRequestContext, id: string): Promise<void> {
  try { await request.post(`${API_URL}/api/projects/${encodeURIComponent(id)}/delete`, { data: { confirm: true } }); } catch { /* ignore */ }
}

/** GET /api/settings/public — the merged public feature flags (no auth). */
export async function publicFlags(request: APIRequestContext): Promise<Record<string, boolean>> {
  const res = await request.get(`${API_URL}/api/settings/public`);
  if (!res.ok()) return {};
  const body = await res.json();
  return (body && body.featureFlags) || {};
}
