/**
 * searchExactDuplicate.test.js — 97.md Phase 12 (plan §13, Decision N1). The
 * conservative exactDuplicateKey normalizer (added ALONGSIDE the untouched
 * family-based termEquivalenceKey), the cross-group exact-duplicate detector, the
 * demoted "Possible variant" family signal, and the config-scoped
 * "Keep both intentionally" dupOverride persistence + auto-reevaluation.
 */
import { describe, it, expect } from 'vitest';
import {
  exactDuplicateKey, groupsHoldingKey, findExactDuplicateInConcept,
  detectExactCrossGroupDuplicates, classifyCrossGroupDuplicates,
  dupOverrideActive, applyDupOverride, clearDupOverride,
} from '../../src/research-engine/searchBuilder/exactDuplicate.js';
import { termEquivalenceKey } from '../../src/research-engine/searchBuilder/crossConcept.js';

const term = (id, text, extra = {}) => ({ id, text, type: 'freetext', field: 'tiab', source: 'user_added', ...extra });
const group = (id, label, terms) => ({ id, label, source: 'user_added', op: 'AND', terms });

describe('exactDuplicateKey — 97 Phase 12 conservative normalization', () => {
  it('treats 97’s exact-duplicate list as ONE key (case, whitespace, straight/curly quotes)', () => {
    const expected = exactDuplicateKey('EUS');
    expect(expected).toBe('eus');
    for (const v of ['eus', '"EUS"', '“EUS”', '  EUS  ', 'EUS ']) {
      expect(exactDuplicateKey(v)).toBe(expected);
    }
  });
  it('collapses repeated internal whitespace', () => {
    expect(exactDuplicateKey('heart   failure')).toBe(exactDuplicateKey('heart failure'));
  });
  it('strips trailing database field tags for comparison', () => {
    expect(exactDuplicateKey('"Heart Failure"[Mesh]')).toBe('heart failure');
    expect(exactDuplicateKey('heart failure[tiab]')).toBe('heart failure');
    expect(exactDuplicateKey('"Heart Failure"[Mesh:NoExp]')).toBe('heart failure');
    expect(exactDuplicateKey('"Heart Failure"[MeSH Terms]')).toBe('heart failure');
  });
  it('keeps 97’s NOT-exact list distinct (no family collapse, no word overlap)', () => {
    const keys = [
      'EUS',
      'EUS-guided biliary drainage',
      'endoscopic ultrasound',
      'EUS-guided transluminal drainage',
    ].map(exactDuplicateKey);
    expect(new Set(keys).size).toBe(4);
  });
  it('keeps valid synonym/variant pairs distinct (tumour/tumor, heart failure/congestive heart failure)', () => {
    expect(exactDuplicateKey('tumour')).not.toBe(exactDuplicateKey('tumor'));
    expect(exactDuplicateKey('heart failure')).not.toBe(exactDuplicateKey('congestive heart failure'));
  });
  it('strips only SURROUNDING quotes — quotes inside a term are preserved', () => {
    expect(exactDuplicateKey('EUS "guided"')).toBe('eus "guided"');
    expect(exactDuplicateKey('EUS "guided"')).not.toBe(exactDuplicateKey('EUS guided'));
  });
  it('is deliberately NARROWER than the family-based termEquivalenceKey (invariant 7)', () => {
    // The family key collapses EUS ≡ endoscopic ultrasound; the exact key must not.
    expect(termEquivalenceKey('EUS')).toBe(termEquivalenceKey('endoscopic ultrasound'));
    expect(exactDuplicateKey('EUS')).not.toBe(exactDuplicateKey('endoscopic ultrasound'));
  });
  it("returns '' for blank/junk input", () => {
    expect(exactDuplicateKey('')).toBe('');
    expect(exactDuplicateKey('   ')).toBe('');
    expect(exactDuplicateKey(null)).toBe('');
    expect(exactDuplicateKey(undefined)).toBe('');
  });
});

describe('detectExactCrossGroupDuplicates', () => {
  const dupConcepts = () => [
    group('g1', 'Search Group 1', [term('t1', 'EUS'), term('t2', 'drainage')]),
    group('g2', 'Search Group 2', [term('t3', '"EUS"')]),
    group('g3', 'Search Group 3', [term('t4', 'mortality')]),
  ];
  it('flags every affected chip across AND groups (quote/case variants count as exact)', () => {
    const dups = detectExactCrossGroupDuplicates(dupConcepts());
    expect(dups).toHaveLength(1);
    expect(dups[0].id).toBe('exactdup:eus');
    expect(dups[0].key).toBe('eus');
    expect(dups[0].conceptIds).toEqual(['g1', 'g2']);
    expect(dups[0].suppressed).toBe(false);
    expect(dups[0].occurrences.map((o) => o.termId).sort()).toEqual(['t1', 't3']);
  });
  it('does not flag family variants (EUS vs endoscopic ultrasound) as exact', () => {
    const cs = [
      group('g1', 'A', [term('t1', 'EUS')]),
      group('g2', 'B', [term('t2', 'endoscopic ultrasound')]),
    ];
    expect(detectExactCrossGroupDuplicates(cs)).toEqual([]);
  });
  it('counts a key once per group and ignores disabled copies', () => {
    const sameGroup = [group('g1', 'A', [term('t1', 'EUS'), term('t2', 'eus')])];
    expect(detectExactCrossGroupDuplicates(sameGroup)).toEqual([]); // same-group case is separate
    const off = [
      group('g1', 'A', [term('t1', 'EUS')]),
      group('g2', 'B', [term('t2', 'eus', { disabled: true })]),
    ];
    expect(detectExactCrossGroupDuplicates(off)).toEqual([]);
  });
  it('tolerates junk input', () => {
    expect(detectExactCrossGroupDuplicates(null)).toEqual([]);
    expect(detectExactCrossGroupDuplicates([])).toEqual([]);
  });
});

describe('findExactDuplicateInConcept / groupsHoldingKey', () => {
  const c = group('g1', 'A', [term('t1', '"Heart Failure"'), term('t2', 'EUS')]);
  it('finds the existing exact term across quote/case variants (the "Find existing term" target)', () => {
    expect(findExactDuplicateInConcept(c, 'heart failure').id).toBe('t1');
    expect(findExactDuplicateInConcept(c, '“HEART FAILURE”').id).toBe('t1');
    expect(findExactDuplicateInConcept(c, 'congestive heart failure')).toBeNull();
  });
  it('excludes the asking term itself', () => {
    expect(findExactDuplicateInConcept(c, 'EUS', 't2')).toBeNull();
  });
  it('groupsHoldingKey returns sorted ids of live holders', () => {
    const cs = [
      group('b', 'B', [term('t1', 'EUS')]),
      group('a', 'A', [term('t2', '"eus"')]),
      group('c', 'C', [term('t3', 'eus', { disabled: true })]),
    ];
    expect(groupsHoldingKey(cs, 'eus')).toEqual(['a', 'b']);
    expect(groupsHoldingKey(cs, '')).toEqual([]);
  });
});

describe('dupOverride — "Keep both intentionally" (config-scoped, term-level)', () => {
  const base = () => [
    group('g1', 'Search Group 1', [term('t1', 'EUS')]),
    group('g2', 'Search Group 2', [term('t2', 'eus')]),
    group('g3', 'Search Group 3', [term('t3', 'mortality')]),
  ];

  it('applyDupOverride stamps { key, groups:[sorted ids] } on EVERY copy and records prevs for undo', () => {
    const { concepts, changed } = applyDupOverride(base(), 'eus');
    const o1 = concepts[0].terms[0].dupOverride;
    const o2 = concepts[1].terms[0].dupOverride;
    expect(o1).toEqual({ key: 'eus', groups: ['g1', 'g2'] });
    expect(o2).toEqual({ key: 'eus', groups: ['g1', 'g2'] });
    expect(changed).toEqual([
      { conceptId: 'g1', termId: 't1', prev: undefined },
      { conceptId: 'g2', termId: 't2', prev: undefined },
    ]);
    // no-op when already current (SAME array back, nothing to undo)
    const again = applyDupOverride(concepts, 'eus');
    expect(again.concepts).toBe(concepts);
    expect(again.changed).toEqual([]);
  });

  it('suppresses the exact warning while the configuration matches (and only then)', () => {
    const { concepts } = applyDupOverride(base(), 'eus');
    expect(dupOverrideActive(concepts, 'eus')).toBe(true);
    expect(detectExactCrossGroupDuplicates(concepts)).toEqual([]); // suppressed by default
    const withSuppressed = detectExactCrossGroupDuplicates(concepts, { includeSuppressed: true });
    expect(withSuppressed).toHaveLength(1);
    expect(withSuppressed[0].suppressed).toBe(true);
  });

  it('REEVALUATES: a third copy re-fires the warning (groups set changed)', () => {
    const { concepts } = applyDupOverride(base(), 'eus');
    const third = concepts.map((c) => (c.id === 'g3' ? { ...c, terms: [...c.terms, term('t9', 'EUS')] } : c));
    expect(dupOverrideActive(third, 'eus')).toBe(false);
    const dups = detectExactCrossGroupDuplicates(third);
    expect(dups).toHaveLength(1);
    expect(dups[0].conceptIds).toEqual(['g1', 'g2', 'g3']);
  });

  it('REEVALUATES: editing a copy’s text re-fires for the new configuration', () => {
    const { concepts } = applyDupOverride(base(), 'eus');
    // The user edits g2's copy to a different term — the override rides on a term
    // whose key no longer matches; only one 'eus' remains → nothing to warn about,
    // and re-creating the duplicate later warns afresh (override groups stale).
    const edited = concepts.map((c) => (c.id === 'g2'
      ? { ...c, terms: [{ ...c.terms[0], text: 'endosonography' }] }
      : c));
    expect(detectExactCrossGroupDuplicates(edited)).toEqual([]); // no pair left
    const recreated = edited.map((c) => (c.id === 'g3' ? { ...c, terms: [...c.terms, term('t9', 'EUS')] } : c));
    expect(dupOverrideActive(recreated, 'eus')).toBe(false); // g1's stale override ≠ {g1,g3}
    expect(detectExactCrossGroupDuplicates(recreated)).toHaveLength(1);
  });

  it('REEVALUATES: moving a copy to another group re-fires (sorted-set mismatch)', () => {
    const { concepts } = applyDupOverride(base(), 'eus');
    // simulate a move of g2's copy into g3 (term object rides along, override intact)
    const movedTerm = concepts[1].terms[0];
    const moved = concepts.map((c) => {
      if (c.id === 'g2') return { ...c, terms: [] };
      if (c.id === 'g3') return { ...c, terms: [...c.terms, movedTerm] };
      return c;
    });
    expect(dupOverrideActive(moved, 'eus')).toBe(false); // stored {g1,g2} ≠ current {g1,g3}
    expect(detectExactCrossGroupDuplicates(moved)).toHaveLength(1);
  });

  it('clearDupOverride deletes the field entirely (omit-when-absent hygiene) and reports prevs', () => {
    const { concepts } = applyDupOverride(base(), 'eus');
    const { concepts: cleared, changed } = clearDupOverride(concepts, 'eus');
    expect('dupOverride' in cleared[0].terms[0]).toBe(false);
    expect('dupOverride' in cleared[1].terms[0]).toBe(false);
    expect(changed.map((c) => c.termId).sort()).toEqual(['t1', 't2']);
    expect(changed[0].prev).toEqual({ key: 'eus', groups: ['g1', 'g2'] });
    expect(detectExactCrossGroupDuplicates(cleared)).toHaveLength(1); // warning is back
    // clearing again: SAME array, nothing changed
    const again = clearDupOverride(cleared, 'eus');
    expect(again.concepts).toBe(cleared);
    expect(again.changed).toEqual([]);
  });

  it('applyDupOverride is a calm no-op when fewer than two groups hold the key', () => {
    const single = [group('g1', 'A', [term('t1', 'EUS')])];
    const out = applyDupOverride(single, 'eus');
    expect(out.concepts).toBe(single);
    expect(out.changed).toEqual([]);
  });
});

describe('classifyCrossGroupDuplicates — exact vs demoted "Possible variant"', () => {
  it('family variants (EUS vs endoscopic ultrasound) are a VARIANT, never exact', () => {
    const cs = [
      group('g1', 'A', [term('t1', 'EUS')]),
      group('g2', 'B', [term('t2', 'endoscopic ultrasound')]),
    ];
    const { exact, variants } = classifyCrossGroupDuplicates(cs);
    expect(exact).toEqual([]);
    expect(variants).toHaveLength(1);
    expect(variants[0].id).toBe('multi:fam:eus'); // invariant 7 — persisted id format unchanged
    expect(variants[0].equivKey).toBe('fam:eus');
  });
  it('exact duplicates are EXACT and not double-reported as variants', () => {
    const cs = [
      group('g1', 'A', [term('t1', 'EUS')]),
      group('g2', 'B', [term('t2', '"EUS"')]),
    ];
    const { exact, variants } = classifyCrossGroupDuplicates(cs);
    expect(exact).toHaveLength(1);
    expect(exact[0].key).toBe('eus');
    expect(variants).toEqual([]); // one exact key — the family entry is the exact path's job
  });
  it('a mixed family (two exact copies + a variant) reports BOTH signals', () => {
    const cs = [
      group('g1', 'A', [term('t1', 'EUS')]),
      group('g2', 'B', [term('t2', 'eus')]),
      group('g3', 'C', [term('t3', 'endoscopic ultrasound')]),
    ];
    const { exact, variants } = classifyCrossGroupDuplicates(cs);
    expect(exact).toHaveLength(1);
    expect(exact[0].conceptIds).toEqual(['g1', 'g2']);
    expect(variants).toHaveLength(1);
    expect(variants[0].occurrences).toHaveLength(3);
  });
  it('existing persisted multi:<equivKey> dismissals keep suppressing ONLY the softer variant signal', () => {
    const cs = [
      group('g1', 'A', [term('t1', 'EUS')]),
      group('g2', 'B', [term('t2', 'endoscopic ultrasound')]),
      group('g3', 'C', [term('t3', 'eus')]),
    ];
    const { exact, variants } = classifyCrossGroupDuplicates(cs, { dismissed: ['multi:fam:eus'] });
    expect(variants).toEqual([]);          // soft signal dismissed
    expect(exact).toHaveLength(1);         // dark-red exact path unaffected
    expect(exact[0].conceptIds).toEqual(['g1', 'g3']);
  });
});

/* ══════════════ 97 QA M18 — the duplicate model is TERM-TYPE-AWARE ═══════════ */
import {
  termTypeClass, termDuplicateKey, candidateDuplicateKey,
} from '../../src/research-engine/searchBuilder/exactDuplicate.js';

describe('QA M18 — termDuplicateKey / candidateDuplicateKey (type-aware exactness)', () => {
  const mesh = (id, text, descriptor, extra = {}) => ({
    id, text, type: 'controlled', field: 'tiab', source: 'user_added',
    vocab: { mesh: descriptor || text, meshUI: 'D000000' }, ...extra,
  });

  it('free-text keys are unchanged (bare conservative key — persisted ids stable)', () => {
    expect(termDuplicateKey(term('t1', 'EUS'))).toBe('eus');
    expect(termDuplicateKey(term('t1', '"Heart Failure"[Mesh]'))).toBe('heart failure');
  });
  it('controlled terms key on their DESCRIPTOR with a mesh: prefix', () => {
    expect(termDuplicateKey(mesh('m1', 'heart failure', 'Heart Failure'))).toBe('mesh:heart failure');
    // Two controlled copies whose typed texts differ still collide via the descriptor.
    expect(termDuplicateKey(mesh('m2', 'cardiac failure', 'Heart Failure'))).toBe('mesh:heart failure');
  });
  it('termTypeClass distinguishes the two classes', () => {
    expect(termTypeClass(mesh('m1', 'x'))).toBe('controlled');
    expect(termTypeClass(term('t1', 'x'))).toBe('freetext');
  });
  it('candidateDuplicateKey defaults to freetext and honors a controlled candidate', () => {
    expect(candidateDuplicateKey('EUS')).toBe('eus');
    expect(candidateDuplicateKey('heart failure', 'controlled')).toBe('mesh:heart failure');
    expect(candidateDuplicateKey('hf', { type: 'controlled', vocab: { mesh: 'Heart Failure' } })).toBe('mesh:heart failure');
  });

  it('MeSH + same-label free text in ONE group is NOT an exact in-group duplicate (the standard Phase-13 pattern)', () => {
    // Prevention: adding the free-text form next to a MeSH-only copy is ALLOWED…
    const meshOnly = group('g1', 'A', [mesh('m1', 'Heart Failure')]);
    expect(findExactDuplicateInConcept(meshOnly, 'heart failure')).toBeNull();
    // …and a second MeSH copy is still blocked against the existing MeSH copy.
    expect(findExactDuplicateInConcept(meshOnly, 'Heart Failure', undefined, 'controlled').id).toBe('m1');
    // With BOTH forms present, a further free-text copy blocks against the free-text one.
    const both = group('g1', 'A', [mesh('m1', 'Heart Failure'), term('t1', 'heart failure')]);
    expect(findExactDuplicateInConcept(both, '"heart failure"').id).toBe('t1');
  });

  it('MeSH vs free-text across AND groups is NOT exact — it demotes to the soft variant signal', () => {
    const cs = [
      group('g1', 'A', [mesh('m1', 'Heart Failure')]),
      group('g2', 'B', [term('t1', 'heart failure')]),
    ];
    expect(detectExactCrossGroupDuplicates(cs)).toEqual([]);
    const { exact, variants } = classifyCrossGroupDuplicates(cs, {});
    expect(exact).toEqual([]);
    expect(variants.length).toBe(1); // soft, non-blocking "Possible variant"
  });

  it('two controlled copies of one heading across groups ARE exact', () => {
    const cs = [
      group('g1', 'A', [mesh('m1', 'heart failure', 'Heart Failure')]),
      group('g2', 'B', [mesh('m2', 'HF', 'Heart Failure')]),
    ];
    const dups = detectExactCrossGroupDuplicates(cs);
    expect(dups).toHaveLength(1);
    expect(dups[0].key).toBe('mesh:heart failure');
    expect(dups[0].conceptIds).toEqual(['g1', 'g2']);
  });

  it('dupOverride round-trips on the type-aware key', () => {
    const cs = [
      group('g1', 'A', [mesh('m1', 'Heart Failure')]),
      group('g2', 'B', [mesh('m2', 'Heart Failure')]),
    ];
    const { concepts: next, changed } = applyDupOverride(cs, 'mesh:heart failure');
    expect(changed).toHaveLength(2);
    expect(dupOverrideActive(next, 'mesh:heart failure', ['g1', 'g2'])).toBe(true);
  });
});
