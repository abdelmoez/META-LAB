import { describe, it, expect } from 'vitest';
import { matchArms, normalizeArm } from '../../../src/research-engine/extraction/armMatch.js';

describe('armMatch — PICO-assisted arm matching (§14.8)', () => {
  it('matches clear intervention / comparator labels', () => {
    const r = matchArms(['EUS-BD', 'ERCP'], { intervention: 'EUS-BD', comparator: 'ERCP' });
    expect(r.confident).toBe(true);
    expect(r.intervention.label).toBe('EUS-BD');
    expect(r.comparator.label).toBe('ERCP');
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it('recognizes control/placebo by role keyword even without exact overlap', () => {
    const r = matchArms(['Drug X', 'Placebo'], { intervention: 'Drug X', comparator: 'placebo control' });
    expect(r.confident).toBe(true);
    expect(r.comparator.label).toBe('Placebo');
  });

  it('is NOT confident on symmetric / unmatchable arms (never a positional guess)', () => {
    const r = matchArms(['Group 1', 'Group 2'], { intervention: 'novel therapy', comparator: 'usual care' });
    expect(r.confident).toBe(false);
    expect(r.intervention).toBeNull();
    expect(r.evidence.join(' ')).toMatch(/confirm/i);
  });

  it('needs ≥2 candidates and PICO — otherwise asks for confirmation', () => {
    expect(matchArms(['only one'], { intervention: 'x', comparator: 'y' }).confident).toBe(false);
    expect(matchArms(['a', 'b'], {}).confident).toBe(false);
    expect(matchArms(null, null).confident).toBe(false);
  });

  it('normalizeArm folds abbreviations and punctuation deterministically', () => {
    expect(normalizeArm('EUS-BD')).toBe('eus-bd');
    expect(normalizeArm('Usual Care')).toContain('usual care');
    expect(normalizeArm(null)).toBe('');
  });

  it('never throws on malformed input', () => {
    expect(() => matchArms([null, undefined, 5], { intervention: 'x' })).not.toThrow();
  });
});
