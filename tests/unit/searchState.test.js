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

  it('PINNED: never-disabled saves stay byte-identical (kept/disabled are omit-when-absent)', () => {
    const original = { concepts: base(), overrides: {}, ignored: [] };
    // enabling an already-enabled term is a pure no-op — no kept stamp, no drift
    const noop = { concepts: setTermDisabled(original.concepts, 'c1', 't1', false), overrides: {}, ignored: [] };
    expect(serializeSearchState(noop)).toBe(serializeSearchState(original));
    expect('kept' in noop.concepts[0].terms[0]).toBe(false);
    // …and disabling DOES change the signature (autosave must fire).
    const off = setTermDisabled(original.concepts, 'c1', 't1', true);
    expect(serializeSearchState({ ...original, concepts: off })).not.toBe(serializeSearchState(original));
  });

  it('re-enabling a pico_auto term stamps kept:true — the sync keep-marker replacing the cleared disabled flag', () => {
    const off = setTermDisabled(base(), 'c1', 't1', true);
    const on = setTermDisabled(off, 'c1', 't1', false);
    expect('disabled' in on[0].terms[0]).toBe(false);
    expect(on[0].terms[0].kept).toBe(true);
    // Deliberate signature change: autosave must persist the marker across reloads.
    const original = { concepts: base(), overrides: {}, ignored: [] };
    expect(serializeSearchState({ ...original, concepts: on })).not.toBe(serializeSearchState(original));
    // Stamping is idempotent across repeat toggles.
    const again = setTermDisabled(setTermDisabled(on, 'c1', 't1', true), 'c1', 't1', false);
    expect(again[0].terms[0].kept).toBe(true);
  });

  it('a user_added term round-trips byte-identical (sync never drops it — no marker needed)', () => {
    const original = { concepts: base(), overrides: {}, ignored: [] };
    const off = setTermDisabled(original.concepts, 'c1', 't2', true);
    const roundTripped = { concepts: setTermDisabled(off, 'c1', 't2', false), overrides: {}, ignored: [] };
    expect(serializeSearchState(roundTripped)).toBe(serializeSearchState(original));
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

  it('disable → PICO edit drops keyword → RE-ENABLE → later syncs keep the term switched ON (kept marker)', () => {
    // The disabled flag was the term's only keep-marker; clearing it on re-enable
    // must not turn the enable toggle into a delayed silent delete.
    const a = syncSearchBuilderFromPico({ P: 'asthma' }, [], []);
    const seeded = a.map((c) => (c.picoField === 'P'
      ? { ...c, id: 'cP', terms: c.terms.map((t) => (norm(t.text) === 'asthma' ? { ...t, id: 'tA' } : t)) }
      : c));
    const off = setTermDisabled(seeded, 'cP', 'tA', true);
    const afterEdit = syncSearchBuilderFromPico({ P: 'COPD' }, off, []);   // keyword gone; term kept OFF
    const on = setTermDisabled(afterEdit, 'cP', 'tA', false);              // user switches it back ON
    const b = syncSearchBuilderFromPico({ P: 'COPD in adults' }, on, []);  // any later PICO edit re-syncs
    const kept = b.find((c) => c.picoField === 'P').terms.find((t) => norm(t.text) === 'asthma');
    expect(kept).toBeTruthy();               // NOT silently deleted
    expect(kept.disabled).toBeUndefined();   // and it is ON
    expect(kept.kept).toBe(true);            // the marker that saved it
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

/* ══════════════ 96.md — question-based concept groups (PICO removed) ═══════════ */

import {
  seedStateFromQuestion, createConceptFromPhrase, findConceptForPhrase,
  conceptOnlyHoldsOriginTerm, reorderConcept, reorderTerm, mergeConcepts, splitConcept,
  conceptDrift, anyLiveTerms, normalizePersistedQuestionSnapshot, setConceptSourcePhrase,
} from '../../src/research-engine/searchBuilder/searchState.js';

describe('96.md D2 — seedStateFromQuestion (revision-0 seed is EMPTY, no scaffold)', () => {
  it('seeds empty concepts + the trimmed question snapshot', () => {
    expect(seedStateFromQuestion('  Does metformin help?  '))
      .toEqual({ concepts: [], questionSnapshot: 'Does metformin help?' });
    expect(seedStateFromQuestion('')).toEqual({ concepts: [], questionSnapshot: '' });
    expect(seedStateFromQuestion(null)).toEqual({ concepts: [], questionSnapshot: '' });
  });
});

describe('96.md D13 — createConceptFromPhrase (phrase click → concept group)', () => {
  it('creates an id-less group: label=phrase, sourcePhrase set, first term = phrase tiab freetext', () => {
    const c = createConceptFromPhrase('heart failure');
    expect(c.label).toBe('heart failure');
    expect(c.sourcePhrase).toBe('heart failure');
    expect(c.source).toBe('user_added');
    expect(c.op).toBe('AND');
    expect(c.id).toBeUndefined(); // the caller assigns ids (module contract)
    expect(c.terms).toHaveLength(1);
    expect(c.terms[0]).toMatchObject({ text: 'heart failure', type: 'freetext', field: 'tiab', source: 'user_added', phrase: true });
  });
  it('single-word phrases do NOT force phrase quoting; blanks return null', () => {
    const c = createConceptFromPhrase('adults');
    expect(c.terms[0].phrase).toBeUndefined();
    expect(createConceptFromPhrase('   ')).toBeNull();
    expect(createConceptFromPhrase(null)).toBeNull();
  });
});

describe('96.md D13 — findConceptForPhrase + conceptOnlyHoldsOriginTerm (dedupe/dequeue)', () => {
  const groups = [
    { id: 'a', label: 'Heart failure', sourcePhrase: 'heart failure', terms: [{ id: 't1', text: 'heart failure' }] },
    { id: 'b', label: 'Renamed group', sourcePhrase: 'hospital readmission', terms: [{ id: 't2', text: 'hospital readmission' }, { id: 't3', text: 'rehospitalization' }] },
    { id: 'c', label: 'Setting', terms: [] },
  ];
  it('matches by normalized sourcePhrase first, then label (duplicate-phrase prevention)', () => {
    expect(findConceptForPhrase(groups, '“Heart Failure?”').id).toBe('a'); // punctuation/case-insensitive (norm)
    expect(findConceptForPhrase(groups, 'hospital readmission').id).toBe('b'); // renamed → sourcePhrase still matches
    expect(findConceptForPhrase(groups, 'Setting').id).toBe('c'); // label fallback
    expect(findConceptForPhrase(groups, 'dapagliflozin')).toBeNull();
    expect(findConceptForPhrase(groups, '')).toBeNull();
  });
  it('a group holding ONLY its origin term may dequeue; extra terms mean focus instead', () => {
    expect(conceptOnlyHoldsOriginTerm(groups[0])).toBe(true);
    expect(conceptOnlyHoldsOriginTerm(groups[1])).toBe(false); // real work inside
    expect(conceptOnlyHoldsOriginTerm(groups[2])).toBe(true);  // nothing to lose
  });
});

describe('96.md D13 — reorderConcept (up/down, no-op safe)', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('moves a group by ±1 and returns a NEW array', () => {
    expect(reorderConcept(list, 'b', -1).map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(reorderConcept(list, 'b', +1).map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });
  it('returns the SAME array reference on a no-op (edge / unknown id / zero delta)', () => {
    expect(reorderConcept(list, 'a', -1)).toBe(list);
    expect(reorderConcept(list, 'c', +1)).toBe(list);
    expect(reorderConcept(list, 'nope', +1)).toBe(list);
    expect(reorderConcept(list, 'b', 0)).toBe(list);
  });
});

describe('96.md §3B (QA M3) — reorderTerm (within-group order, no-op safe)', () => {
  const list = [
    { id: 'a', label: 'A', terms: [{ id: 't1', text: 'one' }, { id: 't2', text: 'two' }, { id: 't3', text: 'three' }] },
    { id: 'b', label: 'B', terms: [{ id: 'u1', text: 'only' }] },
  ];
  it('moves a term by ±1 within its concept and returns a NEW array', () => {
    const up = reorderTerm(list, 'a', 't2', -1);
    expect(up[0].terms.map((t) => t.id)).toEqual(['t2', 't1', 't3']);
    const down = reorderTerm(list, 'a', 't2', +1);
    expect(down[0].terms.map((t) => t.id)).toEqual(['t1', 't3', 't2']);
    // untouched concepts keep their object reference (cheap re-render check)
    expect(up[1]).toBe(list[1]);
  });
  it('term order is part of the persisted signature (a real move autosaves)', () => {
    const moved = reorderTerm(list, 'a', 't2', -1);
    expect(serializeSearchState({ concepts: moved })).not.toBe(serializeSearchState({ concepts: list }));
  });
  it('returns the SAME array reference on a no-op (edge / unknown ids / zero delta)', () => {
    expect(reorderTerm(list, 'a', 't1', -1)).toBe(list);
    expect(reorderTerm(list, 'a', 't3', +1)).toBe(list);
    expect(reorderTerm(list, 'a', 'nope', +1)).toBe(list);
    expect(reorderTerm(list, 'nope', 't1', +1)).toBe(list);
    expect(reorderTerm(list, 'a', 't2', 0)).toBe(list);
    expect(reorderTerm(list, 'b', 'u1', +1)).toBe(list); // single term — both edges
  });
});

describe('96.md §3A/§3B (QA M4) — setConceptSourcePhrase (re-anchor the originating phrase)', () => {
  const list = [
    { id: 'a', label: 'Mortality', sourcePhrase: 'mortality', terms: [] },
    { id: 'b', label: 'Setting', terms: [] },
  ];
  it('rewrites the phrase (trimmed) and only touches the target concept', () => {
    const next = setConceptSourcePhrase(list, 'a', '  cardiovascular events  ');
    expect(next[0].sourcePhrase).toBe('cardiovascular events');
    expect(next[1]).toBe(list[1]);
  });
  it('a re-anchored phrase present in the question stops the group drifting', () => {
    const q = 'Does metformin reduce cardiovascular events in adults?';
    expect(conceptDrift(q, list).map((d) => d.id)).toEqual(['a', 'b']);
    const next = setConceptSourcePhrase(list, 'a', 'cardiovascular events');
    expect(conceptDrift(q, next).map((d) => d.id)).toEqual(['b']);
  });
  it('blank input CLEARS the key entirely (omit-when-empty signature convention)', () => {
    const cleared = setConceptSourcePhrase(list, 'a', '   ');
    expect('sourcePhrase' in cleared[0]).toBe(false);
    // and clearing a concept that never had the key is a full no-op
    expect(setConceptSourcePhrase(list, 'b', '')).toBe(list);
  });
  it('returns the SAME array on unknown id / unchanged phrase', () => {
    expect(setConceptSourcePhrase(list, 'nope', 'x')).toBe(list);
    expect(setConceptSourcePhrase(list, 'a', 'mortality')).toBe(list);
    expect(setConceptSourcePhrase(list, 'a', '  mortality  ')).toBe(list); // trim-equal
  });
});

describe('96.md D13 — mergeConcepts (QA L4: dedupe by EXACT normalized text; undo info)', () => {
  const eus = { id: 'x', label: 'Imaging', sourcePhrase: 'imaging', op: 'OR', terms: [
    { id: 'x1', text: 'EUS' }, { id: 'x2', text: 'sonography' },
  ] };
  const target = { id: 'y', label: 'Ultrasound', op: 'AND', terms: [{ id: 'y1', text: 'endoscopic ultrasound' }] };
  it('moves ALL non-identical terms into the target, which keeps its own label/op', () => {
    const res = mergeConcepts([eus, target], 'x', 'y');
    expect(res.concepts.map((c) => c.id)).toEqual(['y']);
    const merged = res.concepts[0];
    expect(merged.label).toBe('Ultrasound');
    expect(merged.op).toBe('AND');
    // QA L4 — 'EUS' is family-equivalent to 'endoscopic ultrasound' but NOT the
    // same text: distinct synonyms are precisely what an OR group is for, so BOTH
    // source terms survive the merge (only exact normalized duplicates are skipped).
    expect(merged.terms.map((t) => t.id)).toEqual(['y1', 'x1', 'x2']);
    // undo info carries everything the inverse needs
    expect(res.undo).toMatchObject({ fromIndex: 0, intoId: 'y', movedTermIds: ['x1', 'x2'] });
    expect(res.undo.fromConcept).toBe(eus); // the ORIGINAL object (ids survive)
  });
  it('QA L4 — family-equivalent synonyms survive; byte-equal (normalized) duplicates do not', () => {
    const from = { id: 'a', label: 'Cardiac', terms: [
      { id: 'a1', text: 'cardiac failure' },   // distinct synonym → must survive
      { id: 'a2', text: 'Heart Failure' },     // exact normalized dup → skipped
    ] };
    const into = { id: 'b', label: 'HF', terms: [{ id: 'b1', text: 'heart failure' }] };
    const res = mergeConcepts([from, into], 'a', 'b');
    expect(res.concepts[0].terms.map((t) => t.id)).toEqual(['b1', 'a1']);
    expect(res.undo.movedTermIds).toEqual(['a1']);
  });
  it('QA M20 — a same-label MeSH term (attached vocab) SURVIVES a merge into a group holding the free-text form', () => {
    const from = { id: 'a', label: 'Cardiac', terms: [
      { id: 'a1', text: 'Heart Failure', type: 'controlled', vocab: { mesh: 'Heart Failure', meshUI: 'D006333' } },
    ] };
    const into = { id: 'b', label: 'HF', terms: [{ id: 'b1', text: 'heart failure' }] };
    const res = mergeConcepts([from, into], 'a', 'b');
    // The controlled variant is a DIFFERENT term class under the type-aware key:
    // it moves (never silently discarded with its vocab metadata).
    expect(res.concepts[0].terms.map((t) => t.id)).toEqual(['b1', 'a1']);
    expect(res.skipped).toEqual([]);
  });
  it('QA M20 — genuinely-skipped exact duplicates are REPORTED, never silent', () => {
    const from = { id: 'a', label: 'Cardiac', terms: [
      { id: 'a1', text: 'cardiac failure' },
      { id: 'a2', text: '"Heart Failure"' }, // exact dup of b1 under the conservative key
    ] };
    const into = { id: 'b', label: 'HF', terms: [{ id: 'b1', text: 'heart failure' }] };
    const res = mergeConcepts([from, into], 'a', 'b');
    expect(res.undo.movedTermIds).toEqual(['a1']);
    expect(res.skipped).toEqual([{ id: 'a2', text: '"Heart Failure"' }]); // the UI counts these in the toast
  });
  it('returns null for unknown/identical ids', () => {
    expect(mergeConcepts([eus, target], 'x', 'x')).toBeNull();
    expect(mergeConcepts([eus, target], 'nope', 'y')).toBeNull();
    expect(mergeConcepts([eus, target], 'x', 'nope')).toBeNull();
  });
});

describe('96.md D13 — splitConcept (term multi-select → new group)', () => {
  const src = { id: 's', label: 'Drugs', op: 'OR', terms: [
    { id: 'd1', text: 'dapagliflozin' }, { id: 'd2', text: 'empagliflozin' }, { id: 'd3', text: 'metformin' },
  ] };
  it('moves the selected terms into an id-less new group inserted right after the source', () => {
    const res = splitConcept([src], 's', ['d1', 'd2'], 'SGLT2 inhibitors');
    expect(res.newIndex).toBe(1);
    const [remaining, fresh] = res.concepts;
    expect(remaining.terms.map((t) => t.id)).toEqual(['d3']);
    expect(fresh.id).toBeUndefined(); // caller assigns
    expect(fresh.label).toBe('SGLT2 inhibitors');
    expect(fresh.op).toBe('OR'); // inherits the source's op chain position semantics
    expect(fresh.terms.map((t) => t.id)).toEqual(['d1', 'd2']);
  });
  it('falls back to a derived label; null when nothing would move', () => {
    expect(splitConcept([src], 's', ['d3'], '').concepts[1].label).toBe('Drugs (split)');
    expect(splitConcept([src], 's', [], 'X')).toBeNull();
    expect(splitConcept([src], 'nope', ['d1'], 'X')).toBeNull();
    expect(splitConcept([src], 's', ['zz'], 'X')).toBeNull();
  });
});

describe('96.md D2 — conceptDrift (question edits never delete; they flag)', () => {
  const q = 'Do SGLT2 inhibitors reduce hospital readmission in adults with heart failure?';
  const groups = [
    { id: 'a', label: 'Heart failure', sourcePhrase: 'heart failure', terms: [] },
    { id: 'b', label: 'SGLT2 blockers', sourcePhrase: 'SGLT2 inhibitors', terms: [] }, // renamed, phrase still present
    { id: 'c', label: 'Mortality', sourcePhrase: 'mortality', terms: [] },             // phrase gone
    { id: 'd', label: 'Setting', terms: [] },                                          // manual, label not in question
  ];
  it('reports groups whose sourcePhrase (or label fallback) left the question', () => {
    const out = conceptDrift(q, groups);
    expect(out.map((d) => d.id)).toEqual(['c', 'd']);
    expect(out[0]).toEqual({ id: 'c', label: 'Mortality', sourcePhrase: 'mortality' });
  });
  it('matching is case/punctuation-insensitive on normalized text', () => {
    expect(conceptDrift('HEART FAILURE!', [groups[0]])).toEqual([]);
  });
  it('legacy PICO groups are NEVER reported (they came from protocol fields, not the question)', () => {
    const legacy = [
      { id: 'p', label: 'Population', picoField: 'P', source: 'pico_auto', terms: [] },
      { id: 'i', label: 'Intervention / Exposure', field: 'Intervention / Exposure', source: 'pico_auto', terms: [] },
    ];
    expect(conceptDrift(q, legacy)).toEqual([]);
  });
  it('an empty question drifts every question-derived group (nothing matches)', () => {
    expect(conceptDrift('', [groups[0]]).map((d) => d.id)).toEqual(['a']);
  });
});

describe('96.md D2 — questionSnapshot persistence (omit-when-empty byte-stability)', () => {
  const OLD_SHAPE = {
    concepts: [{ id: 'cP', label: 'Population', picoField: 'P', field: 'Population', source: 'pico_auto', op: 'AND', terms: [{ id: 't1', text: 'adults', type: 'freetext', field: 'tiab', source: 'pico_auto' }] }],
    overrides: {}, ignored: [{ text: 'x', field: 'Population', label: 'Population' }],
    databases: ['pubmed'], readyForScreening: false, dismissedWarnings: [],
  };
  it('a historical save (no questionSnapshot) keeps a byte-identical signature', () => {
    expect(serializeSearchState(OLD_SHAPE)).toBe(serializeSearchState({ ...OLD_SHAPE, questionSnapshot: '' }));
    expect(serializeSearchState(OLD_SHAPE)).toBe(serializeSearchState({ ...OLD_SHAPE, questionSnapshot: '   ' }));
    expect(pickPersisted(OLD_SHAPE).questionSnapshot).toBeUndefined();
  });
  it('a real snapshot rides in pickPersisted (trimmed, capped) and changes the signature', () => {
    const withQ = { ...OLD_SHAPE, questionSnapshot: '  does it work?  ' };
    expect(pickPersisted(withQ).questionSnapshot).toBe('does it work?');
    expect(serializeSearchState(withQ)).not.toBe(serializeSearchState(OLD_SHAPE));
  });
  it('per-concept sourcePhrase rides INSIDE concepts untouched (no stripping)', () => {
    const withPhrase = {
      ...OLD_SHAPE,
      concepts: [{ id: 'g1', label: 'heart failure', sourcePhrase: 'heart failure', source: 'user_added', op: 'AND', terms: [] }],
    };
    expect(pickPersisted(withPhrase).concepts[0].sourcePhrase).toBe('heart failure');
  });
  it('normalizePersistedQuestionSnapshot: trim, cap 2000, undefined when blank', () => {
    expect(normalizePersistedQuestionSnapshot(' q ')).toBe('q');
    expect(normalizePersistedQuestionSnapshot('x'.repeat(3000)).length).toBe(2000);
    expect(normalizePersistedQuestionSnapshot('')).toBeUndefined();
    expect(normalizePersistedQuestionSnapshot(9)).toBeUndefined();
  });
  it('anyLiveTerms — the generic has-a-strategy predicate', () => {
    expect(anyLiveTerms(OLD_SHAPE.concepts)).toBe(true);
    expect(anyLiveTerms([{ id: 'g', terms: [{ id: 't', text: 'x', disabled: true }] }])).toBe(false);
    expect(anyLiveTerms([])).toBe(false);
  });
});

/* ══════════════ 97.md — meta key, neutral groups, legacy-label migration ═══════ */

import {
  normalizePersistedMeta, stampManualMeta, buildGeneratedMeta,
  migrateLegacyGroupLabels, renameConcept, defaultGroupLabel,
} from '../../src/research-engine/searchBuilder/searchState.js';
import { searchQualityCheck } from '../../src/research-engine/searchBuilder/crossConcept.js';

describe('97.md — pickPersisted meta (the ONE new top-level key, omit-when-empty)', () => {
  const BASE = {
    concepts: [{ id: 'c1', label: 'X', op: 'AND', terms: [] }],
    overrides: {}, ignored: [],
  };
  const META = {
    generatedAt: '2026-08-02T10:00:00.000Z',
    generatedBy: { id: 'u1', name: 'Ada' },
    sourceQuestion: 'does it work?',
  };

  it('PINNED: pre-97 saves keep BYTE-IDENTICAL signatures (meta absent / {} / all-empty / junk)', () => {
    const before = serializeSearchState(BASE);
    expect(serializeSearchState({ ...BASE, meta: {} })).toBe(before);
    expect(serializeSearchState({ ...BASE, meta: { generatedAt: '', sourceQuestion: '   ' } })).toBe(before);
    expect(serializeSearchState({ ...BASE, meta: { generatedBy: {} } })).toBe(before);
    expect(serializeSearchState({ ...BASE, meta: 'junk' })).toBe(before);
    expect(serializeSearchState({ ...BASE, meta: [1, 2] })).toBe(before);
    expect(pickPersisted(BASE).meta).toBeUndefined();
    expect(pickPersisted({ ...BASE, meta: {} }).meta).toBeUndefined();
  });

  it('a real meta block rides in pickPersisted and changes the signature (autosave persists it)', () => {
    const withMeta = { ...BASE, meta: META };
    expect(pickPersisted(withMeta).meta).toEqual(META);
    expect(serializeSearchState(withMeta)).not.toBe(serializeSearchState(BASE));
    // every field is independently signature-relevant
    expect(serializeSearchState({ ...BASE, meta: { ...META, manuallyModifiedAt: '2026-08-03T09:00:00.000Z' } }))
      .not.toBe(serializeSearchState(withMeta));
  });

  it('normalizePersistedMeta: caps, trims, coerces ids, drops junk fields', () => {
    const m = normalizePersistedMeta({
      generatedAt: 't'.repeat(60),
      generatedBy: { id: 42, name: 'n'.repeat(300) },
      sourceQuestion: 'q'.repeat(3000),
      manuallyModifiedAt: 7,               // junk type → dropped
      manuallyModifiedBy: { id: '', name: '' }, // empty who → dropped
    });
    expect(m.generatedAt.length).toBe(40);
    expect(m.generatedBy.id).toBe('42');   // numeric id tolerated, coerced
    expect(m.generatedBy.name.length).toBe(200);
    expect(m.sourceQuestion.length).toBe(2000);
    expect(m.manuallyModifiedAt).toBeUndefined();
    expect(m.manuallyModifiedBy).toBeUndefined();
    expect(normalizePersistedMeta(null)).toBeUndefined();
    expect(normalizePersistedMeta({})).toBeUndefined();
  });

  it('stampManualMeta: sets the manual fields, preserves generation provenance', () => {
    const stamped = stampManualMeta(META, { id: 'u2', name: 'Grace' }, '2026-08-03T09:00:00.000Z');
    expect(stamped).toEqual({
      ...META,
      manuallyModifiedAt: '2026-08-03T09:00:00.000Z',
      manuallyModifiedBy: { id: 'u2', name: 'Grace' },
    });
    // meta absent → manual fields only
    expect(stampManualMeta(undefined, { id: 'u2', name: 'Grace' }, '2026-08-03T09:00:00.000Z')).toEqual({
      manuallyModifiedAt: '2026-08-03T09:00:00.000Z',
      manuallyModifiedBy: { id: 'u2', name: 'Grace' },
    });
    // all-junk input degrades to undefined (safe to assign into state)
    expect(stampManualMeta(undefined, null, '')).toBeUndefined();
  });

  it('buildGeneratedMeta: generation provenance ONLY — "modified since generation" is derived', () => {
    const m = buildGeneratedMeta({ user: { id: 'u1', name: 'Ada' }, at: '2026-08-02T10:00:00.000Z', sourceQuestion: 'q?' });
    expect(m).toEqual({
      generatedAt: '2026-08-02T10:00:00.000Z',
      generatedBy: { id: 'u1', name: 'Ada' },
      sourceQuestion: 'q?',
    });
    expect(m.manuallyModifiedAt).toBeUndefined();
    // a later manual stamp keeps generation provenance and adds the manual fields
    const after = stampManualMeta(m, { id: 'u1', name: 'Ada' }, '2026-08-02T11:00:00.000Z');
    expect(after.generatedAt).toBe('2026-08-02T10:00:00.000Z');
    expect(after.manuallyModifiedAt).toBe('2026-08-02T11:00:00.000Z');
  });
});

describe('97.md — renameConcept / defaultGroupLabel (98.md §8 — the noun is Concept)', () => {
  const list = [
    { id: 'a', label: 'Concept 1', op: 'AND', terms: [] },
    { id: 'b', label: 'Drainage', op: 'AND', terms: [] },
  ];
  it('renames one group (new array), no-ops for unknown id / blank / unchanged (SAME array)', () => {
    const out = renameConcept(list, 'b', '  Biliary drainage  ');
    expect(out).not.toBe(list);
    expect(out[1].label).toBe('Biliary drainage');
    expect(out[0]).toBe(list[0]); // untouched concepts keep their references
    expect(renameConcept(list, 'zz', 'X')).toBe(list);
    expect(renameConcept(list, 'b', '   ')).toBe(list);
    expect(renameConcept(list, 'b', 'Drainage')).toBe(list);
    expect(renameConcept(list, 'b', 'L'.repeat(300))[1].label.length).toBe(200);
  });
  it('defaultGroupLabel: Concept N with collision bump (98.md §8)', () => {
    expect(defaultGroupLabel([])).toBe('Concept 1');
    expect(defaultGroupLabel(list)).toBe('Concept 3');
    expect(defaultGroupLabel([{ id: 'x', label: 'Concept 1' }])).toBe('Concept 2');
    // a label collision at the counted position bumps past it
    expect(defaultGroupLabel([{ id: 'x', label: 'Concept 2' }])).toBe('Concept 3');
  });
});

describe('97.md Phases 8/15 — migrateLegacyGroupLabels (idempotent, marker-stamped)', () => {
  const legacyFiveGroup = () => [
    { id: 'cP', label: 'Population', picoField: 'P', field: 'Population', source: 'pico_auto', op: 'AND', terms: [{ id: 't1', text: 'adults', type: 'freetext', field: 'tiab', source: 'pico_auto' }] },
    { id: 'cI', label: 'Intervention / Exposure', picoField: 'I', field: 'Intervention / Exposure', source: 'pico_auto', op: 'AND', terms: [{ id: 't2', text: 'metformin', type: 'freetext', field: 'tiab', source: 'pico_auto' }] },
    { id: 'cC', label: 'Comparator / Control', picoField: 'C', field: 'Comparator / Control', source: 'pico_auto', op: 'AND', terms: [] },
    { id: 'cO', label: 'Outcomes', picoField: 'O', field: 'Outcomes', source: 'pico_auto', op: 'AND', terms: [] },
    { id: 'cT', label: 'Time Frame', picoField: 'T', field: 'Time Frame', source: 'pico_auto', op: 'AND', note: 'Last 5 years', terms: [] },
  ];

  it('rewrites canonical PICO labels to "Concept N" (98.md §8) and stamps labelMigrated:2', () => {
    const out = migrateLegacyGroupLabels(legacyFiveGroup());
    expect(out.map((c) => c.label)).toEqual(['Concept 1', 'Concept 2', 'Concept 3', 'Concept 4', 'Concept 5']);
    out.forEach((c) => expect(c.labelMigrated).toBe(2));
  });

  it('RETAINS picoField (invariant 5) — QC/drift exemptions and rejectionKey scope survive', () => {
    const original = legacyFiveGroup();
    const out = migrateLegacyGroupLabels(original);
    expect(out.map((c) => c.picoField)).toEqual(['P', 'I', 'C', 'O', 'T']);
    // empty legacy Comparator/Outcomes stay QC-exempt after the label rewrite
    expect(searchQualityCheck(out).filter((w) => w.id.startsWith('empty:'))).toEqual([]);
    // drift never reports legacy groups, before or after
    expect(conceptDrift('a completely different question', out)).toEqual([]);
    // suggestion rejections stay scoped to the picoField → persisted keys stay valid
    expect(rejectionKey(out[0], 'EUS')).toBe(rejectionKey(original[0], 'EUS'));
    // terms ride through untouched (same objects)
    expect(out[0].terms[0]).toBe(original[0].terms[0]);
  });

  it('preserves user-renamed legacy labels (97: "unless the user previously assigned a custom name")', () => {
    const renamed = legacyFiveGroup().map((c, i) => (i === 0 ? { ...c, label: 'People with diabetes' } : c));
    const out = migrateLegacyGroupLabels(renamed);
    expect(out[0].label).toBe('People with diabetes');
    expect(out[0].labelMigrated).toBeUndefined();
    expect(out[1].label).toBe('Concept 2'); // numbering = position among ALL groups
  });

  it('legacy Concepts-era groups (source pico_auto, NO picoField) migrate by label too', () => {
    const era = [
      { id: 'k1', label: 'Population', field: 'Population', source: 'pico_auto', op: 'AND', terms: [] },
      { id: 'k2', label: 'Outcome', field: 'Outcome', source: 'pico_auto', op: 'AND', terms: [] },
    ];
    const out = migrateLegacyGroupLabels(era);
    expect(out.map((c) => c.label)).toEqual(['Concept 1', 'Concept 2']);
  });

  /* 98.md §8 — the SECOND one-shot pass: default 97-era "Search Group N" labels
     become "Concept N" (same number preserved — collaborators' mental mapping
     survives), stamped labelMigrated:2. User renames never match the pattern. */
  it('98.md §8 — renames a default "Search Group N" label to "Concept N" keeping the SAME number', () => {
    const era97 = [
      { id: 'g1', label: 'Search Group 3', source: 'user_added', op: 'AND', terms: [] },
      { id: 'g2', label: 'Drainage', source: 'user_added', op: 'AND', terms: [] },
      { id: 'g3', label: 'search group 1', source: 'generated', op: 'AND', terms: [] }, // case-insensitive
    ];
    const out = migrateLegacyGroupLabels(era97);
    expect(out.map((c) => c.label)).toEqual(['Concept 3', 'Drainage', 'Concept 1']); // number preserved, NOT position
    expect(out[0].labelMigrated).toBe(2);
    expect(out[1].labelMigrated).toBeUndefined(); // custom name untouched, no marker
    expect(out[2].labelMigrated).toBe(2);
  });

  it('98.md §8 — the second pass is idempotent and leaves non-matching labels alone', () => {
    const era97 = [{ id: 'g1', label: 'Search Group 2', source: 'user_added', op: 'AND', terms: [] }];
    const once = migrateLegacyGroupLabels(era97);
    expect(once[0].label).toBe('Concept 2');
    expect(migrateLegacyGroupLabels(once)).toBe(once); // SAME array — no churn
    // "Concept N" never matches either legacy pattern
    const done = [{ id: 'g1', label: 'Concept 2', labelMigrated: 2, source: 'user_added', op: 'AND', terms: [] }];
    expect(migrateLegacyGroupLabels(done)).toBe(done);
    // near-miss labels are user text, not defaults
    const nearMiss = [{ id: 'g1', label: 'Search Group A', source: 'user_added', op: 'AND', terms: [] }];
    expect(migrateLegacyGroupLabels(nearMiss)).toBe(nearMiss);
  });

  it('never touches user-created groups — even one the user happened to call "Population"', () => {
    const user = [
      { id: 'u1', label: 'Population', source: 'user_added', op: 'AND', terms: [] },
      { id: 'u2', label: 'heart failure', sourcePhrase: 'heart failure', source: 'user_added', op: 'AND', terms: [] },
    ];
    expect(migrateLegacyGroupLabels(user)).toBe(user); // SAME reference — untouched
  });

  it('IDEMPOTENT: second run is a no-op (SAME reference, byte-identical signature)', () => {
    const once = migrateLegacyGroupLabels(legacyFiveGroup());
    const twice = migrateLegacyGroupLabels(once);
    expect(twice).toBe(once);
    expect(serializeSearchState({ concepts: twice })).toBe(serializeSearchState({ concepts: once }));
  });

  it('an already-converted / non-legacy doc returns the SAME array (no spurious autosave on load)', () => {
    const converted = migrateLegacyGroupLabels(legacyFiveGroup());
    expect(migrateLegacyGroupLabels(converted)).toBe(converted);
    const empty = [];
    expect(migrateLegacyGroupLabels(empty)).toBe(empty);
    expect(migrateLegacyGroupLabels(null)).toEqual([]);
  });

  it('the FIRST conversion changes the persisted signature exactly once (then stable)', () => {
    const original = legacyFiveGroup();
    const s0 = serializeSearchState({ concepts: original });
    const once = migrateLegacyGroupLabels(original);
    const s1 = serializeSearchState({ concepts: once });
    expect(s1).not.toBe(s0); // conversion persists via the ordinary autosave…
    expect(serializeSearchState({ concepts: migrateLegacyGroupLabels(once) })).toBe(s1); // …then no-ops forever
  });
});
