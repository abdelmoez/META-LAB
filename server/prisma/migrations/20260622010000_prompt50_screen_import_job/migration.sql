-- prompt50 WS2 — durable, observable, retryable screening import job.
-- Pure additive (a new table); `prisma db push` applies it with no
-- --accept-data-loss (the VPS deploy path). Existing imports are unaffected.

-- CreateTable
CREATE TABLE "ScreenImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "filename" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT '',
    "detectedFormat" TEXT NOT NULL DEFAULT '',
    "fileHash" TEXT,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL DEFAULT '',
    "force" BOOLEAN NOT NULL DEFAULT false,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "importedRecords" INTEGER NOT NULL DEFAULT 0,
    "duplicateRecords" INTEGER NOT NULL DEFAULT 0,
    "rejectedRecords" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorReport" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT NOT NULL DEFAULT '',
    "batchId" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScreenImportJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ScreenImportJob_projectId_status_idx" ON "ScreenImportJob"("projectId", "status");
CREATE INDEX "ScreenImportJob_status_createdAt_idx" ON "ScreenImportJob"("status", "createdAt");
CREATE INDEX "ScreenImportJob_projectId_fileHash_idx" ON "ScreenImportJob"("projectId", "fileHash");
