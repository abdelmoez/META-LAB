-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "promotedVia" TEXT NOT NULL DEFAULT '',
    "acceptedAt" DATETIME,
    "rejectedReason" TEXT NOT NULL DEFAULT '',
    "handoffStatus" TEXT NOT NULL DEFAULT '',
    "handoffAt" DATETIME,
    "handoffStudyId" TEXT NOT NULL DEFAULT '',
    "handoffError" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScreenRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScreenRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ScreenImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ScreenRecord_duplicateGroupId_fkey" FOREIGN KEY ("duplicateGroupId") REFERENCES "ScreenDuplicateGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ScreenRecord" ("abstract", "acceptedAt", "authors", "createdAt", "currentStage", "doi", "duplicateGroupId", "finalStatus", "id", "importBatchId", "isDuplicate", "isPrimary", "journal", "keywords", "pmid", "projectId", "promotedAt", "rawData", "rejectedReason", "sourceDb", "title", "updatedAt", "year") SELECT "abstract", "acceptedAt", "authors", "createdAt", "currentStage", "doi", "duplicateGroupId", "finalStatus", "id", "importBatchId", "isDuplicate", "isPrimary", "journal", "keywords", "pmid", "projectId", "promotedAt", "rawData", "rejectedReason", "sourceDb", "title", "updatedAt", "year" FROM "ScreenRecord";
DROP TABLE "ScreenRecord";
ALTER TABLE "new_ScreenRecord" RENAME TO "ScreenRecord";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
