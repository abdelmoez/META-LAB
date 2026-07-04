/**
 * outcomeMatch.test.js — normalizeOutcome, OUTCOME_SYNONYMS, matchOutcome.
 * Covers: normalization edge cases (singularization guard for "diabetes", unicode
 * dashes, stopword-only preservation), synonym matching in both directions, the
 * ordered match rules and token thresholds, and negative controls.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeOutcome,
  OUTCOME_SYNONYMS,
  matchOutcome,
} from '../../../src/research-engine/extraction/outcomeMatch.js';

/** Build a protocol-outcome object with a normalized canonical. */
function oc(id, name, { level = 'primary', aliases = [] } = {}) {
  return { id, level, index: 1, name, canonical: normalizeOutcome(name), aliases, timepointHint: '' };
}

describe('normalizeOutcome — basics', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeOutcome('  Blood   Pressure ')).toBe('blood pressure');
  });

  it('strips punctuation except hyphen and %', () => {
    expect(normalizeOutcome('HbA1c, (mg/dL):')).toBe('hba1c mg dl');
    expect(normalizeOutcome('response 45%')).toBe('response 45%');
    expect(normalizeOutcome('all-cause mortality')).toBe('all-cause mortality');
  });

  it('removes stopwords', () => {
    expect(normalizeOutcome('Quality of Life')).toBe('quality life');
    expect(normalizeOutcome('death by any cause')).toBe('death any cause');
  });

  it('folds unicode dashes to a hyphen', () => {
    expect(normalizeOutcome('All–cause mortality')).toBe('all-cause mortality'); // en dash
    expect(normalizeOutcome('progression—free survival')).toBe('progression-free survival'); // em dash
    expect(normalizeOutcome('HOMA−IR')).toBe('homa-ir'); // minus sign
  });
});

describe('normalizeOutcome — conservative singularization', () => {
  it('strips a plural "s" on long tokens', () => {
    expect(normalizeOutcome('adverse events')).toBe('adverse event');
    expect(normalizeOutcome('symptoms')).toBe('symptom');
    expect(normalizeOutcome('falls')).toBe('fall');
  });

  it('does NOT singularize "diabetes" to "diabete"', () => {
    expect(normalizeOutcome('Diabetes')).toBe('diabetes');
    expect(normalizeOutcome('Type 2 Diabetes')).toBe('type 2 diabetes');
  });

  it('protects ss / us / is / es endings and short tokens', () => {
    expect(normalizeOutcome('illness')).toBe('illness'); // ss
    expect(normalizeOutcome('status')).toBe('status'); // us
    expect(normalizeOutcome('analysis')).toBe('analysis'); // is
    expect(normalizeOutcome('bias')).toBe('bias'); // short (<=4)
    expect(normalizeOutcome('loss')).toBe('loss'); // ss
  });
});

describe('normalizeOutcome — never empties content', () => {
  it('preserves a string made entirely of stopwords', () => {
    expect(normalizeOutcome('the of and')).toBe('the of and');
    expect(normalizeOutcome('of')).toBe('of');
  });

  it('returns empty string only for empty / non-string input', () => {
    expect(normalizeOutcome('')).toBe('');
    expect(normalizeOutcome('   ')).toBe('');
    expect(normalizeOutcome(null)).toBe('');
    expect(normalizeOutcome(undefined)).toBe('');
    expect(normalizeOutcome(42)).toBe('42');
  });
});

describe('OUTCOME_SYNONYMS integrity', () => {
  it('has at least 30 groups, each a non-empty array of strings that normalize to a stable key', () => {
    expect(OUTCOME_SYNONYMS.length).toBeGreaterThanOrEqual(30);
    for (const group of OUTCOME_SYNONYMS) {
      expect(Array.isArray(group)).toBe(true);
      expect(group.length).toBeGreaterThanOrEqual(1);
      for (const v of group) {
        expect(typeof v).toBe('string');
        const nv = normalizeOutcome(v);
        expect(nv.length).toBeGreaterThan(0);
        expect(normalizeOutcome(nv)).toBe(nv); // normalization is idempotent
      }
    }
  });

  it('no normalized variant appears in two different groups', () => {
    const seen = new Map();
    OUTCOME_SYNONYMS.forEach((group, gi) => {
      for (const v of group) {
        const nv = normalizeOutcome(v);
        if (seen.has(nv)) {
          expect(seen.get(nv)).toBe(gi); // same group only
        } else {
          seen.set(nv, gi);
        }
      }
    });
  });
});

describe('matchOutcome — exact rules', () => {
  it('rule 1: normalized text equals canonical → exact / high', () => {
    const outs = [oc('p1', 'Quality of life')];
    expect(matchOutcome('quality of life', outs)).toEqual({
      outcomeId: 'p1', level: 'primary', confidence: 'high', matchedVia: 'exact',
    });
  });

  it('rule 1: normalized text equals an alias → exact / high', () => {
    const outs = [oc('p1', 'Glycemic control (measured by HbA1c)', { aliases: ['hba1c'] })];
    expect(matchOutcome('HbA1c', outs)).toMatchObject({ outcomeId: 'p1', confidence: 'high', matchedVia: 'exact' });
  });

  it('rule 2: multi-token canonical is a bounded substring → exact / high', () => {
    const outs = [oc('p1', 'Blood pressure')];
    expect(matchOutcome('systolic blood pressure reduction', outs)).toMatchObject({
      confidence: 'high', matchedVia: 'exact',
    });
  });

  it('rule 3: single-token canonical present as a token → exact / medium', () => {
    const outs = [oc('p1', 'Fatigue')]; // not in the synonym table
    expect(matchOutcome('severe fatigue at rest', outs)).toMatchObject({
      outcomeId: 'p1', confidence: 'medium', matchedVia: 'exact',
    });
  });
});

describe('matchOutcome — synonym rule (both directions)', () => {
  it('protocol "All-cause mortality" matches paper "death"', () => {
    const outs = [oc('p1', 'All-cause mortality')];
    expect(matchOutcome('death', outs)).toMatchObject({
      outcomeId: 'p1', matchedVia: 'synonym', confidence: 'high',
    });
  });

  it('protocol "Death" matches paper "all-cause mortality"', () => {
    const outs = [oc('p1', 'Death')];
    expect(matchOutcome('all-cause mortality', outs)).toMatchObject({
      outcomeId: 'p1', matchedVia: 'synonym', confidence: 'high',
    });
  });

  it('abbreviation synonyms match (SBP ↔ blood pressure group)', () => {
    const outs = [oc('p1', 'Blood pressure')];
    expect(matchOutcome('SBP', outs)).toMatchObject({ matchedVia: 'synonym', confidence: 'high' });
  });
});

describe('matchOutcome — token thresholds', () => {
  const outs = [oc('p1', 'Left ventricular ejection fraction')]; // 4 tokens, not a synonym

  it('rule 5: all canonical tokens present (non-contiguous) → tokens / medium', () => {
    expect(matchOutcome('ventricular function: left ejection fraction', outs)).toMatchObject({
      outcomeId: 'p1', matchedVia: 'tokens', confidence: 'medium',
    });
  });

  it('rule 6: >=60% (and >=2) tokens present → tokens / low', () => {
    // 3 of 4 tokens (left, ejection, fraction); "ventricular" absent.
    expect(matchOutcome('reduced ejection fraction in the left atrium', outs)).toMatchObject({
      outcomeId: 'p1', matchedVia: 'tokens', confidence: 'low',
    });
  });

  it('below 60% token overlap → null', () => {
    expect(matchOutcome('ejection velocity', outs)).toBeNull(); // only 1 of 4
  });
});

describe('matchOutcome — negative controls', () => {
  it('serum creatinine must NOT match quality of life', () => {
    const outs = [oc('p1', 'Quality of life')];
    expect(matchOutcome('serum creatinine', outs)).toBeNull();
  });

  it('pain must NOT match blood pressure', () => {
    const outs = [oc('p1', 'Blood pressure')];
    expect(matchOutcome('pain', outs)).toBeNull();
  });

  it('never matches on zero token overlap', () => {
    const outs = [oc('p1', 'Myocardial infarction')];
    expect(matchOutcome('completely unrelated wording', outs)).toBeNull();
  });

  it('returns null for empty text or empty outcome list', () => {
    expect(matchOutcome('', [oc('p1', 'Death')])).toBeNull();
    expect(matchOutcome('death', [])).toBeNull();
    expect(matchOutcome('death', null)).toBeNull();
  });
});

describe('matchOutcome — tie-breaking (list order, primary before secondary)', () => {
  it('first outcome in list order wins on an equal-strength tie', () => {
    const outs = [
      oc('p1', 'Death', { level: 'primary' }),
      oc('s1', 'Overall mortality', { level: 'secondary' }),
    ];
    // "mortality" is a synonym-group hit for both; the earlier primary wins.
    expect(matchOutcome('mortality', outs)).toMatchObject({ outcomeId: 'p1', level: 'primary' });
  });

  it('a stronger rule beats list order', () => {
    const outs = [
      oc('p1', 'Overall mortality'), // synonym (rule 4) for "death"
      oc('s1', 'Death', { level: 'secondary' }), // exact-synonym; "death" equals canonical → rule 1
    ];
    // s1 wins because "death" === its canonical (rule 1) outranks p1's rule-4 synonym.
    expect(matchOutcome('death', outs)).toMatchObject({ outcomeId: 's1', matchedVia: 'exact', confidence: 'high' });
  });
});
