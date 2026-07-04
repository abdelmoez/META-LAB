/**
 * searchDatabases.test.js — SB3 Tab 3 ("Choose Databases"). The pure database
 * catalogue: every entry has a label + access note, the three core databases have
 * verified native syntax + are default-selected, and the grouping is stable.
 */
import { describe, it, expect } from 'vitest';
import {
  DATABASE_CATALOG, ACCESS_TIERS, databaseGroups, defaultSelectedDatabases,
  accessNote, getDatabase, nativeSyntaxDatabases, ACCESS_TOOLTIP,
  compiledDatabases, openUrlFor, homeUrlFor,
} from '../../src/research-engine/searchBuilder/databases.js';

describe('DATABASE_CATALOG integrity', () => {
  it('has the expected core + expanded databases', () => {
    const ids = DATABASE_CATALOG.map((d) => d.id);
    for (const id of ['pubmed', 'embase', 'cochrane', 'clinicaltrials', 'ictrp',
      'scopus', 'wos', 'gscholar', 'cinahl', 'psycinfo', 'proquest',
      'europepmc', 'pmc', 'ieee', 'acm']) {
      expect(ids).toContain(id);
    }
    expect(ids.length).toBe(new Set(ids).size); // ids are unique
  });

  it('every entry has a label, a group, and a known access tier (with a note)', () => {
    for (const db of DATABASE_CATALOG) {
      expect(db.label && db.label.length).toBeTruthy();
      expect(db.group && db.group.length).toBeTruthy();
      expect(ACCESS_TIERS[db.tier]).toBeTruthy();
      expect(accessNote(db.id)).toBe(ACCESS_TIERS[db.tier]);
    }
  });

  it('uses conservative, non-absolute wording for subscription access', () => {
    expect(ACCESS_TIERS.subscription.toLowerCase()).toContain('usually');
    expect(ACCESS_TOOLTIP.toLowerCase()).toContain('institution');
  });
});

describe('native syntax + defaults', () => {
  it('only PubMed / Embase / Cochrane advertise native syntax', () => {
    expect(nativeSyntaxDatabases().sort()).toEqual(['cochrane', 'embase', 'pubmed']);
  });
  it('default selection is exactly the three native-syntax databases', () => {
    expect(defaultSelectedDatabases().sort()).toEqual(['cochrane', 'embase', 'pubmed']);
  });
  it('the free databases are tagged free, not subscription', () => {
    for (const id of ['pubmed', 'clinicaltrials', 'ictrp', 'europepmc', 'pmc']) {
      expect(getDatabase(id).tier.startsWith('free')).toBe(true);
    }
    expect(getDatabase('embase').tier).toBe('subscription');
    expect(getDatabase('scopus').tier).toBe('subscription');
  });
});

describe('databaseGroups', () => {
  it('groups every database exactly once, preserving catalogue order', () => {
    const groups = databaseGroups();
    const flat = groups.flatMap((g) => g.databases.map((d) => d.id));
    expect(flat).toEqual(DATABASE_CATALOG.map((d) => d.id));
  });
  it('exposes the expected section headings', () => {
    const names = databaseGroups().map((g) => g.group);
    expect(names).toContain('Core biomedical');
    expect(names).toContain('Multidisciplinary');
    expect(names).toContain('Grey literature');
  });
});

describe('getDatabase / accessNote edge cases', () => {
  it('returns null / empty for an unknown id', () => {
    expect(getDatabase('nope')).toBeNull();
    expect(accessNote('nope')).toBe('');
  });
});

// ── 73.md Part 6 — additive compiler metadata (does not disturb the above) ──────
describe('compiler metadata (73.md Part 6)', () => {
  it('every catalogue entry carries a syntaxLevel + vocabSystem', () => {
    for (const db of DATABASE_CATALOG) {
      expect(['native', 'approximate']).toContain(db.syntaxLevel);
      expect(['mesh', 'emtree', 'cinahl', 'apa', 'decs', 'none']).toContain(db.vocabSystem);
    }
  });

  it('compiledDatabases() covers all 16 catalogue ids (the compiler renders every one)', () => {
    expect(compiledDatabases().sort()).toEqual(DATABASE_CATALOG.map((d) => d.id).sort());
    expect(compiledDatabases()).toHaveLength(16);
  });

  it('nativeSyntaxDatabases() is UNCHANGED — exactly the three legacy databases', () => {
    expect(nativeSyntaxDatabases().sort()).toEqual(['cochrane', 'embase', 'pubmed']);
  });

  it('only Google Scholar + grey literature are approximate syntax; the rest are native', () => {
    const approx = DATABASE_CATALOG.filter((d) => d.syntaxLevel === 'approximate').map((d) => d.id).sort();
    expect(approx).toEqual(['gscholar', 'opengrey']);
  });

  it('openUrlFor() prefills the URL template only where reliable, else null', () => {
    expect(openUrlFor('pubmed', 'cancer[tiab]')).toBe('https://pubmed.ncbi.nlm.nih.gov/?term=cancer%5Btiab%5D');
    expect(openUrlFor('europepmc', 'TITLE:"x y"')).toBe('https://europepmc.org/search?query=TITLE%3A%22x%20y%22');
    expect(openUrlFor('scopus', 'x')).toBeNull();       // subscription DB → no reliable prefill
    expect(openUrlFor('nope', 'x')).toBeNull();
  });

  it('homeUrlFor() returns a paste-target page for every database', () => {
    for (const db of DATABASE_CATALOG) {
      expect(typeof homeUrlFor(db.id)).toBe('string');
      expect(homeUrlFor(db.id).startsWith('http')).toBe(true);
    }
    expect(homeUrlFor('scopus')).toBe('https://www.scopus.com');
  });
});
