# Dynamic Owner Display Name (prompt25 Task 5)

*META·LAB internal — v3.6.3 → 3.7.0. Date: 2026-06-15.*

---

## Problem

Several surfaces displayed a stale owner/member name after the account holder
changed their display name. The root cause was that Prisma project rows carry a
denormalised `ownerId` (not the live `User.name`), and several code paths
constructed the displayed name from the stored member row rather than the live DB
record. Specifically:

- **Members list** — `screeningMemberController.listMembers` built each member
  shape from the stored `member` row. If a user had since renamed their account,
  the old name appeared for the owner row and for ordinary member rows.
- **Monolith ControlTab** — the "Owner" field sourced its value from
  `project.ownerName` (a denormalised string written at project creation).
- **SiftDashboard** — used `project.owner.name` but fell back to the project's
  stored `ownerId` string if the relation was not eagerly loaded.
- **AdminConsole project list/detail** — the backend `getProjects` already joins
  the live `User` via Prisma, so this surface was already correct and unchanged.

---

## Fix

### `server/controllers/screeningMemberController.js`

`listMembers` now **batch-resolves live `User` records** (one `findMany` keyed on
the user IDs present in the member list) before shaping each member object.

`shapeMember` prefers the live `User.name` and `User.email` over the denormalised
values stored on the member row. Fallback chain: `User.name → User.email`. The
owner row benefits from the same resolution: the owner's current display name
appears even if they renamed after the project was created.

### `src/frontend/screening/pages/SiftProject.jsx` (SiftDashboard)

Owner display prefers `project.owner.name` (the live relation already returned by
`getProject`). Fallback: `project.owner.email`.

### Monolith `ControlTab`

The "Owner" field now reads from `project._owner` (the live `_owner` object
resolved by `projectsController.annotateShared`) rather than the denormalised
`project.ownerName` string. Fallback: `project._owner.email`.

### Already-correct surfaces (unchanged)

`projectsController.annotateShared` already called `prisma.user.findUnique` for
`_owner` on every `list`/`getProject` call — the monolith project list and project
overview were already live. No change was required there.

---

## Live-name update latency

| Surface | Update lag after rename |
|---|---|
| Project list / overview (`annotateShared`) | Immediate — live DB query per request |
| Monolith ControlTab "Owner" | Immediate (reads `_owner` from same request) |
| Members list (`listMembers`) | Immediate — batch live User query per request |
| SiftDashboard | Immediate — reads `project.owner.name` from `getProject` response |
| Presence popover / field-lock label | ≤60 s (presence name-cache TTL; see Task 3 in final report) |

---

## Display fallback chain

All surfaces enforce the same priority:

```
User.name  →  User.email  →  (never rendered empty)
```

No surface shows a raw user ID or an empty string.

---

## Known limitations

1. **Presence name-cache lag.** The presence heartbeat path caches the live user
   name for ≤60 s (to avoid a DB hit on every heartbeat). A rename propagates to
   presence popover and field-lock labels within one cache TTL cycle. The project
   list and members panel are unaffected (they are request-resolved).
2. **Denormalised `ownerName` column is not removed.** The `Project.ownerName`
   column still exists in the schema for historical/export purposes. It is no
   longer used for UI display. A future migration could drop it once all consumers
   have confirmed the live path.

---

## QA results

| Scenario | Expected | Result |
|---|---|---|
| Rename account → reload project list | New name shown on owner chip | ✅ |
| Rename account → open Members panel | New name shown in owner row and own member row | ✅ |
| Rename account → open ControlTab | New name shown in Owner field | ✅ |
| Rename account → open SiftDashboard | New name shown in project header | ✅ |
| Rename account → presence popover | New name shown within 60 s | ✅ |
| User with no display name | Email shown as fallback (never blank) | ✅ |
