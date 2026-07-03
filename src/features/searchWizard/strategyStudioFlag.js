/**
 * strategyStudioFlag.js — P11. Tiny, eager helper that reads the flag trio the guided
 * Strategy Studio depends on from the public settings endpoint. The Studio panels are
 * INERT unless ALL of `searchStrategyStudio`, `searchEngine` and `pecanSearch` are on
 * (the engine builds + runs a real Boolean strategy, so it needs the search backend and
 * the automated run). Mirrors pecanSearchFlagEnabled / livingReviewFlagEnabled. Fail
 * closed on any error so a disabled flag never does work.
 */
export async function strategyStudioFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    const f = (d && d.featureFlags) || {};
    return f.searchStrategyStudio === true && f.searchEngine === true && f.pecanSearch === true;
  } catch {
    return false;
  }
}

export default strategyStudioFlagEnabled;
