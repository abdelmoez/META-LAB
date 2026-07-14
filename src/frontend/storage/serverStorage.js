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
 * Subscribe to autosave status changes. 'conflict' means the server refused a
 * stale write because another tab/collaborator saved first (a
 * `metalab:autosave-conflict` window event carries the project id).
 * @param {(status: 'idle'|'saving'|'saved'|'failed'|'conflict') => void} fn
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
    try { err.body = await res.json(); } catch { /* non-JSON error body */ }
    throw err;
  }
  return res.json();
}

/* ── Server IDs tracking (for delete sync) ───────────────────────────── */

// Track which project IDs were last loaded from the server so we can detect
// projects that the monolith deleted locally and must be removed on the server.
let knownServerIds = new Set();

/* ── Optimistic-concurrency baselines (83.md-limitation fix) ─────────── */

// projectId → the server `autosaveRev` this client last observed. Sent with each
// autosave PUT as `_baseRev` so the server can 409 instead of silently clobbering
// a newer AUTOSAVE from another tab/collaborator (module writes never bump the
// rev). `_`-prefixed, so the server strips it from the persisted blob.
const saveBaselines = new Map();

/* ── Debounce state (owned here so flushStorage() can drain it) ──────── */

let debounceTimer = null;
let pendingValue  = null;   // latest JSON string waiting to be persisted
let saveInFlight  = false;  // true while doSave() is executing (realtime guard)

/**
 * Execute the actual save against the server.  Called either from the
 * debounce timer or directly by flushStorage().
 */
let saveChain = Promise.resolve();
async function doSave(value) {
  // Serialize saves: a flush racing an in-flight debounced save would carry the
  // pre-flight `_baseRev` and false-conflict against this very tab. Each batch
  // waits for the previous one so baselines are always current.
  const run = () => doSaveNow(value);
  const next = saveChain.then(run, run);
  saveChain = next;
  return next;
}

async function doSaveNow(value) {
  saveInFlight = true;
  emitStatus('saving');
  try {
    const projects = JSON.parse(value);
    if (!Array.isArray(projects)) {
      emitStatus('failed');
      return;
    }

    const currentIds = new Set(projects.map(p => p.id));

    // prompt6 Task 5 — skip the PUT for read-only shared projects entirely.
    // The server already no-ops them (200 + {skipped}, the load-bearing batch
    // contract), but a read-only viewer cannot have changed the blob, so
    // uploading it is pure waste. NOTE: they stay in currentIds so the delete
    // sweep below never tries to remove them server-side.
    const writable = projects.filter(
      p => !(p._readOnly || (p._permissions && p._permissions.readOnly))
    );

    // Upsert all writable projects via the autosave endpoint.
    // allSettled (NOT all): one failed PUT must never corrupt the save
    // indicator for the user's own projects — the other saves still land.
    const results = await Promise.allSettled(
      writable.map(p =>
        apiFetch(`${BASE}/projects/${p.id}/autosave`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...p, _baseRev: saveBaselines.has(p.id) ? saveBaselines.get(p.id) : undefined }),
        })
      )
    );
    // Refresh baselines from every landed save (the server returns the row's
    // new updatedAt), so the next PUT carries a current baseline.
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value && Number.isInteger(r.value.autosaveRev)) {
        saveBaselines.set(writable[i].id, r.value.autosaveRev);
      }
    });
    // 409 = the project changed on the server since this tab loaded it. The
    // server REFUSED the stale write (nothing was lost server-side). The stale
    // baseline is deliberately KEPT, so retries keep being refused until the
    // user loads the latest version (get() re-records baselines) — the local
    // divergence is surfaced VISIBLY, never allowed to win silently.
    const conflicts = results
      .map((r, i) => ({ r, p: writable[i] }))
      .filter(x => x.r.status === 'rejected' && x.r.reason && x.r.reason.status === 409);
    conflicts.forEach(({ p }) => {
      try {
        window.dispatchEvent(new CustomEvent('metalab:autosave-conflict', { detail: { id: p.id, name: p.name || '' } }));
      } catch { /* noop */ }
    });
    const failures = results.filter(r => r.status === 'rejected' && (!r.reason || r.reason.status !== 409));
    failures.forEach(r =>
      console.error('[serverStorage] autosave failed:', r.reason && r.reason.message)
    );

    // Delete any projects the user removed in the monolith (best-effort).
    const toDelete = [...knownServerIds].filter(id => !currentIds.has(id));
    if (toDelete.length > 0) {
      await Promise.allSettled(
        toDelete.map(id =>
          fetch(`${BASE}/projects/${id}`, {
            method: 'DELETE',
            credentials: 'include',
          })
        )
      );
    }

    knownServerIds = currentIds;
    if (failures.length > 0) {
      emitStatus('failed');
      return;
    }
    if (conflicts.length > 0) {
      emitStatus('conflict');
      return;
    }
    emitStatus('saved');
    setTimeout(() => emitStatus('idle'), 2000);
  } catch (err) {
    console.error('[serverStorage] autosave failed:', err.message);
    emitStatus('failed');
  } finally {
    saveInFlight = false;
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
      // Record the concurrency baseline every save will be checked against.
      full.forEach(p => { if (p && p.id && Number.isInteger(p.autosaveRev)) saveBaselines.set(p.id, p.autosaveRev); });
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
 * server, OR a save currently in flight.  Useful for an "unsaved changes"
 * warning, and load-bearing for realtime (prompt6 Task 7): a remote
 * project.updated refetch must NEVER be applied while this is true, or it
 * would clobber the user's local edits.
 */
export function hasPendingSave() {
  return pendingValue !== null || debounceTimer !== null || saveInFlight;
}

/**
 * Drop any debounced (not yet sent) save WITHOUT executing it. Used when
 * resolving an autosave conflict: the local divergence is being replaced by the
 * server's newer copy, so persisting it would be wrong. In-flight requests are
 * not affected (the server refuses stale ones via the baseline anyway).
 */
export function discardPendingSave() {
  if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null; }
  pendingValue = null;
}
