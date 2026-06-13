-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "clickedAt" DATETIME;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "deletedSource" TEXT;

-- AlterTable
ALTER TABLE "ScreenProject" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "ScreenProject" ADD COLUMN "deletedSource" TEXT;

-- AlterTable
ALTER TABLE "ScreenProjectMember" ADD COLUMN "inviteAcceptedAt" DATETIME;
ALTER TABLE "ScreenProjectMember" ADD COLUMN "inviteExpiresAt" DATETIME;
ALTER TABLE "ScreenProjectMember" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "ScreenProjectMember" ADD COLUMN "invitedByUserId" TEXT;

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "screenProjectId" TEXT,
    "metaLabProjectId" TEXT,
    "format" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "UsageEvent_type_createdAt_idx" ON "UsageEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenProjectMember_inviteTokenHash_idx" ON "ScreenProjectMember"("inviteTokenHash");

