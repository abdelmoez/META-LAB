# Prompt 50 — Implementation Notes

Technical reference for the six workstreams delivered under `.claude/Prompts/50.md`:
Ops Projects analytics, scalable screening imports, conflict logic, forest-plot
display precision, "Last Modified" sorting, and project chat permissions.

---

## WS1 — Ops Console Projects tab

**Architecture.** `ProjectsSection` (src/frontend/pages/admin/AdminConsole.jsx) is
now a multi-view workspace (Directory / Overview / Growth / Analytics) mirroring
the Users tab, using the shared `UsersSubTabs`, `OpsErrorBoundary` (per-view crash
isolation), and the existing KPI/chart/ranked-bar/donut primitives. All numbers
come from authoritative backend aggregates — no fabricated data, no project blobs
loaded into the browser.

**Endpoints (admin only — `requireAdmin`):**

| Route | Purpose |
| ----- | ------- |
| `GET /api/admin/projects` | Paginated directory. Params: `page, limit, search, status (active\|archived), userId, linked (yes\|no), sort (lastActivity\|created\|updated\|name), dir (asc\|desc)`. Server-side sort happens BEFORE pagination with a deterministic same-direction tiebreak (`<sortKey>, createdAt, id`), so order is correct across every page and reproducible on refresh. Rows carry `lastActivityAt, memberCount, conflictsOpen` (batched groupBy — no N+1). |
| `GET /api/admin/projects/overview` | Platform totals (active / admin-archived / owner-deleted), creation windows with previous-period deltas, activity (modified-this-month, inactive 30d/90d), and screening rollups (with-screening, open-conflicts, with-RoB, avg members, by-stage). |
| `GET /api/admin/project-growth?year=` | Project creation over time — windows, by year/month/quarter/day, this-month stats. Same shape as `user-growth` so the frontend reuses the growth components. |
| `GET /api/admin/project-analytics?window=` | Distributions filtered to a creation window: by status, by owner (top 12), by screening link, by stage, RoB/screening completion. |

**Analytics definitions.** *Active* = `deletedAt IS NULL`. *Admin-archived* =
`deletedAt` set with `deletedSource != 'owner'`. *Owner-deleted* =
`deletedSource = 'owner'`. *With screening* = has a live linked `ScreenProject`.
*Open conflicts* = distinct projects whose linked screening has a
`ScreenConflict` with `resolvedAt IS NULL`. *Inactive 30/90d* = `lastActivityAt`
older than 30/90 days. These reuse the SAME counters the screening engine uses —
no divergent Ops-only count logic.

**Performance.** Overview/growth/analytics read only small columns (never the
`data` blob); counts/groupBy/aggregate are bounded. The directory uses an index on
`(userId, lastActivityAt)` (WS5) and batched per-page member/conflict counts.

---

## WS2 — Scalable screening imports + file formats

**Pipeline.** `server/services/screeningImportService.js` is the shared core
(parse → dedupe → bulk insert) used by both the synchronous endpoint and the
durable async job. `server/services/screeningImportWorker.js` is an in-process,
DB-backed worker that drains queued jobs off the request thread.

**Limits.** The old hard **5000-records-per-batch cap is removed.** Ceilings are
now a generous absolute per-import safety bound (`MAX_RECORDS_PER_IMPORT = 200000`)
and the admin-configurable per-project total (`maxRecordsPerProject`, default
`DEFAULT_MAX_RECORDS_PER_PROJECT = 100000`). Insert uses `createMany` in
`INSERT_CHUNK = 400`-row batches (under SQLite's 999-variable limit). Import
endpoints get a 64 MB JSON body budget (10 MB elsewhere).

**Durable async job.** `ScreenImportJob` (new table) persists the source content
so the browser need not stay open and a restart resumes work.
- `POST /api/screening/projects/:pid/import/start` → `202 { jobId }`. Idempotent
  by `(projectId, fileHash)`: an in-flight job is reused; a completed one →
  `409 duplicate_import` unless `force`.
- `GET /api/screening/projects/:pid/import/jobs/:jobId` → status/progress (raw
  content never leaked).
- Job states: `status` ∈ `queued | processing | completed | completed_with_warnings | failed`;
  `stage` ∈ `queued | deduplicating | saving | done | failed`. `completed_with_warnings`
  when records were rejected (no usable title/DOI/PMID).
- The synchronous `POST …/import` is retained for small files (back-compat).

**Supported formats / parser registry.** `src/research-engine/import-export/parsers.js`
exports `PARSER_REGISTRY`, `SUPPORTED_IMPORT_FORMATS`, `parseByFormat`,
`detectFormat`, and `stripBom`. Formats: RIS, PubMed/MEDLINE (nbib), BibTeX,
EndNote XML, Web of Science (CIW), Scopus/Embase/Cochrane (RIS/CSV), CSV, TSV,
plain text. `detectAndParse` auto-detects by content markers first (so a `.txt`
file holding RIS/PubMed/WoS content is parsed correctly — a `.txt` is never
treated as one generic format), with extension hints and a fallback chain. A new
database format is added in ONE place (the registry).

**Encoding / data quality.** UTF-8 (+ BOM stripped via `stripBom`); CRLF/LF
normalised for the fingerprint. Records with no usable identity are counted as
`rejected` and reported, never silently dropped. Duplicates (exact DOI / exact
PMID / normalised title) are skipped and reported.

**Max tested import sizes.** Unit: a 5,000-record RIS file parses correctly.
Integration: a 6,000-record synchronous import succeeds (proving the 5000 cap is
gone); the async job lifecycle is verified with 300 records incl. idempotency and
force re-import (0 new, all duplicates).

**Recovery procedures.** A job left `processing` by a crash for >10 min is
re-queued at boot (`startImportWorker`). A failed job records a user-facing
`error`; the source `content` is cleared on any terminal state. Re-running the
same file is idempotent (409 / record-level dedupe), so a refresh/retry never
double-inserts.

---

## WS3 — Conflict-state rules

Conflicts are a **title/abstract** concept (full-text "second review" is
leader-finalised via `finalizeRecord`, not the Conflicts tab).

`detectConflict` / `consensusState` (src/research-engine/screening/conflicts.js)
are the single source of truth. A conflict requires **two or more DISTINCT
reviewers** whose **active (non-`undecided`) decisions disagree**. Decisions are
collapsed to one active decision **per reviewer** before counting distinct values,
so one reviewer with multiple rows (e.g. include at title/abstract, exclude at
full text) can never self-conflict.

Decision matrix (`consensusState`, default 2 required reviewers):

| Reviewer A | Reviewer B | State |
| ---------- | ---------- | ----- |
| none | none | `awaiting_screening` |
| include/exclude | none | `awaiting_second_reviewer` |
| include | include | `agreement_included` |
| exclude | exclude | `agreement_excluded` |
| include | exclude (either order) | `conflict` |
| maybe | maybe | `agreement_other` |
| include / exclude | maybe | `conflict` |

`syncConflicts` (server/services/screeningConflictService.js) is **stage-scoped**
(title/abstract) and reconciles the `ScreenConflict` row each time a decision
changes: create/reopen on disagreement, auto-resolve (`resolvedBy='auto'`) on
unanimous agreement, delete on drop-below-two-reviewers; a leader's MANUAL
resolution is sticky. It is awaited before the `decision.saved` realtime poke, so
a refetch sees consistent state. `ConflictsTab` subscribes to `decision.saved` /
`conflict.changed` and refetches, so conflicts appear/disappear without a reload.

---

## WS4 — Forest-plot display formatting & export precision

`src/research-engine/format/chartFormat.js` is a chart-DISPLAY formatter, separate
from `precision.js` (the export/report formatter). The interactive ForestPlot /
FunnelPlot route every visible number through it. Rules:

- `full` (raw, unrounded) precision is **always ignored** on a chart — this is what
  killed `0.00000000000000000`.
- Decimals capped at `CHART_MAX_DECIMALS = 4` (effect estimates 3); weights / I² /
  percentages at 1 dp; p-values ≥3 dp with a `<0.001` threshold.
- Edge cases: `-0 → 0`; NaN/null/'' → em-dash; ±Infinity → `∞`/`−∞`; magnitudes
  `≥ 1e7` → compact scientific notation; locale-independent (`toFixed`, ASCII).

**Export precision is untouched.** The publication SVG (`svgBuilders.js`) and the
CSV/report export (`ExportDialog.jsx`) keep their own user-configurable precision
(incl. `full`). Chart ≠ export by construction — they share no formatter.

---

## WS5 — "Last Modified" sorting & meaningful-activity timestamp

`Project.lastActivityAt` (new, indexed `(userId, lastActivityAt)`) is the
authoritative meaningful-activity timestamp, distinct from Prisma's generic
`@updatedAt` (which a bare row-touch bumps).

- `store.save()` / `saveAsMember()` stamp it on a real content change only (the
  existing no-op guard means merely opening/normalising a project never reorders).
- `touchProjectActivity(metaLabProjectId)` (server/store.js) is the central way a
  linked module records activity without touching the blob. Wired into: screening
  decisions, imports, conflict resolution, screening project-config + member/
  permission changes, and every RoB mutation (via its audit chokepoint).
- `getAll()` sorts `[lastActivityAt desc, createdAt desc, id asc]` (server-side,
  deterministic, null-safe). The landing comparator, "recent" check and relative-
  time displays use the same field.

**Migration / backfill.** Additive nullable column + index (`db push`-safe);
migration seeds `COALESCE(updatedAt, createdAt)`; an idempotent boot backfill
(`backfillProjectActivity`) covers any `db push` row where it is still null, so
ordering is correct from the first request.

---

## WS6 — Chat permission semantics

A member with `canChat = false` (owner/leaders exempt) is **read-only**: they keep
read access to existing chat but cannot create new content — **regardless of the
project-wide `chatRestricted` flag** (the previous coupling was the bug). Enforced
on EVERY chat write route — send, delete, typing — via `canWriteChat(access)` in
`server/controllers/screeningChatController.js`, so a forged body / stale tab /
replayed event / direct API call all get `403`.

The change propagates without a reload: `updateMember` already emits a
user-targeted `permissions.changed` SSE poke; `ChatDrawer` handles it (and every
authorized `list()` response refreshes `canChat`), flipping `blocked = !canChat &&
!isLeader` to a true disabled composer. The change is recorded in the audit trail
with previous → new chat permission. Only `canManageMembers` holders (owner/leader)
may change it; owner-only rules for leader-level powers are unchanged.

---

## Environment variables

| Var | Notes |
| --- | ----- |
| `maxRecordsPerProject` (META·SIFT setting) | Per-project record ceiling; default 100000 (`DEFAULT_MAX_RECORDS_PER_PROJECT`). |
| Import body limit | Hardcoded: 64 MB for `/import` + `/import/start`, 10 MB elsewhere (server/index.js). |
| `analysisPrecision` (per project) | Effect-estimate decimals for chart + export. Export may additionally request `full`; the chart never honours it. |

## New migrations / indexes

- `20260622000000_prompt50_project_last_activity` — `Project.lastActivityAt` + index `(userId, lastActivityAt)` + backfill.
- `20260622010000_prompt50_screen_import_job` — `ScreenImportJob` table (+ indexes on `(projectId,status)`, `(status,createdAt)`, `(projectId,fileHash)`).

Both are additive (nullable columns / new table) and apply with `prisma db push`
without `--accept-data-loss`. The Postgres schema mirror is kept in sync via
`server/scripts/sync-postgres-schema.mjs` (guarded by a drift test).
