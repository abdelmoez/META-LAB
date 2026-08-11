/**
 * probast.test.js — 115.md W1-A. PROBAST structure pins + the official Step 4
 * overall rules for BOTH axes.
 *
 * Text is pinned against the official assessment form
 * (probast.org, PROBAST_20190515.pdf).
 */
import { describe, it, expect } from 'vitest';
import {
  PROBAST,
  PROBAST_RESPONSES,
  EVALUATION_TYPES,
  judgeDomain,
  judgeApplicability,
  judgeOverall,
  judgeOverallApplicability,
} from '../../src/research-engine/rob/instruments/probast.js';
import {
  getInstrument, completeness, proposeDomain, proposeOverall, applicabilityDomainId,
} from '../../src/research-engine/rob/index.js';

const domain = (id) => PROBAST.domains.find((d) => d.id === id);
const ALL_LOW = { D1: 'low', D2: 'low', D3: 'low', D4: 'low' };

describe('PROBAST structure', () => {
  it('has four domains in the official order', () => {
    expect(PROBAST.domains.map((d) => d.id)).toEqual(['D1', 'D2', 'D3', 'D4']);
    expect(PROBAST.domains.map((d) => d.name)).toEqual(['Participants', 'Predictors', 'Outcome', 'Analysis']);
  });

  it('has exactly twenty signalling questions, 2 + 3 + 6 + 9', () => {
    expect(PROBAST.domains.map((d) => d.questions.length)).toEqual([2, 3, 6, 9]);
    const all = PROBAST.domains.flatMap((d) => d.questions);
    expect(all).toHaveLength(20);
    expect(all.map((q) => q.id)).toEqual([
      '1.1', '1.2',
      '2.1', '2.2', '2.3',
      '3.1', '3.2', '3.3', '3.4', '3.5', '3.6',
      '4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8', '4.9',
    ]);
    for (const q of all) expect(q.kind).toBe('signaling');
  });

  it('pins the signalling question text verbatim (form wording, not the E&E variants)', () => {
    const text = (d, q) => domain(d).questions.find((x) => x.id === q).text;
    expect(text('D1', '1.1')).toBe('Were appropriate data sources used, e.g. cohort, RCT or nested case-control study data?');
    expect(text('D1', '1.2')).toBe('Were all inclusions and exclusions of participants appropriate?');
    expect(text('D2', '2.3')).toBe('Are all predictors available at the time the model is intended to be used?');
    // The form prints "pre-specified"; the E&E paper prints "prespecified".
    expect(text('D3', '3.2')).toBe('Was a pre-specified or standard outcome definition used?');
    expect(text('D3', '3.3')).toBe('Were predictors excluded from the outcome definition?');
    expect(text('D4', '4.1')).toBe('Were there a reasonable number of participants with the outcome?');
    expect(text('D4', '4.5')).toBe('Was selection of predictors based on univariable analysis avoided?');
    // The form prints "sampling of controls"; the E&E paper prints "control participants".
    expect(text('D4', '4.6')).toBe('Were complexities in the data (e.g. censoring, competing risks, sampling of controls) accounted for appropriately?');
    expect(text('D4', '4.9')).toBe('Do predictors and their assigned weights in the final model correspond to the results from multivariable analysis?');
  });

  it('pins the four domain-level risk prompts verbatim', () => {
    expect(domain('D1').judgment.prompt).toBe('Risk of bias introduced by selection of participants');
    expect(domain('D2').judgment.prompt).toBe('Risk of bias introduced by predictors or their assessment');
    // The E&E paper reprints D2's prompt over D3 by mistake; the form is correct.
    expect(domain('D3').judgment.prompt).toBe('Risk of bias introduced by the outcome or its determination');
    expect(domain('D4').judgment.prompt).toBe('Risk of bias introduced by the analysis');
  });

  it('answers Y / PY / PN / N / NI, plus the explicit stand-in for the form\'s shaded boxes', () => {
    expect(PROBAST_RESPONSES).toEqual(['Y', 'PY', 'PN', 'N', 'NI', 'NA']);
    expect(PROBAST.naIsAnswer).toBe(true);
    expect(PROBAST.responseOptions.find((o) => o.value === 'NI').label).toBe('No information');
  });

  it('is judged per model evaluation, with the form\'s Dev / Val distinction', () => {
    expect(PROBAST.perModelEvaluation).toBe(true);
    expect(EVALUATION_TYPES.map((t) => t.value)).toEqual(['development', 'validation', 'development-and-validation']);
  });

  it('defines no score', () => {
    expect(PROBAST.scoringAllowed).toBe(false);
    expect(PROBAST.scoring).toBeUndefined();
    expect(PROBAST.maxStars).toBeUndefined();
  });
});

describe('PROBAST applicability is a separate axis', () => {
  it('covers the first three domains only', () => {
    expect(PROBAST.domains.filter((d) => d.applicability).map((d) => d.id)).toEqual(['D1', 'D2', 'D3']);
    expect(domain('D4').applicability).toBeUndefined();
    expect(() => judgeApplicability('D4', 'low')).toThrow(/no applicability section/);
  });

  it('pins the three applicability prompts verbatim', () => {
    expect(domain('D1').applicability.prompt).toBe('Concern that the included participants and setting do not match the review question');
    expect(domain('D2').applicability.prompt).toBe('Concern that the definition, assessment or timing of predictors in the model do not match the review question');
    expect(domain('D3').applicability.prompt).toBe('Concern that the outcome, its definition, timing or determination do not match the review question');
  });

  it('is reviewer-judged and independent of the risk-of-bias axis', () => {
    for (const id of ['D1', 'D2', 'D3']) expect(domain(id).applicability.computed).toBe(false);
    const rob = judgeDomain('D2', { '2.1': 'Y', '2.2': 'PY', '2.3': 'Y' });
    expect(rob.judgment).toBe('low');
    expect(judgeApplicability('D2', 'high').judgment).toBe('high');
    expect(applicabilityDomainId('D2')).toBe('D2-APP');
  });

  it('ignores a concern level outside the enum', () => {
    expect(judgeApplicability('D1', 'moderate').judgment).toBe('');
    expect(judgeApplicability('D1').judgment).toBe('');
  });
});

describe('PROBAST domain judgement rule', () => {
  const all = (d, v) => Object.fromEntries(domain(d).questions.map((q) => [q.id, v]));

  it('every applicable question Yes/Probably yes → Low', () => {
    expect(judgeDomain('D1', { '1.1': 'Y', '1.2': 'PY' }).judgment).toBe('low');
    expect(judgeDomain('D4', all('D4', 'Y')).judgment).toBe('low');
  });

  it('"No information" with no flagged question → Unclear', () => {
    expect(judgeDomain('D2', { '2.1': 'Y', '2.2': 'NI', '2.3': 'Y' }).judgment).toBe('unclear');
  });

  it('a No / Probably no FLAGS the potential for bias but never auto-proposes High', () => {
    const r = judgeDomain('D3', { ...all('D3', 'Y'), '3.5': 'PN' });
    expect(r.judgment).toBe('');
    expect(r.reviewerJudged).toBe(true);
    expect(r.flaggedQuestions).toEqual(['3.5']);
    expect(r.reasons.join(' ')).toMatch(/flags the potential for bias/);
  });

  it('a flagged question wins over a No-information one', () => {
    const r = judgeDomain('D2', { '2.1': 'NI', '2.2': 'N', '2.3': 'Y' });
    expect(r.judgment).toBe('');
    expect(r.flaggedQuestions).toEqual(['2.2']);
  });

  it('a partly-answered domain proposes nothing', () => {
    expect(judgeDomain('D1', { '1.1': 'Y' }).judgment).toBe('');
  });

  it('skips questions marked not applicable (the form\'s shaded boxes)', () => {
    const r = judgeDomain('D2', { '2.1': 'Y', '2.2': 'NA', '2.3': 'Y' });
    expect(r.judgment).toBe('low');
  });
});

describe('PROBAST overall risk of bias (Step 4)', () => {
  it('all four domains low → Low', () => {
    const r = judgeOverall(ALL_LOW);
    expect(r.judgment).toBe('low');
    expect(r.reasons.join(' ')).toMatch(/All domains were rated low risk of bias/);
    expect(r.considerDowngrade).toBe(false);
  });

  it('at least one domain high → High, whatever the rest are', () => {
    expect(judgeOverall({ ...ALL_LOW, D3: 'high' }).judgment).toBe('high');
    expect(judgeOverall({ D1: 'unclear', D2: 'unclear', D3: 'unclear', D4: 'high' }).judgment).toBe('high');
    expect(judgeOverall({ D1: 'high', D2: 'high', D3: 'high', D4: 'high' }).judgment).toBe('high');
  });

  it('an unclear domain with the rest low → Unclear', () => {
    expect(judgeOverall({ ...ALL_LOW, D2: 'unclear' }).judgment).toBe('unclear');
    expect(judgeOverall({ D1: 'unclear', D2: 'unclear', D3: 'low', D4: 'low' }).judgment).toBe('unclear');
  });

  it('high beats unclear', () => {
    expect(judgeOverall({ D1: 'unclear', D2: 'low', D3: 'high', D4: 'low' }).judgment).toBe('high');
  });

  it('will not roll up an incomplete set of domain judgements', () => {
    const r = judgeOverall({ D1: 'low', D2: 'low' });
    expect(r.judgment).toBe('');
    expect(r.reviewerJudged).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/D3, D4/);
  });

  it('accepts the engine\'s {judgment} objects as well as bare strings', () => {
    expect(judgeOverall({ D1: { judgment: 'low' }, D2: { judgment: 'low' }, D3: { judgment: 'low' }, D4: { judgment: 'high' } }).judgment).toBe('high');
  });

  it('flags the development-without-external-validation downgrade caveat', () => {
    const plain = judgeOverall(ALL_LOW);
    expect(plain.considerDowngrade).toBe(false);
    const devOnly = judgeOverall(ALL_LOW, { evaluationType: 'development' });
    expect(devOnly.judgment).toBe('low');
    expect(devOnly.considerDowngrade).toBe(true);
    expect(devOnly.reasons.join(' ')).toMatch(/consider downgrading to high risk of bias/);
    // A high overall is never "downgradeable" — the caveat applies to all-low only.
    expect(judgeOverall({ ...ALL_LOW, D1: 'high' }, { evaluationType: 'development' }).considerDowngrade).toBe(false);
  });
});

describe('PROBAST overall applicability (Step 4)', () => {
  const APP_LOW = { 'D1-APP': 'low', 'D2-APP': 'low', 'D3-APP': 'low' };

  it('all three domains low concern → Low', () => {
    expect(judgeOverallApplicability(APP_LOW).judgment).toBe('low');
  });

  it('any high concern → High', () => {
    expect(judgeOverallApplicability({ ...APP_LOW, 'D2-APP': 'high' }).judgment).toBe('high');
    expect(judgeOverallApplicability({ 'D1-APP': 'unclear', 'D2-APP': 'high', 'D3-APP': 'low' }).judgment).toBe('high');
  });

  it('unclear with no high → Unclear', () => {
    expect(judgeOverallApplicability({ ...APP_LOW, 'D3-APP': 'unclear' }).judgment).toBe('unclear');
  });

  it('reads the nested shape too', () => {
    const nested = { D1: { applicability: 'low' }, D2: { applicability: 'low' }, D3: { applicability: 'high' } };
    expect(judgeOverallApplicability(nested).judgment).toBe('high');
  });

  it('will not roll up an incomplete set', () => {
    expect(judgeOverallApplicability({ 'D1-APP': 'low' }).judgment).toBe('');
  });

  it('rides along on the overall risk-of-bias result, so both axes travel together', () => {
    const r = judgeOverall({ ...ALL_LOW, ...APP_LOW });
    expect(r.judgment).toBe('low');
    expect(r.applicability.judgment).toBe('low');
    // …and stays independent of it.
    const mixed = judgeOverall({ ...ALL_LOW, 'D1-APP': 'high', 'D2-APP': 'low', 'D3-APP': 'low' });
    expect(mixed.judgment).toBe('low');
    expect(mixed.applicability.judgment).toBe('high');
  });
});

describe('PROBAST through the generic engine', () => {
  it('is registered, dispatches, and requires all twenty questions', () => {
    const inst = getInstrument('PROBAST');
    expect(inst.id).toBe('PROBAST');
    expect(proposeDomain(inst, 'D1', { '1.1': 'Y', '1.2': 'Y' }).judgment).toBe('low');
    expect(proposeOverall(inst, ALL_LOW).judgment).toBe('low');
    expect(completeness(inst, { answersByDomain: {} }).overall.required).toBe(20);
  });

  // The evaluation type used to be unreachable: the definition hard-coded
  // `variant: 'development-and-validation'`, nothing ever passed an
  // `evaluationType`, and `proposeOverall` dropped its second argument on the
  // floor — so the official downgrade caveat for a model developed with NO
  // external validation could never fire. It now travels through the engine.
  it('carries the evaluation type through to the Step 4 downgrade caveat', () => {
    const inst = getInstrument('PROBAST');
    const dev = proposeOverall(inst, ALL_LOW, { evaluationType: 'development' });
    expect(dev.judgment).toBe('low');
    expect(dev.considerDowngrade).toBe(true);
    expect(dev.reasons.join(' ')).toMatch(/consider downgrading to high risk of bias/);

    // The default evaluation (development AND validation) carries no caveat…
    const both = proposeOverall(inst, ALL_LOW, { evaluationType: 'development-and-validation' });
    expect(both.considerDowngrade).toBe(false);
    // …and neither does omitting it, so the twelve other tools are unaffected.
    expect(proposeOverall(inst, ALL_LOW).considerDowngrade).toBe(false);
  });

  it('declares the closed set of evaluation types a reviewer may pick from', () => {
    const inst = getInstrument('PROBAST');
    expect(inst.evaluationTypes.map((t) => t.value))
      .toEqual(['development', 'validation', 'development-and-validation']);
    expect(EVALUATION_TYPES.map((t) => t.value)).toEqual(inst.evaluationTypes.map((t) => t.value));
    // The definition's own variant remains the DEFAULT, so a row created without a
    // choice behaves exactly as it did.
    expect(inst.variant).toBe('development-and-validation');
    // No other instrument offers a choice — their variant is a definition constant.
    for (const id of ['RoB2', 'ROBINS-I', 'NOS', 'NOS-CC', 'QUADAS-2', 'AMSTAR-2', 'QUIPS']) {
      expect(getInstrument(id).evaluationTypes, id).toBeUndefined();
    }
  });

  it('an NA answer counts as answered, so a shaded question does not block completion', () => {
    const inst = getInstrument('PROBAST');
    const answersByDomain = {};
    for (const d of PROBAST.domains) {
      answersByDomain[d.id] = Object.fromEntries(d.questions.map((q) => [q.id, 'Y']));
    }
    answersByDomain.D3['3.6'] = 'NA';
    expect(completeness(inst, { answersByDomain }).overall.complete).toBe(true);
  });
});
