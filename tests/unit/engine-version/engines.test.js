/**
 * engines.test.js — the canonical engine catalog + ownership map invariants.
 */
import { describe, it, expect } from 'vitest';
import {
  INITIAL_VERSION,
  ENGINES,
  ENGINE_IDS,
  ENGINE_BY_ID,
  isEngineId,
  SHARED_INFRA_GLOBS,
  NO_BUMP_GLOBS,
} from '../../../src/research-engine/engine-registry/engines.js';

describe('INITIAL_VERSION', () => {
  it('is v0.1', () => {
    expect(INITIAL_VERSION).toEqual({ major: 0, minor: 1 });
  });
});

describe('ENGINES catalog', () => {
  it('has exactly 11 engines', () => {
    expect(ENGINES).toHaveLength(11);
    expect(ENGINE_IDS).toHaveLength(11);
  });
  it('all ids are unique', () => {
    expect(new Set(ENGINE_IDS).size).toBe(11);
  });
  it('all ids are kebab-case', () => {
    for (const id of ENGINE_IDS) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
  it('contains the expected 11 ids', () => {
    expect(ENGINE_IDS).toEqual([
      'screening',
      'screening-ai',
      'search-builder',
      'pecan-search',
      'meta-analysis',
      'network-meta-analysis',
      'risk-of-bias',
      'protocol-pico',
      'data-extraction',
      'import-export',
      'validation',
    ]);
  });
  it('every engine has a displayName, description, valid status, non-empty ownership', () => {
    const validStatus = new Set(['active', 'beta', 'experimental']);
    for (const e of ENGINES) {
      expect(typeof e.displayName).toBe('string');
      expect(e.displayName.length).toBeGreaterThan(0);
      expect(typeof e.description).toBe('string');
      expect(e.description.length).toBeGreaterThan(0);
      expect(validStatus.has(e.status)).toBe(true);
      expect(Array.isArray(e.ownership)).toBe(true);
      expect(e.ownership.length).toBeGreaterThan(0);
      for (const glob of e.ownership) {
        expect(typeof glob).toBe('string');
        expect(glob.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('ENGINE_BY_ID / isEngineId', () => {
  it('lookups resolve to the catalog entries', () => {
    expect(ENGINE_BY_ID.screening.displayName).toBe('Screening');
    expect(ENGINE_BY_ID['network-meta-analysis'].status).toBe('beta');
    expect(ENGINE_BY_ID.nope).toBeUndefined();
  });
  it('isEngineId discriminates known vs unknown', () => {
    expect(isEngineId('screening')).toBe(true);
    expect(isEngineId('network-meta-analysis')).toBe(true);
    expect(isEngineId('nope')).toBe(false);
    expect(isEngineId('')).toBe(false);
    // must not be fooled by Object.prototype members
    expect(isEngineId('toString')).toBe(false);
    expect(isEngineId('hasOwnProperty')).toBe(false);
  });
});

describe('infra glob lists', () => {
  it('are non-empty string arrays', () => {
    expect(Array.isArray(SHARED_INFRA_GLOBS)).toBe(true);
    expect(SHARED_INFRA_GLOBS.length).toBeGreaterThan(0);
    expect(Array.isArray(NO_BUMP_GLOBS)).toBe(true);
    expect(NO_BUMP_GLOBS.length).toBeGreaterThan(0);
  });
});
