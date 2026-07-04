/**
 * records.test.js — canonical extraction RECORD + mkStudy bridges.
 * Covers: record defaults + numeric-to-string coercion, recordToStudy string
 * typing / source mapping / protection rule (base human value wins), confirmDraft
 * new-study and merge-into-base paths (input immutability), park/unpark scope
 * rules, and completeness for the three value families.
 */

import { describe, it, expect } from 'vitest';
import {
  mkExtractionRecord,
  recordToStudy,
  confirmDraft,
  parkRecord,
  unparkToDraft,
  recordCompleteness,
  VALUE_FIELDS,
  SCOPE_LEVELS,
  PROVENANCE_METHODS,
  CONFIDENCE_LEVELS,
} from '../../../src/research-engine/extraction/records.js';

const seqIdFn = () => {
  let i = 0;
  return () => `id${++i}`;
};

/** A fully-populated draft used across the bridge tests. */
const mkDraft = (over = {}) =>
  mkExtractionRecord(
    {
      id: 'rec1',
      author: 'Smith',
      year: 2020,
      outcome: 'Mortality',
      timepoint: '12 weeks',
      comparison: 'Placebo',
      esType: 'OR',
      scope: { level: 'primary', outcomeId: 'out1', canonical: true },
      values: { a: 12, b: 88, c: 20, d: 80, es: -0.62, lo: -1.1, hi: -0.14 },
      provenance: { method: 'table', page: 4, excerpt: 'Table 2', at: '2026-07-03T10:00:00.000Z' },
      confidence: 'medium',
      conversions: [{ id: 'cv1', target: 'es', method: 'log(OR)' }],
      ...over,
    },
    () => 'rec1',
  );

describe('mkExtractionRecord', () => {
  it('fills sane defaults and honors an injectable idFn', () => {
    const r = mkExtractionRecord({}, () => 'fixed123');
    expect(r.id).toBe('fixed123');
    expect(r.draft).toBe(true);
    expect(r.author).toBe('');
    expect(r.year).toBe('');
    expect(r.outcome).toBe('');
    expect(r.timepoint).toBe('');
    expect(r.comparison).toBe('');
    expect(r.esType).toBe('');
    expect(r.scope).toEqual({ level: 'other', outcomeId: '', canonical: false, canonicalName: '' });
    expect(Object.keys(r.values).sort()).toEqual([...VALUE_FIELDS].sort());
    for (const f of VALUE_FIELDS) expect(r.values[f]).toBe('');
    expect(r.provenance).toEqual({ method: 'manual', page: null, region: null, excerpt: '', at: '' });
    expect(r.confidence).toBe('low');
    expect(r.alternates).toEqual([]);
    expect(r.conversions).toEqual([]);
    expect(r.needsReview).toBe(true);
    expect(r.notes).toBe('');
  });

  it('generates an 8-char id by default (repo uid pattern)', () => {
    const r = mkExtractionRecord();
    expect(typeof r.id).toBe('string');
    expect(r.id.length).toBeGreaterThanOrEqual(6);
    expect(r.id.length).toBeLessThanOrEqual(8);
  });

  it('coerces numeric values to strings with full precision', () => {
    const r = mkExtractionRecord(
      { year: 2019, values: { n: 120, es: -0.4215, lo: -0.9, hi: 0, a: '15' } },
      () => 'a',
    );
    expect(r.year).toBe('2019');
    expect(r.values.n).toBe('120');
    expect(r.values.es).toBe('-0.4215');
    expect(r.values.lo).toBe('-0.9');
    expect(r.values.hi).toBe('0'); // zero is a value, not empty
    expect(r.values.a).toBe('15');
    expect(r.values.b).toBe(''); // untouched slots stay empty strings
  });

  it('falls back on invalid enum values and ignores unknown keys', () => {
    const r = mkExtractionRecord(
      {
        scope: { level: 'weird', outcomeId: 'o1' },
        provenance: { method: 'guess', page: 'x' },
        confidence: 'huge',
        bogusTop: 1,
        values: { bogus: 9, a: 1 },
      },
      () => 'a',
    );
    expect(r.scope.level).toBe('other');
    expect(r.scope.outcomeId).toBe('o1');
    expect(r.provenance.method).toBe('manual');
    expect(r.provenance.page).toBeNull();
    expect(r.confidence).toBe('low');
    expect(r).not.toHaveProperty('bogusTop');
    expect(r.values).not.toHaveProperty('bogus');
    expect(r.values.a).toBe('1');
  });

  it('normalizes provenance page + region', () => {
    const full = mkExtractionRecord(
      { provenance: { method: 'click', page: '7', region: { x0: '1', y0: 2, x1: 3.5, y1: 4 } } },
      () => 'a',
    );
    expect(full.provenance.page).toBe(7);
    expect(full.provenance.region).toEqual({ x0: 1, y0: 2, x1: 3.5, y1: 4 });

    const partial = mkExtractionRecord({ provenance: { region: { x0: 1, y0: 2 } } }, () => 'a');
    expect(partial.provenance.region).toBeNull();
  });

  it('deep-copies alternates/conversions (later input mutation cannot leak in)', () => {
    const conversions = [{ id: 'c1', target: 'es' }];
    const r = mkExtractionRecord({ conversions, alternates: [{ es: '0.1' }] }, () => 'a');
    conversions[0].target = 'MUTATED';
    expect(r.conversions[0].target).toBe('es');
    r.alternates[0].es = 'changed';
    expect(r.alternates[0].es).toBe('changed'); // its own copy, detached from input
  });

  it('exposes the enum constants', () => {
    expect(SCOPE_LEVELS).toEqual(['primary', 'secondary', 'other']);
    expect(PROVENANCE_METHODS).toContain('manual');
    expect(CONFIDENCE_LEVELS).toEqual(['high', 'medium', 'low']);
  });

  it('carries sourceStudyId and extractedBy (default empty)', () => {
    const bare = mkExtractionRecord({}, () => 'a');
    expect(bare.sourceStudyId).toBe('');
    expect(bare.extractedBy).toBe('');
    const filled = mkExtractionRecord({ sourceStudyId: 'src9', extractedBy: 'Reviewer A' }, () => 'a');
    expect(filled.sourceStudyId).toBe('src9');
    expect(filled.extractedBy).toBe('Reviewer A');
  });

  it('preserves scope.canonicalName (the outcome NAME) alongside the boolean flag', () => {
    // A string canonical sets BOTH the boolean (truthy) and the distinct name field.
    const fromString = mkExtractionRecord({ scope: { level: 'primary', outcomeId: 'p1', canonical: 'all-cause mortality' } }, () => 'a');
    expect(fromString.scope.canonical).toBe(true);
    expect(fromString.scope.canonicalName).toBe('all-cause mortality');

    // An explicit canonicalName wins and coexists with a boolean canonical.
    const both = mkExtractionRecord({ scope: { level: 'primary', outcomeId: 'p1', canonical: true, canonicalName: 'stroke' } }, () => 'a');
    expect(both.scope.canonical).toBe(true);
    expect(both.scope.canonicalName).toBe('stroke');

    // A boolean-only canonical yields an empty name (no fabrication).
    const boolOnly = mkExtractionRecord({ scope: { level: 'primary', outcomeId: 'p1', canonical: true } }, () => 'a');
    expect(boolOnly.scope.canonicalName).toBe('');
  });
});

describe('recordToStudy', () => {
  it('produces an mkStudy-shaped row with string-typed values from a bare record', () => {
    const { study, overwrites } = recordToStudy(mkDraft());
    expect(overwrites).toEqual([]);
    // mkStudy shape markers
    expect(typeof study.id).toBe('string');
    expect(study.design).toBe('RCT');
    expect(study.title).toBe('');
    // bridged fields, all strings
    expect(study.author).toBe('Smith');
    expect(study.year).toBe('2020');
    expect(study.outcome).toBe('Mortality');
    expect(study.timepoint).toBe('12 weeks');
    expect(study.esType).toBe('OR');
    expect(study.comparatorDef).toBe('Placebo');
    expect(study.a).toBe('12');
    expect(study.d).toBe('80');
    expect(study.es).toBe('-0.62');
    expect(study.lo).toBe('-1.1');
    expect(study.hi).toBe('-0.14');
    for (const f of ['a', 'b', 'c', 'd', 'es', 'lo', 'hi']) expect(typeof study[f]).toBe('string');
    // provenance carry
    expect(study.needsReview).toBe(true);
    expect(study.extractedAt).toBe('2026-07-03T10:00:00.000Z');
    expect(study.scope).toEqual({ level: 'primary', outcomeId: 'out1', canonical: true, canonicalName: '' });
    expect(study.provenance.method).toBe('table');
    expect(study.conversions).toEqual([{ id: 'cv1', target: 'es', method: 'log(OR)' }]);
    expect(study.converted).toBe(true);
  });

  it('maps provenance.method onto study.source (manual leaves it alone)', () => {
    const cases = [
      ['table', 'table'],
      ['figure', 'figure'],
      ['click', 'text'],
      ['auto', 'text'],
      ['ai', 'text'],
      ['manual', ''],
    ];
    for (const [method, source] of cases) {
      const { study } = recordToStudy(mkDraft({ provenance: { method } }));
      expect(study.source, `method ${method}`).toBe(source);
    }
  });

  it('never overwrites a non-empty base field with an empty record value', () => {
    const base = { id: 's1', author: 'Jones', year: '2018', es: '0.5', lo: '', hi: '', n: '200', notes: '' };
    const draft = mkDraft({ author: '', year: '', values: { es: '', lo: '-0.1', hi: '1.1' } });
    const { study, overwrites } = recordToStudy(draft, base);
    expect(study.author).toBe('Jones'); // empty record value → base kept
    expect(study.year).toBe('2018');
    expect(study.es).toBe('0.5');
    expect(study.lo).toBe('-0.1'); // empty base → filled
    expect(study.hi).toBe('1.1');
    expect(overwrites).not.toContain('es');
    expect(overwrites).not.toContain('author');
  });

  it('keeps the base human value on conflict, appends a note, and reports the field', () => {
    const base = { id: 's1', author: 'Smith', n: '120', es: '', lo: '', hi: '', notes: 'human note' };
    const draft = mkDraft({ values: { n: '118', es: '-0.62', lo: '-1.1', hi: '-0.14' } });
    const { study, overwrites } = recordToStudy(draft, base);
    expect(study.n).toBe('120'); // base wins
    expect(overwrites).toContain('n');
    expect(study.notes).toMatch(/human note/);
    expect(study.notes).toMatch(/kept n="120"/);
    expect(study.notes).toMatch(/extracted "118"/);
    expect(study.es).toBe('-0.62'); // empty base slots still filled
  });

  it('inherits base citation + screening linkage fields and never mutates the base', () => {
    const base = {
      id: 's1', author: 'Lee', year: '2019', title: 'A trial', authors: 'Lee, Kim',
      journal: 'NEJM', doi: '10.1/x', pmid: '123', abstract: 'Abs', country: 'KR', design: 'RCT',
      screeningRecordId: 'sr9', screeningProjectId: 'sp3',
      conversions: [{ id: 'old', target: 'es' }], notes: '', es: '', lo: '', hi: '',
    };
    const frozen = JSON.parse(JSON.stringify(base));
    const { study } = recordToStudy(mkDraft({ author: 'Lee', year: 2019 }), base);
    expect(study.title).toBe('A trial');
    expect(study.journal).toBe('NEJM');
    expect(study.doi).toBe('10.1/x');
    expect(study.pmid).toBe('123');
    expect(study.abstract).toBe('Abs');
    expect(study.country).toBe('KR');
    expect(study.design).toBe('RCT');
    expect(study.screeningRecordId).toBe('sr9');
    expect(study.screeningProjectId).toBe('sp3');
    // conversions appended, never replaced
    expect(study.conversions.map((c) => c.id)).toEqual(['old', 'cv1']);
    // input untouched
    expect(base).toEqual(frozen);
  });

  it('survives malformed input', () => {
    const { study, overwrites } = recordToStudy(null);
    expect(overwrites).toEqual([]);
    expect(study.needsReview).toBe(true);
    expect(study.es).toBe('');
  });

  it('writes extractedBy onto the study but never overwrites a non-empty existing value', () => {
    // Empty base extractedBy → filled from the record.
    const fill = recordToStudy(mkDraft({ extractedBy: 'Reviewer A' }), { id: 's1', extractedBy: '' });
    expect(fill.study.extractedBy).toBe('Reviewer A');
    // Non-empty base extractedBy → kept (record does not clobber it).
    const keep = recordToStudy(mkDraft({ extractedBy: 'Reviewer A' }), { id: 's1', extractedBy: 'Original Curator' });
    expect(keep.study.extractedBy).toBe('Original Curator');
  });

  it('preserves scope.canonicalName through the study bridge', () => {
    const draft = mkDraft({ scope: { level: 'primary', outcomeId: 'p1', canonical: 'stroke' } });
    const { study } = recordToStudy(draft);
    expect(study.scope.canonicalName).toBe('stroke');
    expect(study.scope.canonical).toBe(true);
  });
});

describe('confirmDraft', () => {
  const at = '2026-07-03T11:00:00.000Z';

  it('appends a new mkStudy-shaped study and removes the draft', () => {
    const state = { studies: [], drafts: [mkDraft()] };
    const out = confirmDraft(state, 'rec1', { at });
    expect(out.ok).toBe(true);
    expect(out.studies).toHaveLength(1);
    expect(out.drafts).toHaveLength(0);
    expect(out.study.author).toBe('Smith');
    expect(out.study.a).toBe('12');
    expect(out.study.addedAt).toBe(at);
    expect(out.study.updatedAt).toBe(at);
    expect(out.study.extractedAt).toBe('2026-07-03T10:00:00.000Z'); // provenance.at wins
    expect(out.study.needsReview).toBe(true);
  });

  it('merges into a copy of the base study, filling only empty fields', () => {
    const base = { id: 's1', author: 'Smith', year: '', n: '120', es: '', lo: '', hi: '', notes: '' };
    const draft = mkDraft({ values: { n: '118', es: '-0.62', lo: '-1.1', hi: '-0.14' } });
    const state = { studies: [base], drafts: [draft] };
    const frozen = JSON.parse(JSON.stringify(state));

    const out = confirmDraft(state, 'rec1', { at, baseStudyId: 's1' });
    expect(out.ok).toBe(true);
    expect(out.studies).toHaveLength(1); // merged, not appended
    expect(out.study.id).toBe('s1');
    expect(out.study.year).toBe('2020'); // empty base slot filled
    expect(out.study.n).toBe('120'); // conflicting base value kept
    expect(out.study.notes).toMatch(/kept n="120"/);
    expect(out.study.es).toBe('-0.62');
    expect(out.study.updatedAt).toBe(at);
    expect(out.drafts).toHaveLength(0);
    // originals unchanged
    expect(state).toEqual(frozen);
  });

  it('appends as new when baseStudyId does not match any study', () => {
    const state = { studies: [{ id: 'other' }], drafts: [mkDraft()] };
    const out = confirmDraft(state, 'rec1', { at, baseStudyId: 'nope' });
    expect(out.ok).toBe(true);
    expect(out.studies).toHaveLength(2);
    expect(out.studies[1].author).toBe('Smith');
  });

  it('returns ok:false (and untouched copies) for an unknown draft id', () => {
    const state = { studies: [], drafts: [mkDraft()] };
    const out = confirmDraft(state, 'missing', { at });
    expect(out.ok).toBe(false);
    expect(out.study).toBeNull();
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts).not.toBe(state.drafts); // still a copy
  });
});

describe('parkRecord / unparkToDraft', () => {
  const at = '2026-07-03T12:00:00.000Z';

  it('parks a draft: moved, draft:false, scope.level forced to other', () => {
    const state = { drafts: [mkDraft()], parked: [] };
    const frozen = JSON.parse(JSON.stringify(state));
    const out = parkRecord(state, 'rec1', { at });
    expect(out.ok).toBe(true);
    expect(out.drafts).toHaveLength(0);
    expect(out.parked).toHaveLength(1);
    expect(out.parked[0].draft).toBe(false);
    expect(out.parked[0].scope.level).toBe('other');
    expect(out.parked[0].scope.outcomeId).toBe('out1'); // remembered for later unpark
    expect(out.parked[0].parkedAt).toBe(at);
    expect(state).toEqual(frozen); // inputs never mutated
  });

  it('park returns ok:false for an unknown draft id', () => {
    const out = parkRecord({ drafts: [mkDraft()], parked: [] }, 'nope', { at });
    expect(out.ok).toBe(false);
    expect(out.drafts).toHaveLength(1);
    expect(out.parked).toHaveLength(0);
  });

  it('unpark refuses scope.level "other" and a missing outcomeId', () => {
    const parked = [{ ...mkDraft(), draft: false }];
    const refusedOther = unparkToDraft({ parked, drafts: [] }, 'rec1', {
      scope: { level: 'other', outcomeId: 'out1' },
    });
    expect(refusedOther.ok).toBe(false);
    expect(refusedOther.parked).toHaveLength(1); // record stays parked

    const refusedNoOutcome = unparkToDraft({ parked, drafts: [] }, 'rec1', {
      scope: { level: 'primary' },
    });
    expect(refusedNoOutcome.ok).toBe(false);

    const refusedNoScope = unparkToDraft({ parked, drafts: [] }, 'rec1', {});
    expect(refusedNoScope.ok).toBe(false);
  });

  it('unparks with a real protocol scope (primary/secondary + outcomeId)', () => {
    const parkedRec = { ...mkDraft(), draft: false, parkedAt: at };
    const out = unparkToDraft({ parked: [parkedRec], drafts: [] }, 'rec1', {
      scope: { level: 'secondary', outcomeId: 'out7' },
    });
    expect(out.ok).toBe(true);
    expect(out.parked).toHaveLength(0);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0].draft).toBe(true);
    expect(out.drafts[0].scope).toEqual({ level: 'secondary', outcomeId: 'out7', canonical: true, canonicalName: '' });
    expect(out.drafts[0]).not.toHaveProperty('parkedAt');
  });

  it('unpark returns ok:false for an unknown record id even with a valid scope', () => {
    const out = unparkToDraft({ parked: [], drafts: [] }, 'ghost', {
      scope: { level: 'primary', outcomeId: 'out1' },
    });
    expect(out.ok).toBe(false);
  });

  it('unpark gives an off-protocol (empty-outcome) record the chosen outcome NAME so it is confirmable', () => {
    // Auto-parked "also reported" stats carry outcome:'' — unparking must set the name.
    const parkedRec = { ...mkDraft(), outcome: '', draft: false, parkedAt: at };
    const out = unparkToDraft({ parked: [parkedRec], drafts: [] }, 'rec1', {
      scope: { level: 'primary', outcomeId: 'out3', name: 'All-cause mortality' },
    });
    expect(out.ok).toBe(true);
    expect(out.drafts[0].outcome).toBe('All-cause mortality');
  });

  it('unpark never erases an existing outcome when no name is supplied', () => {
    const parkedRec = { ...mkDraft(), outcome: 'Kept outcome', draft: false, parkedAt: at };
    const out = unparkToDraft({ parked: [parkedRec], drafts: [] }, 'rec1', {
      scope: { level: 'secondary', outcomeId: 'out7' },
    });
    expect(out.ok).toBe(true);
    expect(out.drafts[0].outcome).toBe('Kept outcome');
  });
});

describe('recordCompleteness', () => {
  const rec = (values) => mkExtractionRecord({ values }, () => 'a');

  it('effect family: es+lo+hi complete → hasEffect, nothing missing', () => {
    const out = recordCompleteness(rec({ es: '-0.5', lo: '-1', hi: '0' }));
    expect(out).toEqual({ hasEffect: true, hasRaw: false, missing: [] });
  });

  it('effect family: partial → missing lists the empty effect fields', () => {
    const out = recordCompleteness(rec({ es: '-0.5' }));
    expect(out.hasEffect).toBe(false);
    expect(out.missing).toEqual(['lo', 'hi']);
  });

  it('dichotomous family: needs all of a,b,c,d', () => {
    expect(recordCompleteness(rec({ a: '12', b: '88', c: '20', d: '80' }))).toEqual({
      hasEffect: false,
      hasRaw: true,
      missing: [],
    });
    const partial = recordCompleteness(rec({ a: '12', b: '88' }));
    expect(partial.hasRaw).toBe(false);
    expect(partial.missing).toEqual(['c', 'd']);
  });

  it('continuous family: needs means + sds + ns for both arms', () => {
    const full = recordCompleteness(
      rec({ nExp: '50', nCtrl: '48', meanExp: '1.2', sdExp: '0.4', meanCtrl: '1.5', sdCtrl: '0.5' }),
    );
    expect(full).toEqual({ hasEffect: false, hasRaw: true, missing: [] });

    const partial = recordCompleteness(rec({ nExp: '50', meanExp: '1.2', sdExp: '0.4' }));
    expect(partial.hasRaw).toBe(false);
    expect(partial.missing).toEqual(['nCtrl', 'meanCtrl', 'sdCtrl']);
  });

  it('an entirely empty record asks for the effect fields (minimum viable input)', () => {
    expect(recordCompleteness(rec({}))).toEqual({
      hasEffect: false,
      hasRaw: false,
      missing: ['es', 'lo', 'hi'],
    });
  });

  it('raw + effect can both be complete; started-but-incomplete other families still report', () => {
    const both = recordCompleteness(
      rec({ a: '1', b: '2', c: '3', d: '4', es: '0.1', lo: '0', hi: '0.2' }),
    );
    expect(both.hasEffect).toBe(true);
    expect(both.hasRaw).toBe(true);
    expect(both.missing).toEqual([]);

    const mixed = recordCompleteness(rec({ a: '1', es: '0.1', lo: '0', hi: '0.2' }));
    expect(mixed.hasEffect).toBe(true);
    expect(mixed.missing).toEqual(['b', 'c', 'd']);
  });

  it('survives malformed input', () => {
    expect(recordCompleteness(null)).toEqual({
      hasEffect: false,
      hasRaw: false,
      missing: ['es', 'lo', 'hi'],
    });
  });
});
