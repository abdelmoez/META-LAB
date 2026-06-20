/**
 * searchState.test.js — SE1 Task 5/7. The pure, conflict-safe sync core that the
 * Search Builder tab uses to (a) avoid redundant saves / save↔poke ping-pong via a
 * stable state signature, and (b) re-extract PICO concepts without resurrecting a
 * term the user hid/deleted.
 */
import { describe, it, expect } from 'vitest';
import {
  stableStringify, serializeSearchState, searchStatesEqual, pickPersisted, extractActiveConcepts,
  remoteAdoptDecision, syncSearchBuilderFromPico, timeframeLabel, extractFieldTerms,
  conceptFieldKey, PICO_FIELD_DEFS,
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

describe('remoteAdoptDecision (conflict-safe live sync core)', () => {
  it('skips an echo of our own last-saved state (identical signature)', () => {
    expect(remoteAdoptDecision({ remoteSig: 'X', lastSavedSig: 'X', remoteRevision: 9, knownRevision: 2, busy: false })).toBe('skip');
  });
  it('skips a document that is not newer than what we already hold', () => {
    expect(remoteAdoptDecision({ remoteSig: 'B', lastSavedSig: 'A', remoteRevision: 3, knownRevision: 3, busy: false })).toBe('skip');
    expect(remoteAdoptDecision({ remoteSig: 'B', lastSavedSig: 'A', remoteRevision: 2, knownRevision: 3, busy: false })).toBe('skip');
  });
  it('adopts a genuinely-newer document when the user is idle', () => {
    expect(remoteAdoptDecision({ remoteSig: 'B', lastSavedSig: 'A', remoteRevision: 4, knownRevision: 3, busy: false })).toBe('adopt');
  });
  it('defers a genuinely-newer document while the user is mid-edit', () => {
    expect(remoteAdoptDecision({ remoteSig: 'B', lastSavedSig: 'A', remoteRevision: 4, knownRevision: 3, busy: true })).toBe('defer');
  });
  it('degrades gracefully when the server omits a revision (relies on the signature)', () => {
    expect(remoteAdoptDecision({ remoteSig: 'B', lastSavedSig: 'A', remoteRevision: undefined, knownRevision: 3, busy: false })).toBe('adopt');
    expect(remoteAdoptDecision({ remoteSig: 'A', lastSavedSig: 'A', remoteRevision: undefined, knownRevision: 3, busy: false })).toBe('skip');
  });
});

describe('timeframeLabel / conceptFieldKey', () => {
  it('renders presets, custom ranges, and legacy free-text', () => {
    expect(timeframeLabel({ timeframeMode: 'last5' })).toBe('Last 5 years');
    expect(timeframeLabel({ timeframeMode: 'inception' })).toBe('Since inception');
    expect(timeframeLabel({ timeframeMode: 'custom', tfStart: '2010', tfEnd: '2020' })).toBe('2010–2020');
    expect(timeframeLabel({ timeframeMode: 'custom', tfStart: '2010' })).toBe('2010–present');
    expect(timeframeLabel({ timeframe: '2015 to 2020' })).toBe('2015 to 2020');
    expect(timeframeLabel({})).toBe('');
  });
  it('maps concepts to their canonical PICO key (incl. SE1-era field labels)', () => {
    expect(conceptFieldKey({ picoField: 'I' })).toBe('I');
    expect(conceptFieldKey({ source: 'pico_auto', field: 'Outcome' })).toBe('O');
    expect(conceptFieldKey({ source: 'pico_auto', field: 'Comparator' })).toBe('C');
    expect(conceptFieldKey({ source: 'user_added' })).toBe(null);
    expect(conceptFieldKey(null)).toBe(null);
  });
});

describe('syncSearchBuilderFromPico (SE2 — five PICO concept groups)', () => {
  const pico = { P: 'type 2 diabetes mellitus with HFrEF', I: 'SGLT2 inhibitor', C: 'placebo', O: 'all-cause mortality', timeframeMode: 'last5' };
  const termsOf = (groups, key) => groups.find((g) => g.picoField === key).terms.map((t) => norm(t.text));
  const flat = (groups) => groups.flatMap((g) => g.terms.map((t) => norm(t.text)));

  it('always emits the five canonical groups in order — even for empty PICO', () => {
    const groups = syncSearchBuilderFromPico({}, [], []);
    expect(groups.map((g) => g.label)).toEqual(['Population', 'Intervention / Exposure', 'Comparator / Control', 'Outcomes', 'Time Frame']);
    expect(groups.map((g) => g.picoField)).toEqual(['P', 'I', 'C', 'O', 'T']);
    expect(PICO_FIELD_DEFS.map((d) => d.key)).toEqual(['P', 'I', 'C', 'O', 'T']);
  });

  it('maps each PICO field to its own group with extracted keywords', () => {
    const groups = syncSearchBuilderFromPico(pico, [], []);
    expect(termsOf(groups, 'P')).toEqual(expect.arrayContaining(['type 2 diabetes mellitus', 'diabetes', 't2dm', 'heart failure', 'hfref']));
    expect(termsOf(groups, 'I')).toEqual(expect.arrayContaining(['sglt2 inhibitor']));
    expect(termsOf(groups, 'C')).toEqual(expect.arrayContaining(['placebo']));
    expect(termsOf(groups, 'O')).toEqual(expect.arrayContaining(['mortality']));
    // no connector/filler junk terms leak in
    expect(flat(groups)).not.toContain('with');
    expect(flat(groups)).not.toContain('type');
  });

  it('Time Frame group carries the restriction as a note, with no search term', () => {
    const groups = syncSearchBuilderFromPico(pico, [], []);
    const tf = groups.find((g) => g.picoField === 'T');
    expect(tf.note).toBe('Last 5 years');
    expect(tf.terms).toEqual([]);
  });

  it('is idempotent — repeated sync produces no duplicate terms', () => {
    const once = syncSearchBuilderFromPico(pico, [], []);
    const twice = syncSearchBuilderFromPico(pico, once, []);
    expect(flat(twice)).toEqual(flat(once));
    expect(new Set(termsOf(twice, 'P')).size).toBe(termsOf(twice, 'P').length);
  });

  it('does not re-add a hidden/deleted PICO term', () => {
    const groups = syncSearchBuilderFromPico(pico, [], ['T2DM']);
    expect(termsOf(groups, 'P')).not.toContain('t2dm');
    expect(termsOf(groups, 'P')).toEqual(expect.arrayContaining(['diabetes'])); // siblings stay
  });

  it('preserves manual concepts (appended after the five groups)', () => {
    const manual = { id: 'm1', label: 'My idea', source: 'user_added', op: 'AND', terms: [{ text: 'foo', source: 'user_added' }] };
    const out = syncSearchBuilderFromPico(pico, [manual], []);
    expect(out.length).toBe(6);
    expect(out[5]).toMatchObject({ id: 'm1', label: 'My idea' });
  });

  it('preserves manual terms added inside a PICO group', () => {
    const existing = [{ picoField: 'P', source: 'pico_auto', field: 'Population', label: 'Population', op: 'AND', terms: [{ text: 'elderly cohort', source: 'user_added' }] }];
    const out = syncSearchBuilderFromPico(pico, existing, []);
    expect(termsOf(out, 'P')).toContain('elderly cohort');
  });

  it('keeps an auto term the user converted to MeSH even if no longer extracted', () => {
    const existing = [{ picoField: 'O', source: 'pico_auto', field: 'Outcomes', label: 'Outcomes', op: 'AND', terms: [{ text: 'legacy outcome', source: 'pico_auto', type: 'controlled', vocab: { mesh: 'X' } }] }];
    const out = syncSearchBuilderFromPico({ O: 'mortality' }, existing, []);
    expect(termsOf(out, 'O')).toEqual(expect.arrayContaining(['mortality', 'legacy outcome']));
  });

  it('migrates an SE1-era family concept into its PICO group (no orphan)', () => {
    const legacy = [{ id: 'l1', label: 'type 2 diabetes', field: 'Population', source: 'pico_auto', op: 'AND',
      terms: [{ text: 'diabetes', source: 'pico_auto', type: 'controlled', vocab: { mesh: 'Diabetes Mellitus, Type 2' } }] }];
    const out = syncSearchBuilderFromPico({ P: 'type 2 diabetes' }, legacy, []);
    expect(out.length).toBe(5); // absorbed, not kept as a separate concept
    const pop = out.find((g) => g.picoField === 'P');
    expect(pop.terms.some((t) => norm(t.text) === 'diabetes' && t.vocab)).toBe(true); // user's MeSH survives
  });

  it('a PICO edit updates only that field group and drops the stale auto term', () => {
    const a = syncSearchBuilderFromPico({ P: 'asthma' }, [], []);
    const a2 = a.map((c) => ({ ...c, picoField: c.picoField })); // simulate persisted (picoField present)
    const b = syncSearchBuilderFromPico({ P: 'COPD' }, a2, []);
    expect(termsOf(b, 'P')).toEqual(expect.arrayContaining(['copd', 'chronic obstructive pulmonary disease']));
    expect(termsOf(b, 'P')).not.toContain('asthma'); // stale, untouched auto term removed
  });
});

describe('extractFieldTerms', () => {
  it('flattens a field into one deduped ordered term list', () => {
    const terms = extractFieldTerms('type 2 diabetes mellitus with HFrEF').map((t) => norm(t.text));
    expect(terms).toEqual(expect.arrayContaining(['type 2 diabetes mellitus', 'diabetes', 't2dm', 'hfref', 'heart failure']));
    expect(new Set(terms).size).toBe(terms.length); // no dupes
  });
  it('returns [] for empty text', () => {
    expect(extractFieldTerms('')).toEqual([]);
    expect(extractFieldTerms(null)).toEqual([]);
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
