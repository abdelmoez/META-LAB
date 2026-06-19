# Project Control — real on/off switches (prompt36 Task 5)

*META·LAB internal — v3.17.0 → 3.18.0. Date: 2026-06-18.*

File: `meta-lab-3-patched.jsx` (monolith `ControlTab`).

---

## Purpose

In the monolith's Project Control → **"Screening & collaboration"** card, the
**Blind mode** and **Restrict chat** settings were rendered as `ctrlToggle` **text
pill buttons** that just showed the current word ("On"/"Off", "Restricted"/"Open").
They read like status labels, not controls — it was not obvious they were
clickable, and they did not match the app-standard sliding switch used elsewhere.
This task replaces them with a real **`SwitchToggle`** component so both settings
read as proper switches.

---

## The `SwitchToggle` component

A new shared `SwitchToggle` was added to the monolith's shared components,
mirroring the screening `Toggle` switch:

- **Visuals**: a 38 × 22 px track with an 18 px round knob that slides from
  `left:1` (off) to `left:17` (on). On = accent track (`C.acc2`); off = dimmed
  track. A short text label ("On"/"Off", or "Restricted"/"Open") sits beside it.
- **Accessibility**: it is a real `<button type="button">` with `role="switch"`,
  `aria-checked={on}`, and a caller-supplied `aria-label` — so it is
  **keyboard-activatable** (Space/Enter) and announced correctly by assistive
  tech. The old text pill was not a switch and had weaker semantics.
- **Busy state**: a `busy` prop disables the button and dims it during an
  in-flight save.
- **Reduced motion**: the knob's slide `transition` is on the `.ml-switch-knob`
  class, which is disabled under `prefers-reduced-motion: reduce` by the CSS rule
  added in Task 4 (see `workflow-menu-autocollapse.md`).

The now-unused `ctrlToggle` constant was **removed**.

---

## Where it is used

### Project Control (monolith `ControlTab`)

Both settings in the "Screening & collaboration" card now use `SwitchToggle`:

- **Blind mode** — label "On"/"Off", `aria-label` "Blind mode — currently on/off".
  Description unchanged: *"Hide author / journal info from reviewers during
  screening."*
- **Restrict chat** — label "Restricted"/"Open", `aria-label` "Restrict chat —
  currently on/off". Description unchanged: *"When on, only members with the Chat
  permission can post."*

### Both Project Control surfaces now use real switches

The screening-side `ProjectControlTab.jsx` already used the proper `<Toggle>`
switch for these settings. With this change, the **monolith** Project Control
matches it — so both places a user can edit these settings now present identical,
real sliding switches.

---

## Permissions + optimistic save (unchanged)

- Owner / leader gating is unchanged: only `canManageStatus` users see the
  switch; **read-only viewers still see a status badge** (a `tagS` pill showing
  "On/Off" or "Restricted/Open"), not an interactive control.
- Saving still goes through `saveSpSetting(...)` with optimistic update +
  rollback on failure, and still writes to the **linked `ScreenProject`**, which
  remains the single source of truth. The Screening "Settings" tab therefore shows
  the same synchronized values.
- The third setting in the card, **Required reviewers**, is a numeric stepper and
  is unaffected by this change.

---

## Tests / verification

Monolith JSX; covered by `npm run build` (green) + manual QA. No dedicated unit
test (the monolith is not DOM-unit-tested). The `.ml-switch-knob` reduced-motion
rule is covered alongside Task 4.

---

## Known limitations

- This swaps the **control affordance** only; the underlying setting semantics,
  persistence, and gating are unchanged.
- Read-only viewers continue to see a static badge (not a disabled switch), which
  is the existing convention for view-only users in this card.
