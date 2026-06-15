# Members & Permissions UI Unification (prompt24 Task 6)

[FROM: Lead] [TO: Team] [TOPIC: single shared MembersTab in Screening Settings + Project Control, v3.6.0]

## Problem

Two separate members UIs existed for the same underlying data:

| Location | Implementation |
|----------|---------------|
| Screening Settings (`SiftProject` → Settings tab) | `MembersTab` — polished, grouped (Owner ▸ Leaders ▸ Members ▸ Viewers via `groupMembers`), role badges, permission presets, live presence/activity, add-member modal, invite link |
| Project Control (`ControlTab` in monolith) | Bespoke flat list — `CtrlMemberRow`, `CtrlAddMember`, `CtrlPermDot` functions, `CTRL_ROLE_TAG` / `CTRL_PERM_GROUPS` / `CTRL_ADD_PRESETS` / `CTRL_MODULE_OPTIONS` constants, separate mutation state, orphaned remove-confirm modal (~200 lines total) |

Both operated on the same linked `ScreenProject` via `screeningApi`, but had
diverged in visual quality, role-grouping logic, and live-presence support.
Maintaining two implementations for the same data source was a drift risk.

## Solution

The `MembersTab` from Screening Settings is now the **shared component** used
in both locations.

### Changes to `MembersTab`

One new prop added:

```ts
leaveRedirect?: string   // default: '/sift-beta'
```

When a user clicks "Leave project", they are redirected to `leaveRedirect`.
Screening Settings passes the default (`/sift-beta`); Project Control passes
`'/app'` so the user lands back on the META·LAB project dashboard.

No other interface changes.

### Changes to `ControlTab` (monolith)

All bespoke members code was deleted:

- Functions removed: `CtrlMemberRow`, `CtrlAddMember`, `CtrlPermDot`
- Constants removed: `CTRL_ROLE_TAG`, `CTRL_PERM_GROUPS`, `CTRL_ADD_PRESETS`,
  `CTRL_MODULE_OPTIONS`
- State/helpers removed: member-mutation state, remove-confirm modal

Replacement (single line):

```jsx
<MembersTab pid={lid} ... presence={presence} leaveRedirect="/app" />
```

Where `lid` is the linked ScreenProject id and `presence` is the presence data
from the universal header's `useProjectPresence` hook.

### Single source of truth

Both hosts now call the same `screeningApi` endpoints — no API divergence. Role
grouping (`groupMembers`), permission preset logic, invite-link generation, and
live presence/activity indicators are identical in both places.

## Live presence in Project Control

Because the universal header now manages presence (Task 4), the `presence` prop
is available to `ControlTab` without any additional hooks. Members in Project
Control now see the same green "Active now · \<location\>" and "editing
\<field\>" indicators as in Screening Settings.

## File reference

| File | Change |
|------|--------|
| `meta-lab-3-patched.jsx` (`ControlTab`) | Deleted ~200 lines of bespoke members code; replaced with `<MembersTab pid={lid} presence={presence} leaveRedirect="/app"/>` |
| `src/frontend/screening/tabs/MembersTab.jsx` | Added `leaveRedirect` prop (default `'/sift-beta'`); no other changes |

## Known limitations

- `MembersTab` is named and located under `src/frontend/screening/tabs/` but is
  now a de-facto shared project component. Renaming/moving it to a clearly
  shared location (e.g. `ProjectMembersPanel`) is listed as a recommended next
  step.
- The component still depends on `screeningApi`; a META·LAB project must have a
  linked ScreenProject for the members UI to function. This was true of both the
  old and new implementations — no regression.

## QA results

- Unit suite: **719 passed / 6 pre-existing failures**.
- `vite build` green.
- Members tab feature set (grouping, role badges, add-member modal, invite
  link, leave-project redirect) verified by code review against the pre-existing
  MembersTab implementation which was already confirmed working in Screening
  Settings.
