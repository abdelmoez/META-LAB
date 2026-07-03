import { describe, it, expect } from 'vitest';
import { buildGradeByOutcome, gradeFootnotes } from '../../../src/research-engine/grade/sof.js';
import { getOutcomePairs } from '../../../src/research-engine/import-export/journalSubmission.js';

describe('sof — gradeFootnotes', () => {
  it('emits one footnote per non-not-serious domain, in model order', () => {
    const notes = gradeFootnotes({
      domains: { rob: 'serious', inconsistency: 'not_serious', imprecision: 'very_serious', indirectness: 'not_serious', publicationBias: 'not_serious' },
    });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^Risk of bias: rated down one level/);
    expect(notes[1]).toMatch(/^Imprecision: rated down two levels/);
  });

  it('appends a per-domain rationale when provided', () => {
    const notes = gradeFootnotes({
      domains: { imprecision: 'serious' },
      reasons: { imprecision: 'the 95% CI crosses the null' },
    });
    expect(notes[0]).toMatch(/Imprecision: rated down one level \(serious\) — the 95% CI crosses the null\./);
  });

  it('not-serious / not-applicable domains produce no footnote', () => {
    expect(gradeFootnotes({ domains: { rob: 'not_serious', indirectness: 'not_applicable' } })).toEqual([]);
  });

  it('describes upgrades as "rated up"', () => {
    const notes = gradeFootnotes({ domains: { largeEffect: 'large', doseResponse: 'large' } });
    expect(notes[0]).toMatch(/Large magnitude of effect: rated up one level/);
    expect(notes[1]).toMatch(/Dose–response gradient: rated up one level/);
  });

  it('empty / missing domains → no footnotes, no throw', () => {
    expect(gradeFootnotes({})).toEqual([]);
    expect(gradeFootnotes(null)).toEqual([]);
    expect(() => gradeFootnotes(undefined)).not.toThrow();
  });
});

describe('sof — buildGradeByOutcome', () => {
  it('keys the map on assessment.key and computes the certainty label', () => {
    const map = buildGradeByOutcome([
      { key: 'Mortality||| 12wk', design: 'RCT', domains: { rob: 'serious' } },
      { key: 'Relapse|||', design: 'cohort', domains: { rob: 'serious' } },
    ]);
    expect(Object.keys(map).sort()).toEqual(['Mortality||| 12wk', 'Relapse|||']);
    expect(map['Mortality||| 12wk'].certainty).toBe('Moderate'); // RCT 4 - 1
    expect(map['Relapse|||'].certainty).toBe('Very low');        // cohort 2 - 1 → clamp 1
  });

  it('attaches footnotes and modifiersApplied', () => {
    const map = buildGradeByOutcome([{ key: 'k1', design: 'RCT', domains: { rob: 'serious', inconsistency: 'very_serious' } }]);
    const cell = map.k1;
    expect(cell.certainty).toBe('Very low'); // 4 -1 -2 = 1
    expect(cell.footnotes).toHaveLength(2);
    expect(cell.modifiersApplied).toHaveLength(2);
    expect(cell.numeric).toBe(1);
  });

  it('accepts an object-map input keyed by pair.key', () => {
    const map = buildGradeByOutcome({
      abc: { design: 'RCT', domains: { imprecision: 'serious' } },
    });
    expect(map.abc.certainty).toBe('Moderate');
  });

  it('keys line up with getOutcomePairs pair.key (SoF integration)', () => {
    const studies = [
      { outcome: 'Mortality', timepoint: '12wk', esType: 'OR', es: '0.5', lo: '0.3', hi: '0.7' },
      { outcome: 'Relapse', timepoint: '', esType: 'RR', es: '0.8', lo: '0.6', hi: '1.0' },
    ];
    const pairs = getOutcomePairs(studies);
    expect(pairs.length).toBe(2);
    const assessments = pairs.map((p) => ({ key: p.key, design: 'RCT', domains: { imprecision: 'serious' } }));
    const map = buildGradeByOutcome(assessments);
    for (const p of pairs) {
      expect(map[p.key]).toBeTruthy();
      expect(map[p.key].certainty).toBe('Moderate');
    }
  });

  it('assessment with no domains uses the start level unchanged', () => {
    const map = buildGradeByOutcome([{ key: 'k', design: 'cohort', domains: {} }]);
    expect(map.k.certainty).toBe('Low');       // cohort start = Low, no modifiers
    expect(map.k.footnotes).toEqual([]);
    expect(map.k.startLevel.design).toBe('observational');
  });

  it('unclear design flags assumed and defaults to High', () => {
    const map = buildGradeByOutcome([{ key: 'k', domains: {} }]);
    expect(map.k.certainty).toBe('High');
    expect(map.k.startLevel.assumed).toBe(true);
  });

  it('degenerate inputs return an empty map without throwing', () => {
    expect(buildGradeByOutcome(null)).toEqual({});
    expect(buildGradeByOutcome([])).toEqual({});
    expect(buildGradeByOutcome({})).toEqual({});
    // entries without a key are skipped
    expect(buildGradeByOutcome([{ design: 'RCT', domains: { rob: 'serious' } }])).toEqual({});
  });
});
