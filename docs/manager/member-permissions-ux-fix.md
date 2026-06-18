# Member permission UX — no reload / no jump-to-top (prompt33 Task 1)

## Root cause
In `src/frontend/screening/tabs/MembersTab.jsx`, the per-member patch helper did:
```
await screeningApi.updateMember(pid, mid, body);
await load();           // ← the bug
```
`load()` sets `loading = true`, and the component early-returns `<Loading/>` while loading — so the **entire roster unmounts to a spinner** on every permission toggle. Consequences: the open "Advanced permissions" panel (local `showAllPerms` state inside `MemberRow`) was destroyed, every row re-rendered/collapsed, and the scroll position reset to the top.

## How it works now
- **Optimistic, in-place update — no reload.** `patchMember` now: (1) merges the change into just that one member in `members` state (instant), capturing the previous value for revert; (2) calls `updateMember`; (3) reconciles in place from the server's returned `{ member }` (so a role/preset change applies all its flags); (4) on error, reverts that member and shows a per-row error. The roster never unmounts, React keys are stable (`m.id`), so **scroll position and open panels are preserved** and other rows don't re-render into a spinner.
- **Expanded state lifted to the parent.** `expandedIds` (a `Set` of member ids) lives in `MembersTab`; `MemberRow` receives `expanded` + `onToggleExpand`. So even a deliberate full reload (add/remove member) keeps which panels were open.
- **Per-member feedback.** Each row shows `saving…` while a save is in flight and `✓ Saved` for ~1.6s after success.
- **No parent churn.** A permission toggle no longer calls `refreshProject` (it changes neither membership count nor owner/status), so nothing above the panel re-renders.
- **Backend still enforces everything.** `updateMember` (server) re-checks owner/leader/global-flag rules on every call; the optimistic UI is display-only.

## QA
- Expand a member → scroll down → toggle a permission: no reload, no jump, panel stays open, the toggle reflects instantly, `✓ Saved` appears, and it persists after a hard refresh.
- Toggling several permissions quickly works (each is an independent optimistic patch).
- Failure path: on a rejected save the toggle reverts to its prior value and a red row-error shows.
- Owner/leader/reviewer/viewer: unchanged authorization — the server 403s an unauthorized change and the optimistic value reverts.

## Known limitations
- The app's test infra is SSR-only (no DOM-interaction harness), so this is covered by build + manual QA rather than a React render test. The backend authorization it relies on is covered by the existing member integration tests.
