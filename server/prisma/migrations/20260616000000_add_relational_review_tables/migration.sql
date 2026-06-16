-- roadmap 0.2 — additive relational backing for META·LAB records/studies.
-- Purely additive (CREATE TABLE + CREATE INDEX); safe for `prisma db push`
-- (no --accept-data-loss) and `prisma migrate deploy`. The Project.data JSON
-- blob remains the source of truth until the relationalProjectStore flag is
-- enabled at an evaluation gate.

-- CreateTable
CREATE TABLE "ReviewRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT,
    "doi" TEXT,
    "pmid" TEXT,
    "decision" TEXT,
    "mergedIntoId" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewStudy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "author" TEXT,
    "year" TEXT,
    "esType" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewStudy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReviewRecord_projectId_idx" ON "ReviewRecord"("projectId");

-- CreateIndex
CREATE INDEX "ReviewRecord_projectId_doi_idx" ON "ReviewRecord"("projectId", "doi");

-- CreateIndex
CREATE INDEX "ReviewRecord_projectId_pmid_idx" ON "ReviewRecord"("projectId", "pmid");

-- CreateIndex
CREATE INDEX "ReviewStudy_projectId_idx" ON "ReviewStudy"("projectId");

