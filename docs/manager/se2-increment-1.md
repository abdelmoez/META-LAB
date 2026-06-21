# SE2 — Increment 1: live rescoring + instant explanations

> Implements `se2.md` §1 issue-table items (the Critical ones) + the §6 live-scoring
> and §5 explanation-performance architecture. Feature flag `aiScreening` (default OFF).
> Additive + flag-gated; the default screening path is unchanged when the flag is off.

## Issue table (se2.md §1)

| Type | Request | Area | Priority | Owner | Assignee | Status |
|---|---|---|---|---|---|---|
| Suggestion | Move "AI Screening · Global Policy" into the Screening section of the Ops Console. | Ops Console | High | Abdulmoiz | Claude | **Done** ✅ (Increment 1b — see `se2-increment-1b.md`) |
| Bug | "Why this score?" stuck on "Loading explanation…" too long. | Screening Engine | Critical | Abdulmoiz | Claude | **Done** ✅ |
| Suggestion | Recompute/incrementally update AI scoring on each new decision so reviewers see rankings from the latest human decisions. | Screening Engine | Critical | Abdulmoiz | Claude | **Done** ✅ |

## What shipped

### 1. "Why this score?" is now instant (§5, Critical) ✅
**Root cause:** the explanation *was already persisted* (`ScreenAiScore.explanationJson`)
but the panel fetched it on a separate round-trip when expanded, and the client
helper swallowed errors → `null` → the panel showed **"Loading explanation…" forever**
on any failure/empty result.

**Fix — two layers:**
- **Layer 1 (instant, deterministic):** `listRecords` now attaches the full persisted
  AI score **+ explanation inline** on the returned page (≤ `limit` rows, one indexed
  query) when the flag is on. `AiScoreCard` renders from `record.aiScore.explanation`
  with **zero round-trip** — final score, prediction, confidence, uncertainty, reasons
  to include/exclude, PICO match, similar records, data-quality warnings.
- **Fallback fetch** (rare, only if inline missing) is now **abortable, timed out
  (8 s), cancelled on close**, with a **loading skeleton, timeout/error state, and a
  Retry button** — it can never stick on "Loading…".

No new external LLM request is made for Layer 1 (an optional Layer-2 narrative remains
a documented seam, off by default).

### 2. Near-real-time rescoring after each decision (§6, Critical) ✅
- `saveDecision` saves the human decision **transactionally and first**, then (for
  settled include/exclude only) calls `scheduleRescore(projectId)` — **fire-and-forget;
  a scoring failure can never block or lose the decision**.
- New `server/services/screeningAiJobs.js`: a **debounced (4 s, configurable),
  coalesced** scheduler — **one active job per (project, stage)** with a **rerun flag**
  for decisions arriving mid-run. Each run writes a `ScreenAiJob` row (status/duration)
  for observability, then emits the existing realtime `ai.updated` event.
- **"Maybe" is explicitly NOT trained** as a positive (binary classifier; `maybe`/
  `undecided` → unlabeled). Documented.
- **Queue consistency:** on `ai.updated` the client refreshes scores/badges but does
  **not** auto-reorder under the reviewer — it shows a "Scores updating…" indicator
  (with pending-decision count) and a **"↻ Refresh rankings"** button that re-applies
  the new order **while preserving the current record**.
- New endpoint `GET /api/screening/projects/:pid/ai/job-status` → `{ state, running,
  queued, pending, lastCompletedAt }`.

### 3. Emergency kill switch + live-update settings (§4 prep)
`aiScreeningSettings` gained `liveUpdateEnabled`, `retrainDebounceMs`, and a
`killSwitch` that forces global `enabled=false` everywhere it is consulted.

## DB / API / files
- **Migration (additive, `prisma db push`):** `ScreenAiJob` (bare `projectId` scope key,
  status/trigger/runId/durationMs, indexed). No destructive change; no decision/record
  deletion.
- **New endpoint:** `GET /ai/job-status`.
- **Changed:** `screeningController.listRecords` (inline score+explanation on page),
  `saveDecision` (rescore trigger), `screeningAiController` (job-status), `routes/screening.js`,
  `screeningAiService` (live-update defaults + kill switch), `settingsController` (defaults),
  `AiAssist.jsx` (instant explanation + states + updating indicator), `useScreeningAi.js`
  (job status + live-update handling), `ScreeningTab.jsx` (realtime + position-preserving refresh).
- **New:** `server/services/screeningAiJobs.js`.

## Verified
1623 unit tests green; production build green. Real-DB smoke: debounced rescore job
completes (16 scored), `getJobStatus` returns idle/0-pending after completion, and
`listRecords` attaches a full inline explanation (with PICO breakdown) to every page
record — confirming **no round-trip** for "Why this score?".

## Performance (se2.md §5 targets)
- Cached/inline explanation panel: renders from already-loaded record data → **no
  network call** (well under the 300 ms p95 target).
- Fallback fetch: single indexed-row read, 8 s hard timeout, retry — **never indefinite**.

## Honesty note (§7/§19)
The current semantic signal is **TF-IDF lexical similarity** (or the optional dense
embedding provider when configured) — it is labeled as such, not as "biomedical semantic
understanding." A real biomedical-embedding default is Increment 3.

## Next (this PR series)
- **1b:** ✅ **DONE** — relocated AI Screening Global Policy into the Ops Console
  **Screening** section as the **AI Policy** sub-tab with grouped subsections (one source
  of truth, RBAC inherited, before→after audit) — §4. See `se2-increment-1b.md`.
- **Increment 2:** probability calibration (Platt/isotonic, out-of-fold) + statistically
  grounded stopping rules — §8/§9.
- **Increment 3:** biomedical embedding service, duplicate calibration, model
  versioning/drift/rollback, background-job scalability beyond 5k — §7/§10/§11/§12.

## Config (settings-driven, not env — tunable in Ops without redeploy)
`liveUpdateEnabled` (default true), `retrainDebounceMs` (4000), `killSwitch` (false),
in the `aiScreeningSettings` SiteSetting.
