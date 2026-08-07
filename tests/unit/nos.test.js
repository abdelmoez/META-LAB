/**
 * 101.md §18–§22 — the Newcastle–Ottawa Scale.
 *
 * These tests pin the things that are easy to get wrong and scientifically
 * damaging when wrong:
 *   - the official domain/item structure of BOTH forms (not a generic 0–9 box)
 *   - the one-star-per-item cap even where an item has two starred options
 *   - Comparability as the sole ADDITIVE item (0/1/2)
 *   - the fact that the NOS defines NO threshold, and that anything we do offer
 *     is attributed and never marked official (§22)
 */
import { describe, it, expect } from 'vitest';
import {
  NOS_COHORT, NOS_CASE_CONTROL, NOS_MAX_STARS,
  nosSelectedValues, nosQuestionStars, nosScoreDomain, nosScoreAssessment,
  nosCompleteness, nosJudgeOverall,
  interpretNos, applyAhrq, AHRQ_STANDARD,
  NOS_CONVENTIONAL_BANDS, NOS_CONVENTIONAL_BANDS_NOTICE,
  getInstrument, proposeAllDomains, proposeOverall, isScoringInstrument,
} from '../../src/research-engine/rob/index.js';

const cohortAll = (comp = ['a', 'b']) => ({
  selection: { S1: 'a', S2: 'a', S3: 'a', S4: 'a' },
  comparability: { C1: comp },
  outcome: { O1: 'a', O2: 'a', O3: 'a' },
});

const ccAll = (comp = ['a', 'b']) => ({
  selection: { S1: 'a', S2: 'a', S3: 'a', S4: 'a' },
  comparability: { C1: comp },
  exposure: { E1: 'a', E2: 'a', E3: 'a' },
});

describe('official form structure (§19, §20)', () => {
  it('cohort has Selection(4) / Comparability(1) / Outcome(3) with the official maxima', () => {
    expect(NOS_COHORT.domains.map((d) => d.id)).toEqual(['selection', 'comparability', 'outcome']);
    expect(NOS_COHORT.domains.map((d) => d.maxStars)).toEqual([4, 2, 3]);
    expect(NOS_COHORT.domains[0].questions.map((q) => q.id)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(NOS_COHORT.domains[1].questions).toHaveLength(1);
    expect(NOS_COHORT.domains[2].questions.map((q) => q.id)).toEqual(['O1', 'O2', 'O3']);
    expect(NOS_COHORT.maxStars).toBe(9);
  });

  it('case-control has Selection(4) / Comparability(1) / Exposure(3)', () => {
    expect(NOS_CASE_CONTROL.domains.map((d) => d.id)).toEqual(['selection', 'comparability', 'exposure']);
    expect(NOS_CASE_CONTROL.domains.map((d) => d.maxStars)).toEqual([4, 2, 3]);
    expect(NOS_CASE_CONTROL.domains[2].questions.map((q) => q.id)).toEqual(['E1', 'E2', 'E3']);
  });

  it('is a real criteria-based instrument, not a single numeric field (§19)', () => {
    const items = NOS_COHORT.domains.flatMap((d) => d.questions);
    expect(items).toHaveLength(8);
    for (const q of items) {
      expect(Array.isArray(q.options)).toBe(true);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      // every option carries explicit star status — nothing is inferred
      for (const o of q.options) expect(typeof o.star).toBe('boolean');
    }
  });

  it('cites the OHRI source documents', () => {
    expect(NOS_COHORT.source.scale).toMatch(/ohri\.ca/);
    expect(NOS_COHORT.source.manual).toMatch(/nos_manual/);
  });

  it('carries the official header note verbatim', () => {
    expect(NOS_COHORT.officialNote).toContain('maximum of one star for each numbered item');
    expect(NOS_COHORT.officialNote).toContain('maximum of two stars can be given for Comparability');
  });

  it('preserves the protocol-defined blanks rather than inventing values (§D)', () => {
    const o3 = NOS_COHORT.domains[2].questions.find((q) => q.id === 'O3');
    expect(o3.options.find((o) => o.value === 'b').text).toContain('____');
    const c1 = NOS_COHORT.domains[1].questions[0];
    expect(c1.options.find((o) => o.value === 'a').text).toContain('_____');
  });
});

describe('item arity — the one-star cap (§21)', () => {
  it('scores a single starred option as one star', () => {
    const q = NOS_COHORT.domains[0].questions[0]; // S1: a and b are BOTH starred
    expect(nosQuestionStars(q, 'a')).toBe(1);
    expect(nosQuestionStars(q, 'b')).toBe(1);
    expect(nosQuestionStars(q, 'c')).toBe(0);
    expect(nosQuestionStars(q, undefined)).toBe(0);
  });

  it('caps a single-select item at one star even if two starred options are stored', () => {
    // S1 has two starred options that are mutually exclusive ALTERNATIVES. A
    // corrupted answer blob (or a UI bug) must never yield 2 stars for one item.
    const q = NOS_COHORT.domains[0].questions[0];
    expect(nosQuestionStars(q, ['a', 'b'])).toBe(1);
  });

  it('a fully over-ticked cohort assessment still totals 9, never more', () => {
    const overticked = {
      selection: { S1: ['a', 'b'], S2: 'a', S3: ['a', 'b'], S4: 'a' },
      comparability: { C1: ['a', 'b'] },
      outcome: { O1: ['a', 'b'], O2: 'a', O3: 'a' },
    };
    const s = nosScoreAssessment(NOS_COHORT, overticked);
    expect(s.total).toBe(9);
    expect(s.profile).toBe('4/4 · 2/2 · 3/3');
  });
});

describe('Comparability is the only additive item (§E)', () => {
  it('awards 0, 1 or 2 stars from the one item', () => {
    for (const [comp, stars] of [[[], 0], [['a'], 1], [['b'], 1], [['a', 'b'], 2]]) {
      const s = nosScoreDomain(NOS_COHORT, 'comparability', { C1: comp });
      expect(s.stars).toBe(stars);
    }
  });

  it('drives the total accordingly', () => {
    expect(nosScoreAssessment(NOS_COHORT, cohortAll([])).total).toBe(7);
    expect(nosScoreAssessment(NOS_COHORT, cohortAll(['a'])).total).toBe(8);
    expect(nosScoreAssessment(NOS_COHORT, cohortAll(['a', 'b'])).total).toBe(9);
  });

  it('uses a multi-select widget only for Comparability', () => {
    for (const d of NOS_COHORT.domains) {
      for (const q of d.questions) {
        expect(q.select).toBe(d.id === 'comparability' ? 'many' : 'one');
      }
    }
  });
});

describe('scoring totals (§21)', () => {
  it('a perfect cohort study scores 9/9 across 4/2/3', () => {
    const s = nosScoreAssessment(NOS_COHORT, cohortAll());
    expect(s.total).toBe(NOS_MAX_STARS);
    expect(s.byDomain.selection.stars).toBe(4);
    expect(s.byDomain.comparability.stars).toBe(2);
    expect(s.byDomain.outcome.stars).toBe(3);
    expect(s.complete).toBe(true);
  });

  it('a perfect case-control study scores 9/9 across 4/2/3', () => {
    const s = nosScoreAssessment(NOS_CASE_CONTROL, ccAll());
    expect(s.total).toBe(9);
    expect(s.byDomain.exposure.stars).toBe(3);
  });

  it('an empty assessment scores zero and is incomplete', () => {
    const s = nosScoreAssessment(NOS_COHORT, {});
    expect(s.total).toBe(0);
    expect(s.complete).toBe(false);
  });

  it('normalizes every stored answer shape', () => {
    expect(nosSelectedValues('a')).toEqual(['a']);
    expect(nosSelectedValues(['a', 'b'])).toEqual(['a', 'b']);
    expect(nosSelectedValues({ response: 'a' })).toEqual(['a']);
    expect(nosSelectedValues({ response: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(nosSelectedValues(null)).toEqual([]);
    expect(nosSelectedValues('')).toEqual([]);
  });
});

describe('generic engine dispatch', () => {
  it('registers both forms and flags them as star-scored', () => {
    expect(isScoringInstrument(getInstrument('NOS'))).toBe(true);
    expect(isScoringInstrument(getInstrument('NOS-CC'))).toBe(true);
    expect(isScoringInstrument(getInstrument('RoB2'))).toBe(false);
  });

  it('proposeAllDomains → proposeOverall reproduces the star profile', () => {
    const inst = getInstrument('NOS');
    const dj = proposeAllDomains(inst, cohortAll());
    const overall = proposeOverall(inst, dj);
    expect(overall.stars).toBe(9);
    expect(overall.profile).toBe('4/4 · 2/2 · 3/3');
  });

  it('sums star counts persisted as numeral strings (RobDomainJudgment.finalJudgment)', () => {
    const inst = getInstrument('NOS');
    const overall = nosJudgeOverall(inst, { selection: '3', comparability: '1', outcome: '2' });
    expect(overall.stars).toBe(6);
    expect(overall.profile).toBe('3/4 · 1/2 · 2/3');
  });

  it('treats unparseable domain values as zero rather than inflating the score', () => {
    const inst = getInstrument('NOS');
    const overall = nosJudgeOverall(inst, { selection: 'low', comparability: null, outcome: { judgment: '99' } });
    expect(overall.stars).toBe(3); // outcome clamped to its max of 3, others 0
    expect(overall.profile).toBe('0/4 · 0/2 · 3/3');
  });

  it('reports completeness for option-valued answers including the array item', () => {
    const c = nosCompleteness(NOS_COHORT, { answersByDomain: cohortAll() });
    expect(c.overall).toEqual({ answered: 8, required: 8, complete: true });
    const partial = nosCompleteness(NOS_COHORT, { answersByDomain: { selection: { S1: 'a' } } });
    expect(partial.overall.complete).toBe(false);
    expect(partial.perDomain.comparability.missing).toEqual(['C1']);
  });
});

describe('thresholds — §22 honesty', () => {
  it('defaults to no interpretation at all', () => {
    const r = interpretNos(nosScoreAssessment(NOS_COHORT, cohortAll()));
    expect(r.mode).toBe('none');
    expect(r.level).toBe('');
    expect(r.attribution).toMatch(/defines no quality threshold/i);
  });

  it('NEVER marks any interpretation as official, in any mode', () => {
    const s = nosScoreAssessment(NOS_COHORT, cohortAll());
    for (const mode of ['none', 'ahrq', 'custom']) {
      expect(interpretNos(s, { mode, bands: NOS_CONVENTIONAL_BANDS }).official).toBe(false);
    }
  });

  it('the instrument itself ships no judgement levels or quality labels', () => {
    expect(NOS_COHORT.judgmentLevels).toEqual([]);
    expect(NOS_COHORT.overallGuidance).toMatch(/defines no cut-off/i);
  });

  it('applies the AHRQ standard per domain, and attributes it to AHRQ', () => {
    const good = interpretNos(nosScoreAssessment(NOS_COHORT, cohortAll()), { mode: 'ahrq' });
    expect(good.level).toBe('good');
    expect(good.attribution).toMatch(/AHRQ/);
    expect(good.attribution).toMatch(/not part of the Newcastle–Ottawa Scale/i);
    expect(AHRQ_STANDARD.official).toBe(false);
  });

  it('AHRQ makes zero comparability Poor even at 7 of 9 stars — the reason it is not a total', () => {
    const s = nosScoreAssessment(NOS_COHORT, cohortAll([]));
    expect(s.total).toBe(7);
    expect(applyAhrq(s).level).toBe('poor');
    // ...whereas the conventional total-score bands would call the same study "high"
    const conventional = interpretNos(s, { mode: 'custom', bands: NOS_CONVENTIONAL_BANDS });
    expect(conventional.level).toBe('high');
  });

  it('AHRQ separates good from fair on the selection domain', () => {
    const fair = { selection: { S1: 'a', S2: 'a', S3: 'c', S4: 'b' }, comparability: { C1: ['a'] }, outcome: { O1: 'a', O2: 'a', O3: 'a' } };
    const s = nosScoreAssessment(NOS_COHORT, fair);
    expect(s.byDomain.selection.stars).toBe(2);
    expect(applyAhrq(s).level).toBe('fair');
  });

  it('classifies every domain triple deterministically', () => {
    for (let sel = 0; sel <= 4; sel += 1) {
      for (let comp = 0; comp <= 2; comp += 1) {
        for (let out = 0; out <= 3; out += 1) {
          const score = { byDomain: { selection: { stars: sel }, comparability: { stars: comp }, outcome: { stars: out } }, total: sel + comp + out, maxStars: 9 };
          const lvl = applyAhrq(score).level;
          expect(['good', 'fair', 'poor']).toContain(lvl);
          const notPoor = sel >= 2 && comp >= 1 && out >= 2;
          if (!notPoor) expect(lvl).toBe('poor');
          else expect(lvl).toBe(sel >= 3 ? 'good' : 'fair');
        }
      }
    }
  });

  it('offers the 0-3/4-6/7-9 bands only as an opt-in, explicitly-labelled convention', () => {
    expect(NOS_CONVENTIONAL_BANDS_NOTICE).toMatch(/not a rule defined by the Newcastle–Ottawa Scale developers/i);
    const r = interpretNos(nosScoreAssessment(NOS_COHORT, cohortAll()), { mode: 'custom', bands: NOS_CONVENTIONAL_BANDS, label: 'project bands' });
    expect(r.attribution).toMatch(/Project-defined threshold/i);
    expect(r.official).toBe(false);
  });
});
