/**
 * criteriaKeywords.test.js — prompt28 Part 1. Verifies that project inclusion/
 * exclusion CRITERIA derive into the screening keyword lists, project-specific,
 * deduped against existing keywords, with correct source provenance.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeKeyword,
  criteriaKeywordsFromSnapshot,
  mergeKeywordSources,
  effectiveKeywords,
  KEYWORD_SOURCE,
} from '../../src/research-engine/screening/criteriaKeywords.js';

describe('normalizeKeyword', () => {
  it('lowercases, trims, collapses internal whitespace', () => {
    expect(normalizeKeyword('  Randomized   Controlled  Trial ')).toBe('randomized controlled trial');
    expect(normalizeKeyword(null)).toBe('');
    expect(normalizeKeyword(undefined)).toBe('');
  });
});

describe('criteriaKeywordsFromSnapshot', () => {
  it('derives inclusion from incl and exclusion from excl criteria', () => {
    const snap = { incl: '• randomized controlled trial\n• adults with diabetes', excl: '• animal study\n• case report' };
    const { inclusion, exclusion } = criteriaKeywordsFromSnapshot(snap);
    expect(inclusion).toContain('randomized controlled trial');
    expect(inclusion).toContain('adults with diabetes');
    expect(exclusion).toContain('animal study');
    expect(exclusion).toContain('case report');
    // criteria layer must NOT cross sides
    expect(exclusion).not.toContain('randomized controlled trial');
    expect(inclusion).not.toContain('animal study');
  });

  it('accepts a JSON string snapshot and tolerates junk', () => {
    const out = criteriaKeywordsFromSnapshot(JSON.stringify({ incl: 'cohort study' }));
    expect(out.inclusion).toContain('cohort study');
    expect(criteriaKeywordsFromSnapshot('not json')).toEqual({ inclusion: [], exclusion: [] });
    expect(criteriaKeywordsFromSnapshot(null)).toEqual({ inclusion: [], exclusion: [] });
    expect(criteriaKeywordsFromSnapshot({})).toEqual({ inclusion: [], exclusion: [] });
  });

  it('does NOT fold the whole PICO into the criteria layer', () => {
    const out = criteriaKeywordsFromSnapshot({ P: 'elderly population', I: 'aspirin', incl: 'rct only' });
    expect(out.inclusion).toContain('rct only');
    expect(out.inclusion).not.toContain('elderly population');
    expect(out.inclusion).not.toContain('aspirin');
  });
});

describe('mergeKeywordSources', () => {
  it('appends criteria terms not already present, tagging provenance', () => {
    const { terms, sourceByTerm } = mergeKeywordSources(
      ['RCT', 'placebo'],
      ['randomized controlled trial', 'placebo'], // "placebo" already present
      { storedSource: KEYWORD_SOURCE.MANUAL },
    );
    expect(terms).toEqual(['RCT', 'placebo', 'randomized controlled trial']);
    expect(sourceByTerm['RCT']).toBe('manual');
    expect(sourceByTerm['placebo']).toBe('manual'); // kept as manual, not re-badged
    expect(sourceByTerm['randomized controlled trial']).toBe('criteria');
  });

  it('dedupes case/space-insensitively but preserves stored display text', () => {
    const { terms, sourceByTerm } = mergeKeywordSources(
      ['Randomized  Controlled Trial'],
      ['randomized controlled trial'],
    );
    expect(terms).toEqual(['Randomized  Controlled Trial']); // criteria dup dropped
    expect(sourceByTerm['Randomized  Controlled Trial']).toBe('manual');
  });

  it('handles empty / non-array inputs', () => {
    expect(mergeKeywordSources(null, null).terms).toEqual([]);
    expect(mergeKeywordSources(undefined, ['x']).terms).toEqual(['x']);
  });
});

describe('effectiveKeywords', () => {
  const defaults = { inc: ['RCT', 'placebo'], exc: ['animal', 'cohort'] };

  it('layers criteria onto stored keywords for both sides', () => {
    const res = effectiveKeywords({
      storedInclude: ['RCT', 'placebo'],
      storedExclude: ['animal', 'cohort'],
      defaultInclude: defaults.inc,
      defaultExclude: defaults.exc,
      picoSnapshot: { incl: 'double-blind randomisation', excl: 'in vitro study' },
    });
    expect(res.include.terms).toContain('double-blind randomisation');
    expect(res.include.sourceByTerm['double-blind randomisation']).toBe('criteria');
    expect(res.exclude.terms).toContain('in vitro study');
    expect(res.exclude.sourceByTerm['in vitro study']).toBe('criteria');
    // stored keywords preserved
    expect(res.include.terms).toContain('RCT');
    expect(res.exclude.terms).toContain('cohort');
  });

  it('labels stored source as default when the stored list is empty', () => {
    const res = effectiveKeywords({
      storedInclude: [], storedExclude: [],
      defaultInclude: defaults.inc, defaultExclude: defaults.exc,
      picoSnapshot: { incl: 'rct' },
    });
    expect(res.include.sourceByTerm['RCT']).toBe('default');
  });

  it('is project-specific: a different snapshot yields different criteria terms', () => {
    const base = { storedInclude: ['RCT'], storedExclude: [], defaultInclude: defaults.inc, defaultExclude: defaults.exc };
    const a = effectiveKeywords({ ...base, picoSnapshot: { incl: 'paediatric population' } });
    const b = effectiveKeywords({ ...base, picoSnapshot: { incl: 'geriatric population' } });
    expect(a.include.terms).toContain('paediatric population');
    expect(a.include.terms).not.toContain('geriatric population');
    expect(b.include.terms).toContain('geriatric population');
    expect(b.include.terms).not.toContain('paediatric population');
  });

  it('removing criteria removes the derived keyword (nothing persisted)', () => {
    const withCriteria = effectiveKeywords({
      storedInclude: ['RCT'], storedExclude: [], defaultInclude: defaults.inc, defaultExclude: defaults.exc,
      picoSnapshot: { incl: 'open-label trial' },
    });
    expect(withCriteria.include.terms).toContain('open-label trial');
    const withoutCriteria = effectiveKeywords({
      storedInclude: ['RCT'], storedExclude: [], defaultInclude: defaults.inc, defaultExclude: defaults.exc,
      picoSnapshot: {},
    });
    expect(withoutCriteria.include.terms).not.toContain('open-label trial');
    expect(withoutCriteria.include.terms).toContain('RCT'); // stored preserved
  });
});
