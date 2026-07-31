/**
 * searchWorkspaceFlag.js — 71.md, retired-wizard update in 96.md. Tiny, eager
 * helper that decides whether the staged Search Workspace (SearchWorkspace) — and
 * therefore `?stage=` support in the body, which the white side-menu's numbered
 * submenu depends on — is available.
 *
 * 96.md deleted the legacy 3-step SearchWizard, so the old `searchWorkspaceV2`
 * gate is DEPRECATED/IGNORED (it stays in the server DEFAULTS only for stored-row
 * compat): the workspace now renders whenever `searchEngine` is ON. The exported
 * name is kept so existing importers (dispatcher, useSearchWorkspaceV2Enabled,
 * StitchProjectSubnav) work unchanged. Mirrors searchEngineFlagEnabled /
 * pecanSearchFlagEnabled. Fail closed on any error so an undetermined flag always
 * falls back to the legacy in-blob SearchTab path.
 */
export async function searchWorkspaceV2FlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    const f = (d && d.featureFlags) || {};
    return f.searchEngine === true;
  } catch {
    return false;
  }
}

export default searchWorkspaceV2FlagEnabled;
