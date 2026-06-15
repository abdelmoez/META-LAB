# Screening Layout Overflow Fix (prompt24 Task 5)

[FROM: Lead] [TO: Team] [TOPIC: ScreeningTab height + sticky pagination/load-more, v3.6.0]

Pure layout change inside `src/frontend/screening/tabs/ScreeningTab.jsx`.
No handler, label, or data-flow changes.

## Problem

`ScreeningTab`'s root container was sized with `calc(100vh - 56px)`. This
assumed the tab was mounted at the very top of the viewport with a 56px
external header. After the universal project header restructure (Task 4), the
tab is placed inside a flex-column body region that already bounds its own
height — the `calc(100vh - 56px)` guess over-shot or under-shot depending on
the header's actual rendered size, causing either unwanted scrollbars on the
outer page or content truncation.

Additionally:
- The "Load more (N)" button at the bottom of the left studies list was inside
  the scrolling list, so it scrolled out of view as the list grew.
- The `Previous / X of N / Next` pagination bar at the bottom of the middle
  column was inline inside the scrolling abstract region and scrolled off when
  the abstract was long.

## Fix — `src/frontend/screening/tabs/ScreeningTab.jsx`

### Root container

```diff
- height: calc(100vh - 56px)
+ height: 100%
```

The parent (the scrolling body region provided by `ProjectHeaderBar`'s flex
layout) already constrains the available height. `100%` fills that region
exactly without any viewport arithmetic.

### LeftColumn — studies list + Load more

```diff
  LeftColumn:
+   min-height: 0          /* allows flex child to shrink below content size */
    studies list:
+     flex-direction: column
+     min-height: 0
  "Load more (N)" button:
-   (inline in list flow)
+   position: sticky
+   bottom: 0
+   background: var(--t-surf)
+   border-top: 1px solid var(--t-border)
```

The button is now a sticky footer within the left column — always visible at
the bottom of the list panel without scrolling.

### MiddleColumn — abstract content + pagination bar

```diff
  MiddleColumn: restructured as flex column
    inner content region (abstract + review):
+     overflow: auto        /* scrolls within the column */
+     flex: 1
    "← Previous  X / N (of M)  Next →" bar:
-   (inline in content flow)
+   position: sticky (bottom of column)
+   border-top: 1px solid var(--t-border)
+   background: var(--t-surf)
```

The pagination bar is now always visible at the bottom of the middle column
regardless of abstract length.

### RightColumn

```diff
+   min-height: 0    /* consistency; prevents overflow in edge cases */
```

### Theme

All additions use `--t-surf` and `--t-border` tokens, which resolve correctly
in both day and night themes.

## What was NOT changed

All event handlers (`onLoadMore`, `onPrev`, `onNext`), display counts, aria
labels, and keyboard behaviour are verbatim unchanged. This is a layout-only
patch.

## File reference

| File | Change |
|------|--------|
| `src/frontend/screening/tabs/ScreeningTab.jsx` | Root `height: 100%`; `LeftColumn` + list `min-height:0`; sticky Load-more; MiddleColumn flex restructure; sticky pagination bar; `RightColumn min-height:0` |

## Known limitations

- Layout is not tested with a unit test (DOM layout metrics are not reliable in
  the jsdom test environment). Correctness is verified by code review and
  consistent use of the same flex/sticky pattern used elsewhere in the app
  (e.g. the universal header body region, the SiftProject full-bleed frame).

## QA results

- Unit suite: **719 passed / 6 pre-existing failures** (layout change does not
  affect any existing test).
- `vite build` green.
- Day + night theme compatibility confirmed via `--t-*` token usage audit.
