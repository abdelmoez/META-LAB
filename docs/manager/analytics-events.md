# Product Analytics Events (93.md §5.3/§5.4)

Server-side signup + activation analytics, built ON TOP OF the existing
`UsageEvent` foundation (`server/utils/usage.js`) — one event system, not two.
The wrapper lives in `server/services/analytics.js`:

* `recordEvent(type, { userId, projectId?, screenProjectId?, format?, meta? })`
* `recordFirstEvent(type, userId, opts?)` — at most once per user, **atomic**:
  the row is inserted with the deterministic primary key
  `first:<TYPE>:<userId>`, so the database itself rejects a second (or
  concurrent) insert. No check-then-create race window.
* `redactMeta(meta)` — key whitelist + string truncation (see Redaction rules).
* Optional PostHog forwarding (see PostHog opt-in config).

Every call is fire-and-forget and never throws — analytics can never fail,
slow or 500 a request, a worker, or the login path.

## Event catalog

| Event | When it fires | Recorded from | Properties (meta) | First-only? |
| --- | --- | --- | --- | --- |
| `ACCOUNT_CREATED` | Successful `POST /api/auth/register` | `authController.register` | `source: 'register'` | No (naturally once per account) |
| `EMAIL_VERIFIED` | Verification token consumed OK (`POST /api/auth/verify-email`; flow exists behind the `requireEmailVerification` app setting, prompt26) | `authController.verifyEmail` | — | **Yes** (a user can burn several resent tokens; the funnel counts each verified user once) |
| `FIRST_LOGIN` | First successful `POST /api/auth/login` ever | `authController.login` | — | **Yes** |
| `PROJECT_CREATED` | Every successful `POST /api/projects` | `projectsController.createProject` | `metaLabProjectId` column | No |
| `FIRST_PROJECT_CREATED` | The user's first project create | same site | `metaLabProjectId` column | **Yes** |
| `IMPORT_COMPLETED` | (a) durable screening import job reaches `completed`/`completed_with_warnings`; (b) direct META·LAB reference import (`POST /api/import/references`) succeeds | `screeningImportWorker.processJob`, `importExportController.importReferences` | `count` (imported records), `source` (detected format: ris/bibtex/…) | No |
| `FIRST_IMPORT_COMPLETED` | The user's first completed import via either path | same sites | project id column | **Yes** |
| `SCREENING_DECISION_FIRST` | The user's FIRST-ever screening decision save (`POST …/records/:rid/decision`). Deliberately **not** one event per decision — decisions already live in `ScreenDecision`; recording each one would bloat `UsageEvent`. | `screeningController.saveDecision` | `stage`, `screenProjectId` column | **Yes** (this IS the event; there is no per-decision variant) |
| `FIRST_ANALYSIS_RUN` | The user's first successful pooled meta-analysis (`POST /api/meta/run` returning a result) | `metaController.runMetaAnalysis` | `count` (number of studies — never study data) | **Yes** |
| `FIRST_SEARCH_STARTED` | The user's first automated Pecan search run created (round 2) | `pecanSearch/runService.startRun` | `metaLabProjectId` column | **Yes** |
| `FIRST_SEARCH_COMPLETED` | The initiating user's first search run reaching `completed` (round 2) | `pecanSearch/runService` finalize | `metaLabProjectId` column | **Yes** |
| `FIRST_EXPORT` | **DERIVED — never written.** Every export path already records an `EXPORT` row (`UsageEvent.type = 'EXPORT'`, all sites since prompt9). "First export" = the user's earliest `EXPORT` row: `min(createdAt) group by userId where type = 'EXPORT'`. The constant exists only so queries/docs share one spelling. | — | (derives `format`, project ids from the EXPORT row) | Derived |
| `FEEDBACK_SUBMITTED` | Successful `POST /api/contact` | `server/routes/contact.js` | `source: 'contact'`, `severity` (closed enum) — never the message/subject/name/email | No |
| Waitlist signup | **Not duplicated here.** Signups already produce a `BetaWaitlistStatusEvent` (`fromStatus: null → WAITLISTED`, note "Joined waitlist") in the strictly isolated waitlist DB (prompt48). Count signups from that table. | `server/waitlist/waitlistRepository.js` | — | No |
| Invitations | **Pre-existing** `INVITE_CREATED` / `INVITE_ACCEPTED` / `INVITE_REVOKED` UsageEvents (prompt9) — unchanged. Invitation conversion = accepted / created. | invite controllers | — | No |
| Exports | **Pre-existing** `EXPORT` UsageEvents with `format` + project ids — unchanged. | export controllers/workers | — | No |
| Active use | **Pre-existing** `APP_ACTIVE` (≤ 1/user/5min) + `LoginEvent` rows — these power retention (D1/D7/D30) day-buckets. | `requireAuth` throttle | — | No |

## Activation definition (93.md §5.3)

A user is **activated** when ALL three legs hold:

1. `FIRST_PROJECT_CREATED` exists, **and**
2. `FIRST_IMPORT_COMPLETED` **or** `FIRST_SEARCH_COMPLETED` exists, **and**
3. `SCREENING_DECISION_FIRST` **or** `FIRST_ANALYSIS_RUN` **or** first export
   (derived from earliest `EXPORT` row) exists.

**Time to value (TTV)** = `min(createdAt)` of any leg-3 event minus
`User.createdAt`.

**Retention** — a user is retained on day N when an `APP_ACTIVE` (or
`LoginEvent`) row exists in the [N, N+1) day window after `ACCOUNT_CREATED`.

## Initial targets (93.md §5.4)

> **These are INITIAL GOALS for dashboards/reporting — not proven benchmarks,
> and deliberately NOT hardcoded anywhere in product logic.**

| Metric | Initial goal |
| --- | --- |
| Activation rate | ~40–60% |
| Time to first value | < 20 minutes |
| D1 retention | > 50% |
| D7 retention | > 25% |
| D30 retention | > 15% |

## Redaction rules

`redactMeta()` (unit-tested) is **whitelist-only** — anything not on the list
is dropped, which is what guarantees content can never leak:

* Allowed keys: `projectId`, `screenProjectId`, `count`, `source`,
  `durationMs`, `format`, `severity`, `stage`.
* Allowed values: finite numbers, booleans, non-empty strings (truncated to
  120 chars). Objects/arrays/functions are dropped entirely (nested structures
  are where content smuggles in).
* NEVER recorded: titles, abstracts, manuscript text, search queries, message
  bodies, names, emails, tokens. User identification is the internal user id
  (opaque uuid) only.

## Disable switch

`ANALYTICS_DISABLED=1` (or `true`) short-circuits `recordEvent`,
`recordFirstEvent` **and** PostHog forwarding — no rows, no network. Read at
call time, so it can be toggled per environment without code changes.
Operational telemetry that calls `recordUsage` directly (exports, invites,
emails, `APP_ACTIVE`) is deliberately NOT gated — it powers the admin ops
console, not product analytics.

## PostHog opt-in config

Forwarding is **disabled by default**; it activates only when BOTH are set:

```
POSTHOG_API_KEY=phc_xxx
POSTHOG_HOST=https://eu.i.posthog.com     # or your self-hosted instance
```

Behaviour: events are batched in memory and flushed every 5 s to
`POST <host>/capture/`; `distinct_id` is the internal user id; properties are
the already-redacted meta only. The queue is hard-capped at 500 (overflow →
dropped + counted, observable via `posthogQueueStats()`); a failed batch is
dropped and **never retried**; the flush timer is `unref`'d so shutdown is
never held up (up to one 5 s window of queued forwards may be lost — local
UsageEvent rows are unaffected). Session replay is not enabled anywhere.

## Staging separation

Comes free by construction — document per environment:

* Local rows go to the environment's own database (`DATABASE_URL`), so staging
  UsageEvents never mix with production.
* Use a **separate PostHog project key per environment** (or leave
  `POSTHOG_API_KEY` unset on staging) so staging traffic cannot pollute
  production dashboards. Setting `ANALYTICS_DISABLED=1` on staging is the
  bluntest correct option.
