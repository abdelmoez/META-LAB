-- 107.md §2 — context-aware keyword suggestions with a review flow. Adds the
-- per-project keyword REVIEW state (accept/reject verdicts + per-term origin) to
-- ScreenProject. The suggested terms themselves are never persisted — they are
-- re-derived from picoSnapshot on every read — so this column only ever holds the
-- reviewer's decisions. Purely additive with a default: safe on a live database.

-- AlterTable
ALTER TABLE "ScreenProject" ADD COLUMN     "keywordMeta" TEXT NOT NULL DEFAULT '{}';
