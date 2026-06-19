# Workflow menu auto-collapse + directional arrow toggle (prompt36 Tasks 3 & 4)

*META·LAB internal — v3.17.0 → 3.18.0. Date: 2026-06-18.*

File: `meta-lab-3-patched.jsx` (the main workspace monolith).

---

## Purpose

The project workspace has a left workflow sidebar (Plan → Search → Screen →
Extract → Analyze → Report, plus Overview and Project Control). It already
supported an **animated collapse into focus mode** (the sidebar slides out, the
content reclaims the width). This update:

- **Task 3** — automatically collapses the sidebar when the user navigates into a
  **workflow step**, so the chosen step gets maximum width without a manual
  click. Overview and Project Control never trigger this.
- **Task 4** — replaces the ambiguous ☰ hamburger collapse control with a
  **directional arrow** that visibly points the way the menu will move, with a
  state-aware tooltip and ARIA.

---

## Task 3 — the auto-collapse rule

A module-level set identifies the real workflow steps:

```js
const WORKFLOW_TAB_IDS = new Set(TABS.filter(t => t.phase).map(t => t.id));
```

Every workflow step (Plan/Search/Screen/Extract/Analyze/Report tabs) carries a
`phase`; **Overview** and **Project Control** have `phase: null`. So
`WORKFLOW_TAB_IDS` = "every tab that is part of the main workflow."

Navigation into a workflow step goes through a small helper:

```js
const goTab = (id) => { setTab(id); if (WORKFLOW_TAB_IDS.has(id)) setNavCollapsed(true); };
```

`goTab` always switches the tab, and **only** collapses the menu when the target
is a workflow step. Overview / Project Control navigation continues to use plain
`setTab(...)`, so those two never auto-collapse — the user keeps the full sidebar
when sitting on the project's home/admin surfaces.

`goTab` is wired into exactly the **two triggers** the spec calls for:

1. The **sidebar workflow step items'** `onClick` (clicking a step in the list).
2. The **"Next" step button** (advancing to the next workflow phase).

Other navigation paths (e.g. the Overview "Go to Screening →" style buttons) are
intentionally left on plain `setTab` and do not auto-collapse.

### Animation

The collapse uses the **existing** animated mechanism, now also fired
automatically:

- The sidebar (`className="ml-sidebar"`) slides out via
  `transform: translateX(-100%)` with a `0.25s ease` transition.
- The main content (`className="ml-main"`) reclaims the space via `marginLeft`
  (256 → 0) with a matching `0.25s ease` transition.

### Why focus mode

Workflow steps are the working surfaces (screening grid, extraction table,
analysis/forest, RoB, PRISMA). Auto-collapsing the navigation the moment a user
commits to a step gives those data-heavy views the full viewport width without an
extra click, while keeping the sidebar present on the lighter Overview / Project
Control pages where navigation is the point.

---

## Task 4 — the directional arrow toggle

The universal `ProjectHeaderBar` collapse control changed from a ☰ hamburger to a
**chevron arrow** that rotates to indicate direction:

- It renders `<Icon name="chevronLeft" size={16}>` wrapped in
  `<span className="ml-menu-arrow">`.
- When the menu is **open**, the chevron points **left** (collapse direction) and
  the tooltip reads **"Collapse workflow menu"**.
- When **collapsed** (focus mode), the span rotates **180°** so the chevron points
  **right** (expand direction) and the tooltip reads **"Expand workflow menu"**.
- The rotation is a `transform: rotate(180deg)` with a `0.2s var(--ease-out)`
  transition (smooth swap, no icon swap/flicker).

### Tooltip + ARIA

- The button is wrapped in the app's portal `<Tooltip>` (theme-aware, day/night),
  so the label floats above other chrome.
- It carries a **state-aware `aria-label`** ("Collapse workflow menu" /
  "Expand workflow menu") and **`aria-expanded={!focus}`**, so assistive tech
  reports whether the menu is currently expanded.
- The button itself styles as accented when collapsed (so the control reads as
  "active / toggled") and neutral when the menu is open.

---

## Reduced motion

A new CSS rule was added to the monolith's style block:

```css
@media (prefers-reduced-motion: reduce) {
  .ml-sidebar, .ml-main, .ml-menu-arrow, .ml-switch-knob { transition: none !important; }
}
```

This disables the sidebar slide, the content margin shift, the arrow rotation, and
(see Task 5 / `project-control-switch-settings.md`) the switch knob animation for
users who request reduced motion. State still changes instantly; only the
animation is removed.

---

## Tests / verification

This is JSX layout + CSS in the monolith; covered by `npm run build` (green) and
manual QA. No dedicated unit test (the monolith is not DOM-unit-tested).

---

## Known limitations

- Auto-collapse fires only on the **two specified triggers** (sidebar step click,
  "Next" button). Cross-navigation buttons on other surfaces (e.g. Overview's
  "Go to X" buttons) still use plain `setTab` and do not auto-collapse — by
  design, to avoid surprising collapses from unrelated navigation.
- The collapsed/expanded state itself is the existing `navCollapsed` / focus state
  (persisted as before); this task only adds the automatic *trigger* and the new
  arrow affordance.
