# Risk-of-Bias workspace, GRADE sync & workflow polish — final report (prompt34, v3.16.0)

This update reworks the Risk-of-Bias (RoB 2) assessment workspace into a serious, full-height, single-screen tool; connects completed RoB assessments to the GRADE "Risk of Bias" certainty domain as an auditable suggestion; unifies the workflow-menu collapse across every project tab; and surfaces the core screening/collaboration settings in Project Control against a single source of truth. No database or migration changes. Build green (vite); 1113 `tests/unit` + 164 `tests/screening/unit` tests green. Version bumped `3.15.1 → 3.16.0`. Commit hash: TBD.

## 1. PDF fit-width by default (T1)

`src/frontend/screening/components/PdfViewer.jsx` uses the browser-native PDF renderer (an `<iframe>`, not react-pdf). The preview now loads with a URL fragment so each page is scaled to the container width on open:

```js
const previewUrl = attachment ? screeningApi.pdfDownloadUrl(pid, recordId, attachment.id) : null;
const fitUrl = previewUrl ? `${previewUrl}#zoom=page-width&view=FitH` : null;
```

The iframe `src` is `fitUrl` and the iframe is `width: 100%`, so the page re-fits when the container resizes; a manual zoom by the reader persists for the session because the iframe is never remounted on resize. The "Open in new tab" link still uses the plain `previewUrl`. `RobPdfPanel` passes `defaultOpen` so the PDF is visible immediately in the RoB workspace.

## 2. Full-height RoB workspace — no page scroll, action footer always visible (T2)

`src/frontend/rob/RobWorkspace.jsx` is now a flex column whose height is computed by a new `useFillViewportHeight(ref, bottomGap = 24, minHeight = 460)` hook: it measures the element's distance from the viewport top (`getBoundingClientRect().top`) and fills the rest of the window, recomputing on resize. The two-column row is `flex: 1; minHeight: 0`, and both the PDF panel and the assessment **scroll internally** (the domain rail and the question pane each have their own `overflowY: 'auto'`). A new `useMeasuredHeight` (ResizeObserver) sizes the PDF iframe to fill its column so the native viewer scrolls long documents internally rather than growing the page.

A sticky `WorkspaceFooter` (`flexShrink: 0`) sits at the bottom of the assessment section and is always visible, so **Save state, Previous/Next, Finalise/Re-open and "Continue to GRADE" never require page scrolling**. Below 900px (`STACK_BELOW` / `useViewportNarrow`) the layout falls back to a stacked, naturally-scrolling column and the PDF height switches to a viewport-relative value.

## 3. PDF toolbar hide/show (T3)

In `PdfViewer.jsx`, a `toolsHidden` state is persisted to `localStorage` key `metalab.pdfToolsHidden`. A small toggle button (`⋯` when hidden, `✕` when shown; `title`/`aria-label` "Show/Hide PDF tools", `aria-pressed`) collapses the action cluster — Preview / Hide preview, Open in new tab, Replace, Remove — while keeping the "Full-text PDF" label, the filename, the file-size chip and the toggle itself always visible. Hiding only the actions (not the label) gives the PDF more room without losing orientation.

## 4. "Article Information" tab removed; left column is PDF-only (T4)

The separate left-column "Article Information" tab and its `ArticleInfoPane` / `SourceTab` / `InfoRow` / `humanizeEnum` machinery were removed from `RobWorkspace.jsx`. The left column is now purely the study PDF. `RobWorkspace` still owns the single study-record fetch and feeds it to both the header and the PDF panel. The article's fuller detail (abstract + keywords) now lives in an **expandable disclosure inside the header**, gated by the admin setting `robSettings.showArticleInfoTab`. The admin `defaultLeftTab` branching was dropped since there is no longer a left-tab choice.

## 5. Article header spanning both columns (T5)

A new `ArticleHeaderBar` renders above the two-column grid and spans **both** columns. It shows the article identity — title, `authors · journal · year`, DOI/PMID links — plus compact chips (`sourceDb`, "Duplicate", and the final-review decision badge via `articleDecisionBadge`). When `showArticleInfoTab` is on and the record has an abstract or keywords, an "Abstract & keywords" disclosure toggles the fuller detail inline (`aria-expanded`), keeping the header compact. The "Back to Risk of Bias" button sits above both columns; `onClose` owns the routing so the labelled Back works after refresh / deep-link.

## 6. RoB column widths — PDF ~60% / assessment ~40% (T6)

The non-narrow grid template is now `minmax(0, 1.25fr) minmax(440px, 0.85fr)` when the PDF column is shown, giving the PDF roughly 60% and the assessment roughly 40% (the assessment column was widened from the old `clamp(380px, 32vw, 560px)`). The inner domain rail is `212px` wide.

## 7. Serious-engine feel (T7)

The assessment gains the cues of a deliberate review instrument:

- **Progress meter** in the context bar: `"{completed}/{total} domains"` plus a thin progress bar that turns green when all domains are complete.
- **Traffic-light dots** in the domain rail reflect each domain's resolved judgement.
- **Sticky footer** (`WorkspaceFooter`) carries the live autosave state (`autosaves` / `saving…` / `✓ saved` / `save failed` / `✓ finalised` / `view only`), Previous / Next domain navigation, Finalise (disabled until all reachable signalling questions are answered) or Re-open when finalised, and a primary **"Continue to GRADE"** action.
- The RoB-2 tool badge now reads "RoB 2 · effect of assignment".
- Finalise/Re-open were moved out of the Summary body into the always-visible footer; the Summary keeps only the per-assessment exports (CSV / JSON / robvis).

The `onContinue` action is threaded from the monolith: `setTab` → `RoBTab` → `ProjectRobPanel` → `RobWorkspace`, so `onContinue('grade')` switches the project to the GRADE tab.

## 8. Unified workflow-menu collapse across every tab (T8)

In `meta-lab-3-patched.jsx` the separate `screeningFocus` state was removed. There is now a single `navCollapsed` state for every project tab (Overview … Project Control and Screening), persisted in `localStorage` key `metalab.navCollapsed`. The `focus` value is simply `navCollapsed` and `toggleNav` toggles it everywhere; the `☰` button in the universal `ProjectHeaderBar` controls it on every project page. The sidebar slides out (`translateX(-100%)`) and the main content's `marginLeft` goes to 0. Screening's full-bleed **content** layout (padding/overflow) is still driven separately by `inScreening`.

**Behavior change:** Screening no longer auto-collapses the menu on open. Collapse is now one persisted user choice shared across all tabs (see Product decisions).

## 9. Project Control "Screening & collaboration" settings (T9)

The monolith `ControlTab` gained a "Screening & collaboration" card that reads and writes the **linked ScreenProject** through `screeningApi.updateProject` — the single source of truth — so the screening `ProjectControlTab.jsx` "Settings" tab shows the same synchronized values (it also reads/writes the same ScreenProject via the same API). Saves are optimistic (`saveSpSetting` patches local `sp`, shows `✓ saved`, reverts on error). The card is gated by `canManageStatus` (owner / leader / member with `canManageSettings`); non-managers see read-only badges plus "You can view these settings. Only the owner or a leader can change them." The three settings and their exact descriptions:

- **Blind mode** — "Hide author / journal info from reviewers during screening." (On/Off pill)
- **Restrict chat** — "When on, only members with the Chat permission can post." (Restricted/Open pill)
- **Required reviewers** — "Independent title & abstract decisions needed before a record can advance to Final Review. The research standard is 2; only the owner or a leader can change it." (default `2`; select `2–10`)

The server re-validates authority and the inputs: `screeningController.updateProject` returns 403 unless `access.canManageSettings`, and `requiredScreeningReviewers` must be an integer (else 400) and is clamped to `[REQUIRED_REVIEWERS_MIN, REQUIRED_REVIEWERS_MAX]` (the 2-floor preserves the two-reviewer guarantee).

### Blind mode
Persisted as `ScreenProject.blindMode`; hides author/journal info from reviewers during screening. Editable from both Project Control and the screening Settings tab, both backed by the same row.

### Restrict chat
Persisted as `ScreenProject.chatRestricted`. When on, only members with the Chat permission (or a leader) can post. The server already enforces this in `screeningChatController.postMessageCore`: `chatRestricted && !canChat && !isLeader → 403`; the rejection message was updated to "You do not have permission to post in this chat." The blocked state in `ChatDrawer.jsx` now renders a disabled, read-only input placeholdered with that message plus a short explanation ("Chat is restricted to members with the Chat permission."), replacing the previous read-only banner.

### Required reviewers
Persisted as `ScreenProject.requiredScreeningReviewers` (default 2). Independent title & abstract decisions needed before a record advances to Final Review; only owner/leader can change it; server-validated and clamped as above.

## 10. RoB → GRADE integration with stale detection & manual-override protection (T10)

A new pure module `src/research-engine/rob/gradeSync.js` (no Prisma/Express/React/`Date.now()`, so it runs identically on server and client) exposes:

- `summariseRobForGrade(assessments)` — over the completed assessments (`status` in `{complete, consensus}` with a valid `overall` in `{low, some, high}`) it counts low/some/high and maps to a suggested GRADE rating, mirroring the legacy data-based thresholds: mostly low → `not_serious`; any high (minority) or some-concerns majority → `serious`; high in ≥ half of assessed results → `very_serious`; no completed assessments → pending (no rating). It returns `{ hasAny, total, completed, pending, assessed, counts, concern, suggestedRating, reason, signature }`.
- `robGradeSignature(assessments)` — a stable, order-independent signature (`id:status:overall`, sorted) that flips on any change (new assessment, re-finalised judgement, reopen), used to detect staleness.

`GRADETab` fetches `robApi.listAssessments(project.id)` only when the `rob_engine_v2` flag is on (owner-scoped; a 404 / flag-off / error leaves `robList` null and GRADE falls back to the existing legacy `gradeSuggestions`). In the Risk-of-Bias domain row the suggestion is shown with:

- **"Use RoB suggestion"** to accept the auto-derived rating (records `source: 'auto_rob'`).
- **Manual-override protection** — a manual click on the RoB domain records `source: 'manual'`, so later RoB changes are flagged stale rather than silently overwritten; a note explains the manual value is kept even when it differs from the suggestion.
- A **stale banner** ("⚠ Risk of Bias assessments changed since this GRADE judgement was last reviewed.") with **"Re-sync"** (apply the new suggestion) or **"Keep mine"** (acknowledge the new signature while keeping the current rating) when the live signature differs from the persisted one.
- "Apply all suggestions" prefers the RoB-assessment suggestion for the Risk-of-Bias domain when present, otherwise the legacy suggestion.

State is persisted in `grade.robSync = { source: 'auto_rob' | 'manual', signature, syncedAt, rating, counts?, concern?, completed? }`. The suggestion is never a silent forced downgrade — the downgrade stays a human judgement.

## Backend changes

- `server/controllers/screeningChatController.js` — the chat-restricted rejection message in `postMessageCore` is now "You do not have permission to post in this chat." (enforcement logic unchanged).

No other backend changes. `screeningController.updateProject` (authority + validation) and `screeningChatController.postMessageCore` (chat permission) already existed and are reused as the enforcement points for the new Project Control settings UI.

## Frontend changes

- `src/frontend/screening/components/PdfViewer.jsx` — fit-width `fitUrl`; persisted `toolsHidden` toggle (T1, T3).
- `src/frontend/rob/RobWorkspace.jsx` — full-height layout (`useFillViewportHeight`, `useMeasuredHeight`), `ArticleHeaderBar` spanning both columns, removal of the Article Information tab, 60/40 grid, progress meter + traffic dots, sticky `WorkspaceFooter`, `onContinue` (T2, T4, T5, T6, T7).
- `src/frontend/rob/ProjectRobPanel.jsx` — threads `onContinue` into `RobWorkspace`.
- `src/frontend/components/chat/ChatDrawer.jsx` — restricted-chat blocked state shows a disabled input + explanatory message.
- `meta-lab-3-patched.jsx` — unified `navCollapsed` collapse (T8), `ControlTab` "Screening & collaboration" card with optimistic `saveSpSetting` (T9), `GRADETab` RoB→GRADE suggestion wiring with accept / manual / stale handling (T10), `RoBTab` passes `setTab` for "Continue to GRADE".
- `src/research-engine/rob/gradeSync.js` — new pure module (T10).

## Database / migration

None. `grade.robSync` lives inside the existing `Project.data` JSON blob (no new column, no Prisma model, no migration). The screening settings reuse existing `ScreenProject` columns (`blindMode`, `chatRestricted`, `requiredScreeningReviewers`).

## Tests added

`tests/unit/rob-grade-sync.test.js` — 14 cases covering `summariseRobForGrade` (pending/empty, not_serious/serious/very_serious thresholds, some-concerns majority, minority high, `consensus` treated as completed, draft-as-pending reason) and `robGradeSignature` (order-independence, change on judgement/status/added-assessment, stability for identical input).

## Build & test results

- vite build: green.
- `tests/unit`: 1113 green.
- `tests/screening/unit`: 164 green.

## Product decisions / deviations

- **Unified collapse changes the Screening default.** Previously Screening auto-collapsed the sidebar on open via a separate `screeningFocus` flag. To make the menu behave consistently everywhere, that flag was removed and Screening now obeys the same persisted `navCollapsed` choice as every other tab. Net effect: opening Screening no longer auto-collapses the menu; the collapse is a single user choice that persists across tabs and sessions.
- **GRADE sync is frontend-computed on GRADE open and persisted via the normal project save.** `summariseRobForGrade` runs in `GRADETab` (it is pure and could run server-side), and `grade.robSync` is written through the standard monolith `upd('grade', …)` path rather than a direct server `Project.data` write. This deliberately avoids clobbering the monolith's autosave blob with an out-of-band server mutation; the suggestion is recomputed each time GRADE is opened and the persisted signature drives staleness.

## Known limitations & recommended next steps

- **UI-level automated coverage is limited.** The app's test infra is SSR-only (no DOM-interaction harness), so the new GRADE-tab interactions, the RoB layout/footer, the PDF toolbar toggle, and the Project Control settings card are validated by the pure `gradeSync` unit tests plus build + manual QA rather than by interaction tests. A DOM/E2E harness would let these be regression-tested directly.
- **Collapse preference is per-browser, not per-user.** `navCollapsed` (and `pdfToolsHidden`) are stored in `localStorage`, so the choice does not follow a user across devices. Promoting it to a user preference (as was done for dashboard preferences) would make it cross-device.
- **RoB API is still owner-scoped.** `robApi.listAssessments` is owner-scoped, so a non-owner viewing GRADE gets a 404 and the Risk-of-Bias domain falls back to the legacy data-based suggestion. Broadening RoB read access to project members would let the auto-suggestion appear for non-owners.
- **Native-PDF zoom is not app-controlled.** Fit-width is requested via the `#zoom=page-width&view=FitH` URL fragment, which the browser's built-in PDF viewer honours; the app cannot programmatically read or set the zoom afterwards, and exact rendering depends on the browser's PDF engine.
