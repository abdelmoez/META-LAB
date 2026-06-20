/**
 * searchBuilderHits.test.js — prompt42. Pure helpers behind the Search Builder's
 * hit-status lifecycle (Task 1) and granular PICO-term restore (Task 2). These are
 * exported from SearchBuilderTab.jsx so they're testable without rendering React.
 */
import { describe, it, expect } from 'vitest';
import {
  strategyHash, relativeTime, normalizeIgnored, normalizeIgnoredEntry,
} from '../../src/features/searchBuilder/SearchBuilderTab.jsx';

describe('strategyHash', () => {
  it('is deterministic for the same input', () => {
    expect(strategyHash('"Diabetes"[Mesh] AND mortality[tiab]'))
      .toBe(strategyHash('"Diabetes"[Mesh] AND mortality[tiab]'));
  });
  it('differs when the strategy changes', () => {
    expect(strategyHash('a AND b')).not.toBe(strategyHash('a AND c'));
    expect(strategyHash('a AND b')).not.toBe(strategyHash('a OR b'));
    expect(strategyHash('a')).not.toBe(strategyHash('aa'));
  });
  it('handles empty / nullish input without throwing', () => {
    expect(typeof strategyHash('')).toBe('string');
    expect(typeof strategyHash(null)).toBe('string');
    expect(typeof strategyHash(undefined)).toBe('string');
  });
});

describe('relativeTime', () => {
  const NOW = 1_000_000_000_000;
  it('buckets the elapsed time', () => {
    expect(relativeTime(NOW, NOW)).toBe('just now');
    expect(relativeTime(NOW - 2_000, NOW)).toBe('just now');     // < 5s
    expect(relativeTime(NOW - 30_000, NOW)).toBe('30s ago');     // seconds
    expect(relativeTime(NOW - 120_000, NOW)).toBe('2m ago');     // minutes
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago'); // hours
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2d ago'); // days
  });
  it('returns empty string for a null timestamp', () => {
    expect(relativeTime(null, NOW)).toBe('');
  });
  it('never goes negative for a future timestamp', () => {
    expect(relativeTime(NOW + 5000, NOW)).toBe('just now');
  });
});

describe('normalizeIgnored — legacy back-compat (Task 2)', () => {
  it('normalizes a legacy string entry to {text, field:"", label:""}', () => {
    expect(normalizeIgnoredEntry('diabetes')).toEqual({ text: 'diabetes', field: '', label: '' });
  });
  it('preserves the field + label on an object entry', () => {
    expect(normalizeIgnoredEntry({ text: 'HFrEF', field: 'Population', label: 'heart failure (HFrEF)' }))
      .toEqual({ text: 'HFrEF', field: 'Population', label: 'heart failure (HFrEF)' });
  });
  it('drops empty / unusable entries', () => {
    expect(normalizeIgnoredEntry('')).toBeNull();
    expect(normalizeIgnoredEntry('   ')).toBeNull();
    expect(normalizeIgnoredEntry({})).toBeNull();
    expect(normalizeIgnoredEntry(null)).toBeNull();
    expect(normalizeIgnoredEntry({ text: '' })).toBeNull();
  });
  it('normalizes a MIXED legacy-string + object array (restore preserves field)', () => {
    const out = normalizeIgnored(['diabetes', { text: 'mortality', field: 'Outcome', label: 'mortality' }, '']);
    expect(out).toEqual([
      { text: 'diabetes', field: '', label: '' },
      { text: 'mortality', field: 'Outcome', label: 'mortality' },
    ]);
    // The restore path filters on entry.field — the field survives normalization.
    expect(out.find((e) => e.text === 'mortality').field).toBe('Outcome');
  });
  it('coerces non-string field/label to ""', () => {
    expect(normalizeIgnoredEntry({ text: 'x', field: 5, label: {} }))
      .toEqual({ text: 'x', field: '', label: '' });
  });
  it('tolerates a non-array input', () => {
    expect(normalizeIgnored(null)).toEqual([]);
    expect(normalizeIgnored(undefined)).toEqual([]);
  });
});
