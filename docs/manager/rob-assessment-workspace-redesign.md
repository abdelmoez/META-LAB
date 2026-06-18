# Risk-of-Bias Assessment Workspace Redesign

_Version 3.16.0 (prompt34, Tasks 2, 4, 5, 6, 7)_

This note documents the redesign of the RoB 2 assessment workspace — the keyboard-first screen a reviewer uses to judge the risk of bias for one result of one study. The redesign reworks the layout so the workspace behaves like a focused, "serious" assessment tool: the study PDF, the signalling questions and the primary actions are all visible at once, with no page-level scrolling required to reach the controls that finalise an assessment.

The work lives almost entirely in `src/frontend/rob/RobWorkspace.jsx`, with supporting changes in `src/frontend/rob/RobPdfPanel.jsx` and a small amount of threading through `src/frontend/rob/ProjectRobPanel.jsx` and the monolith `RoBTab`/`GRADETab` in `meta-lab-3-patched.jsx`. The pure scoring engine in `src/research-engine/rob/` is unchanged.

## What the workspace looked like before

The previous workspace had several friction points that the redesign targets directly:

- **Page-level scroll to reach Finalise.** The whole workspace grew with its content. To answer the last domain or press **Finalise**, the reviewer scrolled the entire page down, losing sight of the article context and the autosave state.
- **A narrow assessment pane.** The questions column was pinned to roughly `32vw`, which is cramped on a wide monitor for the five-option segmented controls plus the rationale and evidence fields.
- **A separate "Article Information" tab.** Article details (abstract, keywords) lived in their own left-column tab, so the reviewer had to switch away from the PDF to read them.
- **A header scoped only to the PDF.** The article identity (title, authors, journal, DOI/PMID) sat inside the left/PDF region, so it did not visually own the assessment column on the right.

## The new full-height layout (Task 2)

The workspace root is now a flex column that is **sized to fill the viewport** from wherever it is mounted. Because the workspace sits below the application header and the "Risk of Bias" section header, the redesign does not hard-code an offset — it measures the live distance from the element's top to the viewport top and fills the remaining space.

This is the `useFillViewportHeight` hook in `RobWorkspace.jsx`:

```js
function useFillViewportHeight(ref, bottomGap = 24, minHeight = 460) {
  // ...
  const top = el.getBoundingClientRect().top;
  const h = Math.max(minHeight, window.innerHeight - top - bottomGap);
  setHeight(h);
}
```

It recomputes on window `resize` (debounced through `requestAnimationFrame`) and enforces a `minHeight` of `460px` so the layout never collapses. The root element applies the result as an explicit pixel `height` with `display: flex; flexDirection: column`.

Inside that fixed-height shell, the regions are arranged so that **only the content panels scroll, never the page**:

- The **Back bar** and the **article header** are `flexShrink: 0` — they stay put.
- The **two-column row** is `flex: 1; minHeight: 0`, taking all the remaining height.
- Within the assessment column, the **context bar** and the **sticky footer** are `flexShrink: 0`, and the scrolling body between them is `flex: 1; minHeight: 0`. The body itself splits into the domain rail (`overflowY: auto`) and the question/summary pane (`overflowY: auto`), so each scrolls independently.
- The **PDF panel** fills its column; the browser-native PDF viewer scrolls long documents internally. A companion hook, `useMeasuredHeight` (a `ResizeObserver` on the row), feeds the PDF iframe an explicit pixel height (`pdfPreviewHeight`) so it tracks the column rather than overflowing the page.

The net effect: **Save/Finalise/Next/Continue are always on screen.** The reviewer answers questions and finalises without ever scrolling the page.

### Sticky `WorkspaceFooter`

The primary actions are collected into a dedicated `WorkspaceFooter` component pinned to the bottom of the assessment column (`flexShrink: 0`, with a top border and card background). It carries, left to right:

- An `aria-live="polite"` **autosave status** word — `autosaves` / `saving…` / `✓ saved` / `save failed`, or `view only` / `✓ finalised` in the corresponding states.
- **Previous** and **Next** domain navigation (Next reads `Next: D2`, etc., or `Summary` on the last domain; Previous reads `Back to D5` from the Summary step).
- The **primary action**: `Finalise` (disabled until every reachable signalling question is answered, with an explanatory `title`), or — once finalised — `Re-open` plus `Continue to GRADE`.

Below `STACK_BELOW` (900px), the layout intentionally **does not** fix the height. The `useViewportNarrow` hook switches the root to natural `minHeight: auto`, stacks the columns, and lets the page scroll normally — see the stacked fallback below.

## Article header spanning both columns + Back placement (Tasks 4 & 5)

The article identity now lives in a single `ArticleHeaderBar` rendered **above the grid, spanning both columns**. It is fed by the one study-record fetch that `RobWorkspace` owns (`resolveStudyRecord` → `screeningApi.metalabStudyRecord`), so the header and the PDF panel share the same data and the same single network call.

The header shows:

- The article **title** (falling back to the result label or `Study <id>`).
- **Authors · journal · year** when present.
- **DOI** and **PMID** as external links (`doi.org`, `pubmed.ncbi.nlm.nih.gov`).
- Compact **chips**: source database (`sourceDb`), a `Duplicate` badge, and a decision badge derived from the screening record via `articleDecisionBadge` — `↗ Sent to Data Extraction`, `✓ Accepted in Final Review`, or `✗ Rejected in Final Review`.

**The "Article Information" tab was removed (Task 4).** The left column is now PDF-only. The fuller article detail — abstract and keywords — is offered as an **expandable disclosure inside the header** ("Abstract & keywords" → "Hide details"), gated by the admin setting `robSettings.showArticleInfoTab`. When the setting is off, or the study has no abstract/keywords (e.g. a manually added, non-handoff study), the disclosure is simply not offered. This keeps the header compact while still making the article text reachable without leaving the PDF.

**Back button placement (Task 5).** The `Back to Risk of Bias` button sits in its own bar **above both columns**, alongside a `RoB 2 · effect of assignment` tool badge and the `Show source`/`Hide source` toggle. `onClose` owns the routing, so the labelled Back works correctly after a refresh or a deep link.

## 60/40 width logic and the <900px stacked fallback (Task 6)

On a normal-width viewport, the two-column row is a CSS grid:

```js
gridTemplateColumns: hasLeftColumn ? 'minmax(0, 1.25fr) minmax(440px, 0.85fr)' : '1fr'
```

This gives the **PDF roughly 60%** of the width and the **assessment roughly 40%**, with a hard `440px` minimum on the assessment so the segmented controls and rationale/evidence fields are never squeezed. This is a deliberate widening from the old `~32vw` assessment pane. When the PDF is hidden — either by the admin `showPdfPanel` setting or the reviewer's `Hide source` toggle — `hasLeftColumn` is false and the assessment takes the full width (`1fr`).

Below `STACK_BELOW` (900px), `useViewportNarrow` flips the row to `display: flex; flexDirection: column`. The PDF/article stacks **above** the assessment, the page scrolls naturally, and the PDF preview switches to a viewport-relative height (`calc(100vh - 300px)`) instead of the measured row height — so neither pane is crushed on a small screen.

## "Serious engine" improvements (Task 7)

The redesign adds the feedback that makes the workspace feel like a rigorous assessment instrument rather than a form:

- **Progress meter.** The context bar shows `X/5 domains` with a thin progress bar that fills as domains are completed and turns green (`C.grn`) once all are complete. A live **Overall** judgement pill sits beside it, marked `provisional` until every reachable question is answered (and the assessment is not yet finalised).
- **Domain rail with traffic-light dots.** The left rail of the assessment column lists D1–D5 plus a **Summary** step. Each row carries a `TrafficDot` and an `answered/required` count (or `complete`), plus a pencil glyph when a domain judgement has been overridden. Crucially, the dot shows the proposed colour **only once the domain is complete** (`dotJudgment`), so a half-answered domain never displays a misleadingly favourable colour — it stays neutral until its required questions are answered.
- **Live autosave status** in the footer, as described above (`aria-live` so it is announced).
- **Sticky footer** with Previous/Next, Finalise/Re-open, and the GRADE hand-off.
- **Continue to GRADE threading.** Once an assessment is finalised, the footer shows a `Continue to GRADE` button. The handler is threaded from the monolith down through the component tree: the monolith `RoBTab` now receives `setTab` and passes `onContinue={t => setTab(t || "grade")}` to `ProjectRobPanel`, which forwards `onContinue` to `RobWorkspace`. In the footer, `onContinue('grade')` switches the project workspace to the GRADE tab. (Separately, in `GRADETab`, `summariseRobForGrade` consumes the completed assessments to suggest the GRADE Risk-of-Bias rating — flag-gated and owner-scoped, falling back silently when RoB data is unavailable.)

The pure engine is imported directly into the workspace (`proposeDomain`, `proposeOverall`, `completeness`, `isReachable` from `research-engine/rob`), so reachability and the algorithm's proposals update instantly as answers change — it is the same module the server uses to persist the authoritative copy on each debounced autosave, so there is no client/server drift.

## Supporting pieces

- **`RobPdfPanel.jsx`** is a pure, header-less renderer. It receives `{ loading, error, screenProjectId, recordId }`, an `onRetry`, and a `previewHeight`, and either reuses the screening `<PdfViewer>` (`defaultOpen`, so the PDF shows immediately) or renders a clean empty state for studies that were not created from a screening hand-off. It does not introduce a second PDF system or a duplicate attachment table.
- **`ProjectRobPanel.jsx`** is the per-project host. It opens `RobWorkspace` inline and now passes `onContinue` straight through; everything else (assessment list, traffic-light summary, tool selector, create/remove) is unchanged.

## Known limitations

- **Owner-scoped RoB data.** The `/api/rob` surface remains owner-scoped, so a non-owner collaborator sees the `OwnerOnlyNotice` ("Risk of Bias is managed by the project owner") rather than the workspace. The full-height redesign does not change this access model. The GRADE auto-suggestion in `GRADETab` is likewise owner-scoped and falls back to the legacy data-based suggestion for anyone who cannot read the assessments.
- **Height is computed at the element's mount position.** `useFillViewportHeight` measures the live `getBoundingClientRect().top`. If chrome above the workspace changes height without a window `resize` (e.g. a banner appearing), the fill height is not recomputed until the next resize; it self-corrects on any resize and is clamped to a `460px` minimum so it never breaks the layout.
- **PDF behaviour depends on the browser.** The left column relies on the browser-native PDF viewer for internal scrolling and fit-to-width; the workspace controls only the iframe's measured pixel height. Studies with no linked screening record show the empty state — there is no PDF to fit.
- **`Continue to GRADE` requires `setTab`.** The button only appears when the host supplies `onContinue`. Standalone routes that render `RobWorkspace`/`ProjectRobPanel` without threading `setTab` will not show the hand-off action (by design — there is no GRADE tab to continue to in that context).
