-- AlterTable
ALTER TABLE "ScreenImportBatch" ADD COLUMN     "searchRunId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "updatedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PecanSearchRun" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'automated',
ADD COLUMN     "questionText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rolledBackAt" TIMESTAMP(3),
ADD COLUMN     "rolledBackById" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "strategyVersionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PecanSearchSource" ADD COLUMN     "updatedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ScreenRecordSource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "screenRecordId" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL DEFAULT '',
    "runId" TEXT NOT NULL DEFAULT '',
    "batchId" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "providerRecordId" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "changedFields" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT '',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenRecordSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenRecordMetadataChange" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "screenRecordId" TEXT NOT NULL,
    "runId" TEXT NOT NULL DEFAULT '',
    "batchId" TEXT NOT NULL DEFAULT '',
    "field" TEXT NOT NULL DEFAULT '',
    "fromValue" TEXT NOT NULL DEFAULT '',
    "toValue" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenRecordMetadataChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenResetEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'search',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "decisionCount" INTEGER NOT NULL DEFAULT 0,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "initiatedById" TEXT NOT NULL DEFAULT '',
    "initiatedByName" TEXT NOT NULL DEFAULT '',
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenResetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScreenRecordSource_projectId_screenRecordId_idx" ON "ScreenRecordSource"("projectId", "screenRecordId");

-- CreateIndex
CREATE INDEX "ScreenRecordSource_runId_idx" ON "ScreenRecordSource"("runId");

-- CreateIndex
CREATE INDEX "ScreenRecordSource_projectId_importedAt_idx" ON "ScreenRecordSource"("projectId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenRecordSource_screenRecordId_runId_batchId_provider_pr_key" ON "ScreenRecordSource"("screenRecordId", "runId", "batchId", "provider", "providerRecordId");

-- CreateIndex
CREATE INDEX "ScreenRecordMetadataChange_projectId_screenRecordId_idx" ON "ScreenRecordMetadataChange"("projectId", "screenRecordId");

-- CreateIndex
CREATE INDEX "ScreenRecordMetadataChange_runId_idx" ON "ScreenRecordMetadataChange"("runId");

-- CreateIndex
CREATE INDEX "ScreenResetEvent_projectId_createdAt_idx" ON "ScreenResetEvent"("projectId", "createdAt");

