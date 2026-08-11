-- 113.md SEO analytics — additive new-table-only migration. Safe under
-- `prisma migrate deploy`: creates one aggregate table + indexes, touches
-- nothing existing. No unique constraints (live-table rule): dedupe is
-- code-enforced and readers SUM per (day, path, referrerClass).

CREATE TABLE "SeoPageView" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrerClass" TEXT NOT NULL DEFAULT 'direct',
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoPageView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoPageView_day_path_referrerClass_idx" ON "SeoPageView"("day", "path", "referrerClass");

CREATE INDEX "SeoPageView_path_day_idx" ON "SeoPageView"("path", "day");
