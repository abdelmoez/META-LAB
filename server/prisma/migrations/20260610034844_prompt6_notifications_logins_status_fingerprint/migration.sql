-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "app" TEXT NOT NULL DEFAULT '',
    "relatedScreenProjectId" TEXT,
    "relatedMetaLabProjectId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "readAt" DATETIME,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScreenProjectStatusEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL DEFAULT '',
    "changedById" TEXT NOT NULL DEFAULT '',
    "changedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScreenImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT '',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "fileHash" TEXT,
    "fileSize" INTEGER,
    "importedById" TEXT,
    "importedByName" TEXT NOT NULL DEFAULT '',
    "parser" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScreenImportBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScreenImportBatch" ("createdAt", "filename", "format", "id", "projectId", "recordCount") SELECT "createdAt", "filename", "format", "id", "projectId", "recordCount" FROM "ScreenImportBatch";
DROP TABLE "ScreenImportBatch";
ALTER TABLE "new_ScreenImportBatch" RENAME TO "ScreenImportBatch";
CREATE INDEX "ScreenImportBatch_projectId_fileHash_idx" ON "ScreenImportBatch"("projectId", "fileHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenProjectStatusEvent_status_createdAt_idx" ON "ScreenProjectStatusEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenProjectStatusEvent_projectId_createdAt_idx" ON "ScreenProjectStatusEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenProject_linkedMetaLabProjectId_idx" ON "ScreenProject"("linkedMetaLabProjectId");
