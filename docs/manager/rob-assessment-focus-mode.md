# RoB Assessment — Focus Mode (intro text) — prompt39 Task 3

## Goal
Inside the per-study Risk-of-Bias **assessment workspace**, remove the distracting
intro header so the user focuses on the tool; keep it on the RoB **overview** page.

## What was happening
The monolith RoB tab (`RoBTab`) rendered:
```
<SectionHeader title="Risk of Bias"
  desc="Outcome-level RoB 2 for this project — the engine proposes a judgement; you decide." />
<ProjectRobPanel … />
```
`ProjectRobPanel` switches internally between the **overview list** and the per-study
`RobWorkspace` (when an assessment is opened). Because the `SectionHeader` was a
**sibling above** `ProjectRobPanel`, it kept showing **above the assessment
workspace** too — exactly the distraction to remove.

## Fix
- `ProjectRobPanel` gained an `onWorkspaceChange(open: boolean)` callback, fired from
  an effect whenever its internal `openId` (the open assessment) changes.
- `RoBTab` tracks `inWorkspace` and renders the intro `SectionHeader` only when
  **not** in the workspace: `{!inWorkspace && <SectionHeader … />}`.

Result: the intro header shows on the RoB overview (study list), and disappears the
moment a per-study assessment opens — leaving the focused PDF + assessment workspace
(which keeps its own study header: `ArticleHeaderBar` with title/authors/journal/
year/DOI, the Back button, and the completion progress). Returning to the list
restores the header.

## Note
The standalone `RobWorkspace` itself never contained that intro text — the bug was
purely the monolith sibling header persisting across the overview→workspace switch.
No change to `RobWorkspace`.
