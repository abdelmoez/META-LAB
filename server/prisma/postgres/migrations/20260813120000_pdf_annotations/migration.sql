-- 116.md §71-104 (Part VII) — collaborative PDF annotations.
--
-- One BRAND-NEW table, so a @unique (clientId, the §89/§91 idempotency key) and
-- composite indexes are allowed under the house rule "uniqueness on new tables
-- only" — nothing on an existing live table is touched, so this migration is
-- purely additive and safe to deploy while the app is running.
--
-- Identity is the CONTENT HASH of the PDF (docHash = sha256 of the bytes), not the
-- attachment row id: screening `uploadPdf` deletes-and-recreates the attachment on
-- every replace, so the row id names a version, not a document (§73/§74).
--
-- Exactly one of screenProjectId / metaLabProjectId is set per row (enforced in the
-- service, not by a DB constraint, so the two disjoint PDF stores stay independent).
-- Bare scope keys, no foreign keys: annotations outlive the rows that described
-- them, matching the ScreenDecision.projectId / ScreenAuditLog audit-survival rule.

-- CreateTable
CREATE TABLE "PdfAnnotation" (
    "id" TEXT NOT NULL,
    "docHash" TEXT NOT NULL,
    "screenProjectId" TEXT,
    "metaLabProjectId" TEXT,
    "recordId" TEXT,
    "studyId" TEXT,
    "page" INTEGER NOT NULL,
    "rects" TEXT NOT NULL DEFAULT '[]',
    "selectedText" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'yellow',
    "comment" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PdfAnnotation_clientId_key" ON "PdfAnnotation"("clientId");

-- CreateIndex
CREATE INDEX "PdfAnnotation_screenProjectId_docHash_updatedAt_idx" ON "PdfAnnotation"("screenProjectId", "docHash", "updatedAt");

-- CreateIndex
CREATE INDEX "PdfAnnotation_metaLabProjectId_docHash_updatedAt_idx" ON "PdfAnnotation"("metaLabProjectId", "docHash", "updatedAt");

-- CreateIndex
CREATE INDEX "PdfAnnotation_docHash_page_idx" ON "PdfAnnotation"("docHash", "page");
