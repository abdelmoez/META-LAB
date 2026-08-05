/**
 * searchBuilderApi.js — wires SearchBuilderTab's four seams to the separated
 * Search Engine backend (BACKEND_CONTRACT.md), using the app's authenticated
 * fetch (session cookie rides along). HTTP/network failures THROW so the tab can
 * drop to "limited mode"; a 200 with `null` is a genuine MeSH no-match.
 */
const BASE = '/api/search-builder';

async function jpost(url, body) {
  const r = await fetch(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const searchBuilderApi = {
  // text -> mesh record | null  (null = genuine no-match; throw = backend down)
  async meshLookup(term) {
    return jpost(`${BASE}/mesh`, { term });
  },
  // partial text -> array of mesh records (possibly []).  throw = backend down, so
  // the dropdown falls back to its local seed suggestions only.
  async meshSuggest(term) {
    const d = await jpost(`${BASE}/mesh-suggest`, { term });
    return Array.isArray(d) ? d : [];
  },
  // query -> integer | null
  async pubmedCount(query) {
    const d = await jpost(`${BASE}/count`, { query });
    return d && d.count != null ? d.count : null;
  },
};

/* ── 97.md QA H3 — the shared per-tab REVISION channel ─────────────────────────
   The search module has SEVERAL writers in one browser tab: the builder's
   full-state autosave AND the workspace's single-key saves (searchMode,
   readyForScreening). Every single-key ack bumps the server revision, and the
   realtime poke deliberately EXCLUDES the acting user — so without this channel
   the mounted-hidden builder kept a stale baseRevision and its next autosave
   409'd against the user's OWN write (a false "collaborator updated" notice).
   Every saveSearch ack (any caller) publishes { projectId, revision }; the
   builder subscribes and fast-forwards its known revision. Module-level, one per
   bundle — exactly the writers that share a tab. */
const revisionListeners = new Set();
export function onSearchSaved(listener) {
  if (typeof listener !== 'function') return () => {};
  revisionListeners.add(listener);
  return () => revisionListeners.delete(listener);
}
function publishSearchSaved(projectId, ack) {
  if (!ack || typeof ack.revision !== 'number') return;
  for (const cb of [...revisionListeners]) {
    try { cb({ projectId, revision: ack.revision }); } catch { /* listener is best-effort */ }
  }
}

// One search per project. load returns {concepts,overrides} | null (null seeds empty; the workspace seeds from the research question).
export async function loadSearch(projectId) {
  try {
    const r = await fetch(`${BASE}/${projectId}`, { credentials: 'include' });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

// Returns the server ack { ok, revision, meta? } on success (so the tab can track
// the server revision for conflict-safe live sync and adopt the server-stamped
// meta identity), or null on any failure. Every ack is also published on the
// shared revision channel above.
// 98.md §15 — opts.keepalive: the tab-close flush path sets it so the PUT
// survives page teardown (Safari has no reliable beforeunload; fetch keepalive
// is the standards-based way to not lose the final debounce window).
export async function saveSearch(projectId, state, opts) {
  try {
    const r = await fetch(`${BASE}/${projectId}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
      ...(opts && opts.keepalive ? { keepalive: true } : {}),
    });
    if (!r.ok) return null;
    const ack = await r.json();
    publishSearchSaved(projectId, ack);
    return ack;
  } catch { return null; /* best-effort — autosave retries on the next change */ }
}

/** Gate the new tab client-side (mirrors robFlagEnabled). Default OFF on error. */
export async function searchEngineFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.searchEngine === true);
  } catch {
    return false;
  }
}
