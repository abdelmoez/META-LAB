/**
 * sampling.test.js — reproducible calibration sampling (roadmap 1.3).
 */
import { describe, it, expect } from 'vitest';
import { mulberry32, seededPermutation, seededSample }
  from '../../../src/research-engine/screening/sampling.js';

const items = Array.from({ length: 100 }, (_, i) => `r${i}`);

describe('seededSample reproducibility', () => {
  it('same seed → identical sample and indices', () => {
    const a = seededSample(items, 10, 12345);
    const b = seededSample(items, 10, 12345);
    expect(a.indices).toEqual(b.indices);
    expect(a.sample).toEqual(b.sample);
  });

  it('different seeds usually yield different samples', () => {
    const a = seededSample(items, 10, 1);
    const b = seededSample(items, 10, 2);
    expect(a.indices).not.toEqual(b.indices);
  });

  it('returns exactly n items, as a valid sorted unique subset', () => {
    const { sample, indices, n, total } = seededSample(items, 15, 99);
    expect(n).toBe(15);
    expect(total).toBe(100);
    expect(sample).toHaveLength(15);
    expect(new Set(indices).size).toBe(15);                 // unique
    expect([...indices].sort((x, y) => x - y)).toEqual(indices); // sorted ascending
    indices.forEach(i => expect(i).toBeGreaterThanOrEqual(0));
    indices.forEach(i => expect(i).toBeLessThan(100));
  });

  it('clamps n to [0, total]', () => {
    expect(seededSample(items, 1000, 7).n).toBe(100);
    expect(seededSample(items, 0, 7).n).toBe(0);
    expect(seededSample(items, -5, 7).sample).toEqual([]);
  });

  it('null for non-array input', () => {
    expect(seededSample(null, 5, 1)).toBeNull();
  });
});

describe('mulberry32 / seededPermutation determinism', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const r1 = mulberry32(42), r2 = mulberry32(42);
    for (let i = 0; i < 5; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('seededPermutation is a permutation of [0..len)', () => {
    const p = seededPermutation(20, 7);
    expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(seededPermutation(20, 7)).toEqual(p); // reproducible
  });
});
