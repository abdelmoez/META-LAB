/**
 * features/manuscript/flag.js — 64.md (P3). Tiny, eager (NOT lazy-chunked) helper
 * to read the `manuscriptEditor` feature flag from the public settings endpoint.
 * Kept standalone so the dispatcher can decide whether to lazy-load the heavy
 * editor chunk WITHOUT first pulling that chunk in. Mirrors pecanSearchFlagEnabled.
 */
export async function manuscriptEditorFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.manuscriptEditor === true);
  } catch {
    return false;
  }
}

export default manuscriptEditorFlagEnabled;
