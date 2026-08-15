/**
 * features/manuscript/flag.js — 64.md (P3). Tiny, eager (NOT lazy-chunked) helper
 * to read the `manuscriptEditor` feature flag from the public settings endpoint.
 * Kept standalone so the dispatcher can decide whether to lazy-load the heavy
 * editor chunk WITHOUT first pulling that chunk in. Mirrors pecanSearchFlagEnabled.
 *
 * 117.md §K.2 flipped the flag's DEFAULT to ON. This reader stays FAIL-CLOSED
 * anyway, deliberately and in step with every other `*FlagEnabled` helper: the
 * server always merges the catalogue defaults into /api/settings/public
 * (settingsController.getPublicSettings), so the key is present whenever the
 * endpoint answers at all; a `false` here means the request itself failed, and the
 * honest degrade for "we could not ask" is the legacy drafter, which needs no
 * extra chunk, rather than optimistically loading the whole editor.
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
