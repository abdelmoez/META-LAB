/**
 * project-model.test.js
 * Unit tests for mkProject, mkStudy, uid, now, fmtDate from the project model.
 */

import { describe, it, expect } from 'vitest';
import {
  uid,
  now,
  fmtDate,
  mkProject,
  mkStudy,
} from '../../src/research-engine/project-model/defaults.js';

// ── uid ───────────────────────────────────────────────────────────────────────
describe('uid', () => {
  it('returns a string', () => {
    expect(typeof uid()).toBe('string');
  });

  it('returns an 8-character string', () => {
    expect(uid()).toHaveLength(8);
  });

  it('generates unique ids on each call', () => {
    const ids = new Set(Array.from({ length: 1000 }, uid));
    expect(ids.size).toBe(1000);
  });

  it('only contains alphanumeric characters (base-36)', () => {
    for (let i = 0; i < 50; i++) {
      expect(uid()).toMatch(/^[a-z0-9]{8}$/);
    }
  });
});

// ── now ───────────────────────────────────────────────────────────────────────
describe('now', () => {
  it('returns a string', () => {
    expect(typeof now()).toBe('string');
  });

  it('returns a valid ISO-8601 datetime string', () => {
    const ts = now();
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toString()).not.toBe('Invalid Date');
  });

  it('is close to the current time', () => {
    const before = Date.now();
    const ts = now();
    const after = Date.now();
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after + 100);
  });
});

// ── fmtDate ───────────────────────────────────────────────────────────────────
describe('fmtDate', () => {
  it('returns "—" for null input', () => {
    expect(fmtDate(null)).toBe('—');
  });

  it('returns "—" for undefined input', () => {
    expect(fmtDate(undefined)).toBe('—');
  });

  it('returns "—" for empty string', () => {
    expect(fmtDate('')).toBe('—');
  });

  it('formats an ISO string as "Mon DD, YYYY"', () => {
    const formatted = fmtDate('2024-01-05T00:00:00.000Z');
    expect(formatted).toMatch(/Jan/);
    expect(formatted).toMatch(/2024/);
  });

  it('returns a non-empty string for a valid date', () => {
    const formatted = fmtDate('2023-06-15T12:00:00Z');
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).not.toBe('—');
  });
});

// ── mkProject ─────────────────────────────────────────────────────────────────
describe('mkProject', () => {
  it('returns an object with the given name', () => {
    const p = mkProject('My Project');
    expect(p.name).toBe('My Project');
  });

  it('has a unique id', () => {
    const p1 = mkProject('A');
    const p2 = mkProject('B');
    expect(p1.id).not.toBe(p2.id);
  });

  it('has an 8-character alphanumeric id', () => {
    const p = mkProject('Test');
    expect(p.id).toMatch(/^[a-z0-9]{8}$/);
  });

  it('has created and modified timestamps as valid ISO strings', () => {
    const p = mkProject('Test');
    expect(new Date(p.created).toString()).not.toBe('Invalid Date');
    expect(new Date(p.modified).toString()).not.toBe('Invalid Date');
  });

  it('has an empty studies array', () => {
    const p = mkProject('Test');
    expect(Array.isArray(p.studies)).toBe(true);
    expect(p.studies).toHaveLength(0);
  });

  it('has an empty records array', () => {
    const p = mkProject('Test');
    expect(Array.isArray(p.records)).toBe(true);
    expect(p.records).toHaveLength(0);
  });

  it('has a pico object with required keys', () => {
    const p = mkProject('Test');
    expect(p.pico).toBeDefined();
    expect(p.pico).toHaveProperty('P');
    expect(p.pico).toHaveProperty('I');
    expect(p.pico).toHaveProperty('C');
    expect(p.pico).toHaveProperty('O');
    expect(p.pico).toHaveProperty('question');
  });

  it('has a search object with dbs', () => {
    const p = mkProject('Test');
    expect(p.search).toBeDefined();
    expect(p.search.dbs).toBeDefined();
    expect(typeof p.search.dbs).toBe('object');
  });

  it('has a prisma object', () => {
    const p = mkProject('Test');
    expect(p.prisma).toBeDefined();
    expect(Array.isArray(p.prisma.reasons)).toBe(true);
    expect(p.prisma.reasons.length).toBeGreaterThan(0);
  });

  it('has robMethod set to "RoB2"', () => {
    const p = mkProject('Test');
    expect(p.robMethod).toBe('RoB2');
  });

  it('has an empty reportChecked object', () => {
    const p = mkProject('Test');
    expect(p.reportChecked).toEqual({});
  });

  it('prisma reasons entry has id, r, n fields', () => {
    const p = mkProject('Test');
    const reason = p.prisma.reasons[0];
    expect(reason).toHaveProperty('id');
    expect(reason).toHaveProperty('r');
    expect(reason).toHaveProperty('n');
  });
});

// ── mkStudy ───────────────────────────────────────────────────────────────────
describe('mkStudy', () => {
  it('returns an object', () => {
    expect(typeof mkStudy()).toBe('object');
  });

  it('has a unique id', () => {
    const s1 = mkStudy();
    const s2 = mkStudy();
    expect(s1.id).not.toBe(s2.id);
  });

  it('has an 8-character alphanumeric id', () => {
    const s = mkStudy();
    expect(s.id).toMatch(/^[a-z0-9]{8}$/);
  });

  it('all string fields are initialised to ""', () => {
    const s = mkStudy();
    const stringFields = ['author', 'year', 'country', 'outcome', 'es', 'lo', 'hi',
      'esType', 'timepoint', 'followup', 'nExp', 'nCtrl',
      'meanExp', 'sdExp', 'meanCtrl', 'sdCtrl', 'a', 'b', 'c', 'd',
      'events', 'total', 'tp', 'fp', 'fn', 'tn',
      'source', 'notes', 'title', 'authors', 'journal', 'doi', 'pmid', 'abstract'];
    stringFields.forEach(field => {
      expect(s[field]).toBe('');
    });
  });

  it('converted is false by default', () => {
    expect(mkStudy().converted).toBe(false);
  });

  it('needsReview is false by default', () => {
    expect(mkStudy().needsReview).toBe(false);
  });

  it('flags is an empty array', () => {
    const s = mkStudy();
    expect(Array.isArray(s.flags)).toBe(true);
    expect(s.flags).toHaveLength(0);
  });

  it('conversions is an empty array', () => {
    const s = mkStudy();
    expect(Array.isArray(s.conversions)).toBe(true);
    expect(s.conversions).toHaveLength(0);
  });

  it('rob is an empty object', () => {
    const s = mkStudy();
    expect(typeof s.rob).toBe('object');
    expect(Object.keys(s.rob)).toHaveLength(0);
  });

  it('design defaults to "RCT"', () => {
    expect(mkStudy().design).toBe('RCT');
  });

  it('adjusted defaults to "unadjusted"', () => {
    expect(mkStudy().adjusted).toBe('unadjusted');
  });

  it('dataNature defaults to "primary"', () => {
    expect(mkStudy().dataNature).toBe('primary');
  });

  it('n is ""', () => {
    expect(mkStudy().n).toBe('');
  });
});
