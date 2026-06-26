/**
 * version.test.js — pure version math for the internal engine-version system.
 * Versions are STRUCTURAL {major, minor} integers, never floats.
 */
import { describe, it, expect } from 'vitest';
import {
  CHANGE_TYPES,
  isValidChangeType,
  bumpVersion,
  formatVersion,
  parseVersion,
  compareVersion,
} from '../../../src/research-engine/engine-registry/version.js';

describe('CHANGE_TYPES / isValidChangeType', () => {
  it('exposes exactly minor + major', () => {
    expect(CHANGE_TYPES).toEqual(['minor', 'major']);
  });
  it('validates change types', () => {
    expect(isValidChangeType('minor')).toBe(true);
    expect(isValidChangeType('major')).toBe(true);
    expect(isValidChangeType('patch')).toBe(false);
    expect(isValidChangeType('MAJOR')).toBe(false);
    expect(isValidChangeType('')).toBe(false);
    expect(isValidChangeType(undefined)).toBe(false);
    expect(isValidChangeType(null)).toBe(false);
  });
});

describe('bumpVersion', () => {
  it('minor increments minor, preserves major', () => {
    expect(bumpVersion({ major: 0, minor: 1 }, 'minor')).toEqual({ major: 0, minor: 2 });
    expect(bumpVersion({ major: 0, minor: 9 }, 'minor')).toEqual({ major: 0, minor: 10 });
    expect(bumpVersion({ major: 1, minor: 4 }, 'minor')).toEqual({ major: 1, minor: 5 });
  });
  it('major increments major, resets minor to 0', () => {
    expect(bumpVersion({ major: 0, minor: 1 }, 'major')).toEqual({ major: 1, minor: 0 });
    expect(bumpVersion({ major: 1, minor: 7 }, 'major')).toEqual({ major: 2, minor: 0 });
  });
  it('does not mutate the input', () => {
    const v = { major: 1, minor: 2 };
    bumpVersion(v, 'minor');
    bumpVersion(v, 'major');
    expect(v).toEqual({ major: 1, minor: 2 });
  });
  it('throws on an invalid change type', () => {
    expect(() => bumpVersion({ major: 0, minor: 1 }, 'patch')).toThrow(/invalid change type/);
    expect(() => bumpVersion({ major: 0, minor: 1 }, 'PATCH')).toThrow(/invalid change type/);
  });
  it('throws on non-negative-integer components', () => {
    expect(() => bumpVersion({ major: -1, minor: 0 }, 'minor')).toThrow();
    expect(() => bumpVersion({ major: 0, minor: 1.5 }, 'minor')).toThrow();
    expect(() => bumpVersion({ major: '0', minor: 1 }, 'minor')).toThrow();
    expect(() => bumpVersion(null, 'minor')).toThrow();
  });
});

describe('formatVersion', () => {
  it('renders v{major}.{minor}', () => {
    expect(formatVersion({ major: 0, minor: 1 })).toBe('v0.1');
    expect(formatVersion({ major: 0, minor: 10 })).toBe('v0.10');
    expect(formatVersion({ major: 12, minor: 3 })).toBe('v12.3');
  });
  it('guards nulls / garbage → v0.0', () => {
    expect(formatVersion(null)).toBe('v0.0');
    expect(formatVersion(undefined)).toBe('v0.0');
    expect(formatVersion('nope')).toBe('v0.0');
    expect(formatVersion({})).toBe('v0.0');
  });
});

describe('parseVersion', () => {
  it('parses v-prefixed and bare forms', () => {
    expect(parseVersion('v0.1')).toEqual({ major: 0, minor: 1 });
    expect(parseVersion('1.2')).toEqual({ major: 1, minor: 2 });
    expect(parseVersion('v12.34')).toEqual({ major: 12, minor: 34 });
    expect(parseVersion(' V2.0 ')).toEqual({ major: 2, minor: 0 });
  });
  it('returns null on invalid input', () => {
    expect(parseVersion('x')).toBeNull();
    expect(parseVersion('1')).toBeNull();
    expect(parseVersion('1.2.3')).toBeNull();
    expect(parseVersion('v1.')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(12)).toBeNull();
  });
  it('round-trips with formatVersion', () => {
    expect(formatVersion(parseVersion('v3.14'))).toBe('v3.14');
  });
});

describe('compareVersion', () => {
  it('orders by major then minor', () => {
    expect(compareVersion({ major: 0, minor: 2 }, { major: 0, minor: 10 })).toBe(-1); // 0.2 < 0.10
    expect(compareVersion({ major: 1, minor: 0 }, { major: 0, minor: 99 })).toBe(1);  // 1.0 > 0.99
    expect(compareVersion({ major: 1, minor: 2 }, { major: 1, minor: 2 })).toBe(0);
    expect(compareVersion({ major: 2, minor: 0 }, { major: 1, minor: 5 })).toBe(1);
    expect(compareVersion({ major: 1, minor: 5 }, { major: 2, minor: 0 })).toBe(-1);
  });
  it('treats missing components as 0', () => {
    expect(compareVersion({}, { major: 0, minor: 0 })).toBe(0);
    expect(compareVersion({ major: 1 }, {})).toBe(1);
  });
});
