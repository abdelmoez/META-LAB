/**
 * 101.md §1/§2 — search provenance. The manuscript may only name a database that
 * was ACTUALLY searched, and the "last searched" date must come from the execution
 * record rather than a field somebody typed.
 *
 * These tests pin the distinctions §1 enumerates: configured vs attempted vs
 * completed vs zero-results vs failed vs manually-imported vs invalidated.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveSearchProvenance, reportableDatabases, canonicalDbKey, dbLabel, dbKind,
  isReportable, isoOf, DB_STATES,
} from '../../src/research-engine/search/searchProvenance.js';

const run = (id, sources, extra = {}) => ({ id, completedAt: '2026-07-01T10:00:00.000Z', sources, ...extra });
const src = (provider, state, o = {}) => ({
  provider, state, rawCount: 10, importedCount: 10,
  completedAt: '2026-07-01T10:00:00.000Z', ...o,
});

describe('database identity', () => {
  it('folds provider ids and free-text source names onto one canonical key', () => {
    expect(canonicalDbKey('PubMed')).toBe('pubmed');
    expect(canonicalDbKey('pubmed')).toBe('pubmed');
    expect(canonicalDbKey('Web of Science')).toBe('webofscience');
    expect(canonicalDbKey('WOS')).toBe('webofscience');
    expect(canonicalDbKey('Embase (Ovid)')).toBe('embase');
    expect(canonicalDbKey('Cochrane')).toBe('central');
  });
  it('keeps an unknown database as its own identity instead of guessing a neighbour', () => {
    expect(canonicalDbKey('Wanfang Data')).toBe('wanfang data');
    expect(dbLabel('Wanfang Data')).toBe('Wanfang Data');
  });
  it('classifies CENTRAL as a database, not a trial register', () => {
    // The label contains "Register of Controlled Trials"; a text classifier would
    // misfile it. PRISMA 2020 counts CENTRAL under databases.
    expect(dbKind('central')).toBe('database');
    expect(dbKind('clinicaltrials')).toBe('register');
  });
});

describe('deriveSearchProvenance — the §1 state distinctions', () => {
  it('separates configured, attempted, completed, zero-result and failed', () => {
    const p = deriveSearchProvenance({
      configured: ['pubmed', 'embase', 'cinahl', 'psycinfo'],
      runs: [run('r1', [
        src('pubmed', 'completed', { rawCount: 120, importedCount: 100 }),
        src('embase', 'completed', { rawCount: 0, importedCount: 0 }),
        src('psycinfo', 'running'),
        src('scopus', 'failed', { errorClass: 'PROVIDER_RATE_LIMITED' }),
      ])],
    });
    const by = Object.fromEntries(p.databases.map((d) => [d.key, d.state]));
    expect(by.pubmed).toBe('completed');
    expect(by.embase).toBe('zero_results');
    expect(by.psycinfo).toBe('attempted');
    expect(by.scopus).toBe('failed');
    expect(by.cinahl).toBe('configured');
  });

  it('never reports a configured-but-never-searched database (§1, §17)', () => {
    const p = deriveSearchProvenance({ configured: ['pubmed', 'embase'], runs: [] });
    expect(p.reportable).toEqual([]);
    expect(reportableDatabases(p).all).toEqual([]);
    expect(p.latestValidSearchAt).toBe('');
  });

  it('reports a zero-result search — it really happened and PRISMA needs it', () => {
    const p = deriveSearchProvenance({
      runs: [run('r1', [src('embase', 'completed', { rawCount: 0, importedCount: 0 })])],
    });
    expect(isReportable('zero_results')).toBe(true);
    expect(reportableDatabases(p).databases).toEqual(['Embase']);
  });

  it('does not report a failed search', () => {
    const p = deriveSearchProvenance({ runs: [run('r1', [src('scopus', 'failed')])] });
    expect(p.reportable).toEqual([]);
    expect(p.counts.failed).toBe(1);
  });

  it('treats a rolled-back run as invalidated, not as a search', () => {
    const p = deriveSearchProvenance({
      runs: [run('r1', [src('openalex', 'completed')], { rolledBackAt: '2026-07-03T00:00:00.000Z' })],
    });
    const openalex = p.databases.find((d) => d.key === 'openalex');
    expect(openalex.state).toBe('invalidated');
    expect(openalex.reportable).toBe(false);
    expect(p.latestValidSearchAt).toBe('');
  });

  it('lets a later successful run supersede an earlier failure', () => {
    const p = deriveSearchProvenance({
      runs: [
        run('r1', [src('scopus', 'failed', { completedAt: '2026-07-01T10:00:00.000Z' })]),
        run('r2', [src('scopus', 'completed', { completedAt: '2026-08-06T10:00:00.000Z' })]),
      ],
    });
    const scopus = p.databases.find((d) => d.key === 'scopus');
    expect(scopus.state).toBe('completed');
    expect(scopus.error).toBe(null);
    expect(scopus.runIds).toEqual(['r1', 'r2']);
  });

  it('ranks invalidated above failed but below any genuinely searched state', () => {
    expect(DB_STATES.invalidated).toBeGreaterThan(DB_STATES.failed);
    expect(DB_STATES.invalidated).toBeLessThan(DB_STATES.zero_results);
    expect(DB_STATES.invalidated).toBeGreaterThan(DB_STATES.configured);
  });
});

describe('manual search / file import (§1 "manually imported search results")', () => {
  it('credits a database from the imported records own source attribution', () => {
    const p = deriveSearchProvenance({
      imports: [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', databases: [{ name: 'Scopus', count: 41 }] }],
    });
    const scopus = p.databases.find((d) => d.key === 'scopus');
    expect(scopus.state).toBe('imported');
    expect(scopus.method).toBe('manual');
    expect(scopus.recordCount).toBe(41);
    expect(scopus.reportable).toBe(true);
  });

  it('drops an import whose records carry no database attribution (§17)', () => {
    const p = deriveSearchProvenance({
      imports: [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', recordCount: 12, databases: [] }],
    });
    expect(p.databases).toEqual([]);
  });

  it('marks a database searched BOTH ways as mixed', () => {
    const p = deriveSearchProvenance({
      runs: [run('r1', [src('pubmed', 'completed')])],
      imports: [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', databases: [{ name: 'PubMed', count: 3 }] }],
    });
    expect(p.databases.find((d) => d.key === 'pubmed').method).toBe('mixed');
  });
});

describe('§2 — the latest VALID search date', () => {
  it('takes the most recent reportable search, across automated and manual', () => {
    const p = deriveSearchProvenance({
      runs: [run('r1', [src('pubmed', 'completed', { completedAt: '2026-07-01T10:00:00.000Z' })])],
      imports: [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', databases: [{ name: 'Scopus', count: 41 }] }],
    });
    expect(p.latestValidSearchAt).toBe('2026-08-06T09:00:00.000Z');
    expect(p.latestValidSource.label).toBe('Scopus');
  });

  it('a failed retry after a good search does not move the date', () => {
    const p = deriveSearchProvenance({
      runs: [
        run('r1', [src('pubmed', 'completed', { completedAt: '2026-07-01T10:00:00.000Z' })]),
        run('r2', [src('embase', 'failed', { completedAt: '2026-08-06T10:00:00.000Z' })]),
      ],
    });
    expect(p.latestValidSearchAt).toBe('2026-07-01T10:00:00.000Z');
  });

  it('a rolled-back later run does not move the date', () => {
    const p = deriveSearchProvenance({
      runs: [
        run('r1', [src('pubmed', 'completed', { completedAt: '2026-07-01T10:00:00.000Z' })]),
        run('r2', [src('scopus', 'completed', { completedAt: '2026-08-06T10:00:00.000Z' })],
          { rolledBackAt: '2026-08-07T00:00:00.000Z' }),
      ],
    });
    expect(p.latestValidSearchAt).toBe('2026-07-01T10:00:00.000Z');
  });

  it('normalizes Date objects and rejects junk timestamps', () => {
    expect(isoOf(new Date('2026-08-06T09:00:00.000Z'))).toBe('2026-08-06T09:00:00.000Z');
    expect(isoOf('not a date')).toBe('');
    expect(isoOf(null)).toBe('');
  });
});

describe('registers are reported separately from databases (PRISMA 2020)', () => {
  it('splits ClinicalTrials.gov out of the database list', () => {
    const p = deriveSearchProvenance({
      runs: [run('r1', [src('pubmed', 'completed'), src('clinicaltrials', 'completed')])],
    });
    const r = reportableDatabases(p);
    expect(r.databases).toEqual(['PubMed']);
    expect(r.registers).toEqual(['ClinicalTrials.gov']);
  });
});
