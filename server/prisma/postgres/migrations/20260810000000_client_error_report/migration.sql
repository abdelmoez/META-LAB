-- 109.md §6/§46/§47 — bounded, deduped capture for the SPA client-error beacon
-- (POST /api/client-errors was console.warn-only, so the Ops "Undo/Redo client
-- errors" and "recent failures" cards had no data source at all — §46 forbids
-- inventing metrics, so this is the capture half).
--
-- Purely additive: a BRAND-NEW table, no ALTER on any existing table, no data
-- backfill, no destructive change. The UNIQUE index on "fingerprint" is created
-- together with the table, so the repo rule "never add @unique to an existing
-- table" (which exists because a non-interactive `prisma db push` aborts on the
-- resulting data-loss warning) does not apply here.
--
-- Bounds are enforced by the writer (kind <= 80, message <= 500, context <= 500)
-- and the distinct-row count is capped in application code; the columns are plain
-- TEXT to match every other string column in this schema.

-- CreateTable
CREATE TABLE "ClientErrorReport" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "context" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientErrorReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientErrorReport_fingerprint_key" ON "ClientErrorReport"("fingerprint");

-- CreateIndex
CREATE INDEX "ClientErrorReport_lastSeenAt_idx" ON "ClientErrorReport"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ClientErrorReport_kind_lastSeenAt_idx" ON "ClientErrorReport"("kind", "lastSeenAt");
