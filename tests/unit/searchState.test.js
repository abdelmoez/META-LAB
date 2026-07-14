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
  findFieldConcept, fieldHasTerm, addManualTermToField, removeTermFromField,
  conceptStatus, CONCEPT_STATUS_LABELS, termPicoRole, normalizePersistedFilters,
  setTermDisabled, normalizePersistedRejected,
} from '../../src/research-engine/searchBuilder/searchState.js';
import { rejectionKey } from '../../src/research-engine/searchBuilder/suggestionReview.js';
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
    const empty = { concepts: [], overrides: {}, ignored: [], databases: [], readyForScreening: false, dismissedWarnings: [] };
    expect(pickPersisted(null)).toEqual(empty);
    expect(pickPersisted({ concepts: 'bad', overrides: 7, ignored: {} })).toEqual(empty);
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

/* ── SB3 ──────────────────────────────────────────────────────────────────── */

describe('pickPersisted — SB3 databases + readyForScreening', () => {
  it('defaults the new fields safely for pre-SB3 saves (no spurious data)', () => {
    const p = pickPersisted({ concepts: [], overrides: {}, ignored: [] });
    expect(p.databases).toEqual([]);
    expect(p.readyForScreening).toBe(false);
  });
  it('round-trips databases + readyForScreening through the persisted signature', () => {
    const withDbs = { concepts: [], overrides: {}, ignored: [], databases: ['pubmed', 'scopus'], readyForScreening: true };
    const p = pickPersisted(withDbs);
    expect(p.databases).toEqual(['pubmed', 'scopus']);
    expect(p.readyForScreening).toBe(true);
    // a databases change must change the signature (so autosave fires)
    expect(serializeSearchState(withDbs)).not.toBe(serializeSearchState({ ...withDbs, databases: ['pubmed'] }));
    // toggling readyForScreening changes the signature too
    expect(serializeSearchState(withDbs)).not.toBe(serializeSearchState({ ...withDbs, readyForScreening: false }));
  });
  it('drops non-string database ids', () => {
    expect(pickPersisted({ databases: ['pubmed', 5, null, 'embase'] }).databases).toEqual(['pubmed', 'embase']);
  });
});

/* ── prompt60 — search-scope limits (filters) ────────────────────────────────── */

describe('normalizePersistedFilters — search-scope limits', () => {
  it('returns undefined for an absent / all-empty filters block (keeps signatures stable)', () => {
    expect(normalizePersistedFilters(undefined)).toBeUndefined();
    expect(normalizePersistedFilters(null)).toBeUndefined();
    expect(normalizePersistedFilters({})).toBeUndefined();
    expect(normalizePersistedFilters({ dateFrom: '', dateTo: '', languages: [], pubTypes: [] })).toBeUndefined();
  });
  it('normalizes a populated block and clamps + caps the fields', () => {
    const out = normalizePersistedFilters({
      dateFrom: '2010', dateTo: '2025', languages: ['en', 'es', 5, ''], pubTypes: ['Randomized Controlled Trial'],
    });
    expect(out).toEqual({ dateFrom: '2010', dateTo: '2025', languages: ['en', 'es'], pubTypes: ['Randomized Controlled Trial'] });
    // a single non-empty field is enough to be "active"
    expect(normalizePersistedFilters({ pubTypes: ['Review'] })).toEqual({ dateFrom: '', dateTo: '', languages: [], pubTypes: ['Review'] });
  });
  it('caps the arrays', () => {
    const out = normalizePersistedFilters({ languages: Array.from({ length: 40 }, (_, i) => `l${i}`) });
    expect(out.languages.length).toBe(20);
  });
});

describe('pickPersisted / serializeSearchState — filters round-trip (prompt60)', () => {
  it('omits filters from the persisted slice when empty (no signature drift for old saves)', () => {
    const before = serializeSearchState({ concepts: [], overrides: {}, ignored: [] });
    const withEmpty = serializeSearchState({ concepts: [], overrides: {}, ignored: [], filters: { dateFrom: '', dateTo: '', languages: [], pubTypes: [] } });
    expect(withEmpty).toBe(before); // byte-identical → no spurious autosave
    expect(pickPersisted({ concepts: [] }).filters).toBeUndefined();
  });
  it('round-trips a populated filters block and changes the signature (autosave fires)', () => {
    const base = { concepts: [], overrides: {}, ignored: [], databases: [] };
    const withFilters = { ...base, filters: { dateFrom: '2015', dateTo: '', languages: ['en'], pubTypes: [] } };
    expect(pickPersisted(withFilters).filters).toEqual({ dateFrom: '2015', dateTo: '', languages: ['en'], pubTypes: [] });
    expect(serializeSearchState(withFilters)).not.toBe(serializeSearchState(base));
    // changing a filter changes the signature
    expect(serializeSearchState(withFilters)).not.toBe(serializeSearchState({ ...withFilters, filters: { ...withFilters.filters, dateFrom: '2016' } }));
  });
});

describe('addManualTermToField / removeTermFromField / fieldHasTerm', () => {
  // Start from the five canonical PICO groups so the click→concept mapping is realistic.
  const base = () => syncSearchBuilderFromPico({ P: '', I: '', C: '', O: '' }, [], []);

  it('adds a selected keyword into the matching PICO group as a kept (user_added) term', () => {
    const next = addManualTermToField(base(), 'P', 'obesity');
    const pop = findFieldConcept(next, 'P');
    expect(pop.terms.some((t) => t.text === 'obesity')).toBe(true);
    expect(pop.terms.find((t) => t.text === 'obesity').source).toBe('user_added');
    expect(fieldHasTerm(next, 'P', 'OBESITY')).toBe(true); // case-insensitive
  });
  it('is a no-op when the term already exists in the field (dedupe)', () => {
    const once = addManualTermToField(base(), 'I', 'semaglutide');
    const twice = addManualTermToField(once, 'I', 'Semaglutide');
    expect(findFieldConcept(twice, 'I').terms.filter((t) => t.text.toLowerCase() === 'semaglutide').length).toBe(1);
  });
  it('routes keywords to the correct group (Intervention vs Population)', () => {
    let cs = base();
    cs = addManualTermToField(cs, 'P', 'adults');
    cs = addManualTermToField(cs, 'I', 'GLP-1 receptor agonists');
    expect(fieldHasTerm(cs, 'P', 'adults')).toBe(true);
    expect(fieldHasTerm(cs, 'P', 'GLP-1 receptor agonists')).toBe(false);
    expect(fieldHasTerm(cs, 'I', 'GLP-1 receptor agonists')).toBe(true);
  });
  it('removeTermFromField removes the keyword from its group', () => {
    let cs = addManualTermToField(base(), 'O', 'weight loss');
    expect(fieldHasTerm(cs, 'O', 'weight loss')).toBe(true);
    cs = removeTermFromField(cs, 'O', 'weight loss');
    expect(fieldHasTerm(cs, 'O', 'weight loss')).toBe(false);
  });
  it('ignores blank text', () => {
    const cs = base();
    expect(addManualTermToField(cs, 'P', '   ')).toBe(cs);
  });
});

describe('conceptStatus', () => {
  it('reports "empty" for a group with no terms', () => {
    expect(conceptStatus({ terms: [] })).toBe('empty');
    expect(CONCEPT_STATUS_LABELS.empty).toBe('No terms yet');
  });
  it('reports "ready" for a Time-Frame group that has a note', () => {
    expect(conceptStatus({ picoField: 'T', terms: [], note: 'Last 10 years' })).toBe('ready');
  });
  it('reports "needs-review" for a single free-text term', () => {
    expect(conceptStatus({ terms: [{ text: 'obesity', type: 'freetext' }] })).toBe('needs-review');
  });
  it('reports "mesh-suggested" when a heading is available but not yet added', () => {
    expect(conceptStatus({ terms: [{ text: 'obesity', type: 'freetext', vocab: { mesh: 'Obesity' } }] })).toBe('mesh-suggested');
  });
  it('reports "ready" once a subject heading (controlled term) is present', () => {
    expect(conceptStatus({ terms: [{ text: 'Obesity', type: 'controlled' }, { text: 'obese', type: 'freetext' }] })).toBe('ready');
  });
});

/* ── SB4 — PICO-aware concept assignment (role hints + cross-group dedup) ──── */

describe('termPicoRole', () => {
  it('maps procedures → Intervention, conditions → Population, outcomes → Outcomes', () => {
    expect(termPicoRole('endoscopic ultrasound')).toBe('I');
    expect(termPicoRole('EUS')).toBe('I');
    expect(termPicoRole('malignant biliary obstruction')).toBe('P');
    expect(termPicoRole('mortality')).toBe('O');
    expect(termPicoRole('adverse events')).toBe('O');
  });
  it('returns null for ambiguous / unmapped families and unknown terms', () => {
    expect(termPicoRole('transluminal biliary drainage')).toBeNull(); // intentionally unmapped (often the comparator)
    expect(termPicoRole('some bespoke phrase')).toBeNull();
  });
});

describe('syncSearchBuilderFromPico — cross-concept leakage fix (SB4)', () => {
  const fieldText = (groups, key) => {
    const g = groups.find((c) => conceptFieldKey(c) === key);
    return (g ? g.terms : []).map((t) => norm(t.text));
  };

  it('keeps EUS / endoscopic ultrasound OUT of Population and IN Intervention', () => {
    const pico = {
      P: 'patients with malignant biliary obstruction undergoing endoscopic ultrasound',
      I: 'EUS-guided antegrade biliary drainage',
      C: 'transluminal biliary drainage',
      O: 'technical success and adverse events',
    };
    const groups = syncSearchBuilderFromPico(pico, [], []);
    const pop = fieldText(groups, 'P');
    const int = fieldText(groups, 'I');
    expect(pop).not.toContain('endoscopic ultrasound');
    expect(pop).not.toContain('eus');
    expect(int).toContain('endoscopic ultrasound');
    expect(int).toContain('eus');
    // Population still has its own condition; Comparator keeps the distinct term.
    expect(pop).toContain('malignant biliary obstruction');
    expect(fieldText(groups, 'C')).toContain('transluminal biliary drainage');
  });

  it('does not duplicate the same auto term across the five groups', () => {
    const pico = { P: 'endoscopic ultrasound', I: 'endoscopic ultrasound', C: 'endoscopic ultrasound', O: 'mortality' };
    const groups = syncSearchBuilderFromPico(pico, [], []);
    let count = 0;
    for (const k of ['P', 'I', 'C', 'O', 'T']) if (fieldText(groups, k).includes('endoscopic ultrasound')) count += 1;
    expect(count).toBe(1); // consolidated into exactly one group (Intervention, by role)
    expect(fieldText(groups, 'I')).toContain('endoscopic ultrasound');
  });

  it('does not move user-added terms (only auto terms are relocated)', () => {
    // Pre-place a user-added "endoscopic ultrasound" in Population; sync must leave it.
    const existing = syncSearchBuilderFromPico({ P: 'obesity', I: '', C: '', O: '' }, [], []);
    const popId = existing.find((c) => conceptFieldKey(c) === 'P').id;
    const withUserTerm = existing.map((c) => (c.id === popId
      ? { ...c, terms: [...c.terms, { id: 'u1', text: 'endoscopic ultrasound', type: 'freetext', source: 'user_added' }] }
      : c));
    const re = syncSearchBuilderFromPico({ P: 'obesity', I: '', C: '', O: '' }, withUserTerm, []);
    expect(re.find((c) => conceptFieldKey(c) === 'P').terms.some((t) => t.text === 'endoscopic ultrasound' && t.source === 'user_added')).toBe(true);
  });
});

describe('pickPersisted — SB4 dismissedWarnings', () => {
  it('defaults to [] and round-trips string ids only', () => {
    expect(pickPersisted({}).dismissedWarnings).toEqual([]);
    expect(pickPersisted({ dismissedWarnings: ['multi:fam:eus', 7, null, 'empty:O'] }).dismissedWarnings)
      .toEqual(['multi:fam:eus', 'empty:O']);
  });
  it('changes the persisted signature so autosave fires', () => {
    const a = { concepts: [], overrides: {}, ignored: [], databases: [], readyForScreening: false, dismissedWarnings: [] };
    const b = { ...a, dismissedWarnings: ['empty:O'] };
    expect(serializeSearchState(a)).not.toBe(serializeSearchState(b));
  });
});

/* ── 85.md A1 — disable-without-delete (setTermDisabled) ─────────────────────── */

describe('setTermDisabled — flag hygiene', () => {
  const base = () => [{
    id: 'c1', label: 'Condition', op: 'AND', picoField: 'P', field: 'Population', source: 'pico_auto',
    terms: [
      { id: 't1', text: 'heart failure', type: 'freetext', field: 'tiab', source: 'pico_auto' },
      { id: 't2', text: 'cardiac failure', type: 'freetext', field: 'tiab', source: 'user_added' },
    ],
  }];

  it('disables a term with disabled:true', () => {
    const out = setTermDisabled(base(), 'c1', 't1', true);
    expect(out[0].terms[0].disabled).toBe(true);
    expect(out[0].terms[1].disabled).toBeUndefined(); // sibling untouched
  });

  it('enabling DELETES the key — never writes disabled:false', () => {
    const off = setTermDisabled(base(), 'c1', 't1', true);
    const on = setTermDisabled(off, 'c1', 't1', false);
    expect('disabled' in on[0].terms[0]).toBe(false);
  });

  it('PINNED: disable→enable round-trip is byte-identical to the original signature', () => {
    const original = { concepts: base(), overrides: {}, ignored: [] };
    const off = setTermDisabled(original.concepts, 'c1', 't1', true);
    const roundTripped = { concepts: setTermDisabled(off, 'c1', 't1', false), overrides: {}, ignored: [] };
    expect(serializeSearchState(roundTripped)).toBe(serializeSearchState(original));
    // …and disabling DOES change the signature (autosave must fire).
    expect(serializeSearchState({ ...original, concepts: off })).not.toBe(serializeSearchState(original));
  });

  it('is a no-op for unknown concept/term ids and junk input', () => {
    const cs = base();
    expect(setTermDisabled(cs, 'nope', 't1', true)[0].terms[0].disabled).toBeUndefined();
    expect(setTermDisabled(cs, 'c1', 'nope', true)[0].terms.every((t) => !t.disabled)).toBe(true);
    expect(setTermDisabled(null, 'c1', 't1', true)).toEqual([]);
  });
});

describe('syncSearchBuilderFromPico — disabled terms survive a PICO edit (85.md A1)', () => {
  it('keeps a DISABLED pico_auto freetext term whose keyword left the PICO text (off, not dropped)', () => {
    const a = syncSearchBuilderFromPico({ P: 'asthma' }, [], []);
    const pop = a.find((c) => c.picoField === 'P');
    const asthma = pop.terms.find((t) => norm(t.text) === 'asthma');
    const withDisabled = a.map((c) => (c.picoField === 'P'
      ? { ...c, terms: c.terms.map((t) => (norm(t.text) === 'asthma' ? { ...t, id: t.id || 'x1', disabled: true } : t)) }
      : c));
    const b = syncSearchBuilderFromPico({ P: 'COPD' }, withDisabled, []);
    const popB = b.find((c) => c.picoField === 'P');
    const kept = popB.terms.find((t) => norm(t.text) === 'asthma');
    expect(kept).toBeTruthy();
    expect(kept.disabled).toBe(true); // kept OFF, not silently re-enabled
    expect(asthma.source).toBe('pico_auto'); // sanity: this exercised the auto-term keep path
  });

  it('an ENABLED plain freetext auto term whose keyword left is still dropped (unchanged behavior)', () => {
    const a = syncSearchBuilderFromPico({ P: 'asthma' }, [], []);
    const b = syncSearchBuilderFromPico({ P: 'COPD' }, a, []);
    expect(b.find((c) => c.picoField === 'P').terms.map((t) => norm(t.text))).not.toContain('asthma');
  });

  it('a disabled auto term whose keyword is STILL in the PICO text keeps its flag (object reuse)', () => {
    const a = syncSearchBuilderFromPico({ P: 'asthma' }, [], []);
    const withDisabled = a.map((c) => (c.picoField === 'P'
      ? { ...c, terms: c.terms.map((t) => (norm(t.text) === 'asthma' ? { ...t, disabled: true } : t)) }
      : c));
    const b = syncSearchBuilderFromPico({ P: 'asthma' }, withDisabled, []);
    expect(b.find((c) => c.picoField === 'P').terms.find((t) => norm(t.text) === 'asthma').disabled).toBe(true);
  });
});

describe('syncSearchBuilderFromPico — cross-group dedup winner keeps ITS OWN disabled flag', () => {
  // 'placebo' has no PICO role, so the dedup winner is the first group by PICO order
  // (Comparator when duplicated across C and O).
  const pico = { C: 'placebo', O: 'placebo' };
  const withFlagOn = (groups, key) => groups.map((c) => (c.picoField === key
    ? { ...c, terms: c.terms.map((t) => (norm(t.text) === 'placebo' ? { ...t, disabled: true } : t)) }
    : c));
  const placeboIn = (groups, key) => (groups.find((c) => c.picoField === key).terms || [])
    .find((t) => norm(t.text) === 'placebo');

  it('winner disabled + loser enabled → survivor stays disabled', () => {
    const a = syncSearchBuilderFromPico(pico, [], []);
    const seeded = withFlagOn(a, 'C'); // C is the winner (PICO order)
    const b = syncSearchBuilderFromPico(pico, seeded, []);
    expect(placeboIn(b, 'C').disabled).toBe(true);
    expect(placeboIn(b, 'O')).toBeUndefined(); // loser copy deduped away
  });

  it('winner enabled + loser disabled → survivor stays enabled (a discarded duplicate never switches it)', () => {
    const a = syncSearchBuilderFromPico(pico, [], []);
    const seeded = withFlagOn(a, 'O'); // O loses the dedup to C
    const b = syncSearchBuilderFromPico(pico, seeded, []);
    expect(placeboIn(b, 'C')).toBeTruthy();
    expect(placeboIn(b, 'C').disabled).toBeUndefined();
    expect(placeboIn(b, 'O')).toBeUndefined();
  });
});

/* ── 85.md A1 — persisted rejected-suggestion keys ───────────────────────────── */

describe('pickPersisted / serializeSearchState — rejectedSuggestions (85.md A1)', () => {
  it('PINNED: omitted when empty — old-save signatures stay byte-identical', () => {
    const before = serializeSearchState({ concepts: [], overrides: {}, ignored: [] });
    const withEmpty = serializeSearchState({ concepts: [], overrides: {}, ignored: [], rejectedSuggestions: [] });
    expect(withEmpty).toBe(before);
    expect(pickPersisted({ concepts: [] }).rejectedSuggestions).toBeUndefined();
    expect(normalizePersistedRejected([])).toBeUndefined();
    expect(normalizePersistedRejected(null)).toBeUndefined();
    expect(normalizePersistedRejected(['', '   '])).toBeUndefined(); // nothing usable
  });
  it('round-trips non-empty keys and changes the signature (autosave fires)', () => {
    const base = { concepts: [], overrides: {}, ignored: [] };
    const withRej = { ...base, rejectedSuggestions: ['rej:P:fam:eus', 'rej:I:metformin'] };
    expect(pickPersisted(withRej).rejectedSuggestions).toEqual(['rej:P:fam:eus', 'rej:I:metformin']);
    expect(serializeSearchState(withRej)).not.toBe(serializeSearchState(base));
  });
  it('drops non-string junk', () => {
    expect(normalizePersistedRejected(['rej:P:x', 7, null, {}])).toEqual(['rej:P:x']);
  });
});

describe('conceptStatus — optional { rejected } (85.md A1)', () => {
  const c = {
    id: 'cP', picoField: 'P', label: 'Population',
    terms: [
      { id: 't1', text: 'obesity', type: 'freetext', vocab: { mesh: 'Obesity' } },
      { id: 't2', text: 'overweight', type: 'freetext' },
    ],
  };
  it('without opts the existing behavior is unchanged (backwards compatible)', () => {
    expect(conceptStatus(c)).toBe('mesh-suggested');
  });
  it('a concept whose every suggestion is rejected does NOT stay mesh-suggested', () => {
    const rejected = new Set([rejectionKey(c, 'obesity')]);
    expect(conceptStatus(c, { rejected })).toBe('ready'); // 2 live terms, no pending heading
  });
  it('accepts an array too, and an unrelated rejection changes nothing', () => {
    expect(conceptStatus(c, { rejected: [rejectionKey(c, 'obesity')] })).toBe('ready');
    expect(conceptStatus(c, { rejected: ['rej:I:something-else'] })).toBe('mesh-suggested');
  });
  it('falls back to needs-review when the only live term had its suggestion rejected', () => {
    const single = { ...c, terms: [c.terms[0]] };
    expect(conceptStatus(single, { rejected: [rejectionKey(single, 'obesity')] })).toBe('needs-review');
  });
});
