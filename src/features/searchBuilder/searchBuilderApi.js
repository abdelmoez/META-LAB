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

// One search per project. load returns {concepts,overrides} | null (null seeds from PICO).
export async function loadSearch(projectId) {
  try {
    const r = await fetch(`${BASE}/${projectId}`, { credentials: 'include' });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

// Returns the server ack { ok, revision } on success (so the tab can track the
// server revision for conflict-safe live sync), or null on any failure.
export async function saveSearch(projectId, state) {
  try {
    const r = await fetch(`${BASE}/${projectId}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
    });
    return r.ok ? r.json() : null;
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
