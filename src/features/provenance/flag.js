/**
 * features/provenance/flag.js — 88.md. Tiny eager reader for the `researchProvenance`
 * feature flag from the public settings endpoint (mirrors manuscriptEditorFlagEnabled),
 * so the nav/dispatcher can decide whether to surface the Project History tab WITHOUT
 * pulling the heavy panel chunk. Fail-soft: any error → false.
 */
export async function researchProvenanceFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.researchProvenance === true);
  } catch {
    return false;
  }
}

export default researchProvenanceFlagEnabled;
