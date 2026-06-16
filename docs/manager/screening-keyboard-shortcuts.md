# Screening — Keyboard Shortcuts (prompt25 Task 7)

*META·LAB internal — v3.6.3 → 3.7.0. Date: 2026-06-15.*

---

## Overview

Reviewers can now navigate and decide on screening records entirely from the
keyboard. Shortcuts are **per-user, server-persisted, and fully configurable** via
the Profile settings page. A safe key-capture UI prevents conflicting bindings.

---

## Default shortcuts

| Action | Default key |
|---|---|
| Next record | `ArrowRight` |
| Previous record | `ArrowLeft` |
| Include | `i` |
| Exclude | `e` |
| Maybe | `m` |
| Undo | `u` |

---

## Architecture

### Storage model

A new nullable `screeningShortcuts` column (`String?`, JSON-encoded) was added to
the `User` table via a db-push-safe migration (nullable, no `@unique`, additive).
It mirrors the existing `User.dashboardPreferences` pattern.

```
User.screeningShortcuts  →  JSON string  →  { next, previous, include, exclude, maybe, undo }
```

### New files

| File | Purpose |
|---|---|
| `src/frontend/screening/screeningShortcuts.js` | `DEFAULT_SCREENING_SHORTCUTS`, `sanitize()`, `parse()`, `keyLabel()` utility |
| `src/frontend/screening/hooks/useScreeningShortcuts.js` | Single `window` `keydown` listener; attaches/detaches on mount/unmount |
| `tests/unit/screeningShortcuts.test.js` | 5 unit tests covering sanitize / parse / keyLabel |

### `useScreeningShortcuts` guards

The hook ignores keydown events when **any** of these conditions are true:

- The active element is an `<input>`, `<textarea>`, `<select>`, or
  `[contenteditable]` node.
- The active element has the `.sift-in` class (screening decision inputs).
- The event carries `Ctrl`, `Meta`, or `Alt` modifiers.
- The `disabled` option is `true` (passed by `ScreeningTab` when no record is
  loaded or the user has shortcuts turned off).

### Backend (`server/controllers/profileController.js`)

- `GET /api/profile` — returns `screeningShortcuts` alongside existing profile
  fields.
- `PUT /api/profile` — validates the incoming value as a JSON object or `null`;
  enforces a ≤500-char serialised length; stores it on the `User` row.

---

## Client-side caching

`ScreeningTab` loads shortcut preferences from `/api/profile` on mount and writes
a **per-user localStorage cache** (`metalab.screeningShortcuts.<userId>`). The
cache is read first on next load for instant key binding, then overwritten by the
fresh server response. This means:

- Preferences are available offline / before the profile fetch resolves.
- Two accounts on the same browser use separate cache keys and never collide.
- Cross-device sync depends on `/api/profile` loading (the cache may briefly lag
  by one session on a new device).

---

## Profile settings UI (`src/frontend/pages/Profile.jsx`)

A new **"Screening Shortcuts"** section provides:

| Control | Behaviour |
|---|---|
| Enable / disable toggle | Turns shortcuts on or off without clearing the configuration |
| Per-action key capture | Click a field → press any key → key is recorded (displays `keyLabel()` friendly name) |
| Duplicate-key validation | Inline error blocks save if two actions share the same key |
| Reset to defaults | Restores `DEFAULT_SCREENING_SHORTCUTS` in the form (not saved until the user clicks Save) |
| Save | `PUT /api/profile` → updates server record + refreshes localStorage cache |

---

## Key hints in `ScreeningTab`

When shortcuts are enabled, the key binding is shown as a small hint label on
the Include / Exclude / Maybe decision buttons and the Previous / Next navigation
controls. The hint disappears when shortcuts are disabled.

---

## Tests

`tests/unit/screeningShortcuts.test.js` — 5 tests:

| Test | Description |
|---|---|
| `sanitize` with valid object | Returns cleaned object with only known keys |
| `sanitize` with unknown keys | Strips unknown keys, keeps valid ones |
| `sanitize` with null/undefined | Returns `DEFAULT_SCREENING_SHORTCUTS` |
| `parse` with JSON string | Deserialises correctly |
| `keyLabel` friendly names | `ArrowRight → →`, `i → I`, `Escape → Esc`, etc. |

---

## Known limitations

1. **Cross-device cache lag.** The localStorage cache on a second device is stale
   until `/api/profile` loads on that device. During that window (typically < 1 s)
   the old bindings apply. A server-push on profile save would eliminate this.
2. **No browser-shortcut conflict detection.** The key-capture UI prevents
   *intra-app* duplicates but does not warn when a captured key conflicts with a
   browser shortcut (e.g. `Ctrl+W`). The `Ctrl`/`Meta`/`Alt` guard partially
   mitigates this by ignoring modified keys at runtime.
3. **Single window listener per tab.** If two screening tabs are open in the same
   browser window (unusual), both listeners fire. The second tab's shortcuts have
   no visible effect if it is not in focus, but the event still propagates.
4. **No import/export of shortcut profiles.** Custom shortcut sets cannot be
   shared between user accounts.

---

## QA results

| Scenario | Expected | Result |
|---|---|---|
| Press `i` on a loaded record | Record marked Include | ✅ |
| Press `e` on a loaded record | Record marked Exclude | ✅ |
| Press `m` on a loaded record | Record marked Maybe | ✅ |
| Press `u` | Last decision undone | ✅ |
| Press `ArrowRight` / `ArrowLeft` | Next / previous record | ✅ |
| Focus inside a text input, press `i` | No action (guard active) | ✅ |
| Duplicate key set in Profile | Inline error, Save blocked | ✅ |
| Reset to defaults | Default keys restored in form | ✅ |
| Save → logout → login | Shortcuts preserved from server | ✅ |
| Disable toggle → shortcuts off | Keys produce no screening action | ✅ |
| Unit tests | 5/5 pass | ✅ |
