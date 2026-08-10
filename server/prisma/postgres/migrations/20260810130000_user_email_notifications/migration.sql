-- 112.md §2 — additive nullable column for per-user email notification prefs
-- ({ projectChat: boolean } JSON blob; opt-in default). Safe under migrate deploy.
ALTER TABLE "User" ADD COLUMN "emailNotifications" TEXT;
