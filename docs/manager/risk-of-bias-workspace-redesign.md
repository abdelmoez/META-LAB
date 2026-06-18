# Risk of Bias study workspace redesign (prompt32 Tasks 2, 3, 4)

## Current state (before)
`RobWorkspace.jsx` rendered a wrapping flex: left aside = `RobPdfPanel` (PDF, capped 1100px), right pane = the RoB assessment (capped 680px) with a context bar holding an icon-only back button. There was no article header (only `resultLabel` + `studyId`) and no Article Information view. The PDF height was a hard-coded 520px in `PdfViewer.jsx`. The study-record endpoint returned only `{linked,screenProjectId,recordId}` (no article fields).

## Decision
1. **Backend (no schema change):** enrich `getMetaLabStudyRecord` to additively return `record` with the article fields already on `ScreenRecord` (title, authors, year, journal, doi, pmid, abstract, keywords, sourceDb, isDuplicate, currentStage, finalStatus, acceptedAt, rejectedReason, handoffStatus). `record` is null for manually-added studies.
2. **Task 3 — Back button above both containers:** a top-level study-workspace header row sits above the two-column layout with a prominent "← Back to Risk of Bias" button (wired to `onClose`; works on deep-link/refresh).
3. **Task 2 — Left side two tabs + persistent header:** the left column shows a persistent article header (title, authors · journal · year, DOI/PMID links) ABOVE a two-tab bar — **Study PDF** (default) and **Article Information** — the header does not change between tabs. The Article Information pane mirrors Final Review (title, authors/journal/year, DOI/PMID/badges, plain-text abstract, keywords, source/publication info, final-review decision badge from finalStatus/acceptedAt/handoffStatus, PDF attachment status), with graceful fallbacks when `record` is null or fields are empty.
4. **Task 4 — Width, balance, spacing:** the outer layout is a two-column grid `minmax(0,1fr) clamp(380px,32vw,560px)` (left PDF/article fills remaining space; right assessment is a clamped width pinned to the right boundary — no large empty area). Responsive outer `padding-inline: clamp(24px,6vw,96px)`; stacks to one column on narrow viewports. `PdfViewer.jsx` gained a height prop (DEFAULT 520 so Screening is unchanged) so the RoB PDF fills its column and aligns with the workspace bottom.

## Ops integration
The RoB UI reads `robSettings` from `GET /api/settings/public` via a `robApi.getRobSettings()` helper (safe fallbacks): `showPdfPanel`, `showArticleInfoTab` gate the two tabs; `defaultLeftTab` chooses the initial tab. (Ops controls are Task 12.)

## Test results
- Build green (all RoB files compile); the RoB engine unit/integration suites unaffected (presentational change; API call shapes are additive — only a new `record` field).
- `canManage`/read-only gating preserved (no upload/replace when `!editable`).

## Risks / limitations
- Blind mode does not apply in RoB (study already accepted) — full metadata is shown.
- Two token modules are intentionally kept (`RobWorkspace` uses `theme/tokens.js`; `PdfViewer` uses `ui/theme.js`) — both resolve to the same CSS vars.
- `record` is null for manually-added (non-screening-handoff) studies; the header/tab fall back to `resultLabel`/`studyId` and the existing empty states.
