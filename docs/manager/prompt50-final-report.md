# Prompt 50 — Final Report

Six workstreams delivered, each tested and committed/pushed independently to
`main`. Commits: WS4 `1aa6296`, WS6 `3a9538f`, WS3 `8a54efd`, WS5 `67c6cb6`,
WS2 `107900e`, WS1 `6573511` (+ `f1b2aef` test fix), docs `729f77a`.

## 1. Executive summary
Transformed the Ops Console Projects tab into an analytics workspace; made
screening imports scalable + durable and uncapped, with content-based `.txt`/
format detection; corrected conflict detection (stage-scoped, single source of
truth) with live updates; gave the interactive forest plot readable, bounded
precision independent of export; made "Last Modified" sort by an authoritative
meaningful-activity timestamp; and enforced per-member chat permissions on every
write route with immediate, reload-free propagation. Hermetic CI gate green
(1986 tests); WS1 verified end-to-end in a real browser.

## 2. Agents / subagents used
A 7-agent read-only investigation workflow (one lead per workstream + a shared
infra agent) produced root-cause analyses and file maps up front; implementation,
testing, and integration were performed directly by the main agent.

## 3. Repository areas inspected
Ops Console (AdminConsole.jsx, adminController, admin routes/apiClient); screening
controllers/services (controller, conflict, import, chat, member, review),
realtime bus + events, `screening/access`; the project store + projectsController;
RoB controller; the meta-analysis charts (charts.jsx, svgBuilders, precision);
the import parsers; Prisma schema + migrations + postgres sync; the test harness.

## 4. Root cause of every reported issue
- **Ops Projects (WS1):** the tab was a bare table; no project growth/analytics
  endpoints existed (only Users had them).
- **Large imports (WS2):** a hard 5000-records/batch cap + a 10 MB JSON body limit
  + synchronous parse/insert on the request thread; no durable job.
- **Conflicts (WS3):** `syncConflicts` queried decisions WITHOUT a stage filter
  (a both-included record re-decided at full text looked like a disagreement) and
  early-returned on <2 decisions (stale rows lingered); `detectConflict` counted
  distinct decisions from raw rows (self-conflict); the Conflicts tab had no
  realtime listener.
- **Forest plot (WS4):** chart labels flowed through the export formatter, which
  honours `full` (raw) precision; axis ticks used hardcoded `.toFixed()`.
- **Last Modified (WS5):** sorted by Prisma `@updatedAt`, which is bumped by bare
  row-touches and never reflects screening/RoB activity (other tables); no stable
  tiebreak.
- **Chat permissions (WS6):** the gate (backend + frontend) only blocked when the
  project-wide `chatRestricted` flag was on, so per-member `canChat=false` was
  silently ignored.

## 5. Files changed
Backend: `server/controllers/{adminController, screeningController,
screeningChatController, screeningMemberController, robController}.js`,
`server/services/{screeningConflictService, screeningImportService,
screeningImportWorker}.js`, `server/store.js`, `server/index.js`,
`server/routes/{admin, screening}.js`, `server/prisma/schema.prisma` (+ postgres
mirror) + 2 migrations.
Shared: `src/research-engine/screening/conflicts.js`,
`src/research-engine/import-export/parsers.js`,
`src/research-engine/format/chartFormat.js` (new).
Frontend: `src/frontend/pages/admin/{AdminConsole, adminApiClient}.js(x)`,
`src/frontend/pages/{ProjectLanding, projectLanding.helpers}.js(x)`,
`src/frontend/workspace/charts/charts.jsx`,
`src/frontend/components/chat/ChatDrawer.jsx`,
`src/frontend/screening/{pages/SiftImport, tabs/ConflictsTab,
api-client/screeningApi}.js(x)`.
Tests + docs as below.

## 6. Database changes and migrations
- `Project.lastActivityAt` (nullable) + `@@index([userId, lastActivityAt])`.
- New `ScreenImportJob` table (durable import jobs) + 3 indexes.
Both additive — `prisma db push`-safe (no `--accept-data-loss`); backfills seed
existing rows. Postgres schema mirror synced + drift-tested.

## 7. APIs added / modified
Added: `GET /api/admin/projects/overview`, `/api/admin/project-growth`,
`/api/admin/project-analytics`; `POST /api/screening/projects/:pid/import/start`,
`GET /api/screening/projects/:pid/import/jobs/:jobId`.
Modified: `GET /api/admin/projects` (sort/dir/linked filters + richer rows);
`POST /api/screening/projects/:pid/import` (cap removed, shared service);
chat write routes (per-member enforcement); `PATCH …/members/:mid` (chat audit).

## 8. UI components added / modified
Added `ProjectsDirectory`, `ProjectsOverviewSection`, `ProjectsGrowthSection`,
`ProjectsAnalyticsSection` (Ops Projects subtabs). Modified the forest/funnel
charts, the screening import page (Auto-detect + formats + staged progress bar),
the Conflicts tab (realtime), the chat drawer (read-only state), and the project
landing sort.

## 9. Import formats now supported
RIS, PubMed/MEDLINE (nbib), BibTeX, EndNote XML, Web of Science (CIW),
Scopus/Embase/Cochrane (RIS/CSV), CSV, TSV, and plain text — with content-based
auto-detection (a `.txt` with RIS/PubMed/WoS markers parses correctly) and a
modular `PARSER_REGISTRY`.

## 10. Large-import benchmark results
Unit: a 5,000-record RIS file parses correctly. Integration: a 6,000-record
synchronous import completes (proving the 5000 cap is removed); the async job
imports 300 records, is idempotent (409 on the same file), and a forced
re-import inserts 0 (all duplicates). Insert is `createMany` in 400-row chunks.

## 11. Final conflict-state rules
A conflict = ≥2 DISTINCT reviewers whose active (non-`undecided`) title/abstract
decisions disagree (decisions collapsed per reviewer first). Agreement → auto-
resolve; drop-below-two → delete; manual leader resolution is sticky. Full
matrix in `prompt50-implementation.md` §WS3.

## 12. Real-time update behavior
SSE poke-only bus (refetch through authorized endpoints). `decision.saved` /
`conflict.changed` drive the Conflicts tab; `permissions.changed` flips the chat
composer to read-only; `import.completed` nudges record-list refresh;
`members.changed` updates rosters. `syncConflicts` is awaited before its poke so
refetches are consistent.

## 13. Forest plot formatting rules
Chart-only formatter (`chartFormat.js`): ignores `full`; caps decimals
(estimates 3, weights/I²/% 1 dp, p-values ≥3 dp with `<0.001`); `-0→0`,
non-finite→em-dash, ±∞ glyphs, huge magnitudes→scientific. Export precision is a
separate, user-configurable path.

## 14. Definition of "Last Modified"
`Project.lastActivityAt` — set on a real blob edit and by linked-module activity
(screening decisions/imports/conflict resolution, screening config + members, RoB)
via the central `touchProjectActivity`. Not bumped by bare row-touches or reads.

## 15. Chat permission enforcement details
`canWriteChat(access)` gates send/delete/typing; `canChat=false` (non-leader) →
403 regardless of `chatRestricted`. Frontend `blocked = !canChat && !isLeader`,
refreshed via list responses + `permissions.changed`. Audited with previous→new.

## 16. Security review
All new Ops endpoints are `requireAdmin` (integration-tested: 401 unauth, 403
non-admin). Chat writes enforced server-side on every route. Project access stays
id-scoped (existing existence-hiding 404s preserved). Import content validated +
size-bounded; the raw job content is never returned by the status endpoint;
file names/parser errors are React-escaped on render. Administrative project
actions remain audited.

## 17. Accessibility review
Reused the design-system primitives (keyboard-focusable controls, table
semantics, non-color-only badges). Import progress is a real `role=progressbar`
with `aria-valuenow`; read-only chat uses a true disabled input + `role=status`
message ("Chat is read-only for your account in this project."); sort controls are
labelled. Charts have empty/loading/error states and dark-mode support.

## 18. Automated tests added
Unit: `chartFormat` (24), `importParsers` (16), conflict matrix +
cross-stage (10 added), `projectLanding.helpers` sort (4 added). Integration:
`prompt50-conflicts` (4), `prompt50-import` (3), `prompt50-last-modified` (2),
`prompt50-ops-projects` (6), plus an extended `prompt7-chat` WS6 case. Hermetic
gate: 1986 passing.

## 19. Manual workflows tested
Real-browser (Playwright) end-to-end of the rebuilt Ops Projects tab: login →
Projects → Directory/Overview/Growth/Analytics subtabs all render live data
(totals, donuts, ranked bars, growth charts) with no runtime errors.

## 20. Before-and-after performance findings
Imports: before, refused at 5000 records / blocked the request thread; after,
6000+ succeed and large files run as a background job with progress. Ops Projects:
analytics use bounded count/groupBy/aggregate (no blob loads) + an index on
`(userId, lastActivityAt)`; the directory sorts server-side before pagination with
batched per-page member/conflict counts (no N+1).

## 21. Remaining limitations
- Directory server-side sort covers authoritative columns (lastActivity / created /
  updated / name). Sorting by blob-derived counts (studies/members/conflicts)
  across pages would need denormalised counters — left as a future enhancement;
  those columns are display-only today.
- The realtime bus is single-process (in-memory SSE); multi-instance delivery
  would need a pub/sub broker (the polling fallback preserves correctness).
- The import worker is in-process (no external queue) — the intended durable fit
  for the single-process + SQLite architecture.
- The full *parallel live* integration suite has pre-existing env-config conflicts
  (test files assume different admin emails; waitlist needs its own DB) unrelated
  to this work; the hermetic CI gate and all workstream suites are green.

## 22. Recommended future improvements
Denormalised per-project counters (studies/records/members/conflicts) to enable
DB-level sort on those + cheaper analytics; multipart/streamed upload for the
import (sidestep the JSON body budget entirely); a Redis/broker-backed realtime +
job queue for multi-instance deploys; surface the import error report
(downloadable rejected-records CSV) in the UI; and add the Ops Project detail
drawer tabs for activity/audit and diagnostics.
