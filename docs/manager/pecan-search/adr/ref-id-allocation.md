# ADR: Ref-ID allocation — ScreenRecord ids are the stable refs today

**Status:** Accepted · **Scope:** Pecan Search Engine (P1)

## Context

P1 must assign stable, durable references to imported records so provenance links survive
retries and merges. A separate question is whether records need a human-facing sequential
"Ref ID" (e.g. #1, #2, …).

## Decision

**Use the landed `ScreenRecord` id as the stable reference today.** P1 imports through the
existing screening landing (`dedupeAndInsertRecords`), which assigns each landed record its
normal `ScreenRecord` id. Provenance links to that id via `PecanSourceRecord.screenRecordId`
and `PecanDedupDecision.matchedScreenRecordId`. Within a source run, the durable provider
reference is `providerRecordId` under the idempotency key
`@@unique([runId, provider, providerRecordId])` (with a deterministic `contentHashId()`
fallback when the provider gives no stable id).

A **human-facing sequential Ref ID is intentionally not introduced in P1.** `ScreenRecord`
has no numeric/human ref id — only the uuid `id` and the in-document 8-char `record.id`.

## If a sequential Ref ID is later needed

The established, portable, concurrency-safe pattern in the codebase is the **`AppSequence`**
named counter (`schema.prisma`) + `server/services/sequence.js`:

- `allocateNumber(name)` — `upsert` the row, then a single atomic
  `update { value: { increment: 1 } }`; the DB row-level serialization is the uniqueness
  guarantee (identical on SQLite & Postgres, no interactive transaction).
- `ensureSequenceAtLeast(name, floor)` — raises (never lowers) the counter, for gap-free
  backfills.
- Today's only consumer is `User.userNumber` (sequence name `"userNumber"`), proving the
  pattern at scale.

**Caveat:** `AppSequence` is a **global** named counter — there is no per-project sequence
primitive. A per-project Ref ID would need a per-project sequence name (e.g.
`ref:<projectId>`) or a different scheme. Note also that a `@unique` numeric column would
force `prisma db push --accept-data-loss` (which the deploy never passes), so uniqueness is
guaranteed by the allocator + a plain `@@index`, not a unique constraint — exactly how
`userNumber` is modeled.

## Why not allocate a Ref ID now

- The `ScreenRecord` id already satisfies the "stable, durable reference" requirement and
  flows through merges via the screening duplicate model.
- Adding a sequence and a column now would be speculative; the `AppSequence` path is a
  clean, low-risk addition when a real product need appears.

## References
`schema.prisma` (`AppSequence`, `PecanSourceRecord`, `PecanDedupDecision`),
`server/services/sequence.js`, `.claude/Engine/p1-audit/prisma-data-model.md` §4,
`ADR provenance-model.md`.
