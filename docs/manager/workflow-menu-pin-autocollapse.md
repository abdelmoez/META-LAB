# Workflow Menu — Pin / Auto-collapse — prompt39 Tasks 5/6/7

## The two independent controls
1. **Header arrow** (existing, `ProjectHeaderBar`) — manual **collapse/expand now**.
   Open ⇒ left chevron, tooltip "Collapse workflow menu". Collapsed ⇒ chevron rotates
   180°, tooltip "Expand workflow menu". `aria-expanded` reflects state. Unchanged.
2. **Pin toggle** (new, in the sidebar "Workflow" section header) — chooses whether
   the menu **auto-collapses during workflow navigation**. Pin icon; tooltip
   "Pin workflow menu open" (when auto) / "Allow auto-collapse during workflow"
   (when pinned); `aria-pressed` reflects state; the icon is upright when pinned and
   tilted 45° when in auto mode. Saved per-user automatically (no save button).

These are deliberately separate: **arrow = act now**, **pin = policy for navigation**.

## Preference model
- `workflowMenuMode: "pinned" | "auto"` — **server-backed, per-user, cross-device**,
  mirroring `themePreference`:
  - Column `User.workflowMenuMode String?` (nullable → `prisma db push` additive-safe;
    `null` ⇒ `"auto"`, the prior default — existing users are not surprised).
  - Returned by `GET /api/auth/me` (so it's available on app init via `useAuth`).
  - Persisted by `PUT /api/profile` (validated: `"pinned" | "auto" | null`).
  - The monolith reads `authUser.workflowMenuMode`, and on toggle does an optimistic
    `setUser(...)` + best-effort `api.profile.update({workflowMenuMode})`.

## Behavior
- **Pinned:** the menu stays open; navigating between workflow steps (left-menu item
  or "Next" button) does **not** auto-collapse it. Toggling to pinned also expands it
  immediately, and an effect re-expands it after async auth load / on the pinned
  state. The arrow can still manually collapse it (act-now), per Task 7.
- **Auto:** navigating TO a workflow step auto-collapses the menu into focus mode
  (the prior behavior). Overview / Project Control never collapse.

## Centralized rule (Task 6)
All collapse logic lives in one pure, unit-tested module —
`src/frontend/pages/workflowMenu.js`:
- `makeWorkflowMenuRules(TABS)` → `{ isWorkflowFocusRoute, isNonCollapsingProjectRoute,
  shouldAutoCollapseWorkflowMenu, workflowTabIds, projectTabIds }`.
- `shouldAutoCollapseWorkflowMenu({toId, mode})` =
  `mode !== "pinned" && !isNonCollapsingProjectRoute(toId) && isWorkflowFocusRoute(toId)`.
- The monolith binds these to its `TABS` config; `goTab()` is the single gatekeeper
  used by both the left-menu workflow items and the "Next step" button. No
  auto-collapse conditions are scattered across pages.

## Tests
`tests/unit/workflowMenu.test.js` — classification + the auto/pinned decision +
`normalizeWorkflowMenuMode` (10 cases): auto collapses on workflow steps; pinned
never collapses; Overview/Project Control/reference tabs never collapse.

## Limitations
- The menu **open/collapsed** state itself stays per-browser `localStorage`
  (`metalab.navCollapsed`); only the pin/auto **mode** is cross-device. That is
  intentional: collapsed state is ephemeral session UI, mode is a real preference.
- Backend persistence is best-effort (a failed PUT leaves the optimistic UI choice
  for the session; it re-syncs on next successful save / `getMe`).
