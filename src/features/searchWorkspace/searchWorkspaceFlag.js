/**
 * searchWorkspaceFlag.js — 71.md. Tiny, eager helper that decides whether the new
 * STAGED Search Workspace (SearchWorkspace) renders in place of the legacy 3-step
 * SearchWizard. It reads the public settings endpoint and returns true ONLY when
 * BOTH `searchWorkspaceV2` (the redesign flag) AND `searchEngine` (its hard
 * dependency — the workspace composes the Search Builder engine) are on. Mirrors
 * searchEngineFlagEnabled / pecanSearchFlagEnabled. Fail closed on any error so a
 * disabled/undetermined flag always falls back to the byte-identical wizard.
 */
export async function searchWorkspaceV2FlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    const f = (d && d.featureFlags) || {};
    return f.searchWorkspaceV2 === true && f.searchEngine === true;
  } catch {
    return false;
  }
}

export default searchWorkspaceV2FlagEnabled;
