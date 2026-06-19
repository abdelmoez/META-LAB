# RoB workspace — 70/30 resizable PDF / assessment split (prompt36 Task 1)

*META·LAB internal — v3.17.0 → 3.18.0. Date: 2026-06-18.*

File: `src/frontend/rob/RobWorkspace.jsx`.

---

## Purpose

The Risk-of-Bias 2 workspace shows the study PDF on the left and the assessment
engine (signalling questions, proposals, override) on the right. The previous
split was a fixed ~60/40. Reviewers wanted **more room to read the PDF** and the
ability to **rebalance the two panes** per their screen and task. This update sets
the default to **70 % PDF / 30 % assessment** and makes the divider between them
**draggable**, keyboard-operable, and persistent — without introducing per-frame
React re-renders that would lag on weaker machines.

---

## The 70/30 design + ratio bounds

The split is expressed as a single **PDF fraction** (`ratio`), the share of the
row width given to the PDF column. Three module constants govern it:

| Constant | Value | Meaning |
|---|---|---|
| `SPLIT_DEFAULT` | `0.70` | Opens 70 % PDF / 30 % assessment |
| `SPLIT_MIN_PDF` | `0.45` | PDF never narrower than 45 % |
| `SPLIT_MAX_PDF` | `0.72` | PDF never wider than 72 % ⇒ assessment never below ~28 % |

`clampSplit(v)` (exported, unit-tested) clamps any candidate ratio into
`[0.45, 0.72]`. The upper bound is deliberately close to the default so the
assessment pane — which holds the segmented answer controls and the "Algorithm
proposes" panel — can never be squeezed to an unusable width. The lower bound
guarantees the PDF stays legible even when a reviewer drags toward the assessment
side.

---

## The no-re-render resize technique

Dragging a divider naively means writing a new width to React state on every
`pointermove`, which re-renders the whole workspace (PDF iframe, rail, question
cards) dozens of times per second — visibly laggy on weak hardware. This
implementation avoids that entirely:

- The grid column template uses a **CSS custom property**:
  `var(--rob-pdf-pct, <ratio>%) 16px minmax(0, 1fr)` — PDF track, a fixed 16 px
  divider track, then the assessment track.
- The `useResizableSplit(rowRef)` hook holds `ratio` in React state but **only
  reads it on mount** and **only writes it on pointer-up**.
- During a drag, each `pointermove` computes the new clamped ratio and schedules
  **one `requestAnimationFrame`** that writes `--rob-pdf-pct` straight onto the
  row element's inline style (`el.style.setProperty`). The CSS grid recomputes the
  column widths natively — **no React render runs**.
- On `pointerup`, the hook commits the final ratio to state (`setRatio`) and
  persists it. That is the **only** React state change of the whole drag.
- While dragging, `document.body` gets `user-select: none` and `cursor:
  col-resize` so text selection and cursor flicker don't fight the drag; both are
  cleared on pointer-up.

Net effect: a single rAF-throttled style mutation per frame, lag-free regardless
of how heavy the rest of the tree is.

---

## Persistence

The committed ratio is written to `localStorage` under the key
`metalab.rob.splitRatio` (as a string). On mount, `readSplitRatio()` parses it and
accepts the stored value only if it is within `[SPLIT_MIN_PDF, SPLIT_MAX_PDF]`;
anything missing, malformed, or out of range falls back to `SPLIT_DEFAULT` (0.70).
All `localStorage` access is wrapped in `try/catch` so a privacy-restricted
browser degrades to the default rather than throwing.

This is a **per-browser** preference (see Known limitations), not a per-user
server setting.

---

## The divider: accessibility, keyboard, double-click

`ResizeDivider` (exported) renders the 16 px gutter and its visible handle:

- **Roles / ARIA**: `role="separator"`, `aria-orientation="vertical"`,
  `aria-valuemin={45}`, `aria-valuemax={72}`,
  `aria-valuenow={round(ratio*100)}`, plus an `aria-label`
  ("Resize the PDF and assessment panels"). `tabIndex={0}` makes it focusable.
- **Keyboard**: with the divider focused, **←** and **→** nudge the ratio by
  ±2 % (`split.nudge(±0.02)`, clamped + persisted), and **Home** resets to the
  70/30 default.
- **Double-click** the divider resets to 70/30 (`split.reset`).
- **Affordance**: `cursor: col-resize`, `title="Drag to resize panels ·
  double-click to reset"`, `touchAction: 'none'` for pointer/touch drags. The
  handle is a subtle 3 px bar that brightens (to ~5 px, accent colour, with a
  soft focus ring) on hover or during a drag.
- **Reduced motion**: the handle's `transition` is disabled when
  `prefers-reduced-motion: reduce` is set (the hook `usePrefersReducedMotion`
  feeds a `reduced` flag into the divider).

---

## Responsive stacking + PDF hidden

- Below `STACK_BELOW` (900 px viewport width, via `useViewportNarrow`), the
  workspace **stacks to a single column** (flexbox, PDF above the assessment) and
  the `ResizeDivider` is **not rendered** — there is nothing to resize when the
  panes are stacked.
- When the reviewer hides the PDF with the existing **"Hide source"** toggle (or
  the admin disables the PDF panel), the row collapses to a single `1fr` column
  and, again, the divider is not shown.
- The split grid (and divider) therefore render **only** in the wide,
  side-by-side layout with the PDF visible.

The row still lives inside the full-height workspace introduced in prompt34
(`useFillViewportHeight`), so the PDF iframe fills its column and the assessment
scrolls internally — the page itself does not scroll.

---

## Tests

`tests/unit/rob-workspace-ui.test.jsx`:

- `clampSplit` bounds — values below 0.45 clamp up, above 0.72 clamp down,
  in-range values pass through.
- `ResizeDivider` SSR render — asserts the a11y contract
  (`role="separator"`, `aria-orientation`, `aria-valuemin/max/now`, focusable)
  on a server-rendered snapshot.

The DOM-interaction parts (actual pointer drag, the rAF CSS-var write) are covered
by `npm run build` + manual QA — the test infra is SSR-only.

---

## Known limitations

- The split ratio is a **per-browser `localStorage` value**, not synced per user
  across devices. A reviewer using two machines sets it independently on each.
- The drag is pointer-based; on touch-only devices the keyboard nudge / reset
  path (or the stacked layout under 900 px) is the fallback.
