-- roadmap 1.4 — additive OA/provenance fields on ScreenPdfAttachment.
-- Data-preserving SQLite table redefine (INSERT...SELECT keeps every existing
-- row; all new columns are nullable or defaulted). `prisma db push` applies this
-- with NO --accept-data-loss (verified on the live DB). The existing PDF
-- viewer/upload/download path is unaffected (it never selects the new columns).

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScreenPdfAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "uploadedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual_upload',
    "oaStatus" TEXT,
    "sourceUrl" TEXT,
    "resolvedDoi" TEXT,
    "matchedBy" TEXT,
    "matchConfidence" REAL,
    "retrievalAttemptedAt" DATETIME,
    "retrievalError" TEXT,
    CONSTRAINT "ScreenPdfAttachment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ScreenRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScreenPdfAttachment" ("createdAt", "fileName", "fileSize", "id", "mimeType", "projectId", "recordId", "storedName", "uploadedBy") SELECT "createdAt", "fileName", "fileSize", "id", "mimeType", "projectId", "recordId", "storedName", "uploadedBy" FROM "ScreenPdfAttachment";
DROP TABLE "ScreenPdfAttachment";
ALTER TABLE "new_ScreenPdfAttachment" RENAME TO "ScreenPdfAttachment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
