/**
 * searchDatabases.test.js — SB3 Tab 3 ("Choose Databases"). The pure database
 * catalogue: every entry has a label + access note, the three core databases have
 * verified native syntax + are default-selected, and the grouping is stable.
 */
import { describe, it, expect } from 'vitest';
import {
  DATABASE_CATALOG, ACCESS_TIERS, databaseGroups, defaultSelectedDatabases,
  accessNote, getDatabase, nativeSyntaxDatabases, ACCESS_TOOLTIP,
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
