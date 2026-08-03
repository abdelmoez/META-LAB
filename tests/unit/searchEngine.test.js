/**
 * searchEngine.test.js — pure parts of the separated Search Engine (NLM mapper +
 * TTL/LRU cache). The network paths are covered by the skip-aware integration
 * suite + live verification.
 */
import { describe, it, expect } from 'vitest';
import {
  mapMeshSummary, mapMeshSummaryList, emtreeFallback, parseSparqlLabels, meshNarrower, meshSuggest,
} from '../../server/searchEngine/nlmClient.js';
import {
  sanitizeIgnored, sanitizeFilters, sanitizeSearchMode, sanitizeRejectedSuggestions,
  sanitizeQuestionSnapshot, sanitizeSearchMeta, sanitizeBaseRevision, sanitizeAuditAction,
} from '../../server/searchEngine/searchEngineController.js';
import { normalizePersistedQuestionSnapshot, normalizePersistedMeta, serializeSearchState } from '../../src/research-engine/searchBuilder/searchState.js';
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

describe('sanitizeQuestionSnapshot — putSearch allowlist (96.md D2 drift input)', () => {
  it('trims, caps at 2000 chars, and collapses junk to the empty string', () => {
    expect(sanitizeQuestionSnapshot('  does metformin help?  ')).toBe('does metformin help?');
    expect(sanitizeQuestionSnapshot('x'.repeat(3000)).length).toBe(2000);
    expect(sanitizeQuestionSnapshot(undefined)).toBe('');
    expect(sanitizeQuestionSnapshot(42)).toBe('');
    expect(sanitizeQuestionSnapshot(['q'])).toBe('');
  });
  it('round-trips BYTE-IDENTICALLY through the client normalizer (omit-when-empty)', () => {
    // Server echo → client pickPersisted must agree exactly, or the live-sync loop
    // would see phantom changes (the RULE comment in putSearch).
    for (const raw of ['  a question  ', 'q', '', '   ', 'y'.repeat(2500)]) {
      const server = sanitizeQuestionSnapshot(raw);
      const client = normalizePersistedQuestionSnapshot(raw);
      expect(client === undefined ? '' : client).toBe(server);
    }
  });
  it('a stored empty snapshot never changes a historical save signature', () => {
    const legacy = { concepts: [{ id: 'c1', label: 'X', op: 'AND', terms: [] }], overrides: {}, ignored: [] };
    const withEmpty = { ...legacy, questionSnapshot: '' };
    expect(serializeSearchState(withEmpty)).toBe(serializeSearchState(legacy));
    // …while a REAL snapshot changes it (so autosave persists the new key).
    expect(serializeSearchState({ ...legacy, questionSnapshot: 'q' })).not.toBe(serializeSearchState(legacy));
  });
});

describe('sanitizeSearchMeta — putSearch allowlist (97.md, the ONE new top-level key)', () => {
  const META = {
    generatedAt: '2026-08-02T10:00:00.000Z',
    generatedBy: { id: 'u1', name: 'Ada' },
    sourceQuestion: 'does metformin help?',
    manuallyModifiedAt: '2026-08-03T09:00:00.000Z',
    manuallyModifiedBy: { id: 'u2', name: 'Grace' },
  };
  it('keeps the five fields, trimmed and capped; empty fields are OMITTED', () => {
    expect(sanitizeSearchMeta(META)).toEqual(META);
    const partial = sanitizeSearchMeta({ generatedAt: ' t1 ', generatedBy: { id: 42, name: '' }, sourceQuestion: '' });
    expect(partial).toEqual({ generatedAt: 't1', generatedBy: { id: '42', name: '' } });
    expect('sourceQuestion' in partial).toBe(false);
  });
  it('caps: generatedAt/manuallyModifiedAt 40, id 100, name 200, sourceQuestion 2000', () => {
    const out = sanitizeSearchMeta({
      generatedAt: 't'.repeat(60),
      generatedBy: { id: 'i'.repeat(200), name: 'n'.repeat(300) },
      sourceQuestion: 'q'.repeat(3000),
      manuallyModifiedAt: 'm'.repeat(60),
    });
    expect(out.generatedAt.length).toBe(40);
    expect(out.generatedBy.id.length).toBe(100);
    expect(out.generatedBy.name.length).toBe(200);
    expect(out.sourceQuestion.length).toBe(2000);
    expect(out.manuallyModifiedAt.length).toBe(40);
  });
  it('collapses junk to {} (stored empty object — omitted from client signatures)', () => {
    expect(sanitizeSearchMeta(null)).toEqual({});
    expect(sanitizeSearchMeta('junk')).toEqual({});
    expect(sanitizeSearchMeta([1, 2])).toEqual({});
    expect(sanitizeSearchMeta({ generatedAt: 7, generatedBy: 'x', manuallyModifiedBy: {} })).toEqual({});
  });
  it('round-trips BYTE-IDENTICALLY through the client normalizer (the RULE)', () => {
    // Server echo → client pickPersisted must agree exactly, or the live-sync loop
    // would see phantom changes (the putSearch RULE comment).
    const base = { concepts: [], overrides: {}, ignored: [] };
    for (const raw of [META, { generatedAt: ' t ' }, {}, { generatedBy: { id: 9, name: ' N ' } }, { sourceQuestion: 'y'.repeat(2500) }]) {
      expect(serializeSearchState({ ...base, meta: sanitizeSearchMeta(raw) }))
        .toBe(serializeSearchState({ ...base, meta: raw }));
      const client = normalizePersistedMeta(raw);
      expect(client === undefined ? {} : JSON.parse(JSON.stringify(client))).toEqual(sanitizeSearchMeta(raw));
    }
  });
  it('a stored empty meta never changes a historical save signature', () => {
    const legacy = { concepts: [{ id: 'c1', label: 'X', op: 'AND', terms: [] }], overrides: {}, ignored: [] };
    expect(serializeSearchState({ ...legacy, meta: {} })).toBe(serializeSearchState(legacy));
    // …while a REAL meta changes it (so autosave persists the new key).
    expect(serializeSearchState({ ...legacy, meta: { generatedAt: 't' } })).not.toBe(serializeSearchState(legacy));
  });
});

describe('sanitizeBaseRevision — putSearch ENVELOPE (97.md Phase 16 stale-write CAS)', () => {
  it('accepts non-negative integers only', () => {
    expect(sanitizeBaseRevision(0)).toBe(0);
    expect(sanitizeBaseRevision(7)).toBe(7);
  });
  it('collapses everything else to null (= documented LWW, unchanged for legacy clients)', () => {
    expect(sanitizeBaseRevision(-1)).toBeNull();
    expect(sanitizeBaseRevision(1.5)).toBeNull();
    expect(sanitizeBaseRevision('3')).toBeNull();
    expect(sanitizeBaseRevision(null)).toBeNull();
    expect(sanitizeBaseRevision(undefined)).toBeNull();
    expect(sanitizeBaseRevision(NaN)).toBeNull();
    expect(sanitizeBaseRevision({ revision: 3 })).toBeNull();
  });
});

describe('sanitizeAuditAction — putSearch ENVELOPE (97.md Phase 4 regeneration audit)', () => {
  it("accepts exactly 'regenerated'", () => {
    expect(sanitizeAuditAction('regenerated')).toBe('regenerated');
  });
  it('collapses everything else to null (→ ordinary SEARCH_UPDATED)', () => {
    expect(sanitizeAuditAction('REGENERATED')).toBeNull();
    expect(sanitizeAuditAction('restored')).toBeNull();
    expect(sanitizeAuditAction('')).toBeNull();
    expect(sanitizeAuditAction(null)).toBeNull();
    expect(sanitizeAuditAction(1)).toBeNull();
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

/* ══════════ 97 QA M3/M32 — server-side meta identity stamping (putSearch) ════ */
import { stampMetaIdentity } from '../../server/searchEngine/searchEngineController.js';

describe('stampMetaIdentity — generatedBy/manuallyModifiedBy come from the session', () => {
  const ada = { id: 'u1', name: 'Ada' };
  const bob = { id: 'u2', name: 'Bob' };

  it('stamps the acting user when a timestamp CHANGED vs the stored block', () => {
    const out = stampMetaIdentity(
      { generatedAt: 'T2', sourceQuestion: 'q', manuallyModifiedAt: 'T3' },
      { generatedAt: 'T1', generatedBy: { id: 'u0', name: 'Old' } },
      ada,
    );
    expect(out.generatedBy).toEqual({ id: 'u1', name: 'Ada' });
    expect(out.manuallyModifiedBy).toEqual({ id: 'u1', name: 'Ada' });
  });

  it('an UNCHANGED timestamp preserves the stored attribution (a later writer never steals it)', () => {
    const stored = {
      generatedAt: 'T1', generatedBy: { id: 'u1', name: 'Ada' },
      manuallyModifiedAt: 'T2', manuallyModifiedBy: { id: 'u1', name: 'Ada' },
    };
    // Bob saves without touching either timestamp (e.g. dismissed a suggestion —
    // the client echoes the loaded meta): Ada keeps both attributions.
    const out = stampMetaIdentity(
      { generatedAt: 'T1', manuallyModifiedAt: 'T2' }, stored, bob,
    );
    expect(out.generatedBy).toEqual({ id: 'u1', name: 'Ada' });
    expect(out.manuallyModifiedBy).toEqual({ id: 'u1', name: 'Ada' });
  });

  it('a fresh manual stamp by a NEW user re-attributes only the manual side', () => {
    const stored = {
      generatedAt: 'T1', generatedBy: { id: 'u1', name: 'Ada' },
      manuallyModifiedAt: 'T2', manuallyModifiedBy: { id: 'u1', name: 'Ada' },
    };
    const out = stampMetaIdentity(
      { generatedAt: 'T1', manuallyModifiedAt: 'T9' }, stored, bob,
    );
    expect(out.generatedBy).toEqual({ id: 'u1', name: 'Ada' });
    expect(out.manuallyModifiedBy).toEqual({ id: 'u2', name: 'Bob' });
  });

  it('a regeneration block (generation fields only) gets generatedBy and stays reset on the manual side', () => {
    const out = stampMetaIdentity({ generatedAt: 'T5', sourceQuestion: 'q2' }, {}, ada);
    expect(out).toEqual({ generatedAt: 'T5', sourceQuestion: 'q2', generatedBy: { id: 'u1', name: 'Ada' } });
  });

  it('no session user → the block passes through untouched; {} stays {}', () => {
    expect(stampMetaIdentity({ generatedAt: 'T1' }, {}, null)).toEqual({ generatedAt: 'T1' });
    expect(stampMetaIdentity({}, {}, ada)).toEqual({});
  });

  it('the stamped block still round-trips through the client normalizer byte-identically', () => {
    const stamped = stampMetaIdentity({ generatedAt: 'T1', manuallyModifiedAt: 'T2' }, {}, ada);
    expect(normalizePersistedMeta(stamped)).toEqual(stamped);
    expect(sanitizeSearchMeta(stamped)).toEqual(stamped);
  });
});
