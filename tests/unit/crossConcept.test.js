/**
 * crossConcept.test.js — SB4 Parts 4/8/9. Term-equivalence + cross-concept duplicate
 * detection, the Search Quality Check foundation, and the sensitivity signal.
 */
import { describe, it, expect } from 'vitest';
import {
  termEquivalenceKey, detectCrossConceptDuplicates, searchQualityCheck, sensitivitySignal,
} from '../../src/research-engine/searchBuilder/crossConcept.js';

const concept = (picoField, label, ...terms) => ({
  id: `c-${picoField || label}`, label, picoField: picoField || null,
  terms: terms.map((t, i) => (typeof t === 'string' ? { id: `${label}-${i}`, text: t, type: 'freetext' } : { id: `${label}-${i}`, type: 'freetext', ...t })),
});

describe('termEquivalenceKey', () => {
  it('collapses acronyms and expansions of the same family to one key', () => {
    expect(termEquivalenceKey('EUS')).toBe(termEquivalenceKey('endoscopic ultrasound'));
    expect(termEquivalenceKey('T2DM')).toBe(termEquivalenceKey('type 2 diabetes mellitus'));
    expect(termEquivalenceKey('EUS')).toBe('fam:eus');
  });
  it('falls back to normalized text for non-family terms', () => {
    expect(termEquivalenceKey('widget score')).toBe('widget score');
    expect(termEquivalenceKey('')).toBe('');
  });
});

describe('detectCrossConceptDuplicates', () => {
  it('flags an equivalent term living in two concepts (EUS ≡ endoscopic ultrasound)', () => {
    const concepts = [
      concept('P', 'Population', 'endoscopic ultrasound'),
      concept('I', 'Intervention / Exposure', 'EUS'),
      concept('O', 'Outcomes', 'mortality'),
    ];
    const dups = detectCrossConceptDuplicates(concepts);
    expect(dups.length).toBe(1);
    expect(dups[0].equivKey).toBe('fam:eus');
    expect(dups[0].occurrences.map((o) => o.picoField).sort()).toEqual(['I', 'P']);
  });
  it('does not flag distinct terms', () => {
    const concepts = [
      concept('P', 'Population', 'malignant biliary obstruction'),
      concept('I', 'Intervention / Exposure', 'transpapillary biliary drainage'),
      concept('C', 'Comparator / Control', 'transluminal biliary drainage'),
    ];
    expect(detectCrossConceptDuplicates(concepts)).toEqual([]);
  });
  it('counts an equivalence key once per concept (no self-duplicate)', () => {
    const concepts = [concept('P', 'Population', 'EUS', 'endoscopic ultrasound')]; // same family, one concept
    expect(detectCrossConceptDuplicates(concepts)).toEqual([]);
  });
});

describe('searchQualityCheck', () => {
  const concepts = [
    concept('P', 'Population', 'endoscopic ultrasound'),
    concept('I', 'Intervention / Exposure', 'EUS'),
    concept(null, 'Outcomes'), // empty USER-CREATED concept (no picoField)
  ];

  it('warns about a term in more than one concept', () => {
    const ids = searchQualityCheck(concepts).map((x) => x.id);
    expect(ids).toContain('multi:fam:eus');
  });
  /* 96.md D4 — the empty-group check is GENERIC now: every USER-CREATED concept
     group with zero live terms warns (id `empty:<conceptId>`) once 2+ groups
     exist, because an empty group silently drops out of the AND chain. The old
     PICO pedagogy (empty:P/empty:I as special, outcomes-optional, narrow:C/O) is
     deleted, and (QA L23) legacy PICO scaffold groups are exempt — see below. */
  it('warns per empty USER-CREATED concept group (empty:<conceptId>) when 2+ groups exist', () => {
    const w = searchQualityCheck(concepts).find((x) => x.id === 'empty:c-Outcomes');
    expect(w).toBeTruthy();
    expect(w.severity).toBe('warning');
    expect(w.conceptId).toBe('c-Outcomes');
    // the retired PICO-keyed ids never fire again
    const ids = searchQualityCheck(concepts).map((x) => x.id);
    expect(ids).not.toContain('outcomes-optional');
    expect(ids).not.toContain('empty:O');
    expect(ids).not.toContain('narrow:O');
  });
  /* 96.md QA L23 — a migrated five-group PICO scaffold keeps intentionally-empty
     C/O/T groups; those must NOT wake historical projects up with warnings. Both
     legacy markers (picoField / source 'pico_auto') exempt; user groups still warn. */
  it('L23: legacy PICO scaffold groups (picoField / pico_auto) with zero terms are EXEMPT', () => {
    const legacy = [
      concept('P', 'Population', 'heart failure'),
      concept('I', 'Intervention / Exposure', 'metformin'),
      { id: 'c-C', label: 'Comparator / Control', picoField: 'C', source: 'pico_auto', terms: [] },
      { id: 'c-O2', label: 'Outcomes', picoField: 'O', source: 'pico_auto', terms: [] },
      { id: 'c-L', label: 'Legacy concepts-era', field: 'Outcomes', source: 'pico_auto', terms: [] }, // no picoField, legacy source
    ];
    const ids = searchQualityCheck(legacy).map((x) => x.id);
    expect(ids.filter((x) => x.startsWith('empty:'))).toEqual([]);
  });
  it('L23: a user-created empty group STILL warns next to legacy scaffolds', () => {
    const mixed = [
      { id: 'c-P', label: 'Population', picoField: 'P', source: 'pico_auto', terms: [{ id: 't', text: 'adults', type: 'freetext' }] },
      { id: 'c-C', label: 'Comparator / Control', picoField: 'C', source: 'pico_auto', terms: [] }, // legacy — silent
      { id: 'u1', label: 'Setting', source: 'user_added', terms: [] },                              // user — warns
    ];
    const ids = searchQualityCheck(mixed).map((x) => x.id);
    expect(ids).toContain('empty:u1');
    expect(ids).not.toContain('empty:c-C');
  });
  it('a SINGLE empty group is the just-started state — no warning', () => {
    expect(searchQualityCheck([{ id: 'p1', label: 'Heart failure', terms: [] }])
      .some((x) => x.id.startsWith('empty:'))).toBe(false);
  });
  it('a note-carrying group (legacy Time Frame) is exempt from the empty check', () => {
    const cs = [
      concept(null, 'Heart failure', 'heart failure'),
      { id: 'c-T', label: 'Time Frame', picoField: 'T', note: 'Last 5 years', terms: [] },
    ];
    expect(searchQualityCheck(cs).some((x) => x.id.startsWith('empty:'))).toBe(false);
  });
  it('warns when a concept with terms has no controlled vocabulary (novocab:<conceptId>)', () => {
    const ids = searchQualityCheck(concepts).map((x) => x.id);
    expect(ids).toContain('novocab:c-P');
    expect(ids).toContain('novocab:c-I');
    expect(ids).not.toContain('novocab:P'); // retired PICO-keyed id
  });
  it('does not warn novocab when a controlled (MeSH) term is present', () => {
    const withMesh = [concept('P', 'Population', { text: 'Obesity', type: 'controlled' })];
    expect(searchQualityCheck(withMesh).map((x) => x.id)).not.toContain('novocab:c-P');
  });
  it('tolerates legacy dismissed ids (empty:P etc.) as harmless orphans', () => {
    // Old persisted dismissals simply never match a current finding id.
    const out = searchQualityCheck(concepts, { dismissed: ['empty:P', 'novocab:P', 'narrow:O', 'outcomes-optional'] });
    expect(out.map((x) => x.id)).toContain('empty:c-Outcomes'); // current findings unaffected
  });
  it('respects dismissed warning ids', () => {
    const all = searchQualityCheck(concepts);
    const dismissed = ['multi:fam:eus'];
    const after = searchQualityCheck(concepts, { dismissed });
    expect(all.map((x) => x.id)).toContain('multi:fam:eus');
    expect(after.map((x) => x.id)).not.toContain('multi:fam:eus');
  });
  it('orders critical → warning → info', () => {
    const sev = searchQualityCheck(concepts).map((x) => x.severity);
    const rank = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < sev.length; i++) expect(rank[sev[i]]).toBeGreaterThanOrEqual(rank[sev[i - 1]]);
  });
  it('tolerates empty / missing input', () => {
    expect(searchQualityCheck(null)).toEqual([]);
    expect(searchQualityCheck([])).toEqual([]);
  });
});

/* ── 85.md A1 — literal Boolean operator inside a term ───────────────────────── */

describe('searchQualityCheck — literal AND/OR inside a term (85.md A1)', () => {
  it('warns (with an action) when a term contains a standalone uppercase operator', () => {
    const cs = [concept('P', 'Population', 'stroke OR transient ischemic attack')];
    const w = searchQualityCheck(cs).find((x) => x.id.startsWith('boolop:'));
    expect(w).toBeTruthy();
    expect(w.severity).toBe('warning');
    expect(w.message).toMatch(/literal words/i);
    expect(w.action).toMatch(/split/i);
    expect(w.id).toBe(`boolop:c-P:${'stroke or transient ischemic attack'}`);
  });
  it('does NOT flag lowercase connectors or single-word terms', () => {
    const clean = [concept('P', 'Population', 'signs and symptoms', 'AND')];
    expect(searchQualityCheck(clean).some((x) => x.id.startsWith('boolop:'))).toBe(false);
  });
  it('ignores disabled terms and respects dismissal', () => {
    const off = [concept('P', 'Population', { text: 'a OR b', disabled: true })];
    expect(searchQualityCheck(off).some((x) => x.id.startsWith('boolop:'))).toBe(false);
    const cs = [concept('P', 'Population', 'a OR b')];
    const id = searchQualityCheck(cs).find((x) => x.id.startsWith('boolop:')).id;
    expect(searchQualityCheck(cs, { dismissed: [id] }).some((x) => x.id.startsWith('boolop:'))).toBe(false);
  });
});

/* ── 85.md A1 — within-concept duplicate ─────────────────────────────────────── */

describe('searchQualityCheck — within-concept duplicate (85.md A1)', () => {
  it('warns when the same equivalence key appears twice in ONE concept', () => {
    const cs = [concept('I', 'Intervention / Exposure', 'EUS', 'endoscopic ultrasound')];
    const w = searchQualityCheck(cs).find((x) => x.id.startsWith('dupin:'));
    expect(w).toBeTruthy();
    expect(w.severity).toBe('warning');
    expect(w.id).toBe('dupin:c-I:fam:eus');
    expect(w.message).toContain('duplicates');
    expect(w.action).toMatch(/remove/i);
    // …and the cross-concept pass still does NOT fire (one concept only)
    expect(searchQualityCheck(cs).some((x) => x.id === 'multi:fam:eus')).toBe(false);
  });
  it('does not warn for distinct terms, disabled copies, or across concepts', () => {
    expect(searchQualityCheck([concept('I', 'Intervention / Exposure', 'EUS', 'drainage')])
      .some((x) => x.id.startsWith('dupin:'))).toBe(false);
    expect(searchQualityCheck([concept('I', 'Intervention / Exposure', 'EUS', { text: 'endoscopic ultrasound', disabled: true })])
      .some((x) => x.id.startsWith('dupin:'))).toBe(false);
    expect(searchQualityCheck([concept('P', 'Population', 'EUS'), concept('I', 'Intervention / Exposure', 'endoscopic ultrasound')])
      .some((x) => x.id.startsWith('dupin:'))).toBe(false);
  });
  it('is dismissible by id', () => {
    const cs = [concept('I', 'Intervention / Exposure', 'EUS', 'endoscopic ultrasound')];
    expect(searchQualityCheck(cs, { dismissed: ['dupin:c-I:fam:eus'] }).some((x) => x.id.startsWith('dupin:'))).toBe(false);
  });
});

describe('sensitivitySignal', () => {
  it('buckets counts into breadth labels', () => {
    expect(sensitivitySignal(80000).key).toBe('very-broad');
    expect(sensitivitySignal(20000).key).toBe('broad');
    expect(sensitivitySignal(300).key).toBe('balanced');
    expect(sensitivitySignal(50).key).toBe('narrow');
    expect(sensitivitySignal(5).key).toBe('very-narrow');
  });
  it('returns null for unknown counts (no fabricated number)', () => {
    expect(sensitivitySignal(null)).toBeNull();
    expect(sensitivitySignal(undefined)).toBeNull();
    expect(sensitivitySignal(NaN)).toBeNull();
  });
});
