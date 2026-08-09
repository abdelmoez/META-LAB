/**
 * screenAccess.js — 107.md rec: the ONE place that turns a `getProject` payload into
 * the `access` object every META·SIFT tab consumes, plus the capability gates derived
 * from it.
 *
 * It exists because that shape used to be an inline object literal in SiftProject.jsx
 * that enumerated its fields by hand — and `canManageSettings` was simply missing from
 * the list. `ScreeningTab`'s keyword gate therefore read `undefined` for EVERY user
 * (the project owner included), which silently killed the §2 suggestion-review panel,
 * the §3 abstract-selection shortcut, and every edit control in the KeywordEditor.
 * A hand-maintained allow-list that fails silently is the repo's recurring failure
 * mode (shared-context rule 6), so the list now lives in a pure, unit-tested module.
 *
 * Pure — no React, no DOM, no network.
 */

/**
 * Every field the screening tabs may read off `access`. Exported so a regression test
 * can pin the list: a field added to the server's `getProject` response but forgotten
 * here is invisible at runtime (it reads as `undefined`, i.e. "denied").
 */
export const SCREEN_ACCESS_FIELDS = Object.freeze([
  'isLeader', 'myRole', 'isOwner', 'perms',
  'canScreen', 'canChat', 'canResolveConflicts',
  'canManageMembers', 'canManageSettings',
  'blindMode',
]);

/**
 * buildScreenAccess — project payload → the `access` prop passed to every sub-tab.
 *
 * @param {object|null|undefined} project  the `GET /api/screening/projects/:pid` body
 * @returns {object} `{}` when there is no project yet (the tabs render nothing then)
 */
export function buildScreenAccess(project) {
  if (!project) return {};
  return {
    isLeader: project.isLeader,
    myRole: project.myRole,
    // 92.md rec round — forward ownership + granular perms so tabs can grant members
    // with a specific permission (e.g. canManageDuplicates) the same controls the
    // server already allows them to use.
    isOwner: project.isOwner,
    perms: project.perms || {},
    canScreen: project.canScreen,
    canChat: project.canChat,
    canResolveConflicts: project.canResolveConflicts,
    // 107.md rec — the two GLOBAL management flags the server has always sent
    // (screeningController.getProject) and this literal never forwarded.
    canManageMembers: !!project.canManageMembers,
    canManageSettings: !!project.canManageSettings,
    blindMode: project.blindMode,
  };
}

/**
 * canEditScreeningKeywords — may this user mutate the project's keyword lists?
 *
 * Mirrors the server gate exactly (`keywordOps`/`updateProject` require
 * `access.canManageSettings`, and `getProjectAccess` already resolves that to `true`
 * for the owner and every leader). `isLeader` is kept as a defensive second source:
 * it was the pre-107 gate for the KeywordEditor, so a payload that somehow omits the
 * granular flag degrades to the old behaviour instead of hiding every control.
 *
 * @param {object|null|undefined} access
 * @returns {boolean}
 */
export function canEditScreeningKeywords(access) {
  return !!(access?.canManageSettings || access?.isLeader);
}
