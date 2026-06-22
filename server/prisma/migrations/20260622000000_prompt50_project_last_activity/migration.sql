-- prompt50 WS5 — authoritative "Last Modified" timestamp for project sorting.
-- Pure additive: one nullable column + one index; `prisma db push` applies it
-- with no --accept-data-loss (the VPS deploy path). Existing projects are
-- unaffected; the column is backfilled at server boot (backfillProjectActivity)
-- from COALESCE(lastActivityAt, updatedAt, createdAt), so the very first list
-- already sorts correctly even before any new meaningful edit.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "lastActivityAt" DATETIME;

-- Seed existing rows so ordering is correct immediately (idempotent — only NULLs).
UPDATE "Project" SET "lastActivityAt" = COALESCE("updatedAt", "createdAt") WHERE "lastActivityAt" IS NULL;

-- CreateIndex
CREATE INDEX "Project_userId_lastActivityAt_idx" ON "Project"("userId", "lastActivityAt");
