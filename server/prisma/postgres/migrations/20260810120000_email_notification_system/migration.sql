-- 112.md Email & Notification system — additive new-table-only migration.
-- Safe under `prisma migrate deploy`: creates three tables + indexes, touches
-- nothing existing. idempotencyKey is deliberately a plain index (code-enforced
-- dedupe), mirroring the repo's no-@@unique-on-live-tables deploy rule.

CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'transactional',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "entityId" TEXT,
    "variablesJson" TEXT NOT NULL DEFAULT '{}',
    "renderedSubject" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailOutbox_status_createdAt_idx" ON "EmailOutbox"("status", "createdAt");
CREATE INDEX "EmailOutbox_idempotencyKey_idx" ON "EmailOutbox"("idempotencyKey");
CREATE INDEX "EmailOutbox_recipientUserId_idx" ON "EmailOutbox"("recipientUserId");

CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailTemplate_templateKey_idx" ON "EmailTemplate"("templateKey");

CREATE TABLE "ChatDigestPending" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "firstMessageAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "senderNamesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatDigestPending_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatDigestPending_userId_projectId_idx" ON "ChatDigestPending"("userId", "projectId");
CREATE INDEX "ChatDigestPending_lastMessageAt_idx" ON "ChatDigestPending"("lastMessageAt");
