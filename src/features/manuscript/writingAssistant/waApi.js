/**
 * features/manuscript/writingAssistant/waApi.js — 120.md §6.
 *
 * The feature's only network surface. Follow the figureApi.js shape (method-first
 * `req`, `credentials: 'include'` for the httpOnly session cookie, every path segment
 * encodeURIComponent'd).
 *
 * WHAT CROSSES THIS BOUNDARY, EXHAUSTIVELY (§6 "Privacy and security"):
 *   · dictionary TERMS the researcher explicitly chose to accept, and their optional
 *     metadata (preferred spelling, expansion, category);
 *   · the preference blob { enabled, variant, mutedCategories, mutedRules, showStyle }.
 * NO manuscript sentence, paragraph, block or offset is ever sent anywhere. The
 * checker is a local Web Worker with a bundled dictionary; there is no grammar
 * provider, no proxy endpoint and no per-keystroke request of any kind.
 */

const BASE = '/api';

async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status, data });
  }
  return data;
}

export const waApi = {
  /* ── dictionaries (120.md §6 "Dictionary scopes") ──────────────────────────── */
  listPersonal: () => req('GET', '/dictionary/personal'),
  addPersonal: (entry) => req('POST', '/dictionary/personal', entry),
  removePersonal: (entryId) => req('DELETE', `/dictionary/personal/${encodeURIComponent(entryId)}`),

  listProject: (projectId) => req('GET', `/dictionary/project/${encodeURIComponent(projectId)}`),
  addProject: (projectId, entry) => req('POST', `/dictionary/project/${encodeURIComponent(projectId)}`, entry),
  removeProject: (projectId, entryId) => req(
    'DELETE',
    `/dictionary/project/${encodeURIComponent(projectId)}/${encodeURIComponent(entryId)}`,
  ),

  /* ── preferences (§6 "Persist preferences through the established settings
        system") — the profile allowlist, same channel as every other per-user pref. */
  loadPrefs: () => req('GET', '/profile'),
  savePrefs: (prefs) => req('PUT', '/profile', { writingAssistant: prefs }),
};

export default waApi;
