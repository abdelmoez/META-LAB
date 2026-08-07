/**
 * 104.md — the backfill's judgement calls, which are the whole risk surface.
 * Getting these wrong writes confident, wrong claims into people's manuscripts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalDbKey } from '../../../src/research-engine/search/searchProvenance.js';

const SRC = readFileSync('server/scripts/backfill-search-provenance.js', 'utf8');

describe('what it refuses to invent', () => {
  it('never writes searchedAt — the upload date is not the search date', () => {
    expect(SRC).not.toMatch(/searchedAt:\s*[^}]*createdAt/);
    expect(SRC).not.toMatch(/data:\s*\{[^}]*searchedAt/);
  });

  it('never flips contributesToReview — that is a research judgement', () => {
    expect(SRC).not.toMatch(/data:\s*\{[^}]*contributesToReview/);
  });

  it('says so in its own output rather than silently omitting it', () => {
    expect(SRC).toMatch(/searchedAt was NOT backfilled/);
  });
});

describe('the format tokens it clears', () => {
  // These are the values the old `|| format` fallback could write into the
  // database-name column. Each must be something no reader would accept as a
  // database name in a Methods section.
  const FORMATS = ['ris', 'csv', 'tsv', 'nbib', 'bibtex', 'enw', 'txt', 'xml', 'json'];

  it('treats every real parser format as poison', () => {
    for (const f of FORMATS) expect(SRC).toContain(`'${f}'`);
  });

  it('leaves MEDLINE alone — it is a database as well as a format', () => {
    expect(SRC).toMatch(/AMBIGUOUS = new Set\(\['medline'\]\)/);
  });

  it('none of the cleared tokens is a database this app knows', () => {
    for (const f of FORMATS) {
      // canonicalDbKey folds known names; a format token must not resolve to a
      // real database, or clearing it would destroy a true attribution.
      const key = canonicalDbKey(f);
      expect(['pubmed', 'embase', 'scopus', 'cinahl', 'central']).not.toContain(key);
    }
  });
});

describe('when it declines to attribute a batch', () => {
  it('skips a batch whose records span several databases', () => {
    expect(SRC).toMatch(/keys\.size > 1/);
    expect(SRC).toMatch(/records span/);
  });

  it('leaves a batch blank when nothing canonicalizes', () => {
    expect(SRC).toMatch(/keys\.size === 0/);
  });

  it('ignores Pecan batches, whose run already records the database', () => {
    expect(SRC).toMatch(/b\.source !== 'pecan-search'/);
  });

  it('never overwrites a sourceDatabase somebody already set', () => {
    expect(SRC).toMatch(/!String\(b\.sourceDatabase \|\| ''\)\.trim\(\)/);
  });
});

describe('operability', () => {
  it('supports a dry run and a single-project scope', () => {
    expect(SRC).toContain('--dry-run');
    expect(SRC).toContain('--project');
  });

  it('fails loudly when the schema has not been pushed', () => {
    expect(SRC).toMatch(/prisma db push/);
  });
});
