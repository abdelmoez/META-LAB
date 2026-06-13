-- AlterTable
ALTER TABLE "Project" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "Project" ADD COLUMN "lastSavedAt" DATETIME;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastActive" DATETIME;

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
