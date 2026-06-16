/**
 * rob2-engine.test.js — golden tests for the generic RoB engine functions:
 * overall roll-up (official Table 1), branching (nextQuestions), completeness,
 * summaryMatrix, determinism, and getInstrument. See rob-validation.md.
 */
import { describe, it, expect } from 'vitest';
import {
  ROB2,
  getInstrument,
  nextQuestions,
  isReachable,
  proposeDomain,
  proposeAllDomains,
  proposeOverall,
  completeness,
  summaryMatrix,
  judgeOverall,
} from '../../src/research-engine/rob/index.js';

// ── Overall roll-up — official Table 1 ────────────────────────────────────────
describe('RoB2 overall roll-up (Table 1)', () => {
  it('Low when every domain is Low', () => {
    const r = judgeOverall({ D1: 'low', D2: 'low', D3: 'low', D4: 'low', D5: 'low' });
    expect(r.judgment).toBe('low');
    expect(r.multiSomeConcernsFlag).toBe(false);
  });
  it('Some when ≥1 Some and none High', () => {
    const r = judgeOverall({ D1: 'low', D2: 'some', D3: 'low', D4: 'low', D5: 'low' });
    expect(r.judgment).toBe('some');
    expect(r.multiSomeConcernsFlag).toBe(false);
  });
  it('High when ≥1 High (dominates any number of Some)', () => {
    const r = judgeOverall({ D1: 'some', D2: 'some', D3: 'high', D4: 'low', D5: 'some' });
    expect(r.judgment).toBe('high');
  });
  it('multiSomeConcernsFlag set when ≥2 Some and no High', () => {
    const r = judgeOverall({ D1: 'some', D2: 'some', D3: 'low', D4: 'low', D5: 'low' });
    expect(r.judgment).toBe('some');
    expect(r.multiSomeConcernsFlag).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/additive|escalat/i);
  });
  it('accepts an array of {judgment} objects too', () => {
    const r = judgeOverall([{ judgment: 'low' }, { judgment: 'high' }]);
    expect(r.judgment).toBe('high');
  });
  it('proposeOverall delegates to judgeOverall', () => {
    expect(proposeOverall(ROB2, { D1: 'low', D2: 'low', D3: 'low', D4: 'low', D5: 'low' }).judgment).toBe('low');
  });
});

// ── Branching — nextQuestions reveals/hides exactly the reachable set ──────────
describe('RoB2 branching (nextQuestions)', () => {
  it('D2: 2.3 hidden until 2.1/2.2 indicate awareness', () => {
    const hidden = nextQuestions(ROB2, 'D2', { '2.1': 'N', '2.2': 'N' }).map(q => q.id);
    expect(hidden).not.toContain('2.3');
    expect(hidden).not.toContain('2.4');
    expect(hidden).toContain('2.1');
    expect(hidden).toContain('2.6');

    const shown = nextQuestions(ROB2, 'D2', { '2.1': 'Y', '2.2': 'N' }).map(q => q.id);
    expect(shown).toContain('2.3');
  });
  it('D2: 2.4 shown only when 2.3 = Y/PY; 2.5 only when 2.4 = Y/PY/NI', () => {
    expect(nextQuestions(ROB2, 'D2', { '2.1': 'Y', '2.3': 'N' }).map(q => q.id)).not.toContain('2.4');
    expect(nextQuestions(ROB2, 'D2', { '2.1': 'Y', '2.3': 'Y' }).map(q => q.id)).toContain('2.4');
    expect(nextQuestions(ROB2, 'D2', { '2.1': 'Y', '2.3': 'Y', '2.4': 'NI' }).map(q => q.id)).toContain('2.5');
    expect(nextQuestions(ROB2, 'D2', { '2.1': 'Y', '2.3': 'Y', '2.4': 'N' }).map(q => q.id)).not.toContain('2.5');
  });
  it('D2: 2.7 shown only when 2.6 = N/PN/NI', () => {
    expect(nextQuestions(ROB2, 'D2', { '2.6': 'Y' }).map(q => q.id)).not.toContain('2.7');
    expect(nextQuestions(ROB2, 'D2', { '2.6': 'N' }).map(q => q.id)).toContain('2.7');
  });
  it('D3: 3.2/3.3/3.4 chain reveals correctly', () => {
    expect(nextQuestions(ROB2, 'D3', { '3.1': 'Y' }).map(q => q.id)).toEqual(['3.1']);
    expect(nextQuestions(ROB2, 'D3', { '3.1': 'N' }).map(q => q.id)).toEqual(['3.1', '3.2']);
    expect(nextQuestions(ROB2, 'D3', { '3.1': 'N', '3.2': 'N' }).map(q => q.id)).toEqual(['3.1', '3.2', '3.3']);
    expect(nextQuestions(ROB2, 'D3', { '3.1': 'N', '3.2': 'N', '3.3': 'Y' }).map(q => q.id)).toEqual(['3.1', '3.2', '3.3', '3.4']);
  });
  it('D4: 4.3 needs BOTH 4.1 and 4.2 = N/PN/NI', () => {
    expect(nextQuestions(ROB2, 'D4', { '4.1': 'Y', '4.2': 'N' }).map(q => q.id)).not.toContain('4.3');
    expect(nextQuestions(ROB2, 'D4', { '4.1': 'N', '4.2': 'N' }).map(q => q.id)).toContain('4.3');
  });
  it('D1 and D5 questions are always reachable', () => {
    expect(nextQuestions(ROB2, 'D1', {}).map(q => q.id)).toEqual(['1.1', '1.2', '1.3']);
    expect(nextQuestions(ROB2, 'D5', {}).map(q => q.id)).toEqual(['5.1', '5.2', '5.3']);
  });
  it('isReachable matches nextQuestions for a sample question', () => {
    const q24 = ROB2.domains.find(d => d.id === 'D2').questions.find(q => q.id === '2.4');
    expect(isReachable(q24, { '2.3': 'Y' })).toBe(true);
    expect(isReachable(q24, { '2.3': 'N' })).toBe(false);
  });
});

// ── Completeness — finalise must be blocked until reachable answered ───────────
describe('RoB2 completeness', () => {
  it('reports missing reachable questions per domain', () => {
    const c = completeness(ROB2, { answersByDomain: { D1: { '1.1': 'Y', '1.2': 'Y' } } });
    expect(c.perDomain.D1.required).toBe(3);
    expect(c.perDomain.D1.answered).toBe(2);
    expect(c.perDomain.D1.missing).toEqual(['1.3']);
    expect(c.overall.complete).toBe(false);
  });
  it('branched-away questions are NOT required', () => {
    // 3.1 = Y hides 3.2/3.3/3.4 → domain complete with one answer.
    const c = completeness(ROB2, { answersByDomain: { D3: { '3.1': 'Y' } } });
    expect(c.perDomain.D3.required).toBe(1);
    expect(c.perDomain.D3.missing).toEqual([]);
  });
  it('a fully-answered assessment is complete', () => {
    const answersByDomain = {
      D1: { '1.1': 'Y', '1.2': 'Y', '1.3': 'N' },
      D2: { '2.1': 'N', '2.2': 'N', '2.6': 'Y' },
      D3: { '3.1': 'Y' },
      D4: { '4.1': 'N', '4.2': 'N', '4.3': 'N' },
      D5: { '5.1': 'Y', '5.2': 'N', '5.3': 'N' },
    };
    const c = completeness(ROB2, { answersByDomain });
    expect(c.overall.complete).toBe(true);
    for (const d of ['D1', 'D2', 'D3', 'D4', 'D5']) expect(c.perDomain[d].missing).toEqual([]);
  });
  it('NA-valued answers count as unanswered', () => {
    const c = completeness(ROB2, { answersByDomain: { D1: { '1.1': 'Y', '1.2': 'Y', '1.3': 'NA' } } });
    expect(c.perDomain.D1.missing).toEqual(['1.3']);
  });
});

// ── summaryMatrix feeds the traffic-light plot ────────────────────────────────
describe('RoB2 summaryMatrix', () => {
  it('builds rows × (5 domains + overall) from assessments', () => {
    const m = summaryMatrix([
      { id: 'a1', label: 'Smith 2020', domainJudgments: { D1: 'low', D2: 'some', D3: 'low', D4: 'low', D5: 'high' }, overall: 'high' },
    ]);
    expect(m.domains.map(d => d.id)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].cells.find(c => c.domainId === 'D5').judgment).toBe('high');
    expect(m.rows[0].overall).toBe('high');
  });
  it('handles an empty list', () => {
    expect(summaryMatrix([]).rows).toEqual([]);
  });
});

// ── Determinism + instrument access ───────────────────────────────────────────
describe('RoB2 engine determinism + instrument', () => {
  it('same answers → identical proposals, always', () => {
    const answers = { '1.1': 'NI', '1.2': 'Y', '1.3': 'N' };
    const a = proposeDomain(ROB2, 'D1', answers);
    const b = proposeDomain(ROB2, 'D1', answers);
    expect(a).toEqual(b);
    expect(a.judgment).toBe('low');
  });
  it('proposeAllDomains returns a judgement for each domain', () => {
    const all = proposeAllDomains(ROB2, {
      D1: { '1.1': 'Y', '1.2': 'Y', '1.3': 'N' },
      D2: { '2.1': 'N', '2.2': 'N', '2.6': 'Y' },
      D3: { '3.1': 'Y' },
      D4: { '4.1': 'N', '4.2': 'N', '4.3': 'N' },
      D5: { '5.1': 'Y', '5.2': 'N', '5.3': 'N' },
    });
    expect(Object.keys(all)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
    expect(Object.values(all).every(d => d.judgment === 'low')).toBe(true);
    // → overall Low
    expect(proposeOverall(ROB2, all).judgment).toBe('low');
  });
  it('getInstrument returns the frozen RoB2 instrument', () => {
    const inst = getInstrument('RoB2');
    expect(inst.id).toBe('RoB2');
    expect(inst.domains).toHaveLength(5);
    expect(Object.isFrozen(inst)).toBe(true);
    expect(() => getInstrument('NOPE')).toThrow();
  });
  it('instrument data is JSON-serialisable (no functions leak into ROB2)', () => {
    const json = JSON.stringify(ROB2);
    const round = JSON.parse(json);
    expect(round.domains).toHaveLength(5);
    expect(round.domains[0].questions[0]).toHaveProperty('text');
    expect(round.domains[1].questions.find(q => q.id === '2.3').branch).toBeTruthy();
  });
});
