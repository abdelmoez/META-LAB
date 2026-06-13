-- prompt11 — user-facing archive for META·LAB projects (additive, no data loss).
-- Both columns are nullable/defaulted so legacy rows migrate clean and `prisma db
-- push` (the VPS deploy path) needs no --accept-data-loss.
-- AlterTable
ALTER TABLE "Project" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "archivedAt" DATETIME;
