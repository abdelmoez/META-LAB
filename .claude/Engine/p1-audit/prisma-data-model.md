# P1 Audit — Prisma Schema & Data Model

Audit scope: Prisma schema, DB providers, how Project / screening project / study & reference
records / import batches are modeled, Ref-ID generation, migration conventions, SQLite↔PG
portability, and where canonical bibliographic records live + how studies attach to a screening
project. READ-ONLY. All paths absolute-relative to repo root `H:/META-LAB/META-LAB`.

---

## 1. Schema files & generated clients

Canonical (hand-edited) SQLite schemas:
- `server/prisma/schema.prisma` — **MAIN app DB** (canonical source of truth). 1136 lines, ~40 models.
- `server/prisma/waitlist/schema.prisma` — beta-waitlist DB (STRICT isolation; PII never mixes).

Derived (GENERATED — do not hand-edit) Postgres schemas:
- `server/prisma/postgres/schema.prisma` — PG variant of main, header note line 1-3: "GENERATED FILE — DO NOT EDIT BY HAND".
- `server/prisma/postgres/waitlist-schema.prisma` — PG variant of waitlist.

Generated clients (output dirs):
- default `@prisma/client` (SQLite) — from `server/prisma/schema.prisma` (no custom `output`).
- `server/prisma/generated/postgres-client` — from postgres/schema.prisma (`output = "../generated/postgres-client"`).
- `server/prisma/generated/waitlist-client` and `.../postgres-waitlist-client` for the waitlist DB.

The PG schemas are mechanically derived from the canonical SQLite schemas by
`server/scripts/sync-postgres-schema.mjs` (see §5). A drift test asserts they stay in sync; CI fails
if a canonical schema is edited without re-running the sync.

---

## 2. DB provider selection (SQLite + Postgres-readiness)

Single app client: **`server/db/client.js`** — every server module does
`import { prisma } from '../db/client.js'`.

Selection logic (`resolvePrismaClientCtor()`, client.js:20-34):
- `process.env.DATABASE_PROVIDER` unset / anything else → **SQLite** via standard `@prisma/client`
  (`datasource db { provider = "sqlite"; url = env("DATABASE_URL") }`, schema.prisma:9-12). This is
  today's production path, byte-for-byte the original behaviour.
- `DATABASE_PROVIDER = "postgres" | "postgresql"` → lazily `require('../prisma/generated/postgres-client').PrismaClient`.
  Throws a clear error if that client was never generated (`npm run db:generate:postgres`).
- The Postgres client is required **lazily** so a pure-SQLite deploy never needs the PG client on disk.
- Singleton via `globalThis.__prisma` in non-production (client.js:38-42).

KEY CONSTRAINT (why two schema files exist): Prisma 5 requires `datasource.provider` to be a
**literal string** — it cannot be an env var. So the provider is fixed per-schema-file, and the PG
file is generated from the canonical one. The only differences between the two files are the
generator `output` and the datasource `provider`/`url` header (sync-postgres-schema.mjs:13-15).

PG datasource (postgres/schema.prisma:23-26): `provider = "postgresql"`, `url = env("POSTGRES_DATABASE_URL")`.

---

## 3. Core models for P1

### 3a. `Project` (META·LAB research project) — schema.prisma:217-252
- `id String @id @default(uuid())`, `userId` → `User` (onDelete Cascade), `name`.
- **`data String @default("{}")`** — the JSON-serialised project payload. THIS IS THE CANONICAL
  STORE today: studies, records, pico, search, prisma, analysis all live in this blob (the mkProject
  shape — see §7). The relational tables below are additive/inert mirrors.
- Lifecycle: `deletedAt`, `deletedSource` ('owner'|'admin'), `archived`/`archivedAt`, `lastSavedAt`.
- **`lastActivityAt DateTime?`** (prompt50 WS5) — authoritative "meaningful activity" timestamp, set
  via `touchProjectActivity()` on real edits / linked-module actions (screening decision/import/RoB).
  Indexed `@@index([userId, lastActivityAt])`. (Distinct from Prisma `@updatedAt`.)
- Back-relations (no column on Project): `reviewRecords ReviewRecord[]`, `reviewStudies ReviewStudy[]`,
  `robAssessments`, `robManualStudies`, `workflowModuleStates`.

### 3b. `ScreenProject` (the screening project) — schema.prisma:441-482
- `id`, `ownerId` → `User` (relation "UserScreenProjects"), **`linkedMetaLabProjectId String?`**
  (links to a `Project.id`; `@@index([linkedMetaLabProjectId])`). This is the join between a META·LAB
  project and its screening workspace.
- `title`, `description`, `reviewQuestion`, `stage` (default 'title_abstract'), `blindMode`,
  `requiredScreeningReviewers Int @default(2)`, `progressStatus`, `archived`, `disabled`.
- Highlight/filter config (all JSON strings): `inclusionKeywords`, `exclusionKeywords`,
  `studyTypeFilter`, **`picoSnapshot`** (cached PICO/criteria), `aiSettings`.
- Relations: `records ScreenRecord[]`, `labels`, `exclusionReasons`, `duplicateGroups`, `conflicts`,
  **`importBatches ScreenImportBatch[]`**, **`importJobs ScreenImportJob[]`**, `members`, `chatMessages`,
  `auditLogs`.

### 3c. `ScreenRecord` — THE record screening consumes — schema.prisma:484-528
This is the canonical per-reference row that the screening UI/queue reads. P1 auto-import MUST land
rows here.
- `id`, `projectId` → `ScreenProject` (Cascade), **`importBatchId String?`** → `ScreenImportBatch`,
  `duplicateGroupId String?` → `ScreenDuplicateGroup`, `isPrimary`, `isDuplicate`.
- **Bibliographic identity columns** (all `String @default("")`): `title`, `authors`, `year`,
  `journal`, `doi`, `pmid`, `abstract`, `keywords`, **`sourceDb`**, **`rawData String @default("{}")`**
  (full raw parsed object).
- Two-stage workflow: `currentStage` ('title_abstract'|'full_text'), `finalStatus`, `promotedAt`,
  `promotedVia`, `acceptedAt`, `rejectedReason`.
- META·LAB extraction handoff: `handoffStatus`, `handoffAt`, `handoffStudyId`, `handoffError`,
  `revertedExtractionSnapshot`.
- Relations: `decisions ScreenDecision[]`, `conflicts`, `pdfAttachments ScreenPdfAttachment[]`, `openStates`.
- NOTE: there are NO indexes on `doi`/`pmid`/`title` declared on `ScreenRecord` itself (dedup reads
  filter by `projectId` then scan identity columns in memory — see §6). `ScreenImportBatch` does have
  `@@index([projectId, fileHash])`. (Possible P1 perf gotcha at very large N.)

### 3d. `ScreenImportBatch` — provenance of one import — schema.prisma:613-631
- `id`, `projectId` (Cascade), `filename`, `format`, `recordCount`.
- Import fingerprinting (nullable, prompt6 Task 19): **`fileHash String?`** (sha256 of
  line-ending-normalized content), `fileSize`, `importedById`, `importedByName`, `parser`.
- `records ScreenRecord[]`. `@@index([projectId, fileHash])`.
- This is the natural place P1 should attach search-source provenance per batch (or extend with new
  source columns analogous to ScreenPdfAttachment's `source`/`sourceUrl`/`matchedBy` additive set).

### 3e. `ScreenImportJob` — durable async import job — schema.prisma:640-674
The model for P1's auto-import worker. Persists source content so the job survives request end /
worker restart. Idempotent by `(projectId, fileHash)`.
- `status` (queued|processing|completed|completed_with_warnings|failed), `stage`
  (queued|validating|detecting|parsing|deduplicating|saving|finalizing|done|failed).
- `filename`, `format`, `detectedFormat`, `fileHash?`, `fileSize`, **`content String`** (source text;
  cleared on terminal state), `force Boolean`.
- Counters: `totalRecords`, `processedRecords`, `importedRecords`, `duplicateRecords`,
  `rejectedRecords`, `warningCount`, `errorReport` (JSON `[{index,title,reason}]`), `error`.
- `batchId String?` (linked ScreenImportBatch once records saved), `startedAt`, `completedAt`.
- `@@index([projectId, status])`, `@@index([status, createdAt])`, `@@index([projectId, fileHash])`.

### 3f. `ScreenPdfAttachment` — already has provenance fields (a template for P1) — schema.prisma:741-765
roadmap 1.4 added an ADDITIVE provenance/auto-acquisition block that P1 should mirror for search-sourced
records: `source` (manual_upload|oa_unpaywall|oa_openalex|oa_crossref|uploaded_matched), `oaStatus?`,
`sourceUrl?`, `resolvedDoi?`, `matchedBy?` (doi|pmid|title|title+year|manual), `matchConfidence Float?`,
`retrievalAttemptedAt?`, `retrievalError?`. This is the canonical PROVENANCE PATTERN already in the schema.

---

## 4. Ref-ID generation (AppSequence / userNumber / atomic sequence)

There is **one** atomic-sequence mechanism in the codebase:

- Model **`AppSequence`** (schema.prisma:127-131): `name String @id`, `value Int @default(0)`,
  `updatedAt`. One row per logical sequence. Application-managed monotonic counter (Prisma can't put
  `@default(autoincrement())` on a non-PK column on SQLite; MAX(col)+1 is racy).
- Allocator: **`server/services/sequence.js`**:
  - `allocateNumber(name, client=defaultPrisma)` (sequence.js:28-41): `upsert` to ensure the row, then
    a single atomic `update { value: { increment: 1 } }` returning the new value. The DB row-level
    serialisation of that increment is the uniqueness guarantee — concurrency-safe and identical on
    SQLite & PG, NO interactive transaction needed.
  - `ensureSequenceAtLeast(name, floor, client)` (sequence.js:48-61): raises (never lowers) the counter
    via a GUARDED `updateMany({ value: { lt: f } })` so a parallel allocateNumber that already ran
    higher is not clobbered. Used by backfills before assigning gaps.
- Today the ONLY consumer is **`User.userNumber Int?`** (schema.prisma:28, sequence name `"userNumber"`)
  — an immutable, admin-visible numeric user id. It is `@@index([userNumber])` (NOT `@unique` —
  uniqueness by construction; a `@unique` would force `prisma db push` to demand `--accept-data-loss`,
  which the deploy script never passes).

IMPLICATION FOR P1: if the Pecan Search Engine needs a human-facing sequential "Ref ID" per imported
reference, the established, portable, concurrency-safe pattern is to add a new named `AppSequence`
(e.g. `"refNumber"` or per-project) and allocate via `allocateNumber()`. ScreenRecord currently has
NO numeric/human ref-id — only the uuid `id` and the in-document 8-char `record.id` (uid()). NOTE the
allocator is a GLOBAL counter keyed by name; a per-project ref-id would need a per-project name or a
different scheme.

---

## 5. Migration conventions (db push, NOT migrate; round-trip tooling)

The deploy convention is **`prisma db push`, never `prisma migrate`** — there is no
`prisma/migrations/` directory. The entire schema is written to be ADDITIVE-SAFE so `prisma db push`
never needs `--accept-data-loss`. Recurring schema rules (stated in dozens of model comments):
1. New columns are nullable or defaulted ("→ `prisma db push` stays additive-safe").
2. New tables are fine (push creates them cleanly).
3. Lookup columns that need uniqueness use a plain `@@index`, NOT `@unique`, when a unique constraint
   would force `--accept-data-loss` on the VPS deploy (e.g. `User.userNumber`,
   `ScreenProjectMember.inviteTokenHash`, `PasswordResetToken.tokenHash`). Uniqueness is then
   guaranteed by construction (256-bit tokens + single-use, or the AppSequence allocator).
4. `@@unique` IS used freely on brand-new tables (push creates them with the constraint cleanly).

Boot-time backfills run in `server/index.js` (e.g. lastActivityAt backfill ~L328) rather than via
migration files. One-off migration SCRIPTS live in `server/scripts/`:
- `rebrand-pecanrev.js` (idempotent data rewrite for existing DBs), `verify-existing-users.js`,
  `backfill-keywords.js`, `backfill-workspaces.js`, `repair-linked-access.js`, `init-settings.js`,
  `seed-admins.js`.

SQLite→Postgres migration toolchain (prompt49 item 2 — "Postgres-readiness"):
- `server/package.json` scripts:
  - `db:sync-postgres-schema` → `node scripts/sync-postgres-schema.mjs` (derive PG schemas).
  - `db:generate:postgres` → sync + `prisma generate --schema=prisma/postgres/schema.prisma` (+waitlist).
  - `db:push:postgres` → `prisma db push --schema=prisma/postgres/schema.prisma` (+waitlist).
  - `db:migrate:postgres` → `node scripts/migrate-db.mjs` (data copy SQLite→PG).
  - `db:verify:postgres` → `node scripts/verify-migration.mjs`.
- Provider-agnostic data migration core: **`server/db/migrate/core.js`**:
  - `delegateName(modelName)` (L27), `idFieldName(model)` (L32).
  - `planModels(models)` (L44-80): topo-sorts models by DMMF FK metadata (Kahn's algorithm) so parents
    are written before children — FK constraints satisfied on PG without deferring.
  - `migrateAll(source, target, {models, batchSize=500, onProgress, only})` (L88-123): cursor-paginates
    by `@id` and copies each row with `upsert` keyed on `@id` → IDEMPOTENT + RESUMABLE. Copies ALL
    scalars verbatim including `createdAt`/`updatedAt` (Prisma only auto-fills defaults when value
    absent). `createMany`-free (one upsert per row).
  - `verifyAll(source, target, {models, sampleSize=25})` (L156-192): per-model count equality + sample
    deep-equality (`rowsEqual`/`normalizeRow`, Date→ISO, float jitter tolerance).
  - Round-trip proven SQLite→SQLite in `tests/integration/db-migration-roundtrip.test.js` (no live PG
    needed). Operator provisions the real PG instance — the only real blocker per MEMORY.

PORTABILITY GUARANTEE: schemas use only portable column types (String/Int/Float/Boolean/DateTime),
`@default(uuid())`, `@default(now())`, `@updatedAt`, `@@index`, `@@unique`, and relations with
`onDelete: Cascade` — all identical across SQLite and PG (sync-postgres-schema.mjs:12-16). P1 MUST
stay within this portable subset, or it breaks the PG-readiness contract and the drift test.

---

## 6. Existing import → record pipeline (the seam P1 plugs into)

This is the EXACT path to land references into a screening project. P1 (search results → auto-import)
should feed this pipeline rather than inventing a new one.

Service core: **`server/services/screeningImportService.js`** (prompt50 WS2):
- `parseImportContent(content, {format, filename})` (L44-47) → `{records, detectedFormat}` via
  `parseByFormat` from `src/research-engine/import-export/parsers.js`.
- **`dedupeAndInsertRecords(projectId, records, opts)`** (L69-156) — THE bulk insert:
  - Seeds dedupe sets from existing `ScreenRecord` identity columns (`doi`,`pmid`, normTitle of `title`)
    filtered by `projectId` (in-memory; O(n)).
  - Drops records with no usable identity (rejected); skips intra-batch + existing duplicates.
  - Enforces a per-project cap (`maxRecords`, default 100000; throws `err.code='CAPACITY'`).
  - Creates ONE `ScreenImportBatch` row, then bulk-inserts survivors via `prisma.screenRecord.createMany`
    in chunks of `INSERT_CHUNK = 400` (SQLite 999-var limit). Truncates fields (title 1000, abstract
    5000, etc.). Sets `sourceDb`, `rawData = JSON.stringify(r).slice(0,2000)`.
  - Returns `{imported, skippedDuplicates, rejected, batchId, total, keptCount}`.
- Constants: `INSERT_CHUNK=400`, `MAX_RECORDS_PER_IMPORT=200000`, `DEFAULT_MAX_RECORDS_PER_PROJECT=100000`.

Durable async worker: **`server/services/screeningImportWorker.js`** (the model for a P1 search-import
worker):
- In-process, DB-backed (no Redis/Bull): job + source content live in `ScreenImportJob`.
- `claimNext()` (L47-60): atomically flips oldest `queued` → `processing` via `updateMany` guarded on
  status (race-safe, single-process).
- `processJob(job)` (L63-106): parse → patch stages → `dedupeAndInsertRecords` (with onProgress patching
  the job row) → mark completed/`completed_with_warnings`, clear `content`, set `batchId`. Then
  `touchProjectActivity(sp.linkedMetaLabProjectId)` and `emitToProjectMembers(... 'import.completed')`.
- `kickImportWorker()` (L126), `startImportWorker()` (boot hook; re-queues jobs stuck >10min, L134-146).

Sync endpoint path: `importRecords()` in `server/controllers/screeningController.js:926` (small imports).

P1 SEAM: a search → import flow can (a) build canonical record objects (mkRecord-shaped, see §7),
(b) enqueue a `ScreenImportJob` (or call `dedupeAndInsertRecords` directly for sync), reusing the
identical dedup + provenance machinery. Provenance of the SEARCH source belongs on the
`ScreenImportBatch` (extend with source columns, mirroring ScreenPdfAttachment's additive provenance set).

---

## 7. Canonical bibliographic / reference record shape (where records "live")

There is NO single global canonical bibliographic store / shared reference library. Records are
scoped per workspace, in two parallel representations:

1. **In-document canonical shape** — `mkRecord(r)` in
   `src/research-engine/import-export/parsers.js:47-63`:
   `{ id: uid(), title, authors, year, journal, doi (URL-prefix stripped), pmid, abstract, source,
   decision:"", reviewer2:"", notes:"", dupOf:null }`. `uid()` from
   `src/research-engine/project-model/defaults.js:12` (8-char id). `mkStudy()` (defaults.js:100) is the
   sibling for extracted studies. These objects live INSIDE `Project.data` JSON (mkProject, defaults.js:48).
2. **Screening relational shape** — `ScreenRecord` rows (§3c), populated by the import pipeline (§6).
   These are the rows the META·SIFT screening UI actually consumes.

Bridge between the two ("how studies attach to a screening project"):
- A `ScreenProject` is linked to a META·LAB `Project` via `ScreenProject.linkedMetaLabProjectId`.
- After screening acceptance, a `ScreenRecord` is handed off to META·LAB Data Extraction (becomes a
  `study` in `Project.data.studies[]`): `ScreenRecord.handoffStatus/handoffStudyId` track that
  idempotently. RoB then references that in-document `study.id` via `RobAssessment.studyId` (a bare
  string, NOT a DB FK — schema.prisma:840).

Additive relational mirror of the `Project.data` blob (roadmap 0.2; INERT, flag `relationalProjectStore`
default OFF) — `server/services/projectStore.js`:
- Models `ReviewRecord` (schema.prisma:261-279, indexes `[projectId]`, `[projectId,doi]`, `[projectId,pmid]`)
  and `ReviewStudy` (schema.prisma:284-298). Each row carries indexed identity columns PLUS a `data`
  column with the EXACT original object, so `rowsToProject(projectToRows(p))` deep-equals `p`.
- Pure mappers `projectToRows(project)` (L42-67) / `rowsToProject({meta,records,studies})` (L75-80);
  DB helpers `writeRelationalRows` (dual-write, L89-100), `readRelationalRows`, `loadProjectRelational`.
- IMPORTANT: this is NOT the screening pipeline — `ReviewRecord` mirrors META·LAB `Project.data.records[]`
  (the legacy monolith records), distinct from `ScreenRecord` (META·SIFT). P1 dealing with screening
  imports should target `ScreenRecord`, not `ReviewRecord`.

---

## 8. Per-module server-backed state (search-builder persistence; relevant to P1)

`WorkflowModuleState` (schema.prisma:971-985): one row per `(projectId, moduleKey)`, `stateJson`,
optimistic-concurrency `revision`. `@@unique([projectId, moduleKey])`.
- Service `server/services/workflowState.js`: `getModuleState`, `patchModuleState` (compare-and-swap →
  conflict object), `MODULE_KEYS` whitelist (L26): `['protocol','project_control','analysis_config',
  'prisma','report','planProtocol']`, `isValidModuleKey` (L27).
- The existing Search Builder backend (`server/searchEngine/searchEngineController.js`) PERSISTS the
  search strategy under **moduleKey `'search'`** (SEARCH_MODULE const, L26; writes via
  `patchModuleState` with `moduleKey:'search'`, L164). The `WorkflowStateAudit` table logs mutations.
- GOTCHA: `'search'` is NOT in the `MODULE_KEYS` whitelist, yet the search controller writes it (it calls
  `patchModuleState` directly, bypassing `isValidModuleKey`). If P1 routes new search state through the
  generic whitelisted path, add the key; if it follows the searchEngine pattern, it bypasses the whitelist.

P1 (Pecan Search Engine) builds atop the existing flag `searchEngine` (default OFF) and the
`server/searchEngine/` proxy (NLM E-utilities). Search strategy state already persists per-project via
moduleKey 'search'. What P1 ADDS is the execution → results → auto-import → provenance/PRISMA-S layer.

---

## 9. Integration seams for P1 (summary)

1. **Land references**: enqueue `ScreenImportJob` (durable) or call
   `dedupeAndInsertRecords(projectId, records, opts)` (sync) → writes `ScreenImportBatch` + `ScreenRecord`
   rows. Records must be parser-canonical (mkRecord-shaped or the raw fields dedupeAndInsert maps).
2. **Provenance**: extend `ScreenImportBatch` (and/or `ScreenRecord.sourceDb`/`rawData`) with additive
   source columns, mirroring the `ScreenPdfAttachment` provenance pattern (`source`, `sourceUrl`,
   `matchedBy`, `matchConfidence`, `retrievalAttemptedAt`, `retrievalError`).
3. **Dedup**: reuse the existing doi/pmid/normTitle in-memory dedup in `dedupeAndInsertRecords`
   (cross-DB-source dedup is already the model's intent via `sourceDb`).
4. **Search strategy state**: persist via `WorkflowModuleState` (moduleKey 'search' is the precedent).
5. **Ref-ID** (if a human-facing sequential id is needed): add a new `AppSequence` name + `allocateNumber()`.
6. **PRISMA-S counts**: the `ScreenImportBatch.recordCount` / `ScreenImportJob` counters
   (imported/duplicate/rejected) + `ScreenProjectStatusEvent`/`UsageEvent` are the existing telemetry to
   build PRISMA-S flow numbers from.

---

## 10. Top risks / gotchas

- **Two record models, easy to confuse**: `ScreenRecord` (META·SIFT, what screening consumes — TARGET
  for P1 imports) vs `ReviewRecord` (additive mirror of META·LAB `Project.data.records[]`, INERT). Do
  not import search results into ReviewRecord.
- **db push, not migrate**: NO migrations dir. Every P1 schema change MUST be additive (nullable/defaulted
  cols, new tables); use plain `@@index` instead of `@unique` on any uniqueness-by-construction lookup,
  or the VPS deploy breaks (needs `--accept-data-loss`, never passed).
- **PG drift test**: after ANY canonical schema edit, run `npm run db:sync-postgres-schema` or the drift
  test fails CI. Stay within the portable type subset (§5) or the two providers diverge.
- **No identity indexes on ScreenRecord**: dedup scans identity columns in memory after a
  `where:{projectId}` fetch. At very large N (P1 could import 10k+ at once) this is O(records) memory per
  import; the per-project cap (default 100000) bounds it but watch perf. Consider `@@index([projectId,doi])`
  / `[projectId,pmid]` (already present on ReviewRecord but NOT ScreenRecord) if P1 pushes scale.
- **AppSequence is a GLOBAL named counter** — there is no per-project sequence primitive. A per-project
  Ref-ID needs a per-project sequence name or a different scheme.
- **moduleKey 'search' bypasses the MODULE_KEYS whitelist** (searchEngineController writes it directly);
  if P1 adds search state through the generic whitelisted patch path it must add the key to `MODULE_KEYS`.
- **PG client is lazy + generated**: a `DATABASE_PROVIDER=postgres` deploy fails fast unless
  `npm run db:generate:postgres` ran first (client.js:25-31). Operator provisions PG; that is the only
  real outstanding blocker per project memory.
- **Single-process in-process worker**: `screeningImportWorker` assumes ONE Node process (atomic
  status-flip claim, boot re-queue). P1 must follow the same single-worker model or add real locking if
  it ever scales horizontally.
