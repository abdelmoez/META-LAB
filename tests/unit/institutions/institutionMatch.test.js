/**
 * institutionMatch.test.js — institution normalization + matching (prompt26).
 * Covers the prompt's worked examples; uncertain matches must NOT auto-merge.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeInstitution, institutionKey, institutionSimilarity,
  classifyInstitutionMatch, matchInstitution, groupInstitutions,
  INST_AUTO_THRESHOLD, INST_REVIEW_THRESHOLD,
} from '../../../src/research-engine/institutions/institutionMatch.js';

describe('normalizeInstitution', () => {
  it('lower-cases, trims, collapses spaces, strips punctuation, expands abbreviations', () => {
    expect(normalizeInstitution('  Harvard   University ')).toBe('harvard university');
    expect(normalizeInstitution('HARVARD UNIVERSITY')).toBe('harvard university');
    expect(normalizeInstitution('Harvard, University.')).toBe('harvard university');
    expect(normalizeInstitution('Harvard Univ.')).toBe('harvard university');
    expect(normalizeInstitution('king saud univ')).toBe('king saud university');
    expect(normalizeInstitution('')).toBe('');
  });
});

describe('institutionSimilarity — required examples', () => {
  it('"Harvard University" == "harvard university" (1.0, auto)', () => {
    expect(institutionSimilarity('Harvard University', 'harvard university')).toBe(1);
    expect(classifyInstitutionMatch(1)).toBe('auto');
  });
  it('"Harvard Univ." strongly matches "Harvard University"', () => {
    const s = institutionSimilarity('Harvard Univ.', 'Harvard University');
    expect(s).toBeGreaterThanOrEqual(INST_AUTO_THRESHOLD);
  });
  it('"King Saud University" matches "king saud univ"', () => {
    expect(institutionSimilarity('King Saud University', 'king saud univ')).toBeGreaterThanOrEqual(INST_AUTO_THRESHOLD);
  });
  it('extra spaces do not reduce the match', () => {
    expect(institutionSimilarity('Harvard  University', 'Harvard University')).toBe(1);
  });
  it('punctuation differences do not reduce the match', () => {
    expect(institutionSimilarity('Harvard-University', 'Harvard University')).toBe(1);
  });
  it('bare "Harvard" is a POSSIBLE match (review band), NOT auto-merge', () => {
    const s = institutionSimilarity('Harvard', 'Harvard University');
    expect(s).toBeGreaterThanOrEqual(INST_REVIEW_THRESHOLD);
    expect(s).toBeLessThan(INST_AUTO_THRESHOLD);
    expect(classifyInstitutionMatch(s)).toBe('review');
  });
  it('clearly different institutions are "new"', () => {
    const s = institutionSimilarity('Harvard University', 'Stanford University');
    expect(classifyInstitutionMatch(s)).toBe('new');
  });
});

describe('matchInstitution', () => {
  const existing = ['Harvard University', 'Stanford University', 'King Saud University'];

  it('auto-matches a case/abbreviation variant to the existing canonical', () => {
    const m = matchInstitution('harvard univ', existing);
    expect(m.bestMatch.canonicalName).toBe('Harvard University');
    expect(m.disposition).toBe('auto');
    expect(m.input).toBe('harvard univ');           // original preserved
    expect(m.normalized).toBe('harvard university');
  });
  it('sends an uncertain match to review', () => {
    const m = matchInstitution('Harvard', existing);
    expect(m.bestMatch.canonicalName).toBe('Harvard University');
    expect(m.disposition).toBe('review');
  });
  it('treats a genuinely new institution as new', () => {
    const m = matchInstitution('MIT', existing);
    expect(m.disposition).toBe('new');
  });
});

describe('groupInstitutions (Ops duplicate view)', () => {
  it('collapses spelling variants into one group with the most common spelling as canonical', () => {
    const groups = groupInstitutions([
      'Harvard University', 'harvard university', 'Harvard University', 'Harvard Univ.',
      'Stanford University',
    ]);
    const harvard = groups.find(g => g.key === 'harvard');
    expect(harvard).toBeTruthy();
    expect(harvard.count).toBe(4);
    expect(harvard.canonicalName).toBe('Harvard University'); // most frequent spelling
    expect(harvard.variants).toContain('Harvard Univ.');
    expect(groups.find(g => g.key === 'stanford').count).toBe(1);
  });
});
