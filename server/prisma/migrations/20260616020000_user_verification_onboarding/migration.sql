-- prompt26 — additive User columns for email verification + optional onboarding.
-- Pure ADD COLUMN (all nullable); `prisma db push` applies with no
-- --accept-data-loss (verified). Existing users/accounts are unaffected.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "country" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerificationExpiresAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "emailVerificationTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "institutionNormalized" TEXT;
ALTER TABLE "User" ADD COLUMN "institutionOriginal" TEXT;
ALTER TABLE "User" ADD COLUMN "mainUseCase" TEXT;
ALTER TABLE "User" ADD COLUMN "onboardingCompletedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "primaryRole" TEXT;
ALTER TABLE "User" ADD COLUMN "researchField" TEXT;
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" DATETIME;
