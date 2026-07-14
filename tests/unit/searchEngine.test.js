/**
 * searchEngine.test.js — pure parts of the separated Search Engine (NLM mapper +
 * TTL/LRU cache). The network paths are covered by the skip-aware integration
 * suite + live verification.
 */
import { describe, it, expect } from 'vitest';
import {
  mapMeshSummary, mapMeshSummaryList, emtreeFallback, parseSparqlLabels, meshNarrower, meshSuggest,
} from '../../server/searchEngine/nlmClient.js';
import { sanitizeIgnored, sanitizeFilters, sanitizeSearchMode, sanitizeRejectedSuggestions } from '../../server/searchEngine/searchEngineController.js';
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
    expect(m.emtree).toBe('type 2 diabetes mellitus'); // de-inverted, lowercased fallback
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

describe('mapMeshSummaryList (meshSuggest mapper, prompt42)', () => {
  const result = {
    '1': { ds_meshterms: ['Diabetes Mellitus, Type 2', 'NIDDM'], ds_meshui: 'D003924' },
    '2': { ds_meshterms: ['Diabetes Mellitus, Type 1'], ds_meshui: 'D003922' },
    '3': { ds_meshterms: [] },                  // unusable → skipped
    '4': { ds_meshterms: ['Diabetes Mellitus, Type 2'], ds_meshui: 'Dxxxx' }, // dupe heading → skipped
  };
  it('maps each uid in order via mapMeshSummary, dropping unusable + duplicate headings', () => {
    const list = mapMeshSummaryList(result, ['1', '2', '3', '4']);
    expect(list.map((m) => m.mesh)).toEqual(['Diabetes Mellitus, Type 2', 'Diabetes Mellitus, Type 1']);
    expect(list[0].meshUI).toBe('D003924');
    expect(list[0].source).toBe('live');
    expect(list[0].children).toEqual([]); // suggestions don't enrich narrower terms
    expect(list[0].emtree).toBe('type 2 diabetes mellitus'); // de-inverted fallback
  });
  it('respects the cap', () => {
    expect(mapMeshSummaryList(result, ['1', '2'], 1).map((m) => m.mesh)).toEqual(['Diabetes Mellitus, Type 2']);
  });
  it('tolerates empty / malformed args', () => {
    expect(mapMeshSummaryList(null, null)).toEqual([]);
    expect(mapMeshSummaryList({}, ['9'])).toEqual([]); // uid not present
    expect(mapMeshSummaryList(result, [])).toEqual([]);
  });
});

describe('meshSuggest (network-free paths)', () => {
  it('returns [] for an empty term without touching the network', async () => {
    expect(await meshSuggest('')).toEqual([]);
    expect(await meshSuggest('   ')).toEqual([]);
    expect(await meshSuggest(null)).toEqual([]);
  });
});

describe('sanitizeIgnored — backend back-compat (prompt42 Task 2)', () => {
  it('accepts the legacy string[] form, normalizing to objects', () => {
    expect(sanitizeIgnored(['diabetes', 'mortality'])).toEqual([
      { text: 'diabetes', field: '', label: '' },
      { text: 'mortality', field: '', label: '' },
    ]);
  });
  it('accepts the rich object[] form, preserving field + label', () => {
    expect(sanitizeIgnored([{ text: 'HFrEF', field: 'Population', label: 'heart failure (HFrEF)' }]))
      .toEqual([{ text: 'HFrEF', field: 'Population', label: 'heart failure (HFrEF)' }]);
  });
  it('accepts a MIXED array and drops empty / non-string-text entries', () => {
    expect(sanitizeIgnored(['x', { text: 'y', field: 'Outcome' }, '', { foo: 1 }, { text: '' }])).toEqual([
      { text: 'x', field: '', label: '' },
      { text: 'y', field: 'Outcome', label: '' },
    ]);
  });
  it('caps at 500 and tolerates a non-array', () => {
    expect(sanitizeIgnored(Array.from({ length: 600 }, (_, i) => `t${i}`)).length).toBe(500);
    expect(sanitizeIgnored(null)).toEqual([]);
    expect(sanitizeIgnored('nope')).toEqual([]);
  });
});

describe('sanitizeFilters — putSearch allowlist (prompt60 seam fix #3)', () => {
  it('returns the full shape with empty defaults for absent/garbage input', () => {
    expect(sanitizeFilters(undefined)).toEqual({ dateFrom: '', dateTo: '', languages: [], pubTypes: [] });
    expect(sanitizeFilters('nope')).toEqual({ dateFrom: '', dateTo: '', languages: [], pubTypes: [] });
    expect(sanitizeFilters({})).toEqual({ dateFrom: '', dateTo: '', languages: [], pubTypes: [] });
  });
  it('keeps valid fields and drops empty / non-string array entries', () => {
    expect(sanitizeFilters({ dateFrom: ' 2010 ', dateTo: '2025', languages: ['en', '', 5, 'es'], pubTypes: ['Review', null] }))
      .toEqual({ dateFrom: '2010', dateTo: '2025', languages: ['en', 'es'], pubTypes: ['Review'] });
  });
  it('clamps long strings and caps the arrays (mirrors the AST clamps)', () => {
    const out = sanitizeFilters({
      dateFrom: '12345678901234567890',
      languages: Array.from({ length: 40 }, (_, i) => `l${i}`),
      pubTypes: Array.from({ length: 60 }, (_, i) => `p${i}`),
    });
    expect(out.dateFrom.length).toBeLessThanOrEqual(10);
    expect(out.languages.length).toBe(20);
    expect(out.pubTypes.length).toBe(40);
  });
});

describe('sanitizeSearchMode — putSearch allowlist (73.md P5 two-path marker)', () => {
  it("accepts exactly 'manual' and 'automated'", () => {
    expect(sanitizeSearchMode('manual')).toBe('manual');
    expect(sanitizeSearchMode('automated')).toBe('automated');
  });
  it('collapses everything else to null (junk, casing, legacy shapes, absent)', () => {
    expect(sanitizeSearchMode(null)).toBeNull();
    expect(sanitizeSearchMode(undefined)).toBeNull();
    expect(sanitizeSearchMode('')).toBeNull();
    expect(sanitizeSearchMode('MANUAL')).toBeNull();
    expect(sanitizeSearchMode('auto')).toBeNull();
    expect(sanitizeSearchMode(1)).toBeNull();
    expect(sanitizeSearchMode({ mode: 'manual' })).toBeNull();
    expect(sanitizeSearchMode(['manual'])).toBeNull();
  });
});

describe('sanitizeRejectedSuggestions — putSearch allowlist (85.md A1)', () => {
  it('keeps trimmed string keys in order (no dedupe/reorder — the client echo must match byte-for-byte)', () => {
    expect(sanitizeRejectedSuggestions(['rej:P:fam:eus', ' rej:I:metformin ', 'rej:P:fam:eus']))
      .toEqual(['rej:P:fam:eus', 'rej:I:metformin', 'rej:P:fam:eus']);
  });
  it('drops non-strings and empties', () => {
    expect(sanitizeRejectedSuggestions(['rej:P:x', 7, null, {}, '', '   '])).toEqual(['rej:P:x']);
  });
  it('caps at 500 and tolerates a non-array', () => {
    expect(sanitizeRejectedSuggestions(Array.from({ length: 600 }, (_, i) => `rej:P:t${i}`)).length).toBe(500);
    expect(sanitizeRejectedSuggestions(null)).toEqual([]);
    expect(sanitizeRejectedSuggestions('nope')).toEqual([]);
  });
});

describe('emtreeFallback', () => {
  it('de-inverts comma-inverted MeSH headings into natural Embase order', () => {
    expect(emtreeFallback('Diabetes Mellitus, Type 2')).toBe('type 2 diabetes mellitus');
    expect(emtreeFallback('Heart Failure, Systolic')).toBe('systolic heart failure');
    expect(emtreeFallback('Hypertension, Malignant')).toBe('malignant hypertension');
  });

  it('lowercases non-inverted headings unchanged and tolerates empties', () => {
    expect(emtreeFallback('Hypertension')).toBe('hypertension');
    expect(emtreeFallback('')).toBe('');
    expect(emtreeFallback(null)).toBe('');
  });
});

describe('parseSparqlLabels', () => {
  it('extracts ordered de-duped ?label values from a SPARQL JSON result', () => {
    const json = {
      head: { vars: ['label'] },
      results: { bindings: [
        { label: { value: 'Heart Failure, Systolic' } },
        { label: { value: 'Heart Failure, Diastolic' } },
        { label: { value: 'Heart Failure, Systolic' } }, // dupe dropped
      ] },
    };
    expect(parseSparqlLabels(json)).toEqual(['Heart Failure, Systolic', 'Heart Failure, Diastolic']);
  });

  it('returns [] for missing / malformed results', () => {
    expect(parseSparqlLabels(null)).toEqual([]);
    expect(parseSparqlLabels({})).toEqual([]);
    expect(parseSparqlLabels({ results: {} })).toEqual([]);
    expect(parseSparqlLabels({ results: { bindings: [{}, { label: {} }] } })).toEqual([]);
  });
});

describe('meshNarrower guard', () => {
  it('returns [] (no network) for anything that is not a real descriptor UI', async () => {
    // /^D\d{6,}$/ guard — blocks SPARQL injection and avoids pointless fetches.
    expect(await meshNarrower('')).toEqual([]);
    expect(await meshNarrower(null)).toEqual([]);
    expect(await meshNarrower('Diabetes')).toEqual([]);
    expect(await meshNarrower('D123')).toEqual([]);          // too short
    expect(await meshNarrower('D006333 } INJECT')).toEqual([]); // not a bare UID
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
