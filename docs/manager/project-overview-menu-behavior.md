# Project Overview / Project Control — Menu Behavior — prompt39 Tasks 2/6

## Goal
Opening a project lands on **Overview** with the left workflow menu **open**, and
neither **Overview** nor **Project Control** ever auto-collapses the menu — they are
orientation/settings pages, not focus-mode workflow steps.

## How it works
- **Landing tab:** the monolith initializes `tab = initialTab || "overview"`, so a
  freshly opened project starts on Overview (a `?tab=` deep-link still overrides).
- **Menu open by default:** `navCollapsed` defaults to `false` (open) unless the
  user's per-browser `localStorage` (`metalab.navCollapsed`) says otherwise, which is
  respected. If the user's saved **mode** is `"pinned"`, an effect forces the menu
  open on load.
- **No auto-collapse on Overview / Project Control:** these tabs are in the `project`
  group (`group:"project"`, `phase:null`). The centralized rule
  `shouldAutoCollapseWorkflowMenu` returns `false` for any
  `isNonCollapsingProjectRoute` tab, so navigating to them never collapses the menu.
  They are also rendered with plain `setTab()` (not the auto-collapsing `goTab()`),
  giving a second guarantee.
- **Returning to Overview** (e.g. clicking the breadcrumb project name) uses
  `setTab("overview")` — no collapse.

## Net rules (centralized in `workflowMenu.js`)
| From → To | Mode | Menu |
|---|---|---|
| open project → Overview | any | stays open (pinned) / respects saved state (auto) |
| Overview → Project Control | any | does not collapse |
| Overview → a workflow step | auto | collapses |
| Overview → a workflow step | pinned | stays open |
| anything → Overview / Control | any | does not collapse |

See `workflow-menu-pin-autocollapse.md` for the pin/auto preference and the helper
module. QA steps are in `pdf-and-workflow-ux-final-report.md`.
