import { describe, it, expect } from 'vitest';
import {
  CERTAINTY_LEVELS,
  levelForNumeric,
  GRADE_DOMAINS,
  DOWNGRADE_DOMAINS,
  UPGRADE_DOMAINS,
  GRADE_RATINGS,
  isKnownRating,
  ratingModifier,
  domainDef,
  domainLabel,
  startLevelForDesign,
  computeCertainty,
  certaintyFromModifiers,
} from '../../../src/research-engine/grade/gradeModel.js';

describe('gradeModel — levels + ratings catalogue', () => {
  it('CERTAINTY_LEVELS is High..Very low as 4..1', () => {
    expect(CERTAINTY_LEVELS.map((l) => l.numeric)).toEqual([4, 3, 2, 1]);
    expect(CERTAINTY_LEVELS.map((l) => l.label)).toEqual(['High', 'Moderate', 'Low', 'Very low']);
  });

  it('levelForNumeric maps + clamps out-of-range', () => {
    expect(levelForNumeric(4).label).toBe('High');
    expect(levelForNumeric(3).label).toBe('Moderate');
    expect(levelForNumeric(2).label).toBe('Low');
    expect(levelForNumeric(1).label).toBe('Very low');
    expect(levelForNumeric(0).label).toBe('Very low'); // clamp low
    expect(levelForNumeric(9).label).toBe('High');      // clamp high
  });

  it('domain catalogue has the 5 down + 3 up domains with correct flags', () => {
    expect(DOWNGRADE_DOMAINS).toEqual(['rob', 'inconsistency', 'indirectness', 'imprecision', 'publicationBias']);
    expect(UPGRADE_DOMAINS).toEqual(['largeEffect', 'doseResponse', 'plausibleConfounding']);
    expect(domainDef('indirectness').reviewerOnly).toBe(true);
    expect(domainDef('rob').reviewerOnly).toBe(false);
    expect(domainDef('largeEffect').canRateUp).toBe(true);
    expect(domainDef('largeEffect').appliesTo).toBe('observational');
    expect(GRADE_DOMAINS).toHaveLength(8);
    expect(domainLabel('publicationBias')).toBe('Publication bias');
    expect(domainDef('nope')).toBe(null);
  });

  it('rating vocabulary maps to the correct modifiers (both vocabularies)', () => {
    expect(ratingModifier('not_serious')).toBe(0);
    expect(ratingModifier('serious')).toBe(-1);
    expect(ratingModifier('very_serious')).toBe(-2);
    expect(ratingModifier('no_concern')).toBe(0);
    expect(ratingModifier('some_concern')).toBe(-1);
    expect(ratingModifier('major_concern')).toBe(-2);
    expect(ratingModifier('not_applicable')).toBe(0);
    expect(ratingModifier('large')).toBe(1);
    expect(ratingModifier('very_large')).toBe(2);
    expect(ratingModifier('upgrade_one')).toBe(1);
    expect(ratingModifier('upgrade_two')).toBe(2);
  });

  it('unknown / null ratings contribute 0 and are not "known"', () => {
    expect(ratingModifier('garbage')).toBe(0);
    expect(ratingModifier(null)).toBe(0);
    expect(ratingModifier(undefined)).toBe(0);
    expect(isKnownRating('serious')).toBe(true);
    expect(isKnownRating('garbage')).toBe(false);
    expect(isKnownRating(null)).toBe(false);
  });

  it('legacy GRADE_OPTIONS modifiers are preserved (0 / -1 / -2)', () => {
    expect(GRADE_RATINGS.not_serious.modifier).toBe(0);
    expect(GRADE_RATINGS.serious.modifier).toBe(-1);
    expect(GRADE_RATINGS.very_serious.modifier).toBe(-2);
  });
});

describe('gradeModel — startLevelForDesign', () => {
  it('randomized designs start at High (4)', () => {
    for (const d of ['RCT', 'randomized', 'Randomised controlled trial', 'experimental', 'clinical trial']) {
      const s = startLevelForDesign(d);
      expect(s.numeric).toBe(4);
      expect(s.label).toBe('High');
      expect(s.design).toBe('randomized');
      expect(s.assumed).toBe(false);
    }
  });

  it('observational designs start at Low (2)', () => {
    for (const d of ['observational', 'cohort', 'case-control', 'cross-sectional', 'registry', 'NRSI']) {
      const s = startLevelForDesign(d);
      expect(s.numeric).toBe(2);
      expect(s.label).toBe('Low');
      expect(s.design).toBe('observational');
      expect(s.assumed).toBe(false);
    }
  });

  it('"non-randomised trial" is observational, not randomised', () => {
    const s = startLevelForDesign('non-randomised trial');
    expect(s.design).toBe('observational');
    expect(s.numeric).toBe(2);
  });

  it('unclear design defaults to High but flags assumed:true', () => {
    const s = startLevelForDesign('');
    expect(s.numeric).toBe(4);
    expect(s.assumed).toBe(true);
    expect(startLevelForDesign(undefined).assumed).toBe(true);
    expect(startLevelForDesign('mystery-design').assumed).toBe(true);
  });

  it('accepts a PICO object via studyDesign', () => {
    expect(startLevelForDesign({ studyDesign: 'RCT' }).numeric).toBe(4);
    expect(startLevelForDesign({ studyDesign: 'cohort' }).numeric).toBe(2);
    expect(startLevelForDesign({ design: 'observational' }).numeric).toBe(2);
  });
});

describe('gradeModel — computeCertainty', () => {
  const RCT = startLevelForDesign('RCT');   // 4
  const OBS = startLevelForDesign('cohort'); // 2

  it('RCT with no concerns stays High', () => {
    const r = computeCertainty({ startLevel: RCT, domains: { rob: 'not_serious', inconsistency: 'not_serious', indirectness: 'not_serious', imprecision: 'not_serious', publicationBias: 'not_serious' } });
    expect(r.numeric).toBe(4);
    expect(r.level).toBe('High');
    expect(r.modifiersApplied).toHaveLength(5);
    expect(r.modifiersApplied.every((m) => m.modifier === 0)).toBe(true);
  });

  it('one serious domain drops High → Moderate', () => {
    const r = computeCertainty({ startLevel: RCT, domains: { rob: 'serious' } });
    expect(r.numeric).toBe(3);
    expect(r.level).toBe('Moderate');
  });

  it('two serious domains drop High → Low', () => {
    const r = computeCertainty({ startLevel: RCT, domains: { rob: 'serious', imprecision: 'serious' } });
    expect(r.numeric).toBe(2);
    expect(r.level).toBe('Low');
  });

  it('very_serious counts as two levels', () => {
    const r = computeCertainty({ startLevel: RCT, domains: { inconsistency: 'very_serious' } });
    expect(r.numeric).toBe(2);
    expect(r.level).toBe('Low');
  });

  it('clamps at Very low — cannot go below 1', () => {
    const r = computeCertainty({ startLevel: RCT, domains: { rob: 'very_serious', inconsistency: 'very_serious', imprecision: 'very_serious' } });
    expect(r.rawNumeric).toBe(-2);
    expect(r.numeric).toBe(1);
    expect(r.level).toBe('Very low');
  });

  it('observational starts Low; a single serious domain → Very low', () => {
    const r = computeCertainty({ startLevel: OBS, domains: { rob: 'serious' } });
    expect(r.numeric).toBe(1);
    expect(r.level).toBe('Very low');
  });

  it('observational upgrades raise certainty (large effect + dose-response)', () => {
    const r = computeCertainty({ startLevel: OBS, domains: { largeEffect: 'large', doseResponse: 'large' } });
    expect(r.rawNumeric).toBe(4);
    expect(r.level).toBe('High');
  });

  it('clamps at High — cannot exceed 4', () => {
    const r = computeCertainty({ startLevel: RCT, domains: { largeEffect: 'very_large' } });
    expect(r.rawNumeric).toBe(6);
    expect(r.numeric).toBe(4);
    expect(r.level).toBe('High');
  });

  it('supports the concern vocabulary', () => {
    const r = computeCertainty({ startLevel: RCT, domains: { rob: 'some_concern', imprecision: 'major_concern' } });
    expect(r.numeric).toBe(1); // 4 -1 -2 = 1
    expect(r.level).toBe('Very low');
  });

  it('accepts a numeric start level and a {numeric} object', () => {
    expect(computeCertainty({ startLevel: 4, domains: { rob: 'serious' } }).level).toBe('Moderate');
    expect(computeCertainty({ startLevel: { numeric: 2 }, domains: {} }).level).toBe('Low');
  });

  it('accepts a design string as the start level', () => {
    expect(computeCertainty({ startLevel: 'observational', domains: {} }).level).toBe('Low');
  });

  it('accepts an array-of-domains form', () => {
    const r = computeCertainty({ startLevel: RCT, domains: [{ domain: 'rob', rating: 'serious' }, { domain: 'imprecision', rating: 'very_serious' }] });
    expect(r.numeric).toBe(1); // 4 -1 -2
  });

  it('unwraps object-valued domain ratings ({rating} / {suggest})', () => {
    const r = computeCertainty({ startLevel: RCT, domains: { rob: { rating: 'serious' }, imprecision: { suggest: 'serious' } } });
    expect(r.numeric).toBe(2);
  });

  it('drops null / unknown domain ratings without throwing', () => {
    const r = computeCertainty({ startLevel: RCT, domains: { rob: null, indirectness: '', imprecision: 'garbage', inconsistency: 'serious' } });
    expect(r.numeric).toBe(3);
    expect(r.modifiersApplied).toHaveLength(1);
    expect(r.modifiersApplied[0].domain).toBe('inconsistency');
  });

  it('degenerate inputs do not throw', () => {
    expect(() => computeCertainty()).not.toThrow();
    expect(() => computeCertainty({})).not.toThrow();
    const r = computeCertainty({});
    expect(r.numeric).toBe(4);          // unclear design → High
    expect(r.startLevel.assumed).toBe(true);
    expect(r.modifiersApplied).toEqual([]);
  });

  it('certaintyFromModifiers is consistent with computeCertainty', () => {
    expect(certaintyFromModifiers(4, -1).label).toBe('Moderate');
    expect(certaintyFromModifiers(2, -3).label).toBe('Very low');
    expect(certaintyFromModifiers(2, 5).label).toBe('High');
  });
});
