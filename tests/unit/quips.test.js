/**
 * quips.test.js — 115.md W1-A. QUIPS structure pins + the two-scale contract.
 *
 * QUIPS is the tool most easily broken in software, because its prompting items
 * and its domain rating use DIFFERENT scales and there is no algorithm between
 * them. These tests pin both scales and the absence of any mapping.
 */
import { describe, it, expect } from 'vitest';
import {
  QUIPS,
  QUIPS_RESPONSES,
  QUIPS_JUDGMENTS,
  COLUMN_INSTRUCTIONS,
  judgeDomain,
  judgeOverall,
} from '../../src/research-engine/rob/instruments/quips.js';
import { getInstrument, completeness, proposeDomain, proposeOverall } from '../../src/research-engine/rob/index.js';

const domain = (id) => QUIPS.domains.find((d) => d.id === id);

describe('QUIPS structure', () => {
  it('has the six official domains, in order', () => {
    expect(QUIPS.domains.map((d) => d.id)).toEqual([
      'participation', 'attrition', 'prognostic-factor', 'outcome', 'confounding', 'analysis',
    ]);
    expect(QUIPS.domains.map((d) => d.name)).toEqual([
      'Study Participation',
      'Study Attrition',
      'Prognostic Factor Measurement',
      'Outcome Measurement',
      'Study Confounding',
      'Statistical Analysis and Reporting',
    ]);
  });

  it('carries the printed prompting items, 7 + 5 + 6 + 3 + 7 + 4 = 32', () => {
    expect(QUIPS.domains.map((d) => d.questions.length)).toEqual([7, 5, 6, 3, 7, 4]);
    expect(QUIPS.domains.reduce((n, d) => n + d.questions.length, 0)).toBe(32);
  });

  it('pins the goal statement of each domain verbatim', () => {
    expect(domain('participation').goal).toBe('To judge the risk of selection bias (likelihood that relationship between PF and outcome is different for participants and eligible non-participants).');
    expect(domain('confounding').goal).toBe('To judge the risk of bias due to confounding (i.e. the effect of PF is distorted by another factor that is related to PF and outcome).');
    expect(domain('analysis').goal).toBe('To judge the risk of bias related to the statistical analysis and presentation of results.');
  });

  it('pins a few prompting items verbatim, including the tool\'s own PF and (LIST) placeholders', () => {
    expect(domain('participation').questions[0].text).toBe('The source population or population of interest is adequately described for key characteristics (LIST).');
    expect(domain('participation').questions[2].text).toBe('Period of recruitment is adequately described');
    expect(domain('attrition').questions[0].text).toBe('Response rate (i.e., proportion of study sample completing the study and providing outcome data) is adequate.');
    expect(domain('prognostic-factor').questions[2].text).toBe('Continuous variables are reported or appropriate cut-points (i.e., not data-dependent) are used.');
    expect(domain('analysis').questions[3].text).toBe('There is no selective reporting of results.');
  });

  it('keeps the printed "Biases" column label on each prompting item', () => {
    expect(domain('outcome').questions.map((q) => q.bias)).toEqual([
      'Definition of the Outcome',
      'Valid and Reliable Measurement of Outcome',
      'Method and Setting of Outcome Measurement',
    ]);
  });

  it('carries each domain\'s printed SUMMARY statement as the judgement prompt', () => {
    expect(domain('outcome').judgment.prompt).toBe('Outcome of interest is adequately measured in study participants to sufficiently limit potential bias.');
    expect(domain('analysis').judgment.prompt).toBe('The statistical analysis is appropriate for the design of the study, limiting potential for presentation of invalid or spurious results.');
    // The summary is the claim the rating judges — not a 33rd prompting item.
    for (const d of QUIPS.domains) {
      expect(d.questions.map((q) => q.text)).not.toContain(d.judgment.prompt);
    }
  });
});

describe('QUIPS has two scales and they are different scales', () => {
  it('prompting items rate ADEQUACY OF REPORTING: yes / partial / no / unsure', () => {
    expect(QUIPS_RESPONSES).toEqual(['Y', 'PARTIAL', 'N', 'UNSURE']);
    expect(QUIPS.responseOptions.map((o) => o.label)).toEqual(['Yes', 'Partial', 'No', 'Unsure']);
    for (const d of QUIPS.domains) for (const q of d.questions) expect(q.responses).toEqual(QUIPS_RESPONSES);
  });

  it('domains rate RISK OF BIAS: Low / Moderate / High', () => {
    expect(QUIPS_JUDGMENTS).toEqual(['low', 'moderate', 'high']);
    for (const d of QUIPS.domains) {
      expect(d.judgment.levels.map((l) => l.value)).toEqual(['low', 'moderate', 'high']);
      expect(d.judgment.levels.map((l) => l.label)).toEqual(['Low risk of bias', 'Moderate risk of bias', 'High risk of bias']);
    }
  });

  it('the two scales share no value, so they can never be confused', () => {
    const responses = new Set(QUIPS_RESPONSES);
    for (const j of QUIPS_JUDGMENTS) expect(responses.has(j)).toBe(false);
  });

  it('keeps the tool\'s own column instructions', () => {
    expect(COLUMN_INSTRUCTIONS.issues).toMatch(/taken together to inform the overall judgment/);
    expect(COLUMN_INSTRUCTIONS.risk).toMatch(/High, Moderate, or Low/);
  });
});

describe('QUIPS domain rating is the assessor\'s, never computed', () => {
  it('every domain declares computed: false', () => {
    for (const d of QUIPS.domains) expect(d.judgment.computed).toBe(false);
  });

  it('a fully-answered domain still proposes nothing', () => {
    const answers = {};
    for (const q of domain('outcome').questions) answers[q.id] = 'Y';
    const r = judgeDomain('outcome', answers);
    expect(r.judgment).toBe('');
    expect(r.reviewerJudged).toBe(true);
    expect(r.tally).toEqual({ total: 3, answered: 3, byResponse: { Y: 3 } });
  });

  it('passes the assessor\'s rating through when one is supplied', () => {
    for (const rating of QUIPS_JUDGMENTS) {
      const r = judgeDomain('attrition', {}, { rating });
      expect(r.judgment).toBe(rating);
      expect(r.reviewerJudged).toBe(true);
      expect(r.computed).toBe(false);
    }
  });

  it('ignores a rating outside the domain enum', () => {
    expect(judgeDomain('attrition', {}, { rating: 'some' }).judgment).toBe('');
    expect(judgeDomain('attrition', {}, { rating: 'serious' }).judgment).toBe('');
    expect(judgeDomain('attrition', {}, { rating: 'HIGH' }).judgment).toBe('');
  });

  it('rejects an unknown domain', () => {
    expect(() => judgeDomain('nope', {})).toThrow(/Unknown QUIPS domain/);
  });
});

describe('QUIPS defines no overall judgement and no score', () => {
  it('the overall axis is flagged unofficial and uncomputed', () => {
    expect(QUIPS.overall.computed).toBe(false);
    expect(QUIPS.overall.official).toBe(false);
    expect(QUIPS.overall.rule).toBeNull();
    expect(QUIPS.overall.guidance).toMatch(/defines no overall algorithm and no numeric score/);
    expect(QUIPS.scoringAllowed).toBe(false);
    expect(QUIPS.scoring).toBeUndefined();
    expect(QUIPS.maxStars).toBeUndefined();
  });

  it('proposes nothing from the domain ratings', () => {
    const r = judgeOverall({ participation: 'low', attrition: 'low', 'prognostic-factor': 'low', outcome: 'low', confounding: 'low', analysis: 'low' });
    expect(r.judgment).toBe('');
    expect(r.official).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/domain-level ratings only/);
  });

  it('passes a review team\'s own summary rating through, stamped unofficial', () => {
    const r = judgeOverall({}, { rating: 'low' });
    expect(r.judgment).toBe('low');
    expect(r.official).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/not a QUIPS output/);
  });
});

describe('QUIPS through the generic engine', () => {
  it('is registered and completeness counts the 32 prompting items', () => {
    const inst = getInstrument('QUIPS');
    expect(inst.id).toBe('QUIPS');
    const c = completeness(inst, { answersByDomain: {} });
    expect(c.overall.required).toBe(32);
    expect(c.perDomain.confounding.required).toBe(7);
    expect(proposeDomain(inst, 'analysis', {}).judgment).toBe('');
    expect(proposeOverall(inst, {}).judgment).toBe('');
  });
});
