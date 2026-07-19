-- AlterTable
ALTER TABLE "User" ADD COLUMN     "registrationMethod" TEXT;

-- AlterTable
ALTER TABLE "AdminAuditLog" ADD COLUMN     "bulkOperationId" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "requestId" TEXT;

-- CreateTable
CREATE TABLE "UserAdminNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserAdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAdminNote_userId_createdAt_idx" ON "UserAdminNote"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_lastActive_idx" ON "User"("lastActive");

-- CreateIndex
CREATE INDEX "User_suspended_idx" ON "User"("suspended");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_tierId_idx" ON "User"("tierId");

-- CreateIndex
CREATE INDEX "User_emailVerifiedAt_idx" ON "User"("emailVerifiedAt");

-- CreateIndex
CREATE INDEX "User_registrationMethod_idx" ON "User"("registrationMethod");

-- CreateIndex
CREATE INDEX "AdminAuditLog_entityType_entityId_idx" ON "AdminAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_idx" ON "AdminAuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_bulkOperationId_idx" ON "AdminAuditLog"("bulkOperationId");

-- CreateIndex
CREATE INDEX "ScreenProjectMember_userId_idx" ON "ScreenProjectMember"("userId");

-- AddForeignKey
ALTER TABLE "UserAdminNote" ADD CONSTRAINT "UserAdminNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

