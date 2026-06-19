# Layout & Ops polish — final report (prompt36, v3.18.0)

*META·LAB internal. Date: 2026-06-18. Version: 3.17.0 → **3.18.0** (minor).*

A focused workspace-layout + Ops-visibility update: a resizable RoB split, a
flush full-width PDF, automatic workflow-menu collapse with a clearer toggle,
real on/off switches in Project Control, and an admin-only onboarding analytics
dashboard. No schema/migration changes. Build green; **1160 unit tests green**
(the 6 full-suite failures are pre-existing live-server integration reachability
guards, unrelated to this work).

---

## What shipped

| # | Task | Surface | Doc |
|---|---|---|---|
| T1 | RoB **70/30 resizable** PDF / assessment split (draggable, keyboard, persisted) | `src/frontend/rob/RobWorkspace.jsx` | `rob-resizable-assessment-layout.md` |
| T2 | PDF viewer **flush full-width** in the RoB panel | `PdfViewer.jsx`, `RobPdfPanel.jsx` | `pdf-viewer-full-width.md` |
| T3 | Workflow menu **auto-collapse** on workflow-step navigation | `meta-lab-3-patched.jsx` | `workflow-menu-autocollapse.md` |
| T4 | Collapse control → **directional arrow** + tooltip + ARIA | `meta-lab-3-patched.jsx` | `workflow-menu-autocollapse.md` |
| T5 | Project Control **on/off switches** (`SwitchToggle`) | `meta-lab-3-patched.jsx` | `project-control-switch-settings.md` |
| T6 | Ops **onboarding analytics** (3 endpoints + dashboard) | `onboardingController.js`, `routes/admin.js`, `adminApiClient.js`, `AdminConsole.jsx` | `onboarding-analytics-ops.md` |
| T7 | Ops Institutions white-screen — **already fixed** in `9aecc50` | — | `ops-institutions-white-screen-root-cause.md` |

---

## Highlights

- **T1** — The RoB workspace opens 70 % PDF / 30 % assessment with a draggable
  divider clamped to a 45–72 % PDF range. The drag writes a CSS custom property
  (`--rob-pdf-pct`) straight to the grid row via one `requestAnimationFrame` per
  move and touches React state **only on pointer-up**, so it is lag-free on weak
  machines. The divider is a `role="separator"` with keyboard nudge (←/→ ±2 %),
  Home/double-click reset, and `prefers-reduced-motion` support. The ratio
  persists in `localStorage` (`metalab.rob.splitRatio`). Below 900 px the layout
  stacks and the divider is dropped.

- **T2** — `PdfViewer` gained a `flush` prop: it drops its own border/radius/
  background, fills its parent's height, and lets the preview iframe grow to
  fill remaining space so the PDF re-fits width on resize. `RobPdfPanel` renders
  `<PdfViewer flush />` inside its rounded, `overflow:hidden` card with no inner
  padding, so the PDF is edge-to-edge. Standalone screening usage is unchanged.

- **T3/T4** — Navigating into a workflow step (sidebar step click or the "Next"
  button) now auto-collapses the sidebar into focus mode; Overview / Project
  Control never collapse (`WORKFLOW_TAB_IDS` = tabs with a `phase`). The collapse
  control became a chevron that rotates 180° to point the way it will move, with a
  theme-aware tooltip, state-aware `aria-label`, and `aria-expanded`. A
  reduced-motion CSS rule disables the slide/rotation animations.

- **T5** — Project Control's Blind mode + Restrict chat moved from ambiguous text
  pills to a real `SwitchToggle` (sliding switch, `role="switch"`, keyboard-
  activatable), matching the screening switch. Both Project Control surfaces
  (monolith + screening) now use real switches; permissions and optimistic
  save-with-rollback to the linked `ScreenProject` are unchanged.

- **T6** — A new admin-only **Analytics** view in Ops → Onboarding: overview
  rates, per-question stacked bars, a per-user table, question/user drill-downs,
  and a client-side CSV export. Backed by three `requireAdmin` endpoints with a
  strict **denominator contract** (active question denominator = all users;
  inactive = responders; overview over the active × users universe). Answer
  **values** are privacy-gated behind drill-downs + a "Show answers" toggle, and
  institution answers surface only the human-readable name.

- **T7** — The Ops Institutions white-screen was **already root-caused and fixed
  earlier** (commit `9aecc50`); see `ops-institutions-white-screen-root-cause.md`.
  No further work here.

---

## Tests / build

- `vite build` — green (only the pre-existing AnalysisTab `"}" inside JSX`
  esbuild warning, which exits 0).
- `npx vitest run tests/unit` — **1160 passed**.
- New tests: `tests/unit/rob-workspace-ui.test.jsx` (clampSplit bounds +
  `ResizeDivider` a11y), `tests/unit/onboarding-analytics.test.js` (pure
  analytics helpers + denominator behaviour).
- The 6 full-suite failures are pre-existing live-server integration reachability
  guards, unrelated to this change.

---

## Known limitations

- **Split ratio is per-browser** — `metalab.rob.splitRatio` is `localStorage`,
  not synced per user across devices.
- **User table cap 500 / pending list cap 200** — onboarding analytics bounds the
  per-user table to the 500 most-pending users and each question's pending list to
  200; very large deployments would need a paged endpoint (see future work).
- **Auto-collapse scope** — fires only on the two specified triggers (sidebar
  workflow-step click, "Next" button); the Overview "Go to X" buttons still use
  plain `setTab` and do not auto-collapse.

---

## Recommended next steps

1. **Sync the RoB split ratio per user** (server-side preference) so it follows
   the reviewer across devices, like the other per-user prefs.
2. **Onboarding analytics: date-range filters + pagination** beyond the 500/200
   caps, and per-user answer review/re-prompt from Ops.
3. Consider extending auto-collapse (opt-in) to the Overview "Go to X" buttons if
   user feedback wants a consistent focus-mode entry from every navigation path.
