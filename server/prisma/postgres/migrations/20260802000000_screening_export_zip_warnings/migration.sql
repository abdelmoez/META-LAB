-- 97.md Phase 2 — portable screening export ZIP: additive partial-failure columns
-- on ScreenExportJob (ScreenImportJob warningCount precedent). Purely additive,
-- defaulted/nullable — safe on a live database.

-- AlterTable
ALTER TABLE "ScreenExportJob" ADD COLUMN     "warningCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "warnings" TEXT;
