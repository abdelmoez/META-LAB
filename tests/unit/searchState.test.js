/**
 * searchState.test.js — SE1 Task 5/7. The pure, conflict-safe sync core that the
 * Search Builder tab uses to (a) avoid redundant saves / save↔poke ping-pong via a
 * stable state signature, and (b) re-extract PICO concepts without resurrecting a
 * term the user hid/deleted.
 */
import { describe, it, expect } from 'vitest';
import {
  stableStringify, serializeSearchState, searchStatesEqual, pickPersisted, extractActiveConcepts,
} from '../../src/research-engine/searchBuilder/searchState.js';
import { norm, picoToConcepts } from '../../src/research-engine/searchBuilder/conceptExtraction.js';

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });
  it('preserves array order (display order is meaningful)', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
  it('omits undefined values like JSON does, so server round-trips compare equal', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
  it('handles nested objects (e.g. a term vocab)', () => {
    const a = { terms: [{ text: 'x', vocab: { mesh: 'M', children: ['c1'] } }] };
    const b = { terms: [{ text: 'x', vocab: { children: ['c1'], mesh: 'M' } }] };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

describe('serializeSearchState / searchStatesEqual', () => {
  const base = {
    concepts: [{ id: 'c1', label: 'diabetes', op: 'AND', terms: [{ id: 't1', text: 'diabetes' }] }],
    overrides: { pubmed: null },
    ignored: ['mortality'],
  };

  it('treats logically-identical states as equal regardless of key order or volatile extras', () => {
    const reordered = { ignored: ['mortality'], overrides: { pubmed: null }, concepts: base.concepts };
    expect(searchStatesEqual(base, reordered)).toBe(true);
    // Extra, non-persisted top-level keys are ignored (only concepts/overrides/ignored count).
    expect(searchStatesEqual(base, { ...base, _ui: { hover: true } })).toBe(true);
  });

  it('detects a real content change (a peer added a term)', () => {
    const changed = {
      ...base,
      concepts: [{ ...base.concepts[0], terms: [...base.concepts[0].terms, { id: 't2', text: 'T2DM' }] }],
    };
    expect(searchStatesEqual(base, changed)).toBe(false);
  });

  it('pickPersisted coerces shape defensively', () => {
    expect(pickPersisted(null)).toEqual({ concepts: [], overrides: {}, ignored: [] });
    expect(pickPersisted({ concepts: 'bad', overrides: 7, ignored: {} })).toEqual({ concepts: [], overrides: {}, ignored: [] });
  });
});

describe('extractActiveConcepts (hidden/deleted terms stay hidden)', () => {
  const pico = { P: 'type 2 diabetes mellitus with HFrEF', I: 'SGLT2 inhibitor', C: '', O: 'all-cause mortality' };

  it('matches picoToConcepts when nothing is ignored', () => {
    const active = extractActiveConcepts(pico, []);
    const all = picoToConcepts(pico);
    expect(active.map((c) => norm(c.terms[0].text))).toEqual(all.map((c) => norm(c.terms[0].text)));
  });

  it('drops an ignored term and removes a concept that becomes empty', () => {
    const all = picoToConcepts(pico);
    // Ignore every term of the mortality concept → that whole concept disappears.
    const mortality = all.find((c) => norm(c.label).includes('mortality'));
    const ignored = mortality.terms.map((t) => t.text);
    const active = extractActiveConcepts(pico, ignored);
    const labels = active.map((c) => norm(c.label));
    expect(labels).not.toContain(norm(mortality.label));
  });

  it('a deleted term does NOT reappear on repeated re-sync (idempotent under ignore)', () => {
    const ignored = ['T2DM'];
    const a = extractActiveConcepts(pico, ignored);
    const b = extractActiveConcepts(pico, ignored);
    const flat = (cs) => cs.flatMap((c) => c.terms.map((t) => norm(t.text)));
    expect(flat(a)).toEqual(flat(b));
    expect(flat(a)).not.toContain('t2dm');
  });

  it('tolerates empty / missing PICO', () => {
    expect(extractActiveConcepts(null, [])).toEqual([]);
    expect(extractActiveConcepts({}, ['x'])).toEqual([]);
  });
});
