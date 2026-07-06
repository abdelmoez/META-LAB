/**
 * features/extraction/engine/extractionEngineFlag.js — 76.md. Tiny, eager (NOT
 * lazy-chunked) helper that reads the `extractionEngine` flag from the public settings
 * endpoint, so the Extraction tab dispatcher can decide whether to mount the new Pecan
 * Extraction Engine WITHOUT first pulling its heavy chunk. Mirrors
 * extractionAssistFlagEnabled / searchWorkspaceV2FlagEnabled. Fail-closed on any error
 * (undetermined flag → the current split-screen workspace, unchanged).
 */
export async function extractionEngineFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.extractionEngine === true);
  } catch {
    return false;
  }
}

export default extractionEngineFlagEnabled;
