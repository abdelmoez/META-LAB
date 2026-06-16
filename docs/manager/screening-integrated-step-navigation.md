# Screening — Integrated Step Navigation (prompt25 Task 6)

*META·LAB internal — v3.6.3 → 3.7.0. Date: 2026-06-15.*

---

## Problem

The left navigation column of the screening workspace (`SiftProject.jsx`) rendered
each stage as two separate, visually adjacent but logically independent controls:

1. A **clickable title `<button>`** that triggered navigation.
2. A **non-clickable `<StepIndicator>`** sibling that displayed step number, count,
   and status (e.g. "2 / 5 · In progress").

The `StepIndicator` had no pointer events and was visually indistinguishable from
the title button. Users clicking on the indicator — which looked interactive —
received no feedback. Screen-reader users encountered two sequential focusable
elements that represented one logical action, with no `aria-current` on the outer
control.

---

## Fix

### `src/frontend/screening/pages/SiftProject.jsx` — `navCol` items

Each navigation item is now a **single `<button>` wrapping the entire row**:
icon + title text + `StepIndicator`. Key implementation details:

- **Single click target.** The outer `<button>` is the only element that receives
  pointer events and focus. `hover` is applied via `e.currentTarget` to keep
  styling consistent regardless of which child the cursor enters.
- **`title` div has `pointerEvents: none; color: inherit`.** This prevents the
  title sub-div from capturing click/hover events separately, while inheriting
  the button's active/hover colour.
- **`StepIndicator` is unchanged.** `Stepper.jsx` remains a pure display
  component. It receives the same `step`, `count`, and `status` props as before;
  no internal change was made.
- **`aria-current="page"`** is set on the active item's button, satisfying ARIA
  landmark navigation requirements.
- **Native keyboard access.** Because the wrapper is a `<button>`, `Enter` and
  `Space` both trigger navigation without additional key-handler code.

### Before / after comparison

| Aspect | Before | After |
|---|---|---|
| Click target | Title `<button>` only | Entire row (icon + title + step indicator) |
| `StepIndicator` interactivity | `pointerEvents: none` sibling | Still `pointerEvents: none` but inside the wrapper button |
| Keyboard navigation | Tab → title button only | Tab → full row button |
| `aria-current` | None | `"page"` on active item |
| Hover state | Title element only | Full row via `e.currentTarget` |
| Duplicate control appearance | Yes (two adjacent "buttons") | No |

---

## Components affected

| File | Change |
|---|---|
| `src/frontend/screening/pages/SiftProject.jsx` | `navCol` item restructured to single `<button>` wrapper |
| `src/frontend/screening/components/Stepper.jsx` | **Unchanged** — pure display |

---

## Known limitations

1. **Step indicator counts depend on upstream data.** The `step` / `count` values
   shown in `StepIndicator` are supplied by the parent and are only as accurate as
   the data model. If study counts are stale (e.g. immediately after a bulk
   import), the indicator may show outdated numbers until the next fetch.
2. **No hover animation.** The row hover is a colour change only (no scale or
   translate). A subtle motion effect could improve discoverability but was
   intentionally kept minimal to match the existing design token set.

---

## QA results

| Scenario | Expected | Result |
|---|---|---|
| Click on step indicator region | Navigates to that stage | ✅ |
| Click on title text | Navigates to that stage | ✅ |
| Click on icon | Navigates to that stage | ✅ |
| Tab to item, press Enter | Navigates to that stage | ✅ |
| Tab to item, press Space | Navigates to that stage | ✅ |
| Active item | `aria-current="page"` present | ✅ |
| Screen reader (NVDA/VoiceOver spot check) | Single button announced per stage | ✅ |
| `StepIndicator` internal state | No regression (counts/status unchanged) | ✅ |
