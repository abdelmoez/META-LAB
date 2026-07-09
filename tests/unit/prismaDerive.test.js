/**
 * prismaDerive.test.js — 78.md #4. The normalized PRISMA identification derivation
 * must treat MANUAL, IMPORTED and AUTOMATED (Pecan) records identically, and must NOT
 * double-count when an automated search is rerun.
 */
import { describe, it, expect } from 'vitest';
import { derivePrismaIdentification } from '../../server/utils/prismaDerive.js';

describe('derivePrismaIdentification — 78.md #4 normalized PRISMA counts', () => {
  it('manual/import only: identified = records + import dups; screened = records - postImport dups', () => {
    const r = derivePrismaIdentification({ recordCount: 100, importDuplicates: 20, postImportDuplicates: 5 });
    expect(r.identified).toBe(120);           // 100 landed + 20 skipped at import
    expect(r.duplicatesRemoved).toBe(25);     // 20 import + 5 post-import
    expect(r.screened).toBe(95);              // 100 - 5
    expect(r.pecanDuplicates).toBe(0);
  });

  it('automated run folds engine cross-source (exact+fuzzy) dedup into identified + removed', () => {
    // 80 landed records, no import/post dups, but the engine removed 12 exact + 3 fuzzy
    // cross-source duplicates before landing.
    const r = derivePrismaIdentification({ recordCount: 80, pecanExactDup: 12, pecanFuzzyDup: 3 });
    expect(r.pecanDuplicates).toBe(15);
    expect(r.identified).toBe(95);            // 80 + 15 engine-removed
    expect(r.duplicatesRemoved).toBe(15);
    expect(r.screened).toBe(80);              // engine dups were removed before screening
    // identified - duplicatesRemoved === screened (internal consistency)
    expect(r.identified - r.duplicatesRemoved).toBe(r.screened);
  });

  it('mixed manual + automated feed the SAME model additively', () => {
    const r = derivePrismaIdentification({ recordCount: 200, importDuplicates: 30, postImportDuplicates: 10, pecanExactDup: 8, pecanFuzzyDup: 2 });
    expect(r.identified).toBe(240);           // 200 + 30 + 10(engine)
    expect(r.duplicatesRemoved).toBe(50);     // 30 + 10 + 10(engine)
    expect(r.screened).toBe(190);             // 200 - 10
    expect(r.identified - r.duplicatesRemoved).toBe(r.screened);
  });

  it('rerun does not double-count: existingMatch is not an input, so a rerun (all re-found → existingMatch, 0 exact/fuzzy) leaves counts unchanged', () => {
    // First run: 50 landed, engine removed 5 exact cross-source dups.
    const run1 = derivePrismaIdentification({ recordCount: 50, pecanExactDup: 5, pecanFuzzyDup: 0 });
    // Rerun of the same search: nothing new lands, all re-found records are existingMatch
    // (NOT exact/fuzzy), so the summed exact/fuzzy across runs is unchanged (still 5) and
    // the record count is unchanged (50). The derivation is therefore stable.
    const rerun = derivePrismaIdentification({ recordCount: 50, pecanExactDup: 5, pecanFuzzyDup: 0 });
    expect(rerun.identified).toBe(run1.identified);
    expect(rerun.duplicatesRemoved).toBe(run1.duplicatesRemoved);
    expect(rerun.identified).toBe(55);
  });

  it('is defensive: negatives, non-numbers and missing fields collapse to safe non-negative ints', () => {
    expect(derivePrismaIdentification()).toEqual({ identified: 0, duplicatesRemoved: 0, screened: 0, pecanDuplicates: 0 });
    const r = derivePrismaIdentification({ recordCount: -5, importDuplicates: 'x', postImportDuplicates: null, pecanExactDup: 2.9, pecanFuzzyDup: -1 });
    expect(r.identified).toBe(2);   // 0 + 0 + trunc(2.9)=2
    expect(r.duplicatesRemoved).toBe(2);
    expect(r.screened).toBe(0);
  });
});
