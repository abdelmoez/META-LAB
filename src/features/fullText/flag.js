/**
 * features/fullText/flag.js — 68.md (P9). Tiny, eager (NOT lazy-chunked) helper to
 * read the `fullTextRetrieval` feature flag from the public settings endpoint. Kept
 * standalone so the dispatcher can decide whether to lazy-load the heavy panel chunk
 * WITHOUT first pulling that chunk in. Mirrors manuscriptEditorFlagEnabled /
 * pecanSearchFlagEnabled. Fail-closed on any error.
 */
export async function fullTextRetrievalFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.fullTextRetrieval === true);
  } catch {
    return false;
  }
}

export default fullTextRetrievalFlagEnabled;
