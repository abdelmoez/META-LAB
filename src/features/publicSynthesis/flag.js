/**
 * features/publicSynthesis/flag.js — 68.md (P8). Tiny, eager (NOT lazy-chunked)
 * helper to read the `publicSynthesis` feature flag from the public settings
 * endpoint. Kept standalone so the mount point can decide whether to lazy-load the
 * heavy publish panel chunk WITHOUT first pulling that chunk in. Mirrors
 * manuscriptEditorFlagEnabled / extractionAssistFlagEnabled. Fail-closed on error.
 */
export async function publicSynthesisFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.publicSynthesis === true);
  } catch {
    return false;
  }
}

export default publicSynthesisFlagEnabled;
