/**
 * jbiChecklists.test.js — 115.md W1-A. The five JBI checklists: item counts,
 * verbatim item pins, the Yes/No/Unclear/Not-applicable answer set, and the
 * overall-decision PASSTHROUGH (JBI defines no algorithm and no score, so the
 * decision must arrive from the reviewer and leave unchanged).
 */
import { describe, it, expect } from 'vitest';
import {
  JBI_CASE_SERIES,
  JBI_CASE_REPORT,
  JBI_PREVALENCE,
  JBI_CROSS_SECTIONAL,
  JBI_QUALITATIVE,
  JBI_INSTRUMENTS,
  JBI_DECISION_VALUES,
  isJbiInstrumentId,
  judgeDomain,
  judgeOverall,
} from '../../src/research-engine/rob/instruments/jbi.js';
import { getInstrument, completeness, proposeOverall } from '../../src/research-engine/rob/index.js';

const itemsOf = (inst) => inst.domains[0].questions;

describe('the five JBI checklists', () => {
  it('are registered under stable ids', () => {
    expect(JBI_INSTRUMENTS.map((i) => i.id)).toEqual([
      'JBI-CaseSeries', 'JBI-CaseReport', 'JBI-Prevalence', 'JBI-CrossSectional', 'JBI-Qualitative',
    ]);
    expect(isJbiInstrumentId('JBI-Prevalence')).toBe(true);
    expect(isJbiInstrumentId('RoB2')).toBe(false);
  });

  it('have the official item counts: 10 / 8 / 9 / 8 / 10', () => {
    expect(itemsOf(JBI_CASE_SERIES)).toHaveLength(10);
    expect(itemsOf(JBI_CASE_REPORT)).toHaveLength(8);
    expect(itemsOf(JBI_PREVALENCE)).toHaveLength(9);
    expect(itemsOf(JBI_CROSS_SECTIONAL)).toHaveLength(8);
    expect(itemsOf(JBI_QUALITATIVE)).toHaveLength(10);
  });

  it('number their items 1..n and mark them as checklist items', () => {
    for (const inst of JBI_INSTRUMENTS) {
      const qs = itemsOf(inst);
      expect(qs.map((q) => q.id)).toEqual(qs.map((_, i) => String(i + 1)));
      for (const q of qs) expect(q.kind).toBe('item');
    }
  });

  it('pins a few item texts verbatim', () => {
    expect(itemsOf(JBI_CASE_SERIES)[0].text).toBe('Were there clear criteria for inclusion in the case series?');
    expect(itemsOf(JBI_CASE_SERIES)[8].text).toBe('Was there clear reporting of the presenting site(s)/clinic(s) demographic information?');
    expect(itemsOf(JBI_CASE_REPORT)[1].text).toBe("Was the patient's history clearly described and presented as a timeline?");
    expect(itemsOf(JBI_CASE_REPORT)[7].text).toBe('Does the case report provide takeaway lessons?');
    expect(itemsOf(JBI_PREVALENCE)[0].text).toBe('Was the sample frame appropriate to address the target population?');
    expect(itemsOf(JBI_PREVALENCE)[8].text).toBe('Was the response rate adequate, and if not, was the low response rate managed appropriately?');
    expect(itemsOf(JBI_CROSS_SECTIONAL)[4].text).toBe('Were confounding factors identified?');
    expect(itemsOf(JBI_QUALITATIVE)[0].text).toBe('Congruity between the stated philosophical perspective and the research methodology');
    expect(itemsOf(JBI_QUALITATIVE)[9].text).toBe('Conclusions flow from the analysis or interpretation of the data');
  });

  it('records that the qualitative checklist prints its items interrogatively', () => {
    expect(JBI_QUALITATIVE.sourceNote).toMatch(/interrogatively/);
  });

  it('answer Yes / No / Unclear / Not applicable', () => {
    for (const inst of JBI_INSTRUMENTS) {
      expect(inst.responseOptions.map((o) => o.value)).toEqual(['Y', 'N', 'U', 'NA']);
      for (const q of itemsOf(inst)) expect(q.responses).toEqual(['Y', 'N', 'U', 'NA']);
    }
  });

  it('define no score, on any of the five', () => {
    for (const inst of JBI_INSTRUMENTS) {
      expect(inst.scoringAllowed).toBe(false);
      expect(inst.scoring).toBeUndefined();
      expect(inst.maxStars).toBeUndefined();
      expect(inst.overall.computed).toBe(false);
      expect(inst.overall.rule).toBeNull();
      expect(inst.judgmentLevels).toEqual([]);
    }
  });

  it('carry a citation, a guidance URL and a licence note each', () => {
    for (const inst of JBI_INSTRUMENTS) {
      expect(inst.citation).toBeTruthy();
      expect(inst.guidanceUrl).toBe('https://jbi.global/critical-appraisal-tools');
      expect(inst.license).toMatch(/confirmed with JBI/);
      expect(inst.consensusSupported).toBe(true);
    }
  });
});

describe('JBI overall appraisal decision — passthrough, never computed', () => {
  it('offers exactly the three official decisions', () => {
    expect(JBI_DECISION_VALUES).toEqual(['include', 'exclude', 'seek-further-info']);
    expect(JBI_CASE_SERIES.overall.levels.map((l) => l.label)).toEqual(['Include', 'Exclude', 'Seek further info']);
  });

  it('passes each decision straight through, unchanged', () => {
    for (const decision of JBI_DECISION_VALUES) {
      const r = judgeOverall({}, { decision });
      expect(r.judgment).toBe(decision);
      expect(r.reviewerJudged).toBe(true);
      expect(r.computed).toBe(false);
    }
  });

  it('refuses to invent a decision from the item answers', () => {
    const allYes = {};
    for (const q of itemsOf(JBI_CASE_SERIES)) allYes[q.id] = 'Y';
    const r = judgeOverall({ checklist: { judgment: '' } });
    expect(r.judgment).toBe('');
    expect(r.reviewerJudged).toBe(true);
    // Even with a perfect answer set, nothing is proposed.
    const viaEngine = proposeOverall(getInstrument('JBI-CaseSeries'), { checklist: allYes });
    expect(viaEngine.judgment).toBe('');
  });

  it('ignores a decision that is not in the enum', () => {
    expect(judgeOverall({}, { decision: 'maybe' }).judgment).toBe('');
    expect(judgeOverall({}, { decision: 'INCLUDE' }).judgment).toBe('');
  });

  it('reports an answer tally as a count, and calls it a count', () => {
    const r = judgeDomain(JBI_CASE_REPORT, 'checklist', { 1: 'Y', 2: 'Y', 3: 'N', 4: 'NA' });
    expect(r.tally).toEqual({ total: 8, answered: 4, byResponse: { Y: 2, N: 1, NA: 1 } });
    expect(r.judgment).toBe('');
    expect(r.reasons.join(' ')).toMatch(/no domain judgement and no score/);
  });
});

describe('JBI "Not applicable" is a real answer', () => {
  it('the instruments declare it', () => {
    for (const inst of JBI_INSTRUMENTS) expect(inst.naIsAnswer).toBe(true);
  });

  it('an NA answer counts as answered, so a checklist can be completed with one', () => {
    const inst = getInstrument('JBI-CaseReport');
    const answers = {};
    for (const q of itemsOf(inst)) answers[q.id] = 'Y';
    answers['7'] = 'NA';
    const c = completeness(inst, { answersByDomain: { checklist: answers } });
    expect(c.perDomain.checklist.missing).toEqual([]);
    expect(c.overall.complete).toBe(true);
  });

  it('but RoB 2 is unchanged: NA still counts as unanswered there', () => {
    const c = completeness(getInstrument('RoB2'), { answersByDomain: { D1: { '1.1': 'Y', '1.2': 'Y', '1.3': 'NA' } } });
    expect(c.perDomain.D1.missing).toEqual(['1.3']);
  });
});

describe('JBI through the generic engine', () => {
  it('every checklist resolves and reports the right required count', () => {
    const expected = {
      'JBI-CaseSeries': 10, 'JBI-CaseReport': 8, 'JBI-Prevalence': 9, 'JBI-CrossSectional': 8, 'JBI-Qualitative': 10,
    };
    for (const [id, n] of Object.entries(expected)) {
      const inst = getInstrument(id);
      expect(inst.id).toBe(id);
      expect(completeness(inst, { answersByDomain: {} }).overall.required).toBe(n);
    }
  });
});
