/**
 * features/livingReview/flag.js — 66.md (P6). Tiny, eager (NOT lazy-chunked) helper
 * to read the `livingReview` feature flag from the public settings endpoint. Kept
 * standalone so the dispatcher can decide whether to lazy-load the heavy dashboard
 * chunk WITHOUT first pulling that chunk in. Mirrors manuscriptEditorFlagEnabled.
 */
export async function livingReviewFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.livingReview === true);
  } catch {
    return false;
  }
}

export default livingReviewFlagEnabled;
