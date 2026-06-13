-- CreateTable: per-staff read receipts for ops-console contact messages (prompt5 Task 9)
CREATE TABLE "ContactMessageRead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactMessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ContactMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactMessageRead_messageId_userId_key" ON "ContactMessageRead"("messageId", "userId");
