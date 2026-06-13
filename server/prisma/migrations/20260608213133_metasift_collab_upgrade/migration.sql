-- CreateTable
CREATE TABLE "ScreenProjectMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'reviewer',
    "status" TEXT NOT NULL DEFAULT 'active',
    "canScreen" BOOLEAN NOT NULL DEFAULT true,
    "canChat" BOOLEAN NOT NULL DEFAULT true,
    "canResolveConflicts" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScreenProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScreenProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScreenChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "ScreenChatMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScreenPdfAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "uploadedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScreenPdfAttachment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ScreenRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScreenRecordOpenState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScreenRecordOpenState_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ScreenRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScreenAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScreenAuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScreenDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "decision" TEXT NOT NULL DEFAULT 'undecided',
    "exclusionReason" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER,
    "labels" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScreenDecision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ScreenRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScreenDecision" ("createdAt", "decision", "exclusionReason", "id", "labels", "notes", "projectId", "rating", "recordId", "reviewerId", "updatedAt") SELECT "createdAt", "decision", "exclusionReason", "id", "labels", "notes", "projectId", "rating", "recordId", "reviewerId", "updatedAt" FROM "ScreenDecision";
DROP TABLE "ScreenDecision";
ALTER TABLE "new_ScreenDecision" RENAME TO "ScreenDecision";
CREATE UNIQUE INDEX "ScreenDecision_recordId_reviewerId_stage_key" ON "ScreenDecision"("recordId", "reviewerId", "stage");
CREATE TABLE "new_ScreenProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "linkedMetaLabProjectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "reviewQuestion" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "blindMode" BOOLEAN NOT NULL DEFAULT false,
    "progressStatus" TEXT NOT NULL DEFAULT 'not_started',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "inclusionKeywords" TEXT NOT NULL DEFAULT '[]',
    "exclusionKeywords" TEXT NOT NULL DEFAULT '[]',
    "studyTypeFilter" TEXT NOT NULL DEFAULT '[]',
    "picoSnapshot" TEXT NOT NULL DEFAULT '{}',
    "chatRestricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScreenProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScreenProject" ("blindMode", "createdAt", "description", "id", "linkedMetaLabProjectId", "ownerId", "reviewQuestion", "stage", "title", "updatedAt") SELECT "blindMode", "createdAt", "description", "id", "linkedMetaLabProjectId", "ownerId", "reviewQuestion", "stage", "title", "updatedAt" FROM "ScreenProject";
DROP TABLE "ScreenProject";
ALTER TABLE "new_ScreenProject" RENAME TO "ScreenProject";
CREATE TABLE "new_ScreenRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "duplicateGroupId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT '',
    "authors" TEXT NOT NULL DEFAULT '',
    "year" TEXT NOT NULL DEFAULT '',
    "journal" TEXT NOT NULL DEFAULT '',
    "doi" TEXT NOT NULL DEFAULT '',
    "pmid" TEXT NOT NULL DEFAULT '',
    "abstract" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "sourceDb" TEXT NOT NULL DEFAULT '',
    "rawData" TEXT NOT NULL DEFAULT '{}',
    "currentStage" TEXT NOT NULL DEFAULT 'title_abstract',
    "finalStatus" TEXT NOT NULL DEFAULT '',
    "promotedAt" DATETIME,
    "acceptedAt" DATETIME,
    "rejectedReason" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScreenRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScreenRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ScreenImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ScreenRecord_duplicateGroupId_fkey" FOREIGN KEY ("duplicateGroupId") REFERENCES "ScreenDuplicateGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ScreenRecord" ("abstract", "authors", "createdAt", "doi", "duplicateGroupId", "id", "importBatchId", "isDuplicate", "isPrimary", "journal", "keywords", "pmid", "projectId", "rawData", "sourceDb", "title", "updatedAt", "year") SELECT "abstract", "authors", "createdAt", "doi", "duplicateGroupId", "id", "importBatchId", "isDuplicate", "isPrimary", "journal", "keywords", "pmid", "projectId", "rawData", "sourceDb", "title", "updatedAt", "year" FROM "ScreenRecord";
DROP TABLE "ScreenRecord";
ALTER TABLE "new_ScreenRecord" RENAME TO "ScreenRecord";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ScreenProjectMember_projectId_email_key" ON "ScreenProjectMember"("projectId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenRecordOpenState_recordId_userId_key" ON "ScreenRecordOpenState"("recordId", "userId");
