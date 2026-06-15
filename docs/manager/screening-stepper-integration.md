# Screening Workflow Stepper — Integration (prompt21)

[FROM: Lead Architect] [TO: Team]
[TOPIC: New Stepper component — placement, status logic, data source, theme/a11y, no-deps decision, known limitation]

---

## 1. What the stepper is

A horizontal, scrollable progress indicator mounted inside the embedded Screening workspace. It shows six steps in review-flow order:

**Import → Duplicates → Title & Abstract → Conflicts → Final Review → Data Extraction**

Each step carries a status badge (done / active / attention / pending) and the current sub-tab step is highlighted. Steps are keyboard-navigable (Enter/Space, `role="button"`, `aria-current`). Data Extraction is a status-only terminal step — it lives outside the Screening stage and is therefore not clickable.

## 2. New files

| File | Purpose |
|---|---|
| `src/frontend/screening/ui/Stepper.jsx` | React component; theme-aware via `C` tokens + `alpha()`; reuses in-house `<Icon>` |
| `src/frontend/screening/ui/screeningSteps.js` | Pure function `buildScreeningSteps(summary)` — React-free so it is unit-testable |

No new npm dependencies were added. The stepper is built with JS + inline styles + theme tokens only. No TypeScript, no Tailwind, no shadcn, no lucide, no cva, no radix, no `cn` helper.

## 3. Placement in SiftProject.jsx

The stepper is mounted in `src/frontend/screening/pages/SiftProject.jsx` (embedded mode only):

- **Below** the screening sub-nav
- **Above** the subpage content area

`SiftProject` fetches `screeningApi.getOverview(pid).dataSummary` into a `summary` state variable and passes it to `<Stepper>`. That fetch is refreshed alongside the project on every `refreshProject()` call, so the stepper stays live after accept / exclude / revert / SSE `handoff.updated` poke.

Clickable steps call `setTab(key)` (the same setter used by the sub-nav), which writes the canonical `?screen=` param — no separate routing layer.

## 4. Status logic (buildScreeningSteps)

Source: `src/frontend/screening/ui/screeningSteps.js`. Inputs come from `getOverview().dataSummary`. Status values mirror the existing `PROGRESS_BADGE` colour convention.

| Step | done | active | attention | pending |
|---|---|---|---|---|
| Import | `totalArticles > 0` | — | — | no records yet |
| Duplicates | no unresolved groups | — | `unresolvedDuplicateGroups > 0` | no records yet |
| Title & Abstract | `eligibleSecondReview > 0 \|\| decided > 0` | otherwise (records exist) | — | no records yet |
| Conflicts | no unresolved conflicts | — | `unresolvedConflicts > 0` | — |
| Final Review | `finalRemaining === 0` (and eligible > 0) | `finalRemaining > 0` | — | none eligible yet |
| Data Extraction | `acceptedToExtraction > 0` | — | — | nothing sent yet |

`finalRemaining = eligibleSecondReview − (acceptedToExtraction + rejectedSecond)`

Colour mapping: pending = muted, active = accent, done = green, attention = gold.

## 5. Theme and accessibility

- All colours use `C` token variables (`--t-*`) + `alpha()` — no hardcoded hex. Re-themes live in both day and night modes.
- Steps carry `role="button"`, `tabIndex={0}`, `aria-current="step"` (active step only), and `aria-disabled="true"` (Data Extraction non-clickable terminal step).
- Keyboard: Enter and Space activate clickable steps.
- Layout: horizontal flex with `overflow-x: auto` and `scroll-behavior: smooth` — scrollable on narrow widths without horizontal page scroll.

## 6. No-deps decision rationale

The screening UI design system uses JS + inline styles + theme tokens throughout (`SiftProject`, `SecondReviewTab`, `OverviewTab`, etc.). Adding Tailwind, shadcn, or a radix primitive would create a two-system split inside the same bundle and require resolving `cn`/`cva` at build time. The stepper's needs (flex layout, colour states, keyboard interaction) are fully met by the existing primitives.

## 7. Known limitation (documented)

There is no single project-wide "title/abstract fully screened" or "final-review complete" signal available to every member. Those statuses are **derived** — computed from `eligibleSecondReview` / `decided` counts in the overview summary. `projectProgress` is leader-only and is not used. No fake or estimated progress is shown; if the data is unavailable the step stays at the previous status rather than guessing.
