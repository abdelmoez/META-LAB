/**
 * searchEngine.test.js — pure parts of the separated Search Engine (NLM mapper +
 * TTL/LRU cache). The network paths are covered by the skip-aware integration
 * suite + live verification.
 */
import { describe, it, expect } from 'vitest';
import { mapMeshSummary } from '../../server/searchEngine/nlmClient.js';
import { createTtlCache } from '../../server/searchEngine/ttlCache.js';

describe('mapMeshSummary', () => {
  it('maps an esummary MeSH record to the contract shape', () => {
    const rec = {
      ds_meshterms: ['Diabetes Mellitus, Type 2', 'NIDDM', 'Type 2 Diabetes Mellitus'],
      ds_meshui: 'D003924',
      ds_scopenote: 'A subclass of diabetes mellitus that is not insulin-responsive...',
    };
    const m = mapMeshSummary(rec);
    expect(m.mesh).toBe('Diabetes Mellitus, Type 2');
    expect(m.meshUI).toBe('D003924');
    expect(m.synonyms).toContain('NIDDM');
    expect(m.emtree).toBe('diabetes mellitus, type 2'); // lowercased fallback
    expect(m.scope).toMatch(/insulin/);
    expect(m.source).toBe('live');
    expect(Array.isArray(m.children)).toBe(true);
  });

  it('returns null for an empty / unusable record', () => {
    expect(mapMeshSummary(null)).toBeNull();
    expect(mapMeshSummary({})).toBeNull();
    expect(mapMeshSummary({ ds_meshterms: [] })).toBeNull();
  });

  it('caps synonyms and tolerates missing fields', () => {
    const rec = { ds_meshterms: Array.from({ length: 60 }, (_, i) => `t${i}`) };
    const m = mapMeshSummary(rec);
    expect(m.mesh).toBe('t0');
    expect(m.synonyms.length).toBe(40);
    expect(m.meshUI).toBe('');
    expect(m.scope).toBe('');
  });
});

describe('createTtlCache', () => {
  it('stores and retrieves; miss is undefined; cached null is a valid negative', () => {
    const c = createTtlCache({ ttlMs: 10000, max: 3 });
    expect(c.get('x')).toBeUndefined();
    c.set('x', { a: 1 });
    expect(c.get('x')).toEqual({ a: 1 });
    c.set('neg', null);
    expect(c.get('neg')).toBeNull();   // distinct from undefined (miss)
    expect(c.has('neg')).toBe(true);
    expect(c.has('missing')).toBe(false);
  });

  it('evicts the oldest when over max', () => {
    const c = createTtlCache({ ttlMs: 10000, max: 2 });
    c.set('a', 1); c.set('b', 2); c.set('c', 3); // 'a' evicted
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });
});
