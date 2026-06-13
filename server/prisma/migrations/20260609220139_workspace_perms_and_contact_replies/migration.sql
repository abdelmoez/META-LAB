-- CreateTable
CREATE TABLE "ContactReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "repliedById" TEXT NOT NULL,
    "repliedByName" TEXT NOT NULL DEFAULT '',
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactReply_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ContactMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ContactMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "replied" BOOLEAN NOT NULL DEFAULT false,
    "repliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ContactMessage" ("archived", "createdAt", "email", "id", "message", "name", "read", "subject") SELECT "archived", "createdAt", "email", "id", "message", "name", "read", "subject" FROM "ContactMessage";
DROP TABLE "ContactMessage";
ALTER TABLE "new_ContactMessage" RENAME TO "ContactMessage";
CREATE TABLE "new_ScreenProjectMember" (
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
    "permissionPreset" TEXT NOT NULL DEFAULT 'reviewer',
    "canViewMetaSift" BOOLEAN NOT NULL DEFAULT true,
    "canSecondReview" BOOLEAN NOT NULL DEFAULT true,
    "canManageDuplicates" BOOLEAN NOT NULL DEFAULT false,
    "canImportRecords" BOOLEAN NOT NULL DEFAULT false,
    "canExportRecords" BOOLEAN NOT NULL DEFAULT false,
    "readOnlyMetaSift" BOOLEAN NOT NULL DEFAULT false,
    "canViewMetaLab" BOOLEAN NOT NULL DEFAULT true,
    "canEditMetaLab" BOOLEAN NOT NULL DEFAULT false,
    "canManageExtraction" BOOLEAN NOT NULL DEFAULT false,
    "canRunAnalysis" BOOLEAN NOT NULL DEFAULT false,
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "readOnlyMetaLab" BOOLEAN NOT NULL DEFAULT false,
    "canManageMembers" BOOLEAN NOT NULL DEFAULT false,
    "canManageSettings" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScreenProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScreenProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScreenProjectMember" ("canChat", "canResolveConflicts", "canScreen", "email", "id", "joinedAt", "name", "projectId", "role", "status", "updatedAt", "userId") SELECT "canChat", "canResolveConflicts", "canScreen", "email", "id", "joinedAt", "name", "projectId", "role", "status", "updatedAt", "userId" FROM "ScreenProjectMember";
DROP TABLE "ScreenProjectMember";
ALTER TABLE "new_ScreenProjectMember" RENAME TO "ScreenProjectMember";
CREATE UNIQUE INDEX "ScreenProjectMember_projectId_email_key" ON "ScreenProjectMember"("projectId", "email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
