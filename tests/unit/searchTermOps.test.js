/**
 * searchTermOps.test.js — 97.md Phases 6/9/11 (plan §12). The pure term
 * operations: cross-group move (fixing the old moveTerm's silent term-loss bug),
 * move-to-new-group, explicit copy, combine-into-phrase (components recorded),
 * and phrase split (components restored; edited phrases take the safe manual
 * path). Signatures are the plan's positional forms the UI codes against.
 */
import { describe, it, expect } from 'vitest';
import {
  moveTermToConcept, moveTermToNewConcept, copyTerm,
  combinePhrase, combineTokens, splitPartsOf, splitPhrase,
} from '../../src/research-engine/searchBuilder/termOps.js';
import { serializeSearchState } from '../../src/research-engine/searchBuilder/searchState.js';

const term = (id, text, extra = {}) => ({ id, text, type: 'freetext', field: 'tiab', source: 'user_added', ...extra });
const group = (id, label, terms) => ({ id, label, source: 'user_added', op: 'AND', terms });

const meshTerm = (id, text) => term(id, text, {
  type: 'controlled',
  source: 'pico_auto',
  vocab: { mesh: text, meshUI: 'D006333', synonyms: ['cardiac failure'], source: 'live' },
});

describe('moveTermToConcept — the defective moveTerm, replaced (plan §12)', () => {
  const base = () => [
    group('g1', 'Search Group 1', [meshTerm('t1', 'Heart Failure'), term('t2', 'HF', { components: [{ text: 'H' }, { text: 'F' }] })]),
    group('g2', 'Search Group 2', [term('t3', 'mortality')]),
  ];

  it('moves the ORIGINAL term object — id, type, vocab, source, components all survive', () => {
    const list = base();
    const out = moveTermToConcept(list, 't1', 'g1', 'g2');
    expect(out.blocked).toBeUndefined();
    const movedTo = out.concepts.find((c) => c.id === 'g2');
    expect(movedTo.terms.map((t) => t.id)).toEqual(['t3', 't1']);
    expect(movedTo.terms[1]).toBe(list[0].terms[0]); // SAME object — nothing rewritten
    expect(out.term).toBe(list[0].terms[0]);         // surfaced for the caller's toast/undo
    expect(movedTo.terms[1].source).toBe('pico_auto'); // NO source:'user_added' rewrite
    expect(movedTo.terms[1].vocab.meshUI).toBe('D006333'); // MeSH metadata intact
    expect(out.concepts.find((c) => c.id === 'g1').terms.map((t) => t.id)).toEqual(['t2']);
  });

  it('returns top-level fromIndex/toIndex plus ready-made undo info', () => {
    const out = moveTermToConcept(base(), 't2', 'g1', 'g2', 0);
    expect(out.fromIndex).toBe(1);
    expect(out.toIndex).toBe(0);
    expect(out.undo).toEqual({
      fromConceptId: 'g1', toConceptId: 'g2', termId: 't2', fromIndex: 1, toIndex: 0, text: 'HF',
    });
    expect(out.concepts.find((c) => c.id === 'g2').terms.map((t) => t.id)).toEqual(['t2', 't3']); // honored index
  });

  it('BLOCKS a move onto an exact duplicate — no silent deletion (the fixed bug)', () => {
    const list = [
      group('g1', 'A', [term('t1', 'EUS')]),
      group('g2', 'B', [term('t2', '"eus"')]), // exact-equivalent under quote/case normalization
    ];
    const before = serializeSearchState({ concepts: list });
    const out = moveTermToConcept(list, 't1', 'g1', 'g2');
    expect(out.blocked).toBe('duplicate');
    expect(out.existingTermId).toBe('t2');
    expect(out.existingConceptId).toBe('g2');
    expect(out.concepts).toBeUndefined(); // nothing changed…
    expect(serializeSearchState({ concepts: list })).toBe(before); // …and nothing mutated
  });

  it('family variants do NOT block a move (conservative exact key only)', () => {
    const list = [
      group('g1', 'A', [term('t1', 'EUS')]),
      group('g2', 'B', [term('t2', 'endoscopic ultrasound')]),
    ];
    const out = moveTermToConcept(list, 't1', 'g1', 'g2');
    expect(out.blocked).toBeUndefined();
    expect(out.concepts.find((c) => c.id === 'g2').terms).toHaveLength(2);
  });

  it('clamps a wild index and appends by default', () => {
    const out = moveTermToConcept(base(), 't1', 'g1', 'g2', 99);
    expect(out.concepts.find((c) => c.id === 'g2').terms.map((t) => t.id)).toEqual(['t3', 't1']);
  });

  it('returns null for unknown ids or a same-group "move"', () => {
    expect(moveTermToConcept(base(), 'zz', 'g1', 'g2')).toBeNull();
    expect(moveTermToConcept(base(), 't1', 'g1', 'gX')).toBeNull();
    expect(moveTermToConcept(base(), 't1', 'g1', 'g1')).toBeNull();
    expect(moveTermToConcept(null, 't1', 'g1', 'g2')).toBeNull();
  });
});

describe('moveTermToNewConcept — 97 Phase 10 "move into a newly created group"', () => {
  it('creates the id-less new group right after the source with the term inside', () => {
    const list = [group('g1', 'A', [term('t1', 'EUS'), term('t2', 'drainage')]), group('g2', 'B', [])];
    const out = moveTermToNewConcept(list, { termId: 't2', fromId: 'g1', label: 'Drainage' });
    expect(out.newIndex).toBe(1);
    const fresh = out.concepts[1];
    expect(fresh.id).toBeUndefined(); // caller stamps the id (splitConcept contract)
    expect(fresh.label).toBe('Drainage');
    expect(fresh.terms.map((t) => t.id)).toEqual(['t2']);
    expect(fresh.terms[0]).toBe(list[0].terms[1]); // original object rides along
    expect(out.concepts[0].terms.map((t) => t.id)).toEqual(['t1']);
  });
  it('falls back to the term text as the label and returns null for unknown ids', () => {
    const list = [group('g1', 'A', [term('t1', 'EUS')])];
    expect(moveTermToNewConcept(list, { termId: 't1', fromId: 'g1' }).concepts[1].label).toBe('EUS');
    expect(moveTermToNewConcept(list, { termId: 'zz', fromId: 'g1' })).toBeNull();
  });
});

describe('copyTerm — explicit duplication only (97 Phase 9/11)', () => {
  it('appends a fresh-id copy with source:"copied"; vocab/components survive, dupOverride does not', () => {
    const src = meshTerm('t1', 'Heart Failure');
    src.components = [{ text: 'Heart' }, { text: 'Failure' }];
    src.dupOverride = { key: 'heart failure', groups: ['g1', 'g9'] };
    const list = [group('g1', 'A', [src]), group('g2', 'B', [term('t2', 'mortality')])];
    const out = copyTerm(list, 't1', 'g1', 'g2');
    expect(out.blocked).toBeUndefined();
    expect(out.toConceptId).toBe('g2');
    expect(out.copiedIndex).toBe(1);
    expect(out.newTermId).toBe('t97-1'); // deterministic, collision-checked
    const copy = out.concepts.find((c) => c.id === 'g2').terms[1];
    expect(copy.id).toBe('t97-1');
    expect(copy.source).toBe('copied');
    expect(copy.vocab.meshUI).toBe('D006333');
    expect(copy.components).toEqual([{ text: 'Heart' }, { text: 'Failure' }]);
    expect('dupOverride' in copy).toBe(false); // a copy is a NEW configuration — warns afresh
    expect(out.concepts.find((c) => c.id === 'g1').terms).toHaveLength(1); // source untouched
  });
  it('skips ids already taken in the document', () => {
    const list = [group('g1', 'A', [term('t97-1', 'EUS')]), group('g2', 'B', [term('t2', 'mortality')])];
    expect(copyTerm(list, 't97-1', 'g1', 'g2').newTermId).toBe('t97-2');
  });
  it('blocks copying onto an exact duplicate and rejects junk', () => {
    const list = [group('g1', 'A', [term('t1', 'EUS')]), group('g2', 'B', [term('t2', '“EUS”')])];
    const out = copyTerm(list, 't1', 'g1', 'g2');
    expect(out.blocked).toBe('duplicate');
    expect(out.existingTermId).toBe('t2');
    expect(copyTerm(list, 't1', 'g1', 'g1')).toBeNull();
    expect(copyTerm(list, 'zz', 'g1', 'g2')).toBeNull();
  });
});

describe('combinePhrase — 97 Phase 6 phrase rules', () => {
  it('builds the 97 example: sodium-glucose + cotransporter + 2 (order, hyphens, components)', () => {
    const out = combinePhrase(['sodium-glucose', 'cotransporter', '2']);
    expect(out.text).toBe('sodium-glucose cotransporter 2');
    expect(out.components).toEqual([{ text: 'sodium-glucose' }, { text: 'cotransporter' }, { text: '2' }]);
  });
  it('normalizes repeated whitespace inside parts and accepts token objects', () => {
    const out = combinePhrase([{ text: '  heart   failure ' }, { text: 'therapy' }]);
    expect(out.text).toBe('heart failure therapy');
    expect(out.components).toEqual([{ text: 'heart failure' }, { text: 'therapy' }]);
  });
  it('returns null with fewer than two usable parts', () => {
    expect(combinePhrase(['only'])).toBeNull();
    expect(combinePhrase(['x', '   '])).toBeNull();
    expect(combinePhrase([])).toBeNull();
    expect(combinePhrase(null)).toBeNull();
  });
});

describe('combineTokens / splitPhrase — lossless round-trip', () => {
  const base = () => [group('g1', 'A', [
    term('t1', 'sodium-glucose'), term('t2', 'cotransporter'), term('t3', '2'), term('t4', 'inhibitors'),
  ])];

  it('combines in DISPLAY order (not selection order) at the first source position', () => {
    const out = combineTokens(base(), 'g1', ['t3', 't1', 't2']);
    expect(out.term.text).toBe('sodium-glucose cotransporter 2');
    expect(out.term.id).toBe('t97-1');
    expect(out.insertIndex).toBe(0);
    const terms = out.concepts[0].terms;
    expect(terms.map((t) => t.text)).toEqual(['sodium-glucose cotransporter 2', 'inhibitors']);
    expect(terms[0].phrase).toBe(true);
    expect(terms[0].components).toEqual([{ text: 'sodium-glucose' }, { text: 'cotransporter' }, { text: '2' }]);
    expect(out.undo.newTermId).toBe('t97-1');
    expect(out.undo.removed.map((r) => r.term.id)).toEqual(['t1', 't2', 't3']);
    expect(out.undo.removed.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it('splitPhrase restores recorded components (originals available → used)', () => {
    const combined = combineTokens(base(), 'g1', ['t1', 't2', 't3']);
    const split = splitPhrase(combined.concepts, 'g1', combined.term.id);
    expect(split.terms.map((t) => t.text)).toEqual(['sodium-glucose', 'cotransporter', '2']);
    expect(split.terms.every((t) => typeof t.id === 'string' && t.id)).toBe(true);
    expect(split.insertIndex).toBe(0);
    expect(split.concepts[0].terms.map((t) => t.text))
      .toEqual(['sodium-glucose', 'cotransporter', '2', 'inhibitors']);
    expect(split.undo.term.id).toBe(combined.term.id);
    expect(split.undo.index).toBe(0);
    expect(split.undo.newTermIds).toEqual(split.terms.map((t) => t.id));
  });

  it('an EDITED phrase (no components) refuses to guess — null → the safe manual dialog', () => {
    const list = [group('g1', 'A', [term('p1', 'edited combined phrase')])];
    expect(splitPhrase(list, 'g1', 'p1')).toBeNull();
    expect(splitPartsOf({ text: 'edited combined phrase' })).toBeNull();
  });

  it('explicit manual parts override components and skip texts already in the group', () => {
    const list = [group('g1', 'A', [term('p1', 'heart failure therapy'), term('t2', 'therapy')])];
    const out = splitPhrase(list, 'g1', 'p1', ['heart failure', 'therapy']);
    expect(out.terms.map((t) => t.text)).toEqual(['heart failure']); // 'therapy' already lives here — no redundant copy
    expect(out.concepts[0].terms.map((t) => t.text)).toEqual(['heart failure', 'therapy']);
    expect(out.concepts[0].terms[0].phrase).toBe(true); // multi-word part keeps exact-phrase intent
  });

  it('rejects junk: unknown ids, <2 selected terms, <2 usable parts', () => {
    expect(combineTokens(base(), 'gX', ['t1', 't2'])).toBeNull();
    expect(combineTokens(base(), 'g1', ['t1'])).toBeNull();
    expect(combineTokens(base(), 'g1', ['t1', 'zz'])).toBeNull();
    const list = [group('g1', 'A', [term('p1', 'x y', { components: [{ text: 'x y' }] })])];
    expect(splitPhrase(list, 'g1', 'p1')).toBeNull(); // 1 component
  });
});

/* ══════════════ 97 QA — combine-path dup prevention + edited-phrase safety ═══ */
import { componentsMatchText } from '../../src/research-engine/searchBuilder/termOps.js';

describe('QA M19 — combineTokens PREVENTS a same-group exact duplicate', () => {
  it('blocks when the combined phrase already lives on a SURVIVING term', () => {
    const list = [group('g1', 'A', [
      term('t0', 'heart failure'), term('t1', 'heart'), term('t2', 'failure'),
    ])];
    const res = combineTokens(list, 'g1', ['t1', 't2']);
    expect(res).toEqual({
      blocked: 'duplicate', existingTermId: 't0', existingConceptId: 'g1', text: 'heart failure',
    });
    // Nothing was mutated (the caller shows the blocked notice instead).
    expect(list[0].terms.map((t) => t.id)).toEqual(['t0', 't1', 't2']);
  });
  it('still combines when no surviving term matches', () => {
    const list = [group('g1', 'A', [term('t1', 'heart'), term('t2', 'failure')])];
    const res = combineTokens(list, 'g1', ['t1', 't2']);
    expect(res.blocked).toBeUndefined();
    expect(res.term.text).toBe('heart failure');
  });
  it('a same-label MeSH survivor does NOT block the (free-text) combine — type-aware (QA M18)', () => {
    const list = [group('g1', 'A', [
      { id: 'm1', text: 'Heart Failure', type: 'controlled', field: 'tiab', source: 'user_added', vocab: { mesh: 'Heart Failure' } },
      term('t1', 'heart'), term('t2', 'failure'),
    ])];
    const res = combineTokens(list, 'g1', ['t1', 't2']);
    expect(res.blocked).toBeUndefined();
    expect(res.term.text).toBe('heart failure');
  });
});

describe('QA M14 — an EDITED combined phrase never splits from stale components', () => {
  const edited = () => [group('g1', 'A', [term('p1', 'sodium-glucose cotransporter 2 inhibitors', {
    phrase: true,
    components: [{ text: 'sodium-glucose' }, { text: 'cotransporter' }, { text: '2' }],
  })])];

  it('componentsMatchText: true only while the text still equals the joined components', () => {
    expect(componentsMatchText({ text: 'sodium-glucose cotransporter 2', components: [{ text: 'sodium-glucose' }, { text: 'cotransporter' }, { text: '2' }] })).toBe(true);
    expect(componentsMatchText(edited()[0].terms[0])).toBe(false);
    expect(componentsMatchText(term('x', 'plain'))).toBe(false);
  });
  it('splitPhrase with NO explicit parts refuses stale components (null → UI offers the manual split)', () => {
    expect(splitPhrase(edited(), 'g1', 'p1')).toBeNull();
  });
  it('splitPhrase with EXPLICIT manual parts still works on the edited phrase (nothing dropped silently)', () => {
    const res = splitPhrase(edited(), 'g1', 'p1', ['sodium-glucose', 'cotransporter 2 inhibitors']);
    expect(res.terms.map((t) => t.text)).toEqual(['sodium-glucose', 'cotransporter 2 inhibitors']);
  });
});

describe('QA M18 — cross-group move/copy collision is type-aware', () => {
  const meshTerm = { id: 'm1', text: 'Heart Failure', type: 'controlled', field: 'tiab', source: 'user_added', vocab: { mesh: 'Heart Failure' } };
  it('a free-text term MOVES into a group holding the same-label MeSH copy', () => {
    const list = [
      group('g1', 'A', [term('t1', 'heart failure')]),
      group('g2', 'B', [{ ...meshTerm }]),
    ];
    const res = moveTermToConcept(list, 't1', 'g1', 'g2');
    expect(res.blocked).toBeUndefined();
    expect(res.concepts.find((c) => c.id === 'g2').terms.map((t) => t.id)).toEqual(['m1', 't1']);
  });
  it('a MeSH term is still BLOCKED against a same-descriptor MeSH copy at the target', () => {
    const list = [
      group('g1', 'A', [{ ...meshTerm }]),
      group('g2', 'B', [{ ...meshTerm, id: 'm2', text: 'HF' }]),
    ];
    const res = moveTermToConcept(list, 'm1', 'g1', 'g2');
    expect(res.blocked).toBe('duplicate');
    expect(res.existingTermId).toBe('m2');
  });
});
