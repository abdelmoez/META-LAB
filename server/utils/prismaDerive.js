/**
 * server/utils/prismaDerive.js — 78.md #4. Pure, testable derivation of the PRISMA
 * flow's identification counts from AUTHORITATIVE project data, so MANUAL database
 * searches, IMPORTED files and AUTOMATED (Pecan Search Engine) runs all feed the SAME
 * normalized model.
 *
 * The counts come from three real sources, never a frontend counter:
 *   • `recordCount`          — surviving ScreenRecord rows (records in the project).
 *   • `importDuplicates`     — duplicates skipped at import time (per-batch
 *                              ScreenImportBatch.duplicateCount; manual + automated).
 *   • `postImportDuplicates` — records later flagged ScreenRecord.isDuplicate.
 *   • `pecanExactDup/FuzzyDup` — the Pecan engine's CROSS-SOURCE duplicates, removed
 *                              BEFORE landing (so they never became ScreenRecords or
 *                              import-batch counts). Folding them in is what makes an
 *                              automated search's "records identified" reflect the true
 *                              retrieval instead of only the post-dedup landed count.
 *
 * RERUN SAFETY (data-integrity rule): the engine's `existingMatch` count is deliberately
 * EXCLUDED. An existing-match means the record was already in the project (counted once,
 * when it first landed); on a rerun of the same search every re-found record classifies
 * as existing-match, so summing it would inflate "records identified" / "duplicates
 * removed" on each rerun. exact/fuzzy dups are cross-source duplicates of records NEW to
 * the project and are rerun-stable (a re-found record becomes existing-match, not
 * exact/fuzzy), so they are safe to sum across runs.
 */
export function derivePrismaIdentification({
  recordCount = 0,
  importDuplicates = 0,
  postImportDuplicates = 0,
  pecanExactDup = 0,
  pecanFuzzyDup = 0,
} = {}) {
  const total = Math.max(0, Math.trunc(Number(recordCount) || 0));
  const imp = Math.max(0, Math.trunc(Number(importDuplicates) || 0));
  const post = Math.max(0, Math.trunc(Number(postImportDuplicates) || 0));
  const pecanDuplicates = Math.max(0, Math.trunc(Number(pecanExactDup) || 0))
    + Math.max(0, Math.trunc(Number(pecanFuzzyDup) || 0));

  const identified = total + imp + pecanDuplicates;      // retrieved before any dedup
  const duplicatesRemoved = imp + post + pecanDuplicates; // removed before screening
  const screened = Math.max(0, total - post);             // pool after dedup (= identified - duplicatesRemoved)

  return { identified, duplicatesRemoved, screened, pecanDuplicates };
}

export default derivePrismaIdentification;
