-- 116.md §13/§14 — per-record PRISMA identification correction: an explicit
-- override of the derived identification bucket (ScreenRecord.identificationSource,
-- validated against the model's IDENTIFICATION_SOURCE_IDS) plus the preserved
-- free-text source detail ("reference list of Smith 2020"). Purely additive
-- nullable columns: safe on a live database; legacy rows read NULL, which the
-- projection treats as "derive the bucket automatically".

-- AlterTable
ALTER TABLE "ScreenRecord" ADD COLUMN "identificationSource" TEXT;
ALTER TABLE "ScreenRecord" ADD COLUMN "sourceDetail" TEXT;
