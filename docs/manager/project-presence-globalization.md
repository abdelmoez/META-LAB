# Project Presence — Globalization, Popover Portal & Deduplication (prompt24 Tasks 2/3/8/9)

[FROM: Lead] [TO: Team] [TOPIC: presence rewrite — shared component, portal popover, dedup, universal header integration, v3.6.0]

Four tightly coupled tasks that together make presence work correctly on every
project page, with a single indicator and a popover that can never be clipped.

## Background

After v3.5.1, presence heartbeated across all monolith stages but had two
structural defects:

1. **Duplicate chip** — a floating `position:fixed` chip lived in the monolith
   AND the embedded SiftProject screening submenu each rendered their own chip
   simultaneously on the Screening tab.
2. **Popover clipping** — the hover popover was rendered inline inside
   `.tab-content`, which has `overflow:hidden` ancestors and a CSS `transform`
   on the tab pane; the popover was cropped or hidden entirely.

Additionally, the monolith set `enabled:false` on the Screening tab to avoid a
double heartbeat, which left the chip stale while the user was in Screening.

## PresenceIndicator rewrite (`src/frontend/screening/components/PresenceIndicator.jsx`)

`PresenceIndicator` is now the **single shared project-presence component**,
reused by both the META·LAB universal header and the standalone META·SIFT shell
(`/sift-beta`).

### Popover portal (Task 3)

The hover popover is rendered via `createPortal(document.body)` — the same
pattern already used by `ExportDialog` and `ChatDrawer`. This lifts it out of
every stacking/clipping context.

Positioning:
- Computed with `getBoundingClientRect()` on open.
- Viewport collision clamping (right-edge and bottom-edge) prevents the popover
  from running off screen.
- Repositions on `scroll` and `resize` events.
- **Hover-bridge safe**: a 160 ms close delay lets the cursor cross the gap
  between the chip and the popover without it vanishing. Also closes on
  outside-click and `Escape`.

Z-index: `10000` — above navbar, modals, and the transformed tab pane.

### Display contract

| State | Chip shows |
|-------|-----------|
| 0 active users (or no linked workspace) | Self-hides (`null`) |
| 1+ active users | `active / total` e.g. `2 / 4` |
| Hover | Popover: teammate name, current location, field being edited (if any) |

## Deduplication (Task 8)

Previously: floating `position:fixed; top:14px; right:136px` chip in the
monolith + SiftProject's own chip = **two chips on the Screening tab**.

Now: **exactly one indicator**, in the universal project header (see
`universal-project-header.md`). The embedded `SiftProject` no longer renders
its own chip. It still heartbeats its fine-grained `"Screening · Title &
Abstract"`-style location. The standalone `/sift-beta` SiftProject keeps its
own chip unchanged.

## Globalization & location (Tasks 2/9)

### Shared presence room

Presence is scoped to the `ScreenProject` id (`spId = linkedSiftId(project)`).
Monolith and screening users join the same room; location strings differ by
source:

- Monolith: current tab label (e.g. `"PICO"`, `"Analysis"`, `"Extraction"`).
- Screening: fine-grained stage string (e.g. `"Screening · Conflicts"`).

### Heartbeat ownership

`usePresence.js` gained a `heartbeat` option to support listen-only mode.

| Context | `heartbeat` | Behaviour |
|---------|-------------|-----------|
| Universal header — non-Screening tabs | `true` | Header owns heartbeat with tab label as location |
| Universal header — Screening tab | `false` | Header listens only; SiftProject owns the precise location |
| Standalone `/sift-beta` SiftProject | `true` (default) | Unchanged from v3.5.1 |

Previously, the monolith disabled presence entirely on the Screening tab
(`enabled:false`), which left the indicator stale while the user was in
Screening. Now `enabled:true` + `heartbeat:false` keeps the chip live without
a double heartbeat.

### Members & Permissions

Live location/status is surfaced in the Members tab of both Screening Settings
and Project Control — presence data is passed into the shared `MembersTab` in
both hosts.

## Backend — no changes

Routes `/projects/:pid/presence(/heartbeat|/leave)` and
`/projects/:pid/locks/(acquire|release)` are unchanged. The in-memory presence
manager (`server/realtime/presence.js`) and SSE bus are unchanged.

## File reference

| File | Change |
|------|--------|
| `src/frontend/screening/components/PresenceIndicator.jsx` | Full rewrite: portal popover, hover-bridge delay, viewport clamping, self-hide at 0 active |
| `src/frontend/screening/hooks/usePresence.js` | Added `heartbeat` option (listen-only mode) |
| `meta-lab-3-patched.jsx` | Universal header renders the single `PresenceIndicator`; removed old fixed chip; Screening tab uses `heartbeat:false` |
| `src/frontend/screening/pages/SiftProject.jsx` | Removed embedded chip; heartbeat ownership unchanged for standalone mode |

## Tests

`tests/unit/presenceIndicator.test.js` — **5 new tests**, all pass:

| Test | Asserts |
|------|---------|
| Self-hides at 0 active | `null` rendered |
| Shows active/total | `"2 / 4"` chip text |
| aria-label | accessible label present |
| Omits total when unknown | e.g. `"1"` not `"1 / undefined"` |
| No popover/portal until opened | portal not in DOM before hover |

## Known limitations

- A project with no linked screening workspace (`spId null`) shows no presence
  indicator (self-hides gracefully). Opening the Screening stage auto-creates
  the workspace and enables presence everywhere thereafter.
- Popover position is computed on open and repositioned on scroll/resize but
  not via a `ResizeObserver` on the popover element itself; extreme rapid layout
  thrash could momentarily misplace it (re-opens correctly).
- Presence is in-memory + single-process (no Redis pub/sub). This is a
  pre-existing architectural caveat shared by all realtime features (chat,
  pokes). The TTL-based polling fallback preserves correctness in multi-tab
  scenarios.

## QA results

- Unit suite: **719 passed / 6 pre-existing failures**.
- `presenceIndicator.test.js`: 5/5 pass.
- `vite build` green.
- Portal/clipping fix verified by code review (pattern matches ExportDialog /
  ChatDrawer which are confirmed working).
