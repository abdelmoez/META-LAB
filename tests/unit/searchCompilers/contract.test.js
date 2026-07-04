/**
 * contract.test.js — the public compiler API surface: coverage of all 16 catalogue
 * databases, compileAll, capabilitiesFor metadata, manual-override handling, and the
 * graceful path for an unknown database id.
 */
import { describe, it, expect } from 'vitest';
import {
  compileStrategy, compileAll, listCompilerDatabases, capabilitiesFor,
} from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { DATABASE_CATALOG } from '../../../src/research-engine/searchBuilder/databases.js';
import { FIXTURE } from './fixture.js';

const CATALOG_IDS = DATABASE_CATALOG.map((d) => d.id);

describe('compiler coverage', () => {
  it('has a registered compiler for every one of the 16 catalogue databases', () => {
    const compiled = listCompilerDatabases();
    expect(compiled.length).toBe(16);
    for (const id of CATALOG_IDS) expect(compiled).toContain(id);
  });

  it('compileAll(strategy) returns one well-formed result per registered database', () => {
    const all = compileAll(FIXTURE);
    expect(all.map((r) => r.dbId)).toEqual(listCompilerDatabases());
    for (const r of all) {
      expect(typeof r.query).toBe('string');
      expect(r.query.length).toBeGreaterThan(0);
      expect(Array.isArray(r.warnings)).toBe(true);
      expect(Array.isArray(r.notes)).toBe(true);
      expect(Array.isArray(r.unsupported)).toBe(true);
      expect(['native', 'approximate']).toContain(r.syntaxLevel);
      expect(typeof r.filtersApplied).toBe('boolean');
      expect(['mesh', 'emtree', 'cinahl', 'apa', 'decs', 'none']).toContain(r.vocab.system);
    }
  });

  it('compileAll(strategy, subset) honors an explicit database list + order', () => {
    const all = compileAll(FIXTURE, ['scopus', 'pubmed']);
    expect(all.map((r) => r.dbId)).toEqual(['scopus', 'pubmed']);
  });
});

describe('capabilitiesFor', () => {
  it('returns capability metadata (with 1–3 user-facing notes) for every database', () => {
    for (const id of CATALOG_IDS) {
      const cap = capabilitiesFor(id);
      expect(cap).toBeTruthy();
      expect(cap.id).toBe(id);
      expect(cap.notes.length).toBeGreaterThanOrEqual(1);
      expect(cap.notes.length).toBeLessThanOrEqual(3);
      expect(['native', 'approximate']).toContain(cap.syntaxLevel);
    }
  });
  it('returns null for an unknown id', () => {
    expect(capabilitiesFor('nope')).toBeNull();
  });
});

describe('manual override', () => {
  it('replaces the composed query with a saved overrides[dbId] string', () => {
    const s = { ...FIXTURE, overrides: { pubmed: 'my hand-edited query[tiab]' } };
    const r = compileStrategy(s, 'pubmed');
    expect(r.query).toBe('my hand-edited query[tiab]');
    expect(r.overridden).toBe(true);
    expect(r.notes.some((n) => /manual override is saved/.test(n))).toBe(true);
  });
  it('applyOverride:false returns the freshly composed query instead', () => {
    const s = { ...FIXTURE, overrides: { pubmed: 'ignored' } };
    const r = compileStrategy(s, 'pubmed', { applyOverride: false });
    expect(r.query).not.toBe('ignored');
    expect(r.overridden).toBeUndefined();
  });
});

describe('unknown database', () => {
  it('degrades gracefully with an UNSUPPORTED_DATABASE warning (never throws)', () => {
    const r = compileStrategy(FIXTURE, 'notadb');
    expect(r.query).toBe('');
    expect(r.warnings.map((w) => w.code)).toContain('UNSUPPORTED_DATABASE');
    expect(r.vocab.system).toBe('none');
  });
});
