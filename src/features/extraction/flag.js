/**
 * features/extraction/flag.js — 66.md (P5). Tiny, eager (NOT lazy-chunked) helper
 * that reads the `extractionAssist` feature flag from the public settings endpoint.
 * Kept standalone so ExtractionTab can decide whether to offer the structured
 * workspace WITHOUT first pulling the heavy workspace chunk. Mirrors
 * manuscriptEditorFlagEnabled / pecanSearchFlagEnabled. Fail-closed on any error.
 */
export async function extractionAssistFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.extractionAssist === true);
  } catch {
    return false;
  }
}

export default extractionAssistFlagEnabled;
