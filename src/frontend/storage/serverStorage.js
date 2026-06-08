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
 *
 * Debouncing lives HERE (not in the monolith) so that flushStorage() can
 * immediately execute a pending save before logout or page unload.
 */

const PROJECTS_KEY = 'meta:projects';
const BASE = '/api';
const DEBOUNCE_MS = 800;

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

/* ── Debounce state (owned here so flushStorage() can drain it) ──────── */

let debounceTimer = null;
let pendingValue  = null;   // latest JSON string waiting to be persisted

/**
 * Execute the actual save against the server.  Called either from the
 * debounce timer or directly by flushStorage().
 */
async function doSave(value) {
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
  } catch (err) {
    console.error('[serverStorage] autosave failed:', err.message);
    emitStatus('failed');
  }
}

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
    } catch (err) {
      console.error('[serverStorage] load failed:', err.message);
      return null;
    }
  },

  /**
   * Persist the full projects array to the server (debounced).
   * Cancels any previously pending debounce and starts a fresh one.
   * Call flushStorage() to persist immediately (e.g. before logout).
   */
  async set(key, value) {
    if (key !== PROJECTS_KEY) return;

    // Always record the latest value so flushStorage() can use it.
    pendingValue = value;

    // Debounce: cancel the previous timer and start a new one.
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const toSave  = pendingValue;
      pendingValue  = null;
      await doSave(toSave);
    }, DEBOUNCE_MS);
  },
};

/* ── Flush helper (called before logout / page unload) ───────────────── */

/**
 * If there is a debounced save pending, cancel the timer and execute the
 * save immediately.  Returns a Promise that resolves when the save is done
 * (or rejects if there was nothing to flush).
 */
export async function flushStorage() {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pendingValue !== null) {
    const toSave = pendingValue;
    pendingValue = null;
    await doSave(toSave);
  }
}

/**
 * True when there is a debounced save that has not yet been flushed to the
 * server.  Useful for showing a "unsaved changes" warning.
 */
export function hasPendingSave() {
  return pendingValue !== null || debounceTimer !== null;
}
