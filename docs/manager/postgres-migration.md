# PostgreSQL migration — capability, tooling & runbook (prompt49 item 2)

**Status: the application is now fully PostgreSQL-capable.** Everything code-side
is done and tested; the only remaining step is an operator provisioning a live
Postgres server and running two scripts. This document is the source of truth.

---

## Why this is "ready" rather than "already migrated"

A true migration means moving the live data into a running Postgres and cutting
the app over. That requires a Postgres instance to migrate *into* and to verify
against — and there is **no Postgres in the build/CI/production environment**
today (no `psql`/`pg_dump`/Docker; production is a single-process VPS running
SQLite as a file). You cannot *prove* a migration (row-count / FK / sample
equality) without the target DB, and a half-done cutover would break a working
app. So this work makes the cutover a **config + two commands + verify**
operation instead of an engineering project, and proves the entire
migrate→verify pipeline with a SQLite→SQLite round-trip test (only the target
client/URL changes for real Postgres).

---

## Database inventory (every persistent store)

| Store | Tech | Location / env | Contents | Target |
|-------|------|----------------|----------|--------|
| **Main application DB** | SQLite (Prisma) | `DATABASE_URL` → `server/prisma/dev.db` | User/auth, Project (fat-JSON blob), Screen\* (screening + decisions + AI runs/scores/jobs/feedback), Rob\* (Risk-of-Bias), Workflow\* state, ContactMessage/Reply, PasswordResetToken, AdminAuditLog, SecurityEvent, LoginEvent, UsageEvent, Notification, Institution, Onboarding\*, SiteSetting, AppSequence | **`pecanrev`** Postgres DB |
| **Beta-Waitlist DB** | SQLite (Prisma, separate client) | `BETA_WAITLIST_DATABASE_URL` → `server/prisma/waitlist/beta-waitlist.db` | BetaWaitlistApplicant, BetaWaitlistStatusEvent (applicant PII) | **`pecanrev_waitlist`** Postgres DB (kept isolated) |
| Institution overrides (legacy) | server-local JSON | `server/data/*.json` | small ops overrides | not a runtime source of truth; not migrated |
| Uploaded PDFs | filesystem | `server/storage/` | binary attachments | filesystem (not a database) |

No Supabase, Redis-as-source-of-truth, or IndexedDB-as-source-of-truth exist.
The Project payload lives in the `Project.data` TEXT/JSON column (and, behind a
flag, the additive `ReviewRecord`/`ReviewStudy` relational mirror) — all portable
to Postgres as-is.

## PostgreSQL architecture chosen

**Two separate Postgres databases on one instance** — `pecanrev` (application)
and `pecanrev_waitlist` (applicant PII). This preserves the prompt48 isolation
boundary exactly: the waitlist still has its own datasource, its own generated
client, and **no cross-database foreign keys** (`changedBy` stays an opaque admin
id string). The application uses the default `public` schema; tenant isolation
remains row-level via `userId` ownership checks, unchanged.

## How provider selection works (no Prisma `provider = env()`)

Prisma 5 requires `datasource.provider` to be a string literal, so we keep ONE
canonical SQLite schema and **mechanically derive** the Postgres schema from it:

- `server/prisma/schema.prisma` (+ `prisma/waitlist/schema.prisma`) — canonical,
  SQLite, the source of truth. The models use only portable types
  (String/Int/Float/Boolean/DateTime), `@default(uuid()/now())`, `@updatedAt`,
  `@@index`, `@@unique`, and `onDelete: Cascade` — all identical on both engines.
- `scripts/sync-postgres-schema.mjs` rewrites only the generator/datasource header
  → `prisma/postgres/schema.prisma` + `prisma/postgres/waitlist-schema.prisma`,
  generating the clients to `prisma/generated/postgres-client` and
  `…/postgres-waitlist-client` (separate outputs, so the migration tool can hold a
  SQLite *source* and a Postgres *target* client at once).
- A drift test (`tests/unit/postgres-schema-sync.test.js`) fails CI if the
  canonical schema is edited without re-running the sync, so the two never diverge.
- `server/db/client.js` picks the client at boot from `DATABASE_PROVIDER`
  (`sqlite` default → `@prisma/client`; `postgres` → the generated PG client).
  No call site changes.

## Stable numeric user id (item 8 / §6C)

`User.userNumber` is the immutable, sequential, admin-visible numeric id (distinct
from the internal uuid `id`). It is allocated from the `AppSequence` counter via an
**atomic increment** (`server/services/sequence.js`) — never `MAX(id)+1` — so it is
collision-free under concurrency and identical on SQLite and Postgres. Assigned at
registration; existing users are backfilled in `(createdAt, id)` order at boot
(idempotent). It is in `READONLY_USER_FIELDS`, never in `EDITABLE_USER_FIELDS`, so
the Ops console can display but never edit it. (Verified on the real dev DB: 4567
users numbered, 0 duplicates, idempotent.) On Postgres the counter can later be
swapped for a native `SEQUENCE` with no code change.

---

## Versioned migration workflow (93.md §2.2) — production never uses `db push`

Schema changes ride **committed, versioned Prisma migrations** applied with
`prisma migrate deploy`. `db push` remains a dev/bootstrap convenience only —
`server/scripts/guard-db-push.mjs` (wired into `db:push:postgres`) refuses
push-style commands when the environment is unmistakably production, and the
deploy script
(`deploy/metalab-deploy.sh`) runs `migrate deploy` whenever
`DATABASE_PROVIDER=postgres` (the sqlite `db push` branch it keeps is
explicitly transitional — see `deployment-readiness.md` §2).

The pipeline for every schema change:

1. **Develop locally** — edit the canonical SQLite schema
   (`server/prisma/schema.prisma` / `prisma/waitlist/schema.prisma`), re-run
   `npm run db:sync-postgres-schema` (the drift test enforces this), and
   generate a versioned migration for the PG schema.
2. **Commit the migration directory** (`server/prisma/postgres/migrations/`;
   waitlist history lives separately in
   `server/prisma/postgres/waitlist-migrations/` — the DBs stay strictly
   isolated) — migrations are additive; never edit an applied one.
3. **Apply to staging**: deploy the ref to staging; the deploy script runs
   `npm run db:migrate:deploy:postgres` against the staging DB. Smoke it
   (`docs/manager/staging-deployment.md` § Migration rehearsal flow).
4. **Check status any time**: `npm run db:migrate:status:postgres` (from
   `server/`) — lists applied vs pending for both databases.
5. **Apply to production**: the same committed migrations, applied by the
   same script during the production deploy. Rollback policy (backward-
   compatible migrations, expand-and-contract for risky changes, never
   blindly reversing data migrations): `docs/manager/rollback-runbook.md`.

### Baselining an existing database (one-time)

A database whose schema was previously created with `db push` (or restored
from one) has no `_prisma_migrations` history, so the first `migrate deploy`
would try to re-create existing tables and fail. Baseline it **once** (marks
the committed init baseline as applied WITHOUT running it — under the hood
`prisma migrate resolve --applied 000000000000_init` for both databases):

```bash
cd server
npm run db:migrate:baseline:postgres  # one-time: record the init baseline as applied
npm run db:migrate:status:postgres    # verify: nothing pending that already exists
npm run db:migrate:deploy:postgres    # applies only what genuinely remains
```

This mirrors the §2b baseline note in `deployment-readiness.md` and is needed
exactly once per database, at cutover time.

---

## Operator runbook

> Run everything from the `server/` directory. **Never logs connection strings.**
> The SQLite files are never modified, so they remain the rollback.

### 1. Provision Postgres + two databases
```bash
createdb pecanrev
createdb pecanrev_waitlist
```

### 2. Point the env at source (SQLite) and target (Postgres)
```bash
# sources (existing)
DATABASE_URL="file:./dev.db"
BETA_WAITLIST_DATABASE_URL="file:./beta-waitlist.db"
# targets (new)
POSTGRES_DATABASE_URL="postgresql://user:pass@host:5432/pecanrev?schema=public"
POSTGRES_WAITLIST_DATABASE_URL="postgresql://user:pass@host:5432/pecanrev_waitlist?schema=public"
```

### 3. Generate the PG clients + create the schema (versioned)
```bash
npm run db:generate:postgres          # syncs PG schema + generates both PG clients
npm run db:migrate:deploy:postgres    # applies the committed baseline migrations
                                      # → creates all tables in both Postgres DBs
npm run db:migrate:status:postgres    # verify: no pending migrations
```
(`db:push:postgres` still exists for throwaway local experiments, but the
migrate path above is what staging and production use — 93.md §2.2. A fresh
database needs no baseline step; the committed migrations ARE its history.)

### 4. Back up, copy the data, and verify
The SQLite files ARE the backup (read `sqlite3 dev.db .dump > backup.sql` if you
want a portable copy). Then:
```bash
node scripts/migrate-db.mjs --dry-run    # validation-only pass: connects, orders,
                                         # counts, and reports — writes NOTHING
npm run db:migrate:postgres    # copies + verifies BOTH databases
# or one at a time:  node scripts/migrate-db.mjs --only=main
#                    node scripts/migrate-db.mjs --only=waitlist
```
**Production safety interlock (93.md §2.3):** when the environment is
unmistakably production, the tool refuses to write unless explicitly confirmed
with `--confirm-production` — an unconfirmed run downgrades to the dry-run
report. Always run `--dry-run` first regardless of environment.
The tool is **idempotent and resumable** (upsert by id), copies rows in
**topological FK order** (parents before children), preserves **all** ids,
timestamps (`@updatedAt` is NOT reset), ownership, memberships, relationships,
soft-deletion, screening decisions, notes, ratings, audit chronology, the
`userNumber`, and the `AppSequence` counter, and then runs verification:
row counts per table, sampled deep row-equality, and a grand total. It exits
non-zero on any mismatch — **do not cut over on a failed verify.**

Re-verify any time without writing:
```bash
npm run db:verify:postgres
```

### 5. Cut over
```bash
DATABASE_PROVIDER=postgres   # set in the deploy environment, then restart
```
Health/readiness (`GET /api/health/ready`) pings the active DB, and the
post-deploy smoke test (`scripts/smoke-deploy.mjs`) confirms the deployment.

### 6. Rollback
Unset `DATABASE_PROVIDER` (or set `sqlite`) and restart — the untouched SQLite
files are the live data again. No destructive source deletion happens at any point.

---

## Verification evidence (in this repo)

- `tests/unit/db-migrate-core.test.js` — provider-agnostic logic: delegate
  naming, `@id` detection, **topological FK ordering against the real schema
  DMMF** (User→Project, ScreenProject→ScreenRecord→ScreenDecision,
  RobAssessment→RobAnswer, ContactMessage→ContactMessageRead, …), row equality.
- `tests/unit/postgres-schema-sync.test.js` — the two PG schemas stay byte-in-sync
  with the canonical SQLite schemas (drift guard).
- `tests/unit/userNumber.test.js` — atomic allocator, no-collision, backfill
  ordering/idempotency, never-reassign, never-lower counter.
- `tests/integration/db-migration-roundtrip.test.js` — **end-to-end**: migrates an
  edge-case-rich dataset (Arabic/CJK/accented text, long notes, soft-deletion,
  alternate PKs `SiteSetting.key`/`AppSequence.name`, FK chains, historical
  timestamps, suspension/epoch state, `userNumber`) SQLite→SQLite, verifies all
  counts + sampled rows, and proves idempotency. The ONLY production difference is
  the target client/URL (Postgres). Run: `npx vitest run tests/integration/db-migration-roundtrip.test.js`.

## Remaining (operator-only) work
Provision the Postgres instance and run steps 1–5. That is the single external
dependency that cannot be performed without a live Postgres server.
