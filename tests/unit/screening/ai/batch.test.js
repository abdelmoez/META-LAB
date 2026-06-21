/**
 * batch.test.js — se2.md §12 chunking helpers (pure).
 */
import { describe, it, expect } from 'vitest';
import { chunk, progressFraction } from '../../../../src/research-engine/screening/ai/batch.js';

describe('chunk', () => {
  it('splits into chunks of at most size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
  it('handles empty + bad inputs', () => {
    expect(chunk([], 3)).toEqual([]);
    expect(chunk(null, 3)).toEqual([]);
    expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]]); // size floored to 1
  });
  it('covers every element exactly once', () => {
    const arr = Array.from({ length: 1001 }, (_, i) => i);
    const flat = chunk(arr, 100).flat();
    expect(flat).toEqual(arr);
    expect(chunk(arr, 100).length).toBe(11);
  });
});

describe('progressFraction', () => {
  it('computes a clamped 0..1 fraction', () => {
    expect(progressFraction(0, 10)).toBe(0);
    expect(progressFraction(5, 10)).toBe(0.5);
    expect(progressFraction(20, 10)).toBe(1);
    expect(progressFraction(3, 0)).toBe(1); // nothing to do → complete
  });
});
