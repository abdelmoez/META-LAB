/**
 * serverStorage.js
 *
 * Sets window.storage at module-load time so the META·LAB monolith's
 * window.storage.get / window.storage.set calls hit the server API instead
 * of relying on a local store.
 *
 * The monolith stores ALL projects as one JSON array under the key
 * "meta:projects".  This module maps that to per-project REST calls:
 *   get  → GET /api/projects (list) + GET /api/projects/:id (full data)
 *   set  → PUT /api/projects/:id/autosave (upsert) for each project
 *         + DELETE /api/projects/:id for any project removed from the array
 *
 * Autosave status events are published via subscribeToSaveStatus() so React
 * components can show Saving… / Saved / Failed indicators without needing
 * to import React state here.
 */

const PROJECTS_KEY = 'meta:projects';
const BASE = '/api';

/* ── Simple pub-sub for save status ──────────────────────────────────── */

const statusListeners = new Set();

/**
 * Subscribe to autosave status changes.
 * @param {(status: 'idle'|'saving'|'saved'|'failed') => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeToSaveStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function emitStatus(status) {
  statusListeners.forEach(fn => fn(status));
}

/* ── Fetch helper ────────────────────────────────────────────────────── */

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ── Server IDs tracking (for delete sync) ───────────────────────────── */

// Track which project IDs were last loaded from the server so we can detect
// projects that the monolith deleted locally and must be removed on the server.
let knownServerIds = new Set();

/* ── window.storage implementation ──────────────────────────────────── */

window.storage = {
  /**
   * Load all projects from the server.
   * Returns { value: JSON string } in the shape the monolith expects,
   * or null on error (monolith handles null gracefully).
   */
  async get(key) {
    if (key !== PROJECTS_KEY) return null;
    try {
      const list = await apiFetch(`${BASE}/projects`);
      if (!Array.isArray(list) || list.length === 0) {
        knownServerIds = new Set();
        return { value: JSON.stringify([]) };
      }
      // Fetch full data (list endpoint strips studies + records for perf)
      const full = await Promise.all(
        list.map(p => apiFetch(`${BASE}/projects/${p.id}`))
      );
      knownServerIds = new Set(full.map(p => p.id));
      return { value: JSON.stringify(full) };
    } catch {
      return null;
    }
  },

  /**
   * Persist the full projects array to the server.
   * Upserts each project and deletes any that were removed locally.
   * Emits saving → saved | failed status events.
   */
  async set(key, value) {
    if (key !== PROJECTS_KEY) return;
    emitStatus('saving');
    try {
      const projects = JSON.parse(value);
      if (!Array.isArray(projects)) {
        emitStatus('failed');
        return;
      }

      const currentIds = new Set(projects.map(p => p.id));

      // Upsert all current projects via the autosave endpoint
      await Promise.all(
        projects.map(p =>
          apiFetch(`${BASE}/projects/${p.id}/autosave`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(p),
          })
        )
      );

      // Delete any projects the user removed in the monolith
      const toDelete = [...knownServerIds].filter(id => !currentIds.has(id));
      if (toDelete.length > 0) {
        await Promise.all(
          toDelete.map(id =>
            fetch(`${BASE}/projects/${id}`, {
              method: 'DELETE',
              credentials: 'include',
            })
          )
        );
      }

      knownServerIds = currentIds;
      emitStatus('saved');
      setTimeout(() => emitStatus('idle'), 2000);
    } catch {
      emitStatus('failed');
    }
  },
};
